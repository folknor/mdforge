import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConfig } from "../src/lib/config.ts";
import {
  buildPageHtml,
  RemoteLoad,
  stylesheetLoadWarnings,
  writeScratchPage,
} from "../src/lib/page-load.ts";
import { prepareConversion } from "../src/lib/prepare.ts";

/** A promise that never settles, like a request to a server that never answers. */
const never = (): Promise<never> => new Promise(() => undefined);

describe("RemoteLoad", () => {
  it("tracks only remote requests, and drains when they settle", async () => {
    const load = new RemoteLoad<string | number>(1000);

    assert.equal(load.admit(1, "file:///doc/a.png"), true);
    assert.equal(load.admit(2, "https://example.test/a.css"), true);
    assert.deepEqual(load.pending(), ["https://example.test/a.css"]);

    const drained = load.drained();
    load.settle(1);
    load.settle(2);
    await drained;
    assert.deepEqual(load.pending(), []);
  });

  it("finishes without warnings when everything loads in time", async () => {
    const load = new RemoteLoad<string | number>(1000);

    await load.run(
      [
        async () => {
          load.admit("css", "https://example.test/a.css");
          setTimeout(() => load.settle("css"), 5);
        },
      ],
      () => [],
    );

    assert.equal(load.timedOut, false);
    assert.deepEqual(load.warnings(), []);
  });

  it("stops at the deadline, cancels what is outstanding and names it", async () => {
    const load = new RemoteLoad<string | number>(20);
    let stopped = 0;
    let laterStageRan = false;

    await load.run(
      [
        async () => {
          load.admit("img", "http://hang.test/i.png");
          await never();
        },
        async () => {
          laterStageRan = true;
        },
      ],
      () => {
        stopped++;
        load.settle("img");

        return [];
      },
    );

    assert.equal(load.timedOut, true);
    assert.equal(stopped, 1);
    assert.equal(laterStageRan, false, "no stage starts after the deadline");
    assert.deepEqual(load.cutAtClose, ["http://hang.test/i.png"]);
    assert.deepEqual(load.warnings(), [
      "Remote content did not finish loading within 0.02 seconds and was left out: http://hang.test/i.png.",
    ]);
  });

  it("bounds the wait for remote requests the stages did not await", async () => {
    const load = new RemoteLoad<string | number>(20);

    await load.run(
      [
        async () => {
          load.admit("font", "https://hang.test/f.woff2");
        },
      ],
      () => [never()],
      10,
    );

    assert.equal(load.timedOut, true);
    assert.deepEqual(load.warnings(), [
      "Remote content was still loading when the document was printed, so it may be missing: https://hang.test/f.woff2.",
    ]);
  });

  it("refuses remote requests once loading has ended, but not local ones", async () => {
    const load = new RemoteLoad<string | number>(1000);

    await load.run([], () => []);

    assert.equal(load.admit(1, "https://late.test/x.png"), false);
    assert.equal(load.admit(2, "file:///doc/x.png"), true);
    assert.deepEqual(load.warnings(), [
      "Remote content requested after the page had finished loading was left out: https://late.test/x.png.",
    ]);
  });

  it("fails when a stage fails before the deadline", async () => {
    const load = new RemoteLoad<string | number>(1000);

    await assert.rejects(
      load.run(
        [
          async () => {
            throw new Error("navigation failed");
          },
        ],
        () => [],
      ),
      /navigation failed/,
    );
  });

  it("survives a stop that throws or never settles", async () => {
    const load = new RemoteLoad<string | number>(10);

    await load.run(
      [
        async () => {
          load.admit("a", "https://hang.test/a");
          await never();
        },
      ],
      () => {
        throw new Error("frame gone");
      },
      10,
    );

    assert.equal(load.timedOut, true);
  });
});

describe("buildPageHtml", () => {
  it("puts base and stylesheets in the head in cascade order, and the marker last in the body", async () => {
    const prepared = await prepareConversion(
      { content: "# Hi\n", baseDir: "/doc" },
      {
        ...structuredClone(defaultConfig),
        stylesheet: [
          { type: "content", value: "p{}" },
          { type: "url", value: "https://x.test/s.css" },
        ],
      },
      { output: { kind: "none" } },
    );

    const html = buildPageHtml(prepared, "MARK");

    assert.match(html, /<head><base href="file:\/\/\/doc\/">/);
    const watch = html.indexOf("<script>(function watchStylesheetLoads(");
    const style = html.indexOf("<style>p{}</style>");
    const link = html.indexOf('<link rel="stylesheet" href="https://x.test/s.css">');
    assert.ok(watch !== -1 && style > watch, "the load watch comes before every stylesheet");
    assert.ok(html.includes('})("MARK")</script>'), "the watch is named by the marker");
    assert.ok(style !== -1 && link > style, "stylesheets keep their order");
    assert.match(html, /<!--MARK--><\/body>/);
  });
});

describe("stylesheetLoadWarnings", () => {
  it("is silent when every stylesheet loaded and the watch saw it all", () => {
    assert.deepEqual(
      stylesheetLoadWarnings({ complete: true, failedStylesheets: [], watched: true }),
      [],
    );
  });

  it("names each failed stylesheet once, in order", () => {
    const [warning, ...rest] = stylesheetLoadWarnings({
      complete: true,
      failedStylesheets: [
        "https://x.test/a.css",
        "<style> element number 2",
        "https://x.test/a.css",
      ],
      watched: true,
    });

    assert.equal(rest.length, 0);
    assert.match(warning ?? "", /could not be loaded/);
    assert.ok(warning?.endsWith(": https://x.test/a.css, <style> element number 2."));
  });

  it("says when the check could not cover the load, keeping what it saw", () => {
    const warnings = stylesheetLoadWarnings({
      complete: true,
      failedStylesheets: ["https://x.test/a.css"],
      watched: false,
    });

    assert.equal(warnings.length, 2);
    assert.match(warnings[1] ?? "", /could not be checked/);
  });
});

describe("writeScratchPage", () => {
  it("writes into a private directory of its own and removes it on dispose", async () => {
    const page = await writeScratchPage("<p>x</p>");
    const path = fileURLToPath(page.url);
    const dir = join(path, "..");

    try {
      assert.ok(dir.startsWith(tmpdir()));
      assert.equal(await fs.readFile(path, "utf-8"), "<p>x</p>");
      assert.deepEqual(await fs.readdir(dir), ["page.html"]);
      assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    } finally {
      await page.dispose();
    }

    await assert.rejects(fs.stat(dir));
  });

  it("never writes into the document's directory", async () => {
    const docDir = await fs.mkdtemp(join(tmpdir(), "mdforge-test-"));

    try {
      const prepared = await prepareConversion(
        { content: "# x\n", baseDir: docDir },
        structuredClone(defaultConfig),
        { output: { kind: "none" } },
      );

      const page = await writeScratchPage(buildPageHtml(prepared, "end"));

      try {
        assert.deepEqual(await fs.readdir(docDir), []);
        assert.ok(!fileURLToPath(page.url).startsWith(`${docDir}/`));
        assert.ok(
          (await fs.readFile(fileURLToPath(page.url), "utf-8")).includes(
            `<base href="${pathToFileURL(`${docDir}/`).href}">`,
          ),
        );
      } finally {
        await page.dispose();
      }
    } finally {
      await fs.rm(docDir, { recursive: true, force: true });
    }
  });
});

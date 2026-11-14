import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConfig } from "../src/lib/config.ts";
import { buildPageHtml, RemoteLoad, writeScratchPage } from "../src/lib/page-load.ts";
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
    const style = html.indexOf("<style>p{}</style>");
    const link = html.indexOf('<link rel="stylesheet" href="https://x.test/s.css">');
    assert.ok(style !== -1 && link > style, "stylesheets keep their order");
    assert.match(html, /<!--MARK--><\/body>/);
  });
});

describe("writeScratchPage", () => {
  it("writes beside the document and removes the file on dispose", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-test-"));

    try {
      const page = await writeScratchPage(pathToFileURL(`${dir}/`).href, "<p>x</p>");
      const path = fileURLToPath(page.url);

      assert.equal(join(path, ".."), dir);
      assert.equal(await fs.readFile(path, "utf-8"), "<p>x</p>");

      await page.dispose();
      await assert.rejects(fs.stat(path));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("falls back to a temporary directory when the document's is not writable", async () => {
    const page = await writeScratchPage(pathToFileURL("/nonexistent-mdforge-dir/").href, "x");

    try {
      assert.ok(fileURLToPath(page.url).startsWith(tmpdir()));
    } finally {
      await page.dispose();
    }
  });
});

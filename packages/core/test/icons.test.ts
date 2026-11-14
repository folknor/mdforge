import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { iconifyBase, processIcons } from "../src/lib/icons.ts";

// Scratch directories live beside the tests, not in the system temp dir
const scratchRoot = join(import.meta.dirname, ".scratch-icons");

mkdirSync(scratchRoot, { recursive: true });

after(() => rmSync(scratchRoot, { recursive: true, force: true }));

/** A fake server answering every request with an SVG naming the URL. */
function fakeServer() {
  const requests: string[] = [];

  return {
    requests,
    fetch: async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);

      return new Response(`<svg data-from="${url}"></svg>`);
    },
  };
}

describe("iconifyBase", () => {
  it("treats a missing trailing slash as the same base directory", () => {
    assert.equal(iconifyBase("https://h/icons").href, iconifyBase("https://h/icons/").href);
    assert.notEqual(iconifyBase("https://h/icons//").href, iconifyBase("https://h/icons/").href);
  });

  it("rejects non-http, credentials, query and fragment", () => {
    for (const bad of ["file:///x", "https://u@h/", "https://h/?", "https://h/#f", "nope"]) {
      assert.throws(() => iconifyBase(bad), bad);
    }
  });
});

describe("processIcons", () => {
  it("never serves one server's cached icon for another", async () => {
    const cacheRoot = mkdtempSync(join(scratchRoot, "servers-"));
    const a = fakeServer();
    const b = fakeServer();

    const fromA = await processIcons(":icon[mdi:home]", {
      apiUrl: "https://a.example",
      cacheRoot,
      fetch: a.fetch,
    });

    const fromB = await processIcons(":icon[mdi:home]", {
      apiUrl: "https://b.example",
      cacheRoot,
      fetch: b.fetch,
    });

    assert.match(fromA, /a\.example\/mdi\/home\.svg/);
    assert.match(fromB, /b\.example\/mdi\/home\.svg/);
    assert.equal(b.requests.length, 1);

    const again = fakeServer();

    const cached = await processIcons(":icon[mdi:home]", {
      apiUrl: "https://a.example/",
      cacheRoot,
      fetch: again.fetch,
    });

    assert.match(cached, /a\.example/);
    assert.equal(again.requests.length, 0);
  });

  it("keeps ids whose prefix and name split differently apart", async () => {
    const cacheRoot = mkdtempSync(join(scratchRoot, "split-"));
    const server = fakeServer();
    const options = { apiUrl: "https://a.example", cacheRoot, fetch: server.fetch };

    await processIcons(":icon[a--b:c]", options);
    const out = await processIcons(":icon[a:b--c]", options);

    assert.match(out, /\/a\/b--c\.svg/);
    assert.equal(server.requests.length, 2);
  });

  it("renders references whatever their case", async () => {
    const cacheRoot = mkdtempSync(join(scratchRoot, "case-"));
    const server = fakeServer();

    const out = await processIcons("x :icon[MDI:Home]{size=8} y", {
      apiUrl: "https://a.example",
      cacheRoot,
      fetch: server.fetch,
    });

    assert.deepEqual(server.requests, ["https://a.example/mdi/home.svg"]);
    assert.match(out, /^x <svg class="mdforge-icon"/);
    assert.doesNotMatch(out, /\[icon:/);
  });

  it("still renders a fetched icon when the cache cannot be written", async () => {
    const cacheRoot = mkdtempSync(join(scratchRoot, "readonly-"));
    chmodSync(cacheRoot, 0o500);

    try {
      const out = await processIcons(":icon[mdi:home]", {
        apiUrl: "https://a.example",
        cacheRoot,
        fetch: fakeServer().fetch,
      });

      assert.match(out, /<svg/);
      assert.deepEqual(readdirSync(cacheRoot), []);
    } finally {
      chmodSync(cacheRoot, 0o700);
    }
  });
});

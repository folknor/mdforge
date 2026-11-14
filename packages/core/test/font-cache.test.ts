import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { getGoogleFontsCss } from "../src/lib/font-cache.ts";

// Scratch directories live beside the tests, not in the system temp dir
const scratchRoot = join(import.meta.dirname, ".scratch-font-cache");

mkdirSync(scratchRoot, { recursive: true });

after(() => rmSync(scratchRoot, { recursive: true, force: true }));

// A family no system has installed, so it is always "downloaded"
const FAMILY = "Mdforge Test Sans";

function face(file: string, range: string) {
  return `/* latin */
@font-face {
  font-family: '${FAMILY}';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/test/${file}.woff2) format('woff2');
  unicode-range: ${range};
}`;
}

/** Fake Google Fonts: serves `css`, and font files except those in `fail`. */
function fakeGoogle(css: string, fail: Record<string, "hang" | number> = {}) {
  const requests: string[] = [];

  return {
    requests,
    fetch: async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);

      if (url.startsWith("https://fonts.googleapis.com/")) return new Response(css);

      const file = url.split("/").pop()?.replace(".woff2", "") ?? "";
      const failure = fail[file];

      if (failure === "hang") return new Promise<Response>(() => {});

      if (failure !== undefined) return new Response("", { status: failure });

      return new Response(new Uint8Array([1, 2, 3]));
    },
  };
}

const options = (fetchImpl: typeof fetch, cacheDir: string) => ({
  fetch: fetchImpl,
  cacheDir,
  timeoutMs: 50,
  weights: [400],
});

describe("getGoogleFontsCss", () => {
  it("embeds every face and caches a complete result", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "complete-"));
    const google = fakeGoogle(`${face("a", "U+0000-00FF")}\n${face("b", "U+0100-017F, U+0180")}`);

    const result = await getGoogleFontsCss([FAMILY], options(google.fetch, cacheDir));

    assert.deepEqual(result.warnings, []);
    assert.equal(result.css?.match(/data:font\/woff2;base64,AQID/g)?.length, 2);
    assert.doesNotMatch(result.css ?? "", /gstatic/);
    assert.match(result.css ?? "", /unicode-range: U\+0100-017F, U\+0180;/);

    const again = fakeGoogle("");
    const cached = await getGoogleFontsCss([FAMILY], options(again.fetch, cacheDir));

    assert.equal(cached.css, result.css);
    assert.equal(again.requests.length, 0);
  });

  it("leaves out a face whose file timed out, keeps the others, and caches nothing", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "partial-"));

    const google = fakeGoogle(`${face("a", "U+0000-00FF")}\n${face("b", "U+0100-017F")}`, {
      b: "hang",
    });

    const result = await getGoogleFontsCss([FAMILY], options(google.fetch, cacheDir));

    assert.equal(result.css?.match(/@font-face/g)?.length, 1);
    assert.match(result.css ?? "", /U\+0000-00FF/);
    assert.doesNotMatch(result.css ?? "", /gstatic|U\+0100/);
    assert.match(result.warnings[0] ?? "", /1 font face\(s\) left out .*no complete response/);
    assert.deepEqual(readdirSync(cacheDir), []);
  });

  it("replaces every reference to a file used by several faces", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "shared-"));
    const google = fakeGoogle(`${face("a", "U+0000-00FF")}\n${face("a", "U+0100-017F")}`);

    const result = await getGoogleFontsCss([FAMILY], options(google.fetch, cacheDir));

    assert.equal(result.css?.match(/base64,AQID/g)?.length, 2);
    assert.equal(google.requests.filter((url) => url.endsWith("a.woff2")).length, 1);
  });

  it("drops a face with an invalid descriptor and anything that is not a face", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "invalid-"));

    const css = `@import "https://evil.example/x.css";
${face("a", "U+0000-00FF")}
${face("b", "bogus")}`;

    const result = await getGoogleFontsCss([FAMILY], options(fakeGoogle(css).fetch, cacheDir));

    assert.equal(result.css?.match(/@font-face/g)?.length, 1);
    assert.doesNotMatch(result.css ?? "", /evil|bogus/);
    assert.match(result.warnings.join("\n"), /2 font rule\(s\)/);
    assert.deepEqual(readdirSync(cacheDir), []);
  });

  it("rejects out-of-range weights and malformed unicode ranges", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "descriptors-"));
    const bad = ["U+?0-FF", "U+FF-00", "U+110000", "U+0000-00FF,"];

    const css = [
      face("ok", "U+00??"),
      ...bad.map((range, i) => face(`r${i}`, range)),
      face("w", "U+0000").replace("font-weight: 400", "font-weight: 900 100"),
    ].join("\n");

    const result = await getGoogleFontsCss([FAMILY], options(fakeGoogle(css).fetch, cacheDir));

    assert.equal(result.css?.match(/@font-face/g)?.length, 1);
    assert.match(result.warnings.join("\n"), /5 font rule\(s\)/);
  });

  it("refetches when the cached entry is not self-contained", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "poisoned-"));
    const google = fakeGoogle(face("a", "U+0000-00FF"));

    await getGoogleFontsCss([FAMILY], options(google.fetch, cacheDir));
    const [entry] = readdirSync(cacheDir);
    assert.ok(entry);

    // An entry from before this check could still name a remote file
    writeFileSync(join(cacheDir, entry), face("a", "U+0000-00FF"));

    const again = fakeGoogle(face("a", "U+0000-00FF"));
    const result = await getGoogleFontsCss([FAMILY], options(again.fetch, cacheDir));

    assert.equal(again.requests.length, 2);
    assert.doesNotMatch(result.css ?? "", /gstatic/);
    assert.doesNotMatch(readFileSync(join(cacheDir, entry), "utf-8"), /gstatic/);
  });

  it("warns and returns no CSS when the stylesheet request times out", async () => {
    const cacheDir = mkdtempSync(join(scratchRoot, "css-hang-"));

    const result = await getGoogleFontsCss(
      [FAMILY],
      options(() => new Promise<Response>(() => {}), cacheDir),
    );

    assert.equal(result.css, null);
    assert.match(result.warnings[0] ?? "", /from Google Fonts: no complete response within/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkedHtml, type ScriptRecord } from "../src/html-output.ts";

const HTML_NS = "http://www.w3.org/1999/xhtml";

function script(text: string, id?: string): ScriptRecord {
  return { namespace: HTML_NS, type: undefined, id, src: undefined, text };
}

describe("checkedHtml", () => {
  it("passes HTML whose scripts reopen unchanged", () => {
    const html =
      '<!DOCTYPE html><html><head><script>let a = "<\\/script>";</script></head><body><template><script>b()</script></template></body></html>';

    assert.equal(
      checkedHtml({ html, scripts: [script('let a = "<\\/script>";'), script("b()")] }),
      html,
    );
  });

  it("fails a script whose text ends it early on reopen", () => {
    const text = 'let a = "</script><p>";';
    const html = `<html><head><script id="tricky">${text}</script></head><body></body></html>`;

    assert.throws(
      () => checkedHtml({ html, scripts: [script(text, "tricky")] }),
      /script id "tricky" does not survive/,
    );
  });

  it("reads noscript as a browser with scripting does", () => {
    const html =
      '<html><head></head><body><noscript><textarea></noscript><script id="ok">go()</script></body></html>';

    assert.doesNotThrow(() => checkedHtml({ html, scripts: [script("go()", "ok")] }));
  });

  it("checks the text as written to UTF-8", () => {
    const text = `"${String.fromCharCode(0xd800)}"`;
    const html = `<html><head><script id="data">${text}</script></head><body></body></html>`;

    assert.throws(() => checkedHtml({ html, scripts: [script(text, "data")] }), /does not survive/);
  });
});

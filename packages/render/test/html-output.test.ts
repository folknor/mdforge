import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkedHtml, type RawTextRecord } from "../src/html-output.ts";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";

function element(name: string, text: string, id?: string, namespace = HTML_NS): RawTextRecord {
  return { name, namespace, type: undefined, id, src: undefined, text };
}

const script = (text: string, id?: string) => element("script", text, id);

describe("checkedHtml", () => {
  it("passes HTML whose scripts reopen unchanged", () => {
    const html =
      '<!DOCTYPE html><html><head><script>let a = "<\\/script>";</script></head><body><template><script>b()</script></template></body></html>';

    assert.equal(
      checkedHtml({ html, elements: [script('let a = "<\\/script>";'), script("b()")] }),
      html,
    );
  });

  it("fails a script whose text ends it early on reopen", () => {
    const text = 'let a = "</script><p>";';
    const html = `<html><head><script id="tricky">${text}</script></head><body></body></html>`;

    assert.throws(
      () => checkedHtml({ html, elements: [script(text, "tricky")] }),
      /script with id "tricky" does not survive/,
    );
  });

  it("fails a style whose text ends it early on reopen", () => {
    const text = 'p::before { content: "</style><p>"; }';
    const html = `<html><head><style>${text}</style></head><body></body></html>`;

    assert.throws(
      () => checkedHtml({ html, elements: [element("style", text)] }),
      /<style> element .* does not survive/,
    );
  });

  it("passes an SVG style, which serialises escaped", () => {
    const html =
      '<html><head></head><body><svg><style>p::before { content: "&lt;/style>"; }</style></svg></body></html>';

    assert.doesNotThrow(() =>
      checkedHtml({
        html,
        elements: [element("style", 'p::before { content: "</style>"; }', undefined, SVG_NS)],
      }),
    );
  });

  it("reads noscript as a browser with scripting does", () => {
    const html =
      '<html><head></head><body><noscript><textarea></noscript><script id="ok">go()</script></body></html>';

    assert.doesNotThrow(() =>
      checkedHtml({
        html,
        elements: [element("noscript", "<textarea>"), script("go()", "ok")],
      }),
    );
  });

  it("checks the text as written to UTF-8", () => {
    const text = `"${String.fromCharCode(0xd800)}"`;
    const html = `<html><head><script id="data">${text}</script></head><body></body></html>`;

    assert.throws(
      () => checkedHtml({ html, elements: [script(text, "data")] }),
      /does not survive/,
    );
  });
});

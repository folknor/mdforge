import assert from "node:assert/strict";
import { test } from "node:test";
import { AppPage, appFile, appPageUrl, sameDocument } from "../src/main/app-page.ts";

const appUrl = "file:///opt/My%20App/resources/renderer/index.html";

test("the app scheme serves only files under its root", () => {
  const root = "/opt/app/renderer";

  assert.equal(appFile(root, appPageUrl), "/opt/app/renderer/index.html");
  assert.equal(appFile(root, "app://mdforge/assets/a%20b.js"), "/opt/app/renderer/assets/a b.js");
  // The URL parser resolves dot segments before the root is applied
  assert.equal(appFile(root, "app://mdforge/%2e%2e/secret"), "/opt/app/renderer/secret");
  assert.equal(appFile(root, "app://mdforge/assets/..%2f..%2fsecret"), undefined);
  assert.equal(appFile(root, "app://mdforge/%E0%A4%A"), undefined);
  assert.equal(appFile(root, "app://mdforge/"), undefined);
  assert.equal(appFile(root, "app://other/index.html"), undefined);
  assert.equal(appFile(root, "file:///opt/app/renderer/index.html"), undefined);
});

test("sameDocument ignores the hash and nothing else", () => {
  assert.equal(sameDocument(`${appUrl}#x`, appUrl), true);
  assert.equal(sameDocument("http://localhost:5173", "http://localhost:5173/"), true);
  assert.equal(sameDocument(`${appUrl}?q=1`, appUrl), false);
  assert.equal(sameDocument("file:///opt/other.html", appUrl), false);
  assert.equal(sameDocument("not a url", appUrl), false);
});

test("a page is untrusted until the app commits", () => {
  const page = new AppPage(appUrl);

  assert.equal(page.trusted, false);
  page.committed(appUrl);
  assert.equal(page.trusted, true);
});

test("navigation and redirects are allowed only to the app page", () => {
  const page = new AppPage(appUrl);

  assert.equal(page.allows(appUrl), true);
  assert.equal(page.allows(`${appUrl}#top`), true);
  assert.equal(page.allows("file:///etc/passwd"), false);
  assert.equal(page.allows("https://example.com/"), false);
});

test("an unexpected commit revokes trust until the app commits again", () => {
  const page = new AppPage(appUrl);

  page.committed(appUrl);
  page.committed("file:///opt/My%20App/resources/renderer/other.html");
  // pushState back to the app's URL commits nothing, so nothing is restored
  assert.equal(page.trusted, false);
  page.committed(appUrl);
  assert.equal(page.trusted, true);
});

test("a failed load or a crash revokes trust", () => {
  const page = new AppPage(appUrl);

  page.committed(appUrl);
  page.lost();
  assert.equal(page.trusted, false);
});

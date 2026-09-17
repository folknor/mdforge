#!/usr/bin/env node

// Renders a set of autolink-heavy markdown snippets through @mdforge/core's
// markdown pipeline and prints the resulting HTML. Used to diff linkify
// behaviour across marked-linkify-it upgrades.

import { defaultConfig } from "../packages/core/dist/index.js";
import { getHtml } from "../packages/core/dist/lib/markdown.js";

const samples = [
  "Visit https://example.com for details.",
  "Bare domain example.com and www.example.org here.",
  "Mail me at someone@example.com please.",
  "A link in <https://example.com/angle> brackets.",
  "Already [linked](https://example.com) stays put.",
  "Trailing punctuation: see https://example.com/path.",
  "Parens https://en.wikipedia.org/wiki/Foo_(bar) included.",
  "In `code https://example.com` untouched.",
  "ftp://files.example.com/pub and http://192.168.0.1:8080/x",
  "Unicode http://例え.テスト/パス and https://example.com/ünïcode",
];

for (const md of samples) {
  console.log("--- " + md);
  console.log(getHtml(md, defaultConfig).trim());
}

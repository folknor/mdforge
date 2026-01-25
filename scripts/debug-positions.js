import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const puppeteer = require("../packages/core/node_modules/puppeteer");

const html = await fs.readFile("tmp/debug.html", "utf-8");
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });

const positions = await page.evaluate(() => {
  const fields = document.querySelectorAll("[data-form-field]");
  const result = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const input = field.querySelector("input, textarea, select");
    if (!input) continue;
    const rect = input.getBoundingClientRect();
    result.push({
      name: field.getAttribute("data-field-name"),
      x: rect.x, y: rect.y, width: rect.width, height: rect.height
    });
  }
  return result;
});

console.log("Viewport:", await page.evaluate(() => ({
  width: document.documentElement.clientWidth,
  height: document.documentElement.clientHeight
})));
console.log("\nFirst 3 field positions:");
positions.slice(0, 3).forEach(p => {
  console.log(`  ${p.name}: x=${p.x}, y=${p.y}, w=${p.width}, h=${p.height}`);
});

await browser.close();

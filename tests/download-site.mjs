import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const site = pathToFileURL(path.resolve("build/download-site/index.html")).href;
const sums = new Map((await readFile("dist/SHA256SUMS.txt", "utf8")).trim().split(/\r?\n/).map(line => {
  const [hash, filename] = line.split("  ");
  return [filename, hash];
}));
const browser = await chromium.launch({
  ...(process.env.UNSOCIAL_TEST_BROWSER ? { executablePath: process.env.UNSOCIAL_TEST_BROWSER } : { channel: process.platform === "win32" ? "msedge" : "chrome" }),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("requestfailed", req => {
    // Chromium cancels document navigation when it hands the response to its download manager.
    const file = new URL(req.url()).pathname.split("/").pop();
    if (req.isNavigationRequest() && sums.has(file) && req.failure()?.errorText === "net::ERR_ABORTED") return;
    errors.push(req.url() + " " + req.failure()?.errorText);
  });
  await page.goto(site);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.getByRole("tab").count(), 3);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/download-desktop.png", fullPage: true });
  const downloaded = new Set();
  for (const platform of ["Windows", "macOS", "Linux"]) {
    const tab = page.getByRole("tab", { name: platform, exact: true });
    await tab.click();
    assert.equal(await tab.getAttribute("aria-selected"), "true");
    for (const anchor of await page.getByRole("tabpanel", { name: platform }).locator("a[download]").all()) {
      const [download] = await Promise.all([page.waitForEvent("download"), anchor.click()]);
      const filename = download.suggestedFilename();
      const digest = createHash("sha256");
      for await (const block of await download.createReadStream()) digest.update(block);
      assert.equal(digest.digest("hex"), sums.get(filename), filename);
      downloaded.add(filename);
      await download.delete();
    }
  }
  assert.equal(downloaded.size, 4);
  await page.getByRole("tab", { name: "Linux" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Windows" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("End");
  assert.equal(await page.getByRole("tab", { name: "Linux" }).getAttribute("aria-selected"), "true");
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal overflow at " + width);
    if (width === 390) await page.screenshot({ path: "artifacts/download-mobile.png", fullPage: true });
  }
  assert.ok(await page.locator("img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
  const fallback = await browser.newContext({ javaScriptEnabled: false });
  const plain = await fallback.newPage();
  await plain.goto(site);
  assert.equal(await plain.locator(".platform:visible a[download]").count(), 4);
  assert.deepEqual(errors, []);
  console.log("PASS: all four browser downloads match the manifest; tab navigation, responsive layout, images and no-script links verified.");
} finally {
  await browser.close();
}

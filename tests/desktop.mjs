import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const exe = process.env.UNSOCIAL_TEST_EXECUTABLE || require("electron");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "unsocial-ui-")),
  screens = path.resolve("artifacts");
await fs.mkdir(screens, { recursive: true });
const apps = [],
  errors = [];
async function launch(name) {
  const profile = path.join(tmp, name);
  const args = process.env.UNSOCIAL_TEST_EXECUTABLE ? [] : [path.resolve(".")];
  const env = {
    ...process.env,
    UNSOCIAL_PROFILE: profile,
    UNSOCIAL_ADVERTISE: "127.0.0.1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: exe,
    chromiumSandbox: true,
    args: [
      ...args,
      "--user-data-dir=" + profile,
      ...(process.env.UNSOCIAL_TEST_HEADLESS ? ["--headless"] : []),
    ],
    env,
    timeout: 45000,
  });
  apps.push(app);
  const w = await app.firstWindow();
  w.setDefaultTimeout(20000);
  w.on("pageerror", (e) => errors.push(e.message));
  await w.getByRole("heading", { name: "Room directory" }).waitFor();
  return { app, w };
}
try {
  const h = await launch("host"),
    g = await launch("guest");
  await h.w.locator("[data-nav=ethernet]").click();
  await h.w.getByRole("heading", { name: "Wired adapters" }).waitFor();
  await h.w.waitForFunction(
    () =>
      !document
        .getElementById("wired-ports")
        .textContent.includes("Checking wired adapters"),
  );
  const wire = await h.w.evaluate(
    async () =>
      (await window.network.state()).ethernet?.flatMap((p) => p.addresses)[0],
  );
  await h.w.locator("[data-nav=settings]").click();
  const themes = await h.w
    .locator("#theme option")
    .evaluateAll((options) => options.map((o) => o.value));
  assert.equal(themes.length, 8);
  for (const theme of themes) {
    await h.w.locator("#theme").selectOption(theme);
    assert.equal(await h.w.locator("html").getAttribute("data-theme"), theme);
  }
  await h.w.locator("#host-start").click();
  await h.w.locator("#host-stop").waitFor();
  await h.w.locator("#host-stop").click();
  await h.w.locator("#submit").click();
  await h.w.locator("#host-start").waitFor();
  await h.w.locator("[data-nav=rooms]").click();
  await h.w.screenshot({ path: path.join(screens, "directory.png") });
  if (wire) {
    await h.w.locator("[data-nav=ethernet]").click();
    await h.w
      .getByRole("button", { name: "Create wired room" })
      .first()
      .click();
  } else await h.w.getByRole("button", { name: "Create room" }).click();
  await h.w.getByLabel("Room name").fill("Night shift");
  await h.w.getByLabel("Your display name").fill("Ada");
  await h.w.locator("#submit").click();
  await h.w
    .locator("#status")
    .getByText("Connected", { exact: true })
    .waitFor();
  await h.app.evaluate(({ clipboard }) => {
    clipboard.writeText = (v) => {
      globalThis.testInvitation = v;
    };
  });
  await h.w.locator("#copy").click();
  const invite = await h.app.evaluate(() => globalThis.testInvitation);
  assert.ok(invite.startsWith("unsocial://"));
  if (wire) {
    assert.equal(
      new URL(
        JSON.parse(
          Buffer.from(invite.slice("unsocial://join/".length), "base64url"),
        ).origin,
      ).hostname,
      wire,
    );
    await g.w.locator("[data-nav=ethernet]").click();
    await g.w.getByRole("button", { name: "Join wired room" }).first().click();
  } else await g.w.getByRole("button", { name: "Join room" }).click();
  await g.w.getByLabel("Room invitation").fill(invite);
  await g.w.getByLabel("Your display name").fill("Lin");
  await g.w.locator("#submit").click();
  await g.w
    .locator("#status")
    .getByText("Connected", { exact: true })
    .waitFor();
  await h.w.locator("#members").getByText("Lin", { exact: true }).waitFor();
  await h.w.getByLabel("Message the room").fill("Can you check the transfer?");
  await h.w.locator("#chat-form button").click();
  await g.w
    .locator("#messages")
    .getByText("Can you check the transfer?")
    .waitFor();
  const copy = h.w.getByRole("button", { name: "Copy message" });
  const opacity = () => copy.evaluate((b) => getComputedStyle(b).opacity);
  const message = h.w.locator(".message-text").first();
  const bounds = await message.boundingBox();
  await h.w.mouse.move(
    bounds.x + bounds.width + 12,
    bounds.y + bounds.height / 2,
  );
  assert.equal(await opacity(), "0");
  await message.hover();
  assert.equal(await opacity(), "1");
  await copy.click();
  assert.equal(
    await h.app.evaluate(() => globalThis.testInvitation),
    "Can you check the transfer?",
  );
  await h.w.locator("#chat-text").hover();
  assert.equal(await opacity(), "0");
  const site = path.join(tmp, "site");
  await fs.mkdir(site);
  await fs.writeFile(
    path.join(site, "index.html"),
    '<h1>Team demo</h1><script src="/demo.js"></script><a href="next.html">Next</a>',
  );
  await fs.writeFile(
    path.join(site, "demo.js"),
    'document.body.dataset.loaded = "yes"',
  );
  await fs.writeFile(path.join(site, "next.html"), "<h1>Next page</h1>");
  await h.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, site);
  await h.w.locator("#site-share").click();
  const opening = g.app.waitForEvent("window");
  await g.w.locator("#site-open").click();
  const viewer = await opening;
  await viewer.getByRole("heading", { name: "Team demo" }).waitFor();
  await viewer.locator('body[data-loaded="yes"]').waitFor();
  assert.equal(await viewer.evaluate(() => typeof window.network), "undefined");
  await viewer.getByRole("link", { name: "Next" }).click();
  await viewer.getByRole("heading", { name: "Next page" }).waitFor();
  const closed = viewer.waitForEvent("close");
  await h.w.locator("#site-stop").click();
  await closed;
  await g.w.locator("#site-open").waitFor({ state: "hidden" });
  const source = path.join(tmp, "protocol-note.txt"),
    out = path.join(tmp, "received");
  await fs.mkdir(out);
  await fs.writeFile(
    source,
    "Two independent desktops verified these bytes.\n",
  );
  await h.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, source);
  await g.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, out);
  await g.w.locator("[data-nav=settings]").click();
  await g.w.locator("#folder").click();
  await g.w.locator("[data-nav=rooms]").click();
  await h.w.locator("#pick").click();
  await g.w.locator("#files button").first().click();
  await g.w.locator("#room-jobs").getByText("Show in folder").waitFor();
  assert.equal(
    await fs.readFile(path.join(out, "protocol-note.txt"), "utf8"),
    await fs.readFile(source, "utf8"),
  );
  await g.w.screenshot({ path: path.join(screens, "room.png") });
  await h.w.locator("#leave").click();
  await h.w.locator("#submit").click();
  await h.w.getByRole("heading", { name: "Room directory" }).waitFor();
  await h.app.close();
  apps.splice(apps.indexOf(h.app), 1);
  await g.w
    .locator("#status")
    .getByText("Reconnecting", { exact: true })
    .waitFor();
  const restored = await launch("host");
  assert.equal(
    await restored.w.locator("html").getAttribute("data-theme"),
    themes.at(-1),
  );
  await g.w
    .locator("#status")
    .getByText("Connected", { exact: true })
    .waitFor();
  await g.w
    .getByLabel("Message the room")
    .fill("Back after the host restarted.");
  await g.w.locator("#chat-form button").click();
  await g.w
    .locator("#messages")
    .getByText("Back after the host restarted.")
    .waitFor();
  await g.w.locator("#leave").click();
  await g.w.locator("#submit").click();
  await g.w.getByRole("heading", { name: "Room directory" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two desktops, server controls, themes, copy hover, private website, verified file, host restart and reconnect. Transport: " +
      (wire ? "wired " + wire : "loopback") +
      ".",
  );
} finally {
  for (const app of apps.reverse()) await app.close().catch(() => {});
  await fs.rm(tmp, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 150,
  });
}

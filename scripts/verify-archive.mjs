import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { openPromise } from "yauzl";

async function digest(stream) {
  const h = createHash("sha256");
  for await (const b of stream) h.update(b);
  return h.digest("hex");
}
async function data(zip, entry) {
  const parts = [];
  for await (const b of await zip.openReadStreamPromise(entry)) parts.push(b);
  return Buffer.concat(parts);
}
const files = (await fsp.readdir("dist"))
  .filter((name) => name.endsWith(".zip"))
  .sort();
const checksums = [];
assert.ok(files.length, "No release archives found");
for (const name of files) {
  const file = path.join("dist", name);
  const expected = (await fsp.readFile(file + ".sha256", "utf8")).split(" ")[0];
  assert.equal(await digest(fs.createReadStream(file)), expected);
  checksums.push(expected + "  " + name);
  const zip = await openPromise(file, { autoClose: false, lazyEntries: true }),
    entries = new Map();
  for await (const entry of zip.eachEntry()) {
    assert.ok(!entries.has(entry.fileName), "Duplicate archive entry");
    entries.set(entry.fileName, entry);
  }
  const win = name.includes("-Windows-"),
    mac = name.includes("-macOS-"),
    arm = name.endsWith("-arm64.zip");
  const root = mac ? "Unsocial Network.app/Contents/" : "Unsocial Network/",
    app = root + (mac ? "Resources/app/" : "resources/app/");
  const get = (k) => {
    assert.ok(entries.has(k), "Missing " + k);
    return entries.get(k);
  };
  get(app + "package.json");
  get(app + "node_modules/ws/index.js");
  for (const asset of await fsp.readdir("desktop")) {
    const actual = await digest(
      await zip.openReadStreamPromise(get(app + "desktop/" + asset)),
    );
    assert.equal(
      actual,
      await digest(fs.createReadStream(path.join("desktop", asset))),
    );
  }
  const service = get(app + "bin/unsocial-room" + (win ? ".exe" : ""));
  const exe = await data(zip, service);
  if (win) {
    assert.equal(exe.toString("ascii", 0, 2), "MZ");
    assert.equal(exe.readUInt16LE(exe.readUInt32LE(60) + 4), 0x8664);
    get(root + "Unsocial Network.exe");
  } else {
    assert.ok((service.externalFileAttributes >>> 16) & 0o111);
    if (mac) {
      const arch = arm ? 0x0100000c : 0x01000007;
      assert.equal(exe.readUInt32LE(0), 0xfeedfacf);
      assert.equal(exe.readUInt32LE(4), arch);
      const launcher = await data(zip, get(root + "MacOS/UnsocialNetwork"));
      assert.equal(launcher.readUInt32LE(4), arch);
      get(root + "Frameworks/Electron.app/Contents/MacOS/Electron");
      const symlink = [...entries.values()].find((e) =>
        e.fileName.endsWith("Electron Framework.framework/Versions/Current"),
      );
      assert.ok(symlink);
      assert.equal(
        (symlink.externalFileAttributes >>> 16) & 0o170000,
        0o120000,
      );
      assert.equal((await data(zip, symlink)).toString(), "A");
    } else {
      assert.equal(exe.readUInt32BE(0), 0x7f454c46);
      assert.equal(exe.readUInt16LE(18), 62);
      assert.ok(
        (get(root + "unsocial-network").externalFileAttributes >>> 16) & 0o111,
      );
    }
  }
  zip.close();
  console.log(name + " verified · " + entries.size + " entries");
}
await fsp.writeFile(
  path.join("dist", "SHA256SUMS.txt"),
  checksums.join("\n") + "\n",
);

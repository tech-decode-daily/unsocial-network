import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import yazl from "yazl";
import yauzl from "yauzl";

const os = process.argv[2] || process.platform,
  arch = process.argv[3] || process.arch;
if (
  !["win32", "linux", "darwin"].includes(os) ||
  !["x64", "arm64"].includes(arch)
)
  throw Error("Unsupported target.");
const packageInfo = JSON.parse(await fsp.readFile("package.json"));
const electron = JSON.parse(
  await fsp.readFile("node_modules/electron/package.json"),
).version;
const name = "electron-v" + electron + "-" + os + "-" + arch + ".zip",
  cache = path.join("build", "runtime", name);
const expected = JSON.parse(
  await fsp.readFile("node_modules/electron/checksums.json"),
)[name];
async function hash(file) {
  const h = createHash("sha256");
  for await (const part of fs.createReadStream(file)) h.update(part);
  return h.digest("hex");
}
await fsp.mkdir(path.dirname(cache), { recursive: true });
if (!fs.existsSync(cache)) {
  const res = await fetch(
    "https://github.com/electron/electron/releases/download/v" +
      electron +
      "/" +
      name,
  );
  if (!res.ok) throw Error("Electron download failed");
  await pipeline(
    Readable.fromWeb(res.body),
    fs.createWriteStream(cache + ".part"),
  );
  await fsp.rename(cache + ".part", cache);
}
if ((await hash(cache)) !== expected)
  throw Error("Electron archive checksum mismatch.");
function exec(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(cmd + " failed.");
}
exec(process.execPath, ["scripts/build-server.mjs", os, arch]);
const mac = os === "darwin",
  win = os === "win32",
  platform = { win32: "Windows", darwin: "macOS", linux: "Linux" }[os];
const root = { darwin: "Unsocial Network.app/Contents/", win32: "Unsocial Network/", linux: "unsocial-network/" }[os];
const appRoot = root + (mac ? "Resources/app/" : "resources/app/");
const dist = "dist",
  filename =
    "Unsocial-Network-" +
    packageInfo.version +
    "-" +
    platform +
    "-" +
    arch +
    ".zip";
await fsp.mkdir(dist, { recursive: true });
const zip = new yazl.ZipFile(),
  output = path.join(dist, filename);
const done = pipeline(zip.outputStream, fs.createWriteStream(output + ".part"));
const runtime = await yauzl.openPromise(cache, {
  autoClose: false,
  lazyEntries: true,
});
const options = (mode = 0o100644) => ({ mode, compressionLevel: 5 });
for await (const entry of runtime.eachEntry()) {
  let file = entry.fileName;
  if (mac)
    file = file.startsWith("Electron.app/")
      ? root + "Frameworks/" + file
      : root + "Resources/" + file;
  else {
    if (file === "resources/default_app.asar") continue;
    if (file === (win ? "electron.exe" : "electron"))
      file = win ? "Unsocial Network.exe" : "unsocial-network";
    file = root + file;
  }
  const mode = entry.externalFileAttributes >>> 16 || 0o100644;
  if (file.endsWith("/")) {
    zip.addEmptyDirectory(file, { mode: (mode & 0o7777) | 0o040000 });
    continue;
  }
  zip.addReadStreamLazy(
    file,
    { mode, compressionLevel: 5, size: entry.uncompressedSize },
    (cb) => runtime.openReadStream(entry, cb),
  );
}
async function tree(src, to) {
  for (const item of await fsp.readdir(src, { withFileTypes: true })) {
    if (item.name === "README.md") continue;
    const full = path.join(src, item.name),
      dest = to + item.name;
    if (item.isDirectory()) await tree(full, dest + "/");
    else zip.addFile(full, dest, options());
  }
}
await tree("desktop", appRoot + "desktop/");
await tree("node_modules/ws", appRoot + "node_modules/ws/");
const goRoot = execFileSync("go", ["env", "GOROOT"], {
  encoding: "utf8",
}).trim();
zip.addFile(
  path.join(goRoot, "LICENSE"),
  appRoot + "licenses/Go.txt",
  options(),
);
for (const module of [
  "github.com/gorilla/websocket",
  "go.etcd.io/bbolt",
  "golang.org/x/sys",
]) {
  const dir = execFileSync("go", ["list", "-m", "-f", "{{.Dir}}", module], {
    cwd: "server",
    encoding: "utf8",
  }).trim();
  zip.addFile(
    path.join(dir, "LICENSE"),
    appRoot + "licenses/" + module.replaceAll("/", "-") + ".txt",
    options(),
  );
}
zip.addBuffer(
  Buffer.from(
    JSON.stringify({
      name: "unsocial-network",
      productName: "Unsocial Network",
      version: packageInfo.version,
      main: "desktop/main.cjs",
    }),
  ),
  appRoot + "package.json",
  options(),
);
const bin = "unsocial-room" + (win ? ".exe" : "");
zip.addFile(
  path.join("build", os + "-" + arch, bin),
  appRoot + "bin/" + bin,
  options(0o100755),
);
if (mac) {
  const out = path.join("build", os + "-" + arch, "launcher");
  exec(
    "go",
    [
      "build",
      "-trimpath",
      "-ldflags=-s -w",
      "-o",
      out,
      "scripts/mac-launcher.go",
    ],
    {
      ...process.env,
      CGO_ENABLED: "0",
      GOOS: "darwin",
      GOARCH: arch === "x64" ? "amd64" : "arm64",
    },
  );
  zip.addFile(out, root + "MacOS/UnsocialNetwork", options(0o100755));
  // The first portable bundle used build 1. Keep subsequent dotted builds above it.
  const [major, minor, patch] = packageInfo.version.split(".");
  const bundleVersion = [Number(major) + 1, minor, patch].join(".");
  const plist =
    '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleName</key><string>Unsocial Network</string><key>CFBundleDisplayName</key><string>Unsocial Network</string><key>CFBundleIdentifier</key><string>network.unsocial.desktop</string><key>CFBundleExecutable</key><string>UnsocialNetwork</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>' +
    packageInfo.version +
    "</string><key>CFBundleVersion</key><string>" + bundleVersion + "</string><key>NSHighResolutionCapable</key><true/></dict></plist>";
  zip.addBuffer(Buffer.from(plist), root + "Info.plist", options());
}
zip.addFile("README.md", mac ? "Read me.md" : root + "Read me.md", options());
if (os === "linux")
  zip.addFile("packaging/linux/unsocial-network.apparmor", root + "unsocial-network.apparmor", options());
zip.end();
await done;
runtime.close();
await fsp.rename(output + ".part", output);
await fsp.writeFile(
  output + ".sha256",
  (await hash(output)) + "  " + filename + "\n",
);
console.log(output);

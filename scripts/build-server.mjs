import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
const os = process.argv[2] || process.platform;
const arch = process.argv[3] || process.arch;
const goOS = { win32: "windows", darwin: "darwin", linux: "linux" }[os];
const goArch = { x64: "amd64", arm64: "arm64" }[arch];
if (!goOS || !goArch) throw Error("Unsupported build target");
const destination = path.resolve("build", os + "-" + arch);
mkdirSync(destination, { recursive: true });
const output = path.join(
  destination,
  "unsocial-room" + (os === "win32" ? ".exe" : ""),
);
const result = spawnSync(
  "go",
  ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "."],
  {
    cwd: "server",
    stdio: "inherit",
    env: { ...process.env, GOOS: goOS, GOARCH: goArch, CGO_ENABLED: "0" },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status;

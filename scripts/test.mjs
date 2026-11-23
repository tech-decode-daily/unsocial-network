import { spawnSync } from "node:child_process";
for (const [cmd, args, cwd] of [
  ["go", ["test", "./..."], "server"],
  [process.execPath, ["scripts/build-server.mjs"], "."],
  [process.execPath, ["--test", "tests/network.test.cjs"], "."],
]) {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

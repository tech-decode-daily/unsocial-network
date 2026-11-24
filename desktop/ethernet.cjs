"use strict";
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const exec = promisify(execFile);

async function output(program, args) {
  return (await exec(program, args, { windowsHide: true, timeout: 8000 }))
    .stdout;
}
function macPorts(report) {
  return report
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .flatMap((block) => {
      const name = /^Hardware Port: (.+)$/m.exec(block)?.[1]?.trim();
      const device = /^Device: (en\d+)$/m.exec(block)?.[1];
      return name &&
        device &&
        /ethernet|\blan\b|\bGBE\b|(?:^|\s)\d+[.\d]*G(?:igabit)?(?:\s|$)/i.test(
          name,
        )
        ? [{ name, device }]
        : [];
    });
}
async function wiredPorts() {
  if (process.platform === "win32") {
    const script =
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $rows=@(Get-NetAdapter -Physical | Where-Object { $_.InterfaceType -eq 6 -and $_.InterfaceOperationalStatus -eq 1 -and $_.NdisPhysicalMedium -ne 10 } | ForEach-Object { $_.Name }); ConvertTo-Json -Compress -InputObject $rows";
    const report = await output(
      path.join(
        process.env.SystemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
    );
    return JSON.parse(report.trim()).map((name) => ({ name, device: name }));
  }
  if (process.platform === "darwin") {
    const ports = macPorts(
      await output("/usr/sbin/networksetup", ["-listallhardwareports"]),
    );
    const states = await Promise.all(
      ports.map(async (p) =>
        /\bstatus: active\b/.test(await output("/sbin/ifconfig", [p.device]))
          ? p
          : null,
      ),
    );
    return states.filter(Boolean);
  }
  const root = "/sys/class/net";
  const ports = await Promise.all(
    (await fs.readdir(root)).map(async (device) => {
      try {
        const dir = path.join(root, device);
        const entries = await fs.readdir(dir);
        if (
          !entries.includes("device") ||
          entries.includes("wireless") ||
          entries.includes("phy80211")
        )
          return;
        const [type, carrier] = await Promise.all(
          ["type", "carrier"].map((f) =>
            fs.readFile(path.join(dir, f), "utf8"),
          ),
        );
        if (type.trim() === "1" && carrier.trim() === "1")
          return { name: device, device };
      } catch {
        /* An unplugged adapter can disappear during enumeration. */
      }
    }),
  );
  return ports.filter(Boolean);
}
function withAddresses(ports, interfaces) {
  return ports
    .map(({ name, device }) => ({
      name,
      device,
      addresses: (interfaces[device] || [])
        .filter((a) => a.family === "IPv4" && !a.internal)
        .map((a) => a.address)
        .sort(),
    }))
    .sort((a, b) => a.device.localeCompare(b.device));
}
async function ethernet() {
  return withAddresses(await wiredPorts(), os.networkInterfaces());
}
module.exports = { ethernet, macPorts, withAddresses };

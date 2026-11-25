import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { "release-json": { type: "string" }, repository: { type: "string" } } });
const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw Error("Invalid package version");

const out = path.join("build", "download-site");
const tag = "v" + version;
const repository = values.repository;
let remoteAssets, source, notes, downloadBase;
if (values["release-json"] || repository) {
  if (!values["release-json"] || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw Error("Supply a release JSON file and its GitHub owner/repository");
  const release = JSON.parse(await readFile(values["release-json"], "utf8"));
  source = "https://github.com/" + repository;
  notes = source + "/releases/tag/" + tag;
  downloadBase = source + "/releases/download/" + tag + "/";
  if (release.tag_name !== tag || release.draft || release.html_url !== notes) throw Error("Expected a published release matching the package version and repository");
  remoteAssets = new Map(release.assets.map(asset => [asset.name, asset]));
} else {
  source = "../../README.md";
  notes = "../../CHANGELOG.md";
  downloadBase = "../../dist/";
}

function releaseAsset(name) {
  const asset = remoteAssets.get(name);
  if (!asset || asset.state !== "uploaded" || asset.browser_download_url !== downloadBase + name ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw Error("Release asset missing or incomplete: " + name);
  }
  return asset;
}

const manifestName = "SHA256SUMS.txt";
const checksums = downloadBase + manifestName;
let localManifest;
if (remoteAssets) {
  releaseAsset(manifestName);
} else {
  localManifest = new Set((await readFile(path.join("dist", manifestName), "utf8")).trim().split(/\r?\n/));
}

const systems = [
  {
    id: "windows", title: "Windows",
    instruction: "Open the downloaded setup file and choose Install. You can then open Unsocial Network from Start.",
    builds: [{ suffix: "Windows-x64-Setup.exe", label: "Download for Windows", detail: "Intel / AMD 64-bit · EXE installer" }],
  },
  {
    id: "macos", title: "macOS",
    instruction: "Open the downloaded package and follow Installer. It selects the right version for your Mac and puts Unsocial Network in Applications." +
      (["0.1.2", "0.1.3"].includes(version) ? " This version is unsigned and macOS may block installation." : ""),
    builds: [{ suffix: "macOS.pkg", label: "Download for Mac", detail: "Apple Silicon and Intel · PKG installer" }],
  },
  {
    id: "linux", title: "Linux",
    instruction: "On Ubuntu or Debian, open the DEB in your software installer and choose Install. Other Linux distributions can use the portable archive.",
    builds: [{ suffix: "Linux-x64.deb", label: "Ubuntu / Debian", detail: "Intel / AMD 64-bit · DEB installer" }, { suffix: "Linux-x64.tar.gz", label: "Other Linux", detail: "Intel / AMD 64-bit · TAR.GZ portable" }],
  },
];

async function binaryLink(build) {
  const filename = `Unsocial-Network-${version}-${build.suffix}`;
  let bytes;
  if (remoteAssets) {
    bytes = releaseAsset(filename).size;
  } else {
    const archive = path.join("dist", filename);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (!localManifest.has(hash.digest("hex") + "  " + filename)) throw Error("Checksum mismatch: " + filename);
    bytes = (await stat(archive)).size;
  }
  const size = (bytes / 1048576).toFixed(1) + " MiB";
  return `<div><a class="button" href="${downloadBase}${filename}" download aria-label="${build.label}, ${build.detail}, ${size}">${build.label} <span class="arrow" aria-hidden="true">↓</span></a><p class="details">${build.detail} · ${size}</p></div>`;
}

const panels = [];
for (const system of systems) {
  const links = await Promise.all(system.builds.map(binaryLink));
  panels.push(`<section class="platform" id="${system.id}"><h3>${system.title}</h3><p>${system.instruction}</p><div class="binaries">${links.join("\n")}</div></section>`);
}
const replacements = { version, source, sourceLabel: remoteAssets ? "GitHub" : "Readme", notes, checksums, panels: panels.join("\n") };
const template = await readFile("website/index.html", "utf8");
const html = template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
  if (!Object.hasOwn(replacements, name)) throw Error("Unknown template field: " + name);
  return replacements[name];
});
await mkdir(out, { recursive: true });
for (const file of ["site.css", "site.js", "assets"]) await cp(path.join("website", file), path.join(out, file), { recursive: true });
await writeFile(path.join(out, ".nojekyll"), "");
await writeFile(path.join(out, "index.html"), html);
console.log("Built " + path.resolve(out) + " for " + (remoteAssets ? repository + " " + tag : "local desktop archives"));

"use strict";
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const CHUNK = 1024 * 1024;
const mime = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};
const id = () => randomBytes(16).toString("hex");
function localName(name) {
  let value =
    path
      .basename(name.replaceAll("\\", "/"))
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
      .replace(/[. ]+$/g, "") || "download";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))
    value = "_" + value;
  return value;
}
async function hashFile(filename, signal, update = () => {}) {
  const hash = createHash("sha256");
  let count = 0;
  for await (const chunk of fs.createReadStream(filename, { signal })) {
    hash.update(chunk);
    count += chunk.length;
    update(count);
  }
  return hash.digest("hex");
}
async function publish(part, dir, name, checkpoint) {
  const file = path.parse(localName(name));
  for (let i = 0; ; i++) {
    const out = path.join(
      dir,
      file.name + (i ? " (" + i + ")" : "") + file.ext,
    );
    try {
      checkpoint(out);
      await fsp.link(part, out);
      return out;
    } catch (e) {
      if (e.code !== "EEXIST")
        throw Error(
          "Choose a download folder supporting hard links to publish the verified file.",
        );
    }
  }
}
function publicJob(j) {
  const { id, kind, name, size, progress, status, error, file, room } = j;
  return { id, kind, name, size, progress, status, error, file, room };
}
class Transfers {
  constructor({
    jobs = [],
    session,
    folder,
    save,
    update,
    log = () => {},
    parallel = 2,
  }) {
    Object.assign(this, { jobs, session, folder, save, update, log, parallel });
    this.active = new Map();
    this.stopping = false;
    for (const j of jobs)
      if (!["complete", "cancelled", "failed"].includes(j.status)) {
        j.status = "paused";
        j.error = "Paused during shutdown. Resume when ready.";
      }
  }
  changed(durable = true) {
    if (durable) this.save();
    this.update();
  }
  add(job) {
    this.jobs.push({
      ...job,
      id: id(),
      key: id(),
      progress: 0,
      status: "queued",
      error: "",
    });
    this.changed();
    this.pump();
  }
  async send(files, room) {
    for (const filename of files) {
      let st;
      try {
        st = await fsp.stat(filename);
      } catch (error) {
        this.log(
          "Could not read " +
            path.basename(filename) +
            " (" +
            (error.code || "filesystem error") +
            ").",
        );
        continue;
      }
      if (st.isFile())
        this.add({
          room,
          kind: "upload",
          path: filename,
          name: path.basename(filename),
          size: st.size,
          mtime: st.mtimeMs,
        });
    }
  }
  receive(f, room) {
    const dir = this.folder();
    this.add({
      room,
      kind: "download",
      file: f.ID,
      name: f.Name,
      size: f.Size,
      hash: f.Hash,
      dir,
      part: path.join(dir, ".unsocial-" + id() + ".part"),
    });
  }
  pump() {
    if (this.stopping) return;
    for (const j of this.jobs) {
      if (this.active.size >= this.parallel) break;
      if (j.status !== "queued" || this.active.has(j.id)) continue;
      const session = this.session(j.room);
      if (!session) continue;
      const ac = new AbortController();
      this.active.set(j.id, ac);
      this.run(j, session, ac.signal)
        .catch((e) => {
          j.status = "failed";
          j.error = e.message;
        })
        .finally(() => {
          this.active.delete(j.id);
          this.changed();
          this.pump();
        });
    }
  }
  async run(j, session, signal) {
    const base = "/rooms/" + session.Room + "/files";
    this.log((j.kind === "upload" ? "Sending " : "Receiving ") + j.name + ".");
    try {
      if (j.kind === "upload") await this.upload(j, session.conn, base, signal);
      else await this.download(j, session.conn, base, signal);
      j.status = "complete";
      j.progress = j.size;
      j.error = "";
      this.log("Verified " + j.name + ".");
    } catch (e) {
      if (j.status === "cancelling") {
        await this.cleanup(j, session);
        j.status = "cancelled";
      } else if (signal.aborted) j.status = "paused";
      else {
        j.status = "failed";
        this.log("Transfer stopped for " + j.name + ".");
        j.error =
          e.code === "ENOSPC"
            ? "Download disk is full. Free space and retry."
            : e.message;
      }
    }
  }
  async upload(j, conn, base, signal) {
    const st = await fsp.stat(j.path);
    if (!st.isFile() || st.size !== j.size || st.mtimeMs !== j.mtime)
      throw Error("Source file changed. Select it again.");
    if (!j.hash) {
      j.status = "hashing";
      j.progress = 0;
      this.changed();
      j.hash = await hashFile(j.path, signal, (n) => {
        j.progress = n;
        this.update();
      });
    }
    signal.throwIfAborted();
    const meta = j.file
      ? await conn.request("GET", base + "/" + j.file, { signal })
      : await conn.request("POST", base, {
          json: {
            Name: j.name,
            Size: j.size,
            Hash: j.hash,
            Key: j.key,
            Mime:
              mime[path.extname(j.name).toLowerCase()] ||
              "application/octet-stream",
          },
          signal,
        });
    j.file = meta.ID;
    j.progress = meta.Offset;
    j.status = "uploading";
    this.changed();
    const handle = await fsp.open(j.path, "r");
    try {
      while (j.progress < j.size) {
        signal.throwIfAborted();
        const len = Math.min(CHUNK, j.size - j.progress);
        const buf = Buffer.allocUnsafe(len);
        if ((await handle.read(buf, 0, len, j.progress)).bytesRead !== len)
          throw Error("Source ended early.");
        const out = await conn.request("PATCH", base + "/" + j.file, {
          bytes: buf,
          headers: {
            "Upload-Offset": String(j.progress),
            "Chunk-SHA256": createHash("sha256").update(buf).digest("hex"),
          },
          signal,
        });
        if (out.Offset !== j.progress + len)
          throw Error("Server acknowledged an unexpected offset.");
        j.progress = out.Offset;
        this.update();
      }
    } finally {
      await handle.close();
    }
    j.status = "verifying";
    this.changed();
    const out = await conn.request("POST", base + "/" + j.file + "/verify", {
      signal,
      timeout: 1800000,
    });
    if (!out.Ready || out.Hash !== j.hash)
      throw Error("File verification did not finish.");
  }
  async download(j, conn, base, signal) {
    if (
      !/^[a-f0-9]{64}$/.test(j.hash) ||
      !Number.isSafeInteger(j.size) ||
      j.size < 0
    )
      throw Error("Invalid file metadata.");
    await fsp.mkdir(j.dir, { recursive: true, mode: 0o700 });
    // Reconcile a crash after the final link was created but before queue commit.
    if (j.publishPath) {
      const stat = async (file) =>
        fsp.lstat(file, { bigint: true }).catch((e) => {
          if (e.code !== "ENOENT") throw e;
          return null;
        });
      const [dest, partial] = await Promise.all([
        stat(j.publishPath),
        stat(j.part),
      ]);
      if (
        dest?.isFile() &&
        (!partial || (partial.dev === dest.dev && partial.ino === dest.ino)) &&
        (await hashFile(j.publishPath, signal)) === j.hash
      ) {
        j.output = j.publishPath;
        if (partial) await fsp.unlink(j.part);
        return;
      }
    }
    let handle;
    try {
      handle = await fsp.open(j.part, "ax+", 0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const st = await fsp.lstat(j.part);
      if (!st.isFile() || st.nlink !== 1)
        throw Error("Unexpected partial file.");
      handle = await fsp.open(j.part, "a+");
    }
    try {
      j.progress = (await handle.stat()).size;
      if (j.progress > j.size) {
        await handle.truncate(0);
        j.progress = 0;
      }
      j.status = "downloading";
      this.changed();
      while (j.progress < j.size) {
        const end = Math.min(j.progress + CHUNK, j.size) - 1;
        const out = await conn.request(
          "GET",
          base + "/" + j.file + "/content",
          {
            headers: { Range: "bytes=" + j.progress + "-" + end },
            binary: true,
            max: CHUNK,
            signal,
          },
        );
        if (
          out.status !== 206 ||
          out.headers["content-range"] !==
            "bytes " + j.progress + "-" + end + "/" + j.size ||
          out.data.length !== end - j.progress + 1
        )
          throw Error("Unexpected download range.");
        await handle.writeFile(out.data);
        j.progress = end + 1;
        this.update();
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    j.status = "verifying";
    this.changed();
    if ((await hashFile(j.part, signal)) !== j.hash) {
      await fsp.unlink(j.part);
      j.progress = 0;
      throw Error(
        "Download failed integrity verification. Retry for a fresh copy.",
      );
    }
    signal.throwIfAborted();
    j.output = await publish(j.part, j.dir, j.name, (candidate) => {
      j.publishPath = candidate;
      this.save();
    });
    await fsp.unlink(j.part);
  }
  async cleanup(j, session) {
    if (j.kind === "download" && j.part) await fsp.rm(j.part, { force: true });
    if (j.kind === "upload" && j.file && session)
      await session.conn
        .request("DELETE", "/rooms/" + session.Room + "/files/" + j.file, {
          timeout: 5000,
        })
        .catch(() => {});
  }
  async action(id, action) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) throw Error("Unknown transfer.");
    if (action === "retry" && ["failed", "paused"].includes(j.status)) {
      j.status = "queued";
      j.error = "";
      this.changed();
      this.pump();
      return;
    }
    if (action === "cancel" && !["complete", "cancelled"].includes(j.status)) {
      j.status = "cancelling";
      this.changed();
      const ac = this.active.get(id);
      if (ac) ac.abort();
      else {
        await this.cleanup(j, this.session(j.room));
        j.status = "cancelled";
        this.changed();
      }
      return;
    }
    throw Error("Action unavailable for this transfer.");
  }
  async pauseRoom(room) {
    for (const j of this.jobs.filter((j) => j.room === room)) {
      if (j.status === "queued") j.status = "paused";
      this.active.get(j.id)?.abort();
    }
    this.changed();
  }
  async shutdown() {
    this.stopping = true;
    for (const ac of this.active.values()) ac.abort();
    while (this.active.size) await new Promise((r) => setTimeout(r, 30));
  }
}
module.exports = { Transfers, publicJob, hashFile, localName };

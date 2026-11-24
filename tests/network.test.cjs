const { test } = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os"),
  path = require("node:path"),
  fs = require("node:fs/promises");
const { spawn } = require("node:child_process"),
  { once } = require("node:events"),
  { createInterface } = require("node:readline");
const { randomBytes, createHash } = require("node:crypto");
const {
  RoomConnection,
  encodeInvite,
  parseInvite,
} = require("../desktop/network.cjs");
const { Transfers, hashFile, localName } = require("../desktop/transfers.cjs");
const { macPorts, withAddresses } = require("../desktop/ethernet.cjs");
test("Ethernet adapters retain their own IPv4 addresses, including direct-cable addresses", () => {
  const report =
    "Hardware Port: Wi-Fi\nDevice: en0\n\nHardware Port: USB 10/100/1000 LAN\nDevice: en4\n\nHardware Port: Ethernet\nDevice: en5\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0";
  const adapters = withAddresses(macPorts(report), {
    en0: [{ family: "IPv4", address: "10.0.0.2" }],
    en4: [
      { family: "IPv4", address: "169.254.10.2" },
      { family: "IPv6", address: "::1" },
    ],
  });
  assert.deepEqual(
    adapters.map((a) => [a.device, a.addresses]),
    [
      ["en4", ["169.254.10.2"]],
      ["en5", []],
    ],
  );
});
const hash = (x) => createHash("sha256").update(x).digest("hex"),
  key = () => randomBytes(16).toString("hex");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, limit = 45000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await delay(30);
  }
  throw Error("Timed out waiting for condition");
}
test(
  "independent TLS room clients and durable file service",
  { timeout: 180000 },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "unsocial-integration-"),
    );
    const admin = key() + key();
    let child, config, owner, guest, room, other, base, host, peer;
    const clients = [];
    function connect(token = "", server = config) {
      const c = new RoomConnection(server, token);
      clients.push(c);
      return c;
    }
    async function start(extra = []) {
      const exe = path.resolve(
        "build",
        process.platform + "-" + process.arch,
        "unsocial-room" + (process.platform === "win32" ? ".exe" : ""),
      );
      child = spawn(
        exe,
        ["-data", dir, "-advertise", "127.0.0.1", "-desktop", ...extra],
        {
          env: { ...process.env, UNSOCIAL_ADMIN_TOKEN: admin },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const lines = createInterface({ input: child.stdout });
      const [line] = await once(lines, "line");
      config = JSON.parse(line);
      lines.close();
    }
    async function stop() {
      if (child && child.exitCode === null) {
        const end = once(child, "exit");
        child.stdin.end();
        await end;
      }
    }
    t.after(async () => {
      clients.forEach((c) => c.close());
      await stop();
      await fs.rm(dir, { recursive: true, force: true });
    });
    await start();
    await t.test(
      "TLS trust, malformed input and room credentials",
      async () => {
        const adminClient = connect(admin);
        assert.equal((await adminClient.request("GET", "/health")).protocol, 1);
        await assert.rejects(
          connect("", { origin: config.origin }).request("GET", "/health"),
          /certificat|issuer|verify/i,
        );
        await assert.rejects(
          connect().request("POST", "/rooms", {
            json: { Name: "X", Display: "Y" },
          }),
          { status: 403 },
        );
        await assert.rejects(
          adminClient.request("POST", "/rooms", {
            json: { Name: "X", Unexpected: true },
          }),
          { status: 400 },
        );
        room = await adminClient.request("POST", "/rooms", {
          json: { Name: "Signal room", Display: "Host" },
        });
        other = await adminClient.request("POST", "/rooms", {
          json: { Name: "Other", Display: "Elsewhere" },
        });
        base = "/rooms/" + room.Room;
        const inv = parseInvite(encodeInvite({ ...room, ...config }));
        assert.equal(inv.room, room.Room);
        assert.equal(inv.ca, config.ca);
        await assert.rejects(
          connect().request("POST", base + "/join", {
            json: { Invite: "bad", Display: "Guest" },
          }),
          { status: 403 },
        );
        await assert.rejects(
          connect().request("GET", "/rooms/" + "0".repeat(24) + "/state"),
          { status: 404 },
        );
        owner = connect(room.Token);
        peer = await connect().request("POST", base + "/join", {
          json: { Invite: room.Invite, Display: "Guest" },
        });
        guest = connect(peer.Token);
        const site = path.join(dir, "website");
        await fs.mkdir(site);
        await fs.writeFile(
          path.join(site, "index.html"),
          "<h1>Build preview</h1>",
        );
        await fs.writeFile(path.join(site, ".private.json"), "{}");
        await assert.rejects(
          guest.request("PUT", base + "/site", { json: { Folder: site } }),
          { status: 403 },
        );
        await adminClient.request("PUT", base + "/site", {
          json: { Folder: site },
        });
        assert.equal((await guest.request("GET", base + "/state")).Site, true);
        assert.equal(
          (
            await guest.request("GET", base + "/site/", { binary: true })
          ).data.toString(),
          "<h1>Build preview</h1>",
        );
        await assert.rejects(connect().request("GET", base + "/site/"), {
          status: 403,
        });
        await assert.rejects(
          guest.request("GET", base + "/site/.private.json"),
          { status: 404 },
        );
        await adminClient.request("PUT", base + "/site", {
          json: { Folder: "" },
        });
        await assert.rejects(guest.request("GET", base + "/site/"), {
          status: 404,
        });
        await assert.rejects(
          guest.request("GET", "/rooms/" + other.Room + "/state"),
          { status: 403 },
        );
        await assert.rejects(
          connect().request("POST", base + "/join", {
            json: { Invite: room.Invite, Display: "gUeSt" },
          }),
          { status: 409 },
        );
        const third = await connect().request("POST", base + "/join", {
          json: { Invite: room.Invite, Display: "Observer" },
        });
        assert.equal(
          (await owner.request("GET", base + "/state")).Members.length,
          3,
        );
        await connect(third.Token).request("POST", base + "/leave");
        const sock = connect().socket(base + "/events?after=0");
        const [e] = await once(sock, "error");
        assert.match(e.message, /403/);
      },
    );
    await t.test(
      "presence, ordered chat, deduplication and replay",
      async () => {
        const sock = guest.socket(base + "/events?after=0");
        const frames = [];
        sock.on("message", (v) => frames.push(JSON.parse(v)));
        await once(sock, "open");
        await until(() =>
          frames.some(
            (f) => f.Members.find((m) => m.ID === peer.Member)?.Online,
          ),
        );
        const message = { Text: "Across the room", Key: key() };
        await Promise.all([
          owner.request("POST", base + "/chat", { json: message }),
          owner.request("POST", base + "/chat", { json: message }),
          guest.request("POST", base + "/chat", {
            json: { Text: "Reply", Key: key() },
          }),
        ]);
        await until(() =>
          frames.some((f) => f.Events.some((e) => e.Text === "Reply")),
        );
        const state = await owner.request("GET", base + "/state");
        const chat = state.Events.filter((e) => e.Kind === "chat");
        assert.equal(chat.length, 2);
        assert.ok(chat[1].Seq > chat[0].Seq);
        const closed = once(sock, "close");
        sock.close();
        await closed;
        await until(
          async () =>
            !(await owner.request("GET", base + "/state")).Members.find(
              (m) => m.ID === peer.Member,
            ).Online,
        );
        await owner.request("POST", base + "/chat", {
          json: { Text: "While disconnected", Key: key() },
        });
        const resumed = guest.socket(base + "/events?after=" + state.Cursor);
        const [raw] = await once(resumed, "message");
        assert.equal(JSON.parse(raw).Events[0].Text, "While disconnected");
        resumed.close();
      },
    );
    await t.test(
      "durable offset, replayed offer, restart, corruption and protected download",
      async () => {
        const bytes = randomBytes(100003),
          split = 16000;
        const meta = {
          Name: "sample.custom",
          Size: bytes.length,
          Hash: hash(bytes),
          Mime: "application/octet-stream",
          Key: key(),
        };
        await assert.rejects(
          owner.request("POST", base + "/files", {
            json: { ...meta, Name: "../elsewhere" },
          }),
          { status: 400 },
        );
        await assert.rejects(
          owner.request("POST", base + "/files", {
            json: { ...meta, Size: -1 },
          }),
          { status: 400 },
        );
        await assert.rejects(
          owner.request("POST", base + "/files", {
            json: { ...meta, Mime: "x".repeat(18000) },
          }),
          { status: 400 },
        );
        const offer = () =>
          owner.request("POST", base + "/files", { json: meta });
        const f = await offer();
        assert.equal((await offer()).ID, f.ID);
        const url = base + "/files/" + f.ID;
        const chunk = (b, offset, checksum = hash(b)) =>
          owner.request("PATCH", url, {
            bytes: b,
            headers: { "Upload-Offset": offset, "Chunk-SHA256": checksum },
          });
        await assert.rejects(guest.request("GET", url + "/content"), {
          status: 404,
        });
        await assert.rejects(owner.request("POST", url + "/verify"), {
          status: 409,
        });
        await assert.rejects(
          chunk(bytes.subarray(0, split), 0, "0".repeat(64)),
          { status: 422 },
        );
        assert.equal((await chunk(bytes.subarray(0, split), 0)).Offset, split);
        await assert.rejects(chunk(bytes, 0), { status: 409 });
        const original = config;
        clients.forEach((c) => c.close());
        await stop();
        await start();
        assert.equal(original.ca, config.ca);
        assert.equal(original.origin, config.origin);
        owner = connect(room.Token);
        guest = connect(peer.Token);
        assert.equal((await owner.request("GET", url)).Offset, split);
        await chunk(bytes.subarray(split), split);
        assert.ok((await owner.request("POST", url + "/verify")).Ready);
        assert.ok((await owner.request("POST", url + "/verify")).Ready);
        assert.deepEqual(
          (await guest.request("GET", url + "/content", { binary: true })).data,
          bytes,
        );
        await assert.rejects(
          connect(other.Token).request("GET", url + "/content"),
          { status: 403 },
        );
        const bad = await owner.request("POST", base + "/files", {
          json: { ...meta, Key: key(), Size: 0, Hash: hash("wrong") },
        });
        await assert.rejects(
          owner.request("POST", base + "/files/" + bad.ID + "/verify"),
          { status: 422 },
        );
        await owner.request("DELETE", base + "/files/" + bad.ID);
      },
    );
    await t.test(
      "storage pressure, same-offset contention and cancellation",
      async () => {
        clients.forEach((c) => c.close());
        await stop();
        await start(["-reserve-bytes", "18446744073709551615"]);
        owner = connect(room.Token);
        const buf = Buffer.from("one chunk"),
          make = () =>
            owner.request("POST", base + "/files", {
              json: {
                Name: "cancelled.dat",
                Size: buf.length,
                Hash: hash(buf),
                Key: key(),
                Mime: "application/octet-stream",
              },
            });
        const f = await make(),
          route = base + "/files/" + f.ID,
          send = () =>
            owner.request("PATCH", route, {
              bytes: buf,
              headers: { "Upload-Offset": "0", "Chunk-SHA256": hash(buf) },
            });
        await assert.rejects(send(), { status: 507 });
        assert.equal((await owner.request("GET", route)).Offset, 0);
        clients.forEach((c) => c.close());
        await stop();
        await start();
        owner = connect(room.Token);
        guest = connect(peer.Token);
        const results = await Promise.allSettled([send(), send()]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(
          results.find((r) => r.status === "rejected").reason.status,
          409,
        );
        await owner.request("DELETE", route);
        await assert.rejects(owner.request("GET", route), { status: 404 });
        const delayed = {
          request: async (...args) => {
            if (args[0] === "PATCH") await delay(200);
            return owner.request(...args);
          },
        };
        const engine = new Transfers({
          session: () => ({ Room: room.Room, conn: delayed }),
          folder: () => dir,
          save: () => {},
          update: () => {},
        });
        const filename = path.join(dir, "cancel-source.bin");
        await fs.writeFile(filename, randomBytes(32768));
        await engine.send([filename], room.Room);
        const j = engine.jobs[0];
        await until(() => j.status === "uploading");
        await engine.action(j.id, "cancel");
        await until(() => j.status === "cancelled");
        await assert.rejects(owner.request("GET", base + "/files/" + j.file), {
          status: 404,
        });
      },
    );
    await t.test(
      "concurrent opaque files, large upload, download resume and name conflicts",
      async () => {
        const sources = path.join(dir, "sources"),
          out = path.join(dir, "downloads");
        await fs.mkdir(sources);
        await fs.mkdir(out);
        const names = [
          "message.txt",
          "archive.zip",
          "image.png",
          "clip.y4m",
          "empty.odd",
          "large.binary",
        ];
        const fixture = Buffer.alloc(1024 * 1024, 0xaf);
        for (const name of names)
          await fs.writeFile(
            path.join(sources, name),
            name === "empty.odd" ? "" : randomBytes(733),
          );
        await fs.writeFile(
          path.join(sources, "message.txt"),
          "Hello from the other desktop.\n",
        );
        await fs.writeFile(
          path.join(sources, "image.png"),
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        await fs.writeFile(
          path.join(sources, "clip.y4m"),
          Buffer.concat([
            Buffer.from("YUV4MPEG2 W2 H2 F1:1 Ip A1:1 C420jpeg\nFRAME\n"),
            Buffer.from([16, 60, 100, 160, 128, 128]),
          ]),
        );
        const zip = new (require("yazl").ZipFile)();
        const zipDone = require("node:stream/promises").pipeline(
          zip.outputStream,
          require("node:fs").createWriteStream(
            path.join(sources, "archive.zip"),
          ),
        );
        zip.addBuffer(Buffer.from("Room fixture"), "note.txt");
        zip.end();
        await zipDone;
        const large = path.join(sources, names.at(-1));
        const handle = await fs.open(large, "w");
        for (let i = 0; i < 256; i++) await handle.writeFile(fixture);
        await handle.close();
        const engine = (conn) =>
          new Transfers({
            session: () => ({ Room: room.Room, conn }),
            folder: () => out,
            save: () => {},
            update: () => {},
            parallel: 3,
          });
        const uploads = engine(owner);
        await uploads.send(
          names.map((n) => path.join(sources, n)),
          room.Room,
        );
        await until(
          () =>
            uploads.jobs.every((j) =>
              ["failed", "complete"].includes(j.status),
            ),
          120000,
        );
        assert.deepEqual(
          uploads.jobs.map((j) => j.error),
          names.map(() => ""),
        );
        const shared = (await owner.request("GET", base + "/state")).Files;
        let cut = true;
        const flaky = {
          request: async (...args) => {
            if (
              cut &&
              args[0] === "GET" &&
              Number(args[2].headers.Range.match(/\d+/)[0]) >= 1048576
            ) {
              cut = false;
              throw Error("Interrupted by test");
            }
            return guest.request(...args);
          },
        };
        const downloads = engine(flaky);
        await fs.writeFile(path.join(out, names.at(-1)), "existing file");
        downloads.receive(
          shared.find((f) => f.Name === names.at(-1)),
          room.Room,
        );
        const j = downloads.jobs[0];
        await until(() => j.status === "failed");
        assert.equal((await fs.stat(j.part)).size, 1048576);
        await downloads.action(j.id, "retry");
        await until(() => ["failed", "complete"].includes(j.status), 120000);
        assert.equal(j.status, "complete", j.error);
        assert.equal(path.basename(j.output), "large (1).binary");
        assert.equal(await hashFile(j.output), await hashFile(large));
        await fs.link(j.output, j.part);
        j.status = "paused";
        await downloads.action(j.id, "retry");
        await until(() => j.status === "complete");
        await assert.rejects(fs.stat(j.part), { code: "ENOENT" });
        assert.equal(
          await fs.readFile(path.join(out, names.at(-1)), "utf8"),
          "existing file",
        );
        for (const name of names.slice(0, -1))
          downloads.receive(
            shared.find((f) => f.Name === name),
            room.Room,
          );
        await until(() =>
          downloads.jobs.every(
            (j) => j.status === "complete" || j.status === "failed",
          ),
        );
        for (const j of downloads.jobs)
          assert.equal(await hashFile(j.output), j.hash);
        assert.equal(localName("CON.txt"), "_CON.txt");
      },
    );
    await t.test(
      "creator departure leaves peer session usable and revokes creator",
      async () => {
        await owner.request("POST", base + "/leave");
        await assert.rejects(owner.request("GET", base + "/state"), {
          status: 403,
        });
        assert.equal(
          (await guest.request("GET", base + "/state")).Members.length,
          1,
        );
        await guest.request("POST", base + "/chat", {
          json: { Text: "Still connected", Key: key() },
        });
      },
    );
  },
);

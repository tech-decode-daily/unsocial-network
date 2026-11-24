"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  safeStorage,
  shell,
  Menu,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { randomBytes } = require("node:crypto");
const {
  RoomConnection,
  encodeInvite,
  parseInvite,
  endpoint,
} = require("./network.cjs");
const { Transfers, publicJob } = require("./transfers.cjs");
const { ethernet } = require("./ethernet.cjs");
const { openSite } = require("./site-viewer.cjs");
app.setName("Unsocial Network");
if (process.env.UNSOCIAL_PROFILE)
  app.setPath("userData", path.resolve(process.env.UNSOCIAL_PROFILE));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  const profile = app.getPath("userData"),
    vault = path.join(profile, "session.bin"),
    home = path.join(__dirname, "index.html");
  let win,
    queue,
    hostPromise,
    hostProcess,
    hostPort,
    stopping = false,
    ethernetTimer,
    ethernetPorts = null,
    ethernetError = false,
    siteWindow,
    active,
    socket,
    reconnect,
    attempt = 0,
    notifyTimer,
    quitting = false,
    shut = false,
    switching = false;
  let connection = "Offline",
    roomView = null,
    secure = false;
  const activity = [],
    streams = new Map();
  let data = {
    rooms: [],
    jobs: [],
    display: "",
    folder: path.join(app.getPath("downloads"), "Unsocial Network"),
    parallel: 2,
  };
  function log(message) {
    activity.push({ time: Date.now(), message });
    if (activity.length > 100) activity.shift();
    notify();
  }
  function save() {
    if (!secure) return;
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(data));
      fs.writeFileSync(vault + ".tmp", encrypted, { mode: 0o600, flush: true });
      fs.renameSync(vault + ".tmp", vault);
    } catch {
      secure = false;
      log("Session saving unavailable. This session is in memory.");
    }
  }
  function localIPs() {
    return Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === "IPv4" && !a.internal)
      .map((a) => a.address);
  }
  async function refreshEthernet() {
    let ports;
    try {
      ports = await ethernet();
    } catch {
      ports = null;
    }
    if (
      JSON.stringify(ports) !== JSON.stringify(ethernetPorts) ||
      ethernetError !== (ports === null)
    ) {
      ethernetPorts = ports;
      ethernetError = ports === null;
      notify();
    }
    if (!quitting) ethernetTimer = setTimeout(refreshEthernet, 5500);
  }
  function wiredAddress(address) {
    if (
      !ethernetPorts?.some((port) => port.addresses.includes(address)) ||
      !localIPs().includes(address)
    )
      throw Error(
        "Ethernet address is unavailable. Check the cable and try again.",
      );
    return address;
  }
  function state() {
    return {
      version: app.getVersion(),
      connection,
      room: roomView,
      member: active?.Member,
      display: data.display,
      secure,
      parallel: data.parallel,
      folder: data.folder,
      rooms: data.rooms.map((r) => ({
        id: r.Room,
        name: r.Name,
        expires: r.Expires,
        hosted: r.hosted,
        origin: r.origin,
      })),
      jobs: data.jobs.map(publicJob),
      activity,
      ips: localIPs(),
      ethernet: ethernetPorts,
      ethernetError,
      hostPort,
      hostStopping: stopping,
      hosted: !!active?.hosted,
      wired: active?.localAddress,
    };
  }
  function notify() {
    if (notifyTimer || !win || win.isDestroyed()) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      if (!win.isDestroyed()) win.webContents.send("state", state());
    }, 75);
  }
  function session(id) {
    const m = data.rooms.find((r) => r.Room === id);
    if (!m) return;
    let conn = streams.get(id);
    if (!conn) {
      conn = new RoomConnection(m, m.Token);
      streams.set(id, conn);
    }
    return { ...m, conn };
  }
  function detach() {
    if (siteWindow && !siteWindow.isDestroyed()) siteWindow.destroy();
    siteWindow = null;
    clearTimeout(reconnect);
    if (socket) {
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.terminate();
      socket = null;
    }
    active = null;
    roomView = null;
    connection = "Offline";
    attempt = 0;
  }
  async function loadRoom(id) {
    if (!active || active.Room !== id) return;
    const current = active;
    try {
      const snap = await current.conn.request(
        "GET",
        "/rooms/" + id + "/state",
        { timeout: 14000 },
      );
      if (current !== active) return;
      if (attempt && roomView.Cursor) {
        snap.Cursor = roomView.Cursor;
        snap.Events = roomView.Events;
      }
      roomView = snap;
      listen(current);
    } catch (e) {
      if (current !== active) return;
      schedule(current, e.message, e.status);
    }
    notify();
  }
  function schedule(current, message, status) {
    if (current !== active || quitting) return;
    if ([403, 404, 410].includes(status)) {
      connection = "Unavailable";
      log(message);
      return;
    }
    connection = "Reconnecting";
    if (!attempt) log("Room connection interrupted. Reconnecting.");
    clearTimeout(reconnect);
    reconnect = setTimeout(
      () => loadRoom(current.Room),
      Math.min(15000, 600 * 2 ** Math.min(attempt++, 5)) + Math.random() * 350,
    );
    notify();
  }
  function listen(current) {
    const sock = current.conn.socket(
      "/rooms/" + current.Room + "/events?after=" + roomView.Cursor,
    );
    socket = sock;
    sock.on("open", () => {
      if (current !== active) return;
      connection = "Connected";
      log(
        attempt
          ? "Room connection restored."
          : "Connected to " + current.Name + ".",
      );
      attempt = 0;
      queue.pump();
    });
    sock.on("message", (raw) => {
      if (current !== active) return;
      try {
        const frame = JSON.parse(raw);
        roomView.Members = frame.Members;
        roomView.Site = !!frame.Site;
        if (!roomView.Site && siteWindow && !siteWindow.isDestroyed())
          siteWindow.destroy();
        for (const ev of frame.Events) {
          if (ev.Seq <= roomView.Cursor) continue;
          roomView.Events.push(ev);
          if (ev.Kind === "file") {
            log(ev.Sender + " shared " + ev.Text + ".");
            current.conn
              .request("GET", "/rooms/" + current.Room + "/files/" + ev.File)
              .then((f) => {
                if (
                  current === active &&
                  !roomView.Files.some((x) => x.ID === f.ID)
                ) {
                  roomView.Files.push(f);
                  notify();
                }
              })
              .catch(() => {});
          }
          if (ev.Kind === "join" || ev.Kind === "leave")
            log(
              ev.Sender +
                (ev.Kind === "join" ? " joined the room." : " left the room."),
            );
        }
        roomView.Events = roomView.Events.slice(-300);
        roomView.Cursor = frame.Cursor;
        notify();
      } catch {
        sock.terminate();
      }
    });
    sock.on("error", () => {});
    sock.on("close", (code, reason) => {
      if (sock !== socket) return;
      socket = null;
      schedule(
        current,
        reason.toString() || "Room connection closed.",
        code === 4003 ? 403 : 0,
      );
    });
  }
  async function enter(id) {
    const next = session(id);
    if (!next) throw Error("Room is unavailable.");
    detach();
    active = next;
    roomView = {
      Room: id,
      Name: next.Name,
      Members: [],
      Files: [],
      Events: [],
      Expires: next.Expires,
      Cursor: 0,
    };
    connection = "Connecting";
    notify();
    await loadRoom(id);
  }
  async function host() {
    if (stopping)
      throw Error("The local server is stopping. Try again in a moment.");
    if (hostPromise) return hostPromise;
    fs.rmSync(path.join(profile, "host-paused"), { force: true });
    const token = randomBytes(32).toString("hex");
    const bin = "unsocial-room" + (process.platform === "win32" ? ".exe" : "");
    const packaged = path.join(app.getAppPath(), "bin", bin);
    const binary = fs.existsSync(packaged)
      ? packaged
      : path.join(
          __dirname,
          "..",
          "build",
          process.platform + "-" + process.arch,
          bin,
        );
    const child = spawn(
      binary,
      [
        "-data",
        path.join(profile, "host"),
        "-desktop",
        ...(process.env.UNSOCIAL_ADVERTISE
          ? ["-advertise", process.env.UNSOCIAL_ADVERTISE]
          : []),
      ],
      {
        windowsHide: true,
        env: { ...process.env, UNSOCIAL_ADMIN_TOKEN: token },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    hostProcess = child;
    hostPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(Error("Room host startup timed out."));
      }, 15000);
      child.on("error", () => {
        clearTimeout(timer);
        hostPromise = null;
        reject(Error("Unable to start the bundled room server."));
      });
      child.stderr.on("data", () => {});
      const lines = createInterface({ input: child.stdout });
      lines.once("line", (line) => {
        clearTimeout(timer);
        try {
          const config = JSON.parse(line);
          hostPort = config.port;
          log("Local room server is listening.");
          resolve({ ...config, token });
        } catch {
          reject(Error("Room server returned invalid startup details."));
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        hostPromise = null;
        hostProcess = null;
        hostPort = null;
        reject(
          Error(
            "Room host could not start. Check disk space and the saved port.",
          ),
        );
        if (!quitting) log("Local room server stopped.");
      });
    });
    return hostPromise;
  }
  async function stopHost() {
    const child = hostProcess;
    if (!child || stopping) return;
    stopping = true;
    notify();
    try {
      fs.writeFileSync(path.join(profile, "host-paused"), "");
      const done = new Promise((resolve) => child.once("exit", resolve));
      const timer = setTimeout(() => child.kill(), 5000);
      try {
        child.stdin.end();
        await done;
      } finally {
        clearTimeout(timer);
      }
    } finally {
      stopping = false;
      notify();
    }
  }
  async function setSite(room, folder) {
    if (!room?.hosted) throw Error("Choose a room hosted on this desktop.");
    const config = await host();
    const admin = new RoomConnection(
      { ...config, origin: "https://127.0.0.1:" + config.port },
      config.token,
    );
    try {
      await admin.request("PUT", "/rooms/" + room.Room + "/site", {
        json: { Folder: folder },
      });
    } finally {
      admin.close();
    }
  }
  async function establish(input, join) {
    if (switching) throw Error("A room connection is already being opened.");
    switching = true;
    let conn;
    try {
      const display = String(input.display || "").trim();
      if (!display || display.length > 80)
        throw Error("Enter your display name.");
      const localAddress = input.wired ? wiredAddress(input.wired) : undefined;
      const server = join
        ? parseInvite(input.invite)
        : input.origin
          ? { ...endpoint(input.origin), token: input.admin }
          : { ...(await host()) };
      const lan = localAddress || input.lan;
      if (!join && !input.origin && lan) {
        if (!localIPs().includes(lan))
          throw Error("Selected network address is unavailable.");
        const url = new URL(server.origin);
        url.hostname = lan;
        server.origin = url.origin;
      }
      conn = new RoomConnection(
        { ...server, localAddress },
        join ? "" : server.token,
      );
      const result = join
        ? await conn.request("POST", "/rooms/" + server.room + "/join", {
            json: { Invite: server.key, Display: display },
          })
        : await conn.request("POST", "/rooms", {
            json: { Name: input.name, Display: display },
          });
      if (
        !/^[0-9a-f]{24}$/.test(result.Room) ||
        !/^[0-9a-f]{64}$/.test(result.Token)
      )
        throw Error("Invalid room credentials from host.");
      if (data.rooms.some((r) => r.Room === result.Room)) {
        await conn.close();
        throw Error("This room is already in your directory. Open it there.");
      }
      data.rooms.unshift({
        ...result,
        ...endpoint(server.origin, server.ca),
        hosted: !join && !input.origin,
        localAddress,
      });
      data.display = display;
      save();
      await enter(result.Room);
      log((join ? "Joined " : "Created ") + result.Name + ".");
    } finally {
      conn?.close();
      switching = false;
    }
  }
  async function act(name, payload) {
    switch (name) {
      case "state":
        return state();
      case "startHost":
        await host();
        return;
      case "stopHost":
        return stopHost();
      case "shareSite": {
        const room = active;
        if (!room?.hosted) throw Error("Open a room hosted here first.");
        const result = await dialog.showOpenDialog(win, {
          title: "Share a static website with this room",
          properties: ["openDirectory"],
        });
        if (!result.canceled && active === room)
          await setSite(room, result.filePaths[0]);
        return;
      }
      case "stopSite":
        return setSite(active, "");
      case "openSite":
        if (!active || !roomView?.Site)
          throw Error("No website is running in this room.");
        if (siteWindow && !siteWindow.isDestroyed()) siteWindow.focus();
        else siteWindow = openSite(active, win);
        return;
      case "copyMessage": {
        const message = roomView?.Events.find(
          (e) => e.Seq === payload && e.Kind === "chat",
        );
        if (!message) throw Error("Message is unavailable.");
        clipboard.writeText(message.Text);
        return;
      }
      case "create":
        return establish(payload, false);
      case "join": {
        const inv = parseInvite(payload.invite);
        const known = data.rooms.find(
          (r) =>
            r.Room === inv.room &&
            r.origin === inv.origin &&
            r.Invite === inv.key &&
            r.ca === inv.ca,
        );
        if (!known) return establish(payload, true);
        if (
          payload.wired &&
          known.localAddress !== wiredAddress(payload.wired)
        ) {
          known.localAddress = payload.wired;
          streams.get(known.Room)?.close();
          streams.delete(known.Room);
          save();
        }
        return enter(known.Room);
      }
      case "enter":
        return enter(payload);
      case "directory":
        detach();
        notify();
        return;
      case "invite":
        if (active) {
          clipboard.writeText(encodeInvite(active));
          log("Invitation copied to clipboard.");
        }
        return;
      case "chat":
        if (!active) throw Error("Open a room first.");
        return active.conn.request("POST", "/rooms/" + active.Room + "/chat", {
          json: { Text: payload.text, Key: payload.key },
        });
      case "leave": {
        if (!active) return;
        const s = active;
        if (s.hosted && roomView?.Site) await setSite(s, "");
        await s.conn.request("POST", "/rooms/" + s.Room + "/leave");
        await queue.pauseRoom(s.Room);
        detach();
        data.rooms = data.rooms.filter((x) => x.Room !== s.Room);
        for (const j of data.jobs.filter(
          (j) =>
            j.room === s.Room && !["cancelled", "complete"].includes(j.status),
        ))
          await queue.action(j.id, "cancel");
        streams.get(s.Room)?.close();
        streams.delete(s.Room);
        save();
        log("Left " + s.Name + ".");
        return;
      }
      case "forget": {
        const r = data.rooms.find((x) => x.Room === payload);
        if (!r || r.Expires * 1000 > Date.now())
          throw Error("Only expired rooms can be removed here.");
        for (const j of data.jobs.filter(
          (j) =>
            j.room === r.Room && !["complete", "cancelled"].includes(j.status),
        ))
          await queue.action(j.id, "cancel");
        data.rooms = data.rooms.filter((x) => x !== r);
        if (active?.Room === r.Room) detach();
        streams.get(r.Room)?.close();
        streams.delete(r.Room);
        save();
        notify();
        return;
      }
      case "send": {
        if (!active) return;
        const room = active.Room;
        const result = await dialog.showOpenDialog(win, {
          properties: ["openFile", "multiSelections"],
        });
        if (!result.canceled) await queue.send(result.filePaths, room);
        return;
      }
      case "drop":
        if (active && Array.isArray(payload))
          return queue.send(payload, active.Room);
        return;
      case "receive": {
        const f = roomView?.Files.find((f) => f.ID === payload);
        if (!f) throw Error("This file is unavailable.");
        queue.receive(f, active.Room);
        return;
      }
      case "transfer":
        return queue.action(payload.id, payload.action);
      case "show": {
        const j = data.jobs.find(
          (j) => j.id === payload && j.output && j.status === "complete",
        );
        if (j) shell.showItemInFolder(j.output);
        return;
      }
      case "folder": {
        const result = await dialog.showOpenDialog(win, {
          properties: ["openDirectory", "createDirectory"],
        });
        if (!result.canceled) {
          data.folder = result.filePaths[0];
          save();
          notify();
        }
        return;
      }
      case "parallel": {
        const n = Number(payload);
        if (!Number.isSafeInteger(n) || n < 1 || n > 64)
          throw Error("Choose between 1 and 64 active jobs.");
        data.parallel = n;
        queue.parallel = n;
        save();
        queue.pump();
        notify();
        return;
      }
      default:
        throw Error("Unknown desktop command.");
    }
  }
  app
    .whenReady()
    .then(async () => {
      fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
      secure =
        safeStorage.isEncryptionAvailable() &&
        !(
          process.platform === "linux" &&
          safeStorage.getSelectedStorageBackend() === "basic_text"
        );
      if (secure && fs.existsSync(vault)) {
        try {
          data = JSON.parse(safeStorage.decryptString(fs.readFileSync(vault)));
        } catch {
          secure = false;
          log(
            "Saved session could not be unlocked. Using memory for this launch.",
          );
        }
      }
      queue = new Transfers({
        jobs: data.jobs,
        session,
        folder: () => data.folder,
        save,
        update: notify,
        log,
        parallel: data.parallel,
      });
      Menu.setApplicationMenu(null);
      win = new BrowserWindow({
        width: 1260,
        height: 850,
        minWidth: 740,
        minHeight: 560,
        backgroundColor: "#edeee5",
        show: false,
        title: "Unsocial Network",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const wc = win.webContents;
      refreshEthernet();
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      wc.on("will-navigate", (e) => e.preventDefault());
      wc.session.setPermissionRequestHandler((_w, _p, cb) => cb(false));
      ipcMain.handle("command", async (e, name, value) => {
        if (
          e.sender !== wc ||
          e.senderFrame !== wc.mainFrame ||
          e.senderFrame.url !== pathToFileURL(home).href
        )
          throw Error("Invalid desktop context.");
        return act(name, value);
      });
      win.once("ready-to-show", () => win.show());
      log("Desktop initialized.");
      if (!secure)
        log(
          "OS credential store unavailable. Rooms and jobs will last for this session.",
        );
      await win.loadFile(home);
      // Other members may still be using a room its creator has left.
      if (
        !fs.existsSync(path.join(profile, "host-paused")) &&
        fs.existsSync(path.join(profile, "host", "rooms.db"))
      )
        host().catch((e) => log(e.message));
    })
    .catch((e) => {
      dialog.showErrorBox("Unsocial Network", e.message);
      app.quit();
    });
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (e) => {
    if (shut) return;
    e.preventDefault();
    if (quitting) return;
    quitting = true;
    clearTimeout(ethernetTimer);
    (async () => {
      detach();
      await queue?.shutdown();
      save();
      for (const c of streams.values()) c.close();
      if (hostProcess) {
        const child = hostProcess;
        const done = new Promise((r) => child.once("exit", r));
        child.stdin.end();
        await Promise.race([done, new Promise((r) => setTimeout(r, 4500))]);
        if (child.exitCode === null) child.kill();
      }
    })().finally(() => {
      shut = true;
      app.quit();
    });
  });
}

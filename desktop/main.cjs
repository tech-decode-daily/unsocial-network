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
    active,
    notifyTimer,
    quitting = false,
    shut = false,
    switching = false;
  let secure = false;
  const activity = [],
    sessions = new Map();
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
      connection: active?.connection ?? "Offline",
      room: active?.view ?? null,
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
        connection: sessions.get(r.Room)?.connection ?? "Offline",
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
    if (sessions.has(id)) return sessions.get(id);
    const m = data.rooms.find((r) => r.Room === id);
    if (!m || m.Expires * 1000 <= Date.now() || quitting) return;
    const room = {
      ...m,
      conn: new RoomConnection(m, m.Token),
      connection: "Connecting",
      attempt: 0,
      socket: null,
      reconnect: null,
      siteWindow: null,
      view: {
        Room: id,
        Name: m.Name,
        Expires: m.Expires,
        Cursor: 0,
        Members: [],
        Files: [],
        Events: [],
      },
    };
    sessions.set(id, room);
    loadRoom(room);
    return room;
  }
  function closeSession(id) {
    const room = sessions.get(id);
    if (!room) return;
    sessions.delete(id);
    if (active === room) active = null;
    if (room.siteWindow && !room.siteWindow.isDestroyed())
      room.siteWindow.destroy();
    clearTimeout(room.reconnect);
    if (room.socket) {
      room.socket.removeAllListeners();
      room.socket.on("error", () => {});
      room.socket.terminate();
    }
    room.conn.close();
  }
  function isLive(room) {
    return !quitting && sessions.get(room.Room) === room;
  }
  async function loadRoom(current) {
    if (!isLive(current)) return;
    try {
      const snap = await current.conn.request(
        "GET",
        "/rooms/" + current.Room + "/state",
        { timeout: 14000 },
      );
      if (!isLive(current)) return;
      if (current.attempt && current.view.Cursor) {
        snap.Cursor = current.view.Cursor;
        snap.Events = current.view.Events;
      }
      current.view = snap;
      listen(current);
    } catch (e) {
      schedule(current, e.message, e.status);
    }
    notify();
  }
  function schedule(current, message, status) {
    if (!isLive(current)) return;
    if (
      [403, 404, 410].includes(status) ||
      current.Expires * 1000 <= Date.now()
    ) {
      current.connection = "Unavailable";
      log(current.Name + ": " + message);
      return;
    }
    current.connection = "Reconnecting";
    if (!current.attempt) log("Reconnecting to " + current.Name + ".");
    clearTimeout(current.reconnect);
    current.reconnect = setTimeout(
      () => loadRoom(current),
      Math.min(15000, 600 * 2 ** Math.min(current.attempt++, 5)) +
        Math.random() * 350,
    );
    notify();
  }
  function listen(current) {
    const roomView = current.view;
    const sock = current.conn.socket(
      "/rooms/" + current.Room + "/events?after=" + roomView.Cursor,
    );
    current.socket = sock;
    sock.on("open", () => {
      if (!isLive(current)) return;
      current.connection = "Connected";
      log(
        current.attempt
          ? "Reconnected to " + current.Name + "."
          : "Connected to " + current.Name + ".",
      );
      current.attempt = 0;
      queue.pump();
    });
    sock.on("message", (raw) => {
      if (!isLive(current)) return;
      try {
        const frame = JSON.parse(raw);
        roomView.Members = frame.Members;
        roomView.Site = !!frame.Site;
        if (
          !roomView.Site &&
          current.siteWindow &&
          !current.siteWindow.isDestroyed()
        )
          current.siteWindow.destroy();
        for (const ev of frame.Events) {
          if (ev.Seq <= roomView.Cursor) continue;
          roomView.Events.push(ev);
          if (ev.Kind === "file") {
            log(current.Name + ": " + ev.Sender + " shared " + ev.Text + ".");
            current.conn
              .request("GET", "/rooms/" + current.Room + "/files/" + ev.File)
              .then((f) => {
                if (
                  isLive(current) &&
                  current.view === roomView &&
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
                (ev.Kind === "join" ? " joined " : " left ") +
                current.Name +
                ".",
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
      if (sock !== current.socket) return;
      current.socket = null;
      schedule(
        current,
        reason.toString() || "Room connection closed.",
        code === 4003 ? 403 : 0,
      );
    });
  }
  function enter(id) {
    const next = session(id);
    if (!next) throw Error("Room is unavailable.");
    active = next;
    if (next.connection === "Unavailable" && next.Expires * 1000 > Date.now()) {
      next.connection = "Connecting";
      loadRoom(next);
    }
    notify();
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
      enter(result.Room);
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
        if (!active?.view.Site)
          throw Error("No website is running in this room.");
        if (active.siteWindow && !active.siteWindow.isDestroyed())
          active.siteWindow.focus();
        else active.siteWindow = openSite(active, win);
        return;
      case "copyMessage": {
        const message = active?.view.Events.find(
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
        if (!known) {
          if (data.rooms.some((r) => r.Room === inv.room))
            throw Error(
              "This room is already in your directory. Open it there.",
            );
          return establish(payload, true);
        }
        if (
          payload.wired &&
          known.localAddress !== wiredAddress(payload.wired)
        ) {
          known.localAddress = payload.wired;
          closeSession(known.Room);
          save();
        }
        return enter(known.Room);
      }
      case "enter":
        return enter(payload);
      case "directory":
        active = null;
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
        if (s.hosted && s.view.Site) await setSite(s, "");
        await s.conn.request("POST", "/rooms/" + s.Room + "/leave");
        await queue.pauseRoom(s.Room);
        data.rooms = data.rooms.filter((x) => x.Room !== s.Room);
        for (const j of data.jobs.filter(
          (j) =>
            j.room === s.Room && !["cancelled", "complete"].includes(j.status),
        ))
          await queue.action(j.id, "cancel");
        closeSession(s.Room);
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
        closeSession(r.Room);
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
        if (!result.canceled && sessions.has(room))
          await queue.send(result.filePaths, room);
        return;
      }
      case "drop":
        if (active && Array.isArray(payload))
          return queue.send(payload, active.Room);
        return;
      case "receive": {
        const f = active?.view.Files.find((f) => f.ID === payload);
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
      ipcMain.handle("command", async (e, name, value, roomId) => {
        if (
          e.sender !== wc ||
          e.senderFrame !== wc.mainFrame ||
          e.senderFrame.url !== pathToFileURL(home).href
        )
          throw Error("Invalid desktop context.");
        if (roomId !== undefined && roomId !== active?.Room)
          throw Error("The selected room has changed. Try again in the room.");
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
      for (const room of data.rooms) session(room.Room);
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
      await queue?.shutdown();
      save();
      for (const id of sessions.keys()) closeSession(id);
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

const { contextBridge, ipcRenderer, webUtils } = require("electron");
const call = (op, arg, room) => ipcRenderer.invoke("command", op, arg, room);
contextBridge.exposeInMainWorld("network", {
  state: () => call("state"),
  startHost: () => call("startHost"),
  stopHost: () => call("stopHost"),
  shareSite: (room) => call("shareSite", undefined, room),
  stopSite: (room) => call("stopSite", undefined, room),
  openSite: (room) => call("openSite", undefined, room),
  copyMessage: (seq, room) => call("copyMessage", seq, room),
  create: (d) => call("create", d),
  join: (d) => call("join", d),
  enter: (id) => call("enter", id),
  directory: () => call("directory"),
  invite: (room) => call("invite", undefined, room),
  chat: (text, key, room) => call("chat", { text, key }, room),
  leave: (room) => call("leave", undefined, room),
  forget: (id) => call("forget", id),
  send: (room) => call("send", undefined, room),
  drop: (files, room) =>
    call(
      "drop",
      Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean),
      room,
    ),
  receive: (id, room) => call("receive", id, room),
  transfer: (id, action) => call("transfer", { id, action }),
  show: (id) => call("show", id),
  folder: () => call("folder"),
  parallel: (n) => call("parallel", n),
  onState: (fn) => ipcRenderer.on("state", (_e, s) => fn(s)),
});

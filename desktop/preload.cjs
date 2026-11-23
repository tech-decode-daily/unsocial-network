const { contextBridge, ipcRenderer, webUtils } = require("electron");
const call = (op, arg) => ipcRenderer.invoke("command", op, arg);
contextBridge.exposeInMainWorld("network", {
  state: () => call("state"),
  create: (d) => call("create", d),
  join: (d) => call("join", d),
  enter: (id) => call("enter", id),
  directory: () => call("directory"),
  invite: () => call("invite"),
  chat: (text, key) => call("chat", { text, key }),
  leave: () => call("leave"),
  forget: (id) => call("forget", id),
  send: () => call("send"),
  drop: (files) =>
    call(
      "drop",
      Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean),
    ),
  receive: (id) => call("receive", id),
  transfer: (id, action) => call("transfer", { id, action }),
  show: (id) => call("show", id),
  folder: () => call("folder"),
  parallel: (n) => call("parallel", n),
  onState: (fn) => ipcRenderer.on("state", (_e, s) => fn(s)),
});

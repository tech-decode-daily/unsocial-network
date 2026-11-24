"use strict";
const { BrowserWindow, protocol, session } = require("electron");
const { randomUUID } = require("node:crypto");
const https = require("node:https");
const { Readable } = require("node:stream");

const scheme = "unsocial-site";
const origin = scheme + "://room/";
protocol.registerSchemesAsPrivileged([
  {
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const policy =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'";

function asset(room, request) {
  if (
    !request.url.startsWith(origin) ||
    !["GET", "HEAD"].includes(request.method)
  )
    return new Response(null, { status: 403 });
  const parts = new URL(request.url).pathname
    .slice(1)
    .split("/")
    .map(decodeURIComponent);
  if (parts.some((part) => part.startsWith(".") || /[\\/:\x00]/.test(part)))
    return new Response(null, { status: 404 });
  const route =
    "/rooms/" + room.Room + "/site/" + parts.map(encodeURIComponent).join("/");
  const headers = { Authorization: "Bearer " + room.Token };
  if (request.headers.has("range"))
    headers.Range = request.headers.get("range");
  return new Promise((resolve, reject) => {
    const req = https.request(
      room.origin + route,
      {
        method: request.method,
        agent: room.conn.agent,
        headers,
        signal: request.signal,
      },
      (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume();
          const status =
            res.statusCode === 403 ? 403 : res.statusCode === 404 ? 404 : 502;
          resolve(
            new Response(
              request.method === "HEAD" ? null : "Website asset unavailable.",
              { status },
            ),
          );
          return;
        }
        const out = {
          "Content-Security-Policy": policy,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        };
        for (const name of [
          "content-type",
          "content-length",
          "accept-ranges",
          "content-range",
        ]) {
          if (res.headers[name]) out[name] = res.headers[name];
        }
        if (request.method === "HEAD") res.resume();
        resolve(
          new Response(request.method === "HEAD" ? null : Readable.toWeb(res), {
            status: res.statusCode,
            headers: out,
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(Error("Website host unavailable")));
    req.end();
  });
}
function openSite(room, parent) {
  const ses = session.fromPartition("site-" + randomUUID(), { cache: false });
  ses.protocol.handle(scheme, async (req) => {
    try {
      return await asset(room, req);
    } catch {
      return new Response("Website unavailable.", { status: 502 });
    }
  });
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ses.on("will-download", (e) => e.preventDefault());
  ses.webRequest.onBeforeRequest((details, cb) =>
    cb({
      cancel:
        !details.url.startsWith(origin) && !details.url.startsWith("data:"),
    }),
  );
  const viewer = new BrowserWindow({
    parent,
    width: 950,
    height: 700,
    title: room.Name + " · Room website",
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      navigateOnDragDrop: false,
    },
  });
  viewer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  viewer.webContents.on("will-frame-navigate", (e) => {
    if (!e.url.startsWith(origin)) e.preventDefault();
  });
  viewer.on("page-title-updated", (e) => e.preventDefault());
  viewer.on("closed", () => ses.protocol.unhandle(scheme));
  viewer.loadURL(origin).catch(() => {});
  return viewer;
}
module.exports = { openSite };

"use strict";
const $ = (id) => document.getElementById(id),
  api = window.network;
let state,
  page = "rooms",
  modalType = "",
  toastTimer,
  draftKey = "",
  lastDraft = "",
  lastRoom = "",
  lastChat = "";
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(label, fn) {
  const b = el("button", label, "light");
  b.type = "button";
  b.onclick = () => run(fn);
  return b;
}
function notify(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5500);
}
function cleanError(e) {
  return String(e?.message || e).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    "",
  );
}
async function run(fn) {
  try {
    await fn();
  } catch (e) {
    notify(cleanError(e));
  }
}
function empty(title, desc, icon = "▱") {
  const box = el("div", undefined, "empty"),
    info = el("div");
  box.append(el("span", icon, "glyph"), info);
  info.append(el("b", title), el("p", desc));
  return box;
}
function row(name, meta, ...controls) {
  const wrap = el("div", undefined, "row"),
    group = el("div");
  group.append(el("strong", name), el("span", meta, "meta"));
  wrap.append(group, ...controls);
  return wrap;
}
function size(n) {
  let v = n,
    i = 0;
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + " " + units[i];
}
function time(ms) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function clock() {
  $("clock").textContent = new Date().toLocaleTimeString([], { hour12: false });
}
clock();
setInterval(clock, 1000);
function nav(p) {
  page = p;
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== p;
  for (const b of document.querySelectorAll("[data-nav]")) {
    b.classList.toggle("on", b.dataset.nav === p);
    b.setAttribute("aria-current", b.dataset.nav === p ? "page" : "false");
  }
  $("crumb").textContent = {
    rooms: "Rooms",
    transfers: "Transfers",
    activity: "Activity",
    settings: "Settings",
  }[p];
}
document
  .querySelectorAll("[data-nav]")
  .forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
function jobList(jobs) {
  if (!jobs.length)
    return [
      empty(
        "No transfers yet",
        "Files you send or receive will appear here.",
        "⇅",
      ),
    ];
  return [...jobs].reverse().map((j) => {
    const wrap = row(
      j.name,
      (j.kind === "upload" ? "↑ Send" : "↓ Receive") +
        " · " +
        j.status +
        " · " +
        size(j.progress) +
        " / " +
        size(j.size),
    );
    const main = wrap.firstChild;
    main.className = "job-main";
    if (!["complete", "cancelled"].includes(j.status)) {
      const p = el("progress", undefined, "progress");
      p.max = j.size || 1;
      p.value = j.progress;
      p.setAttribute("aria-label", j.name + " progress");
      main.append(p);
      wrap.append(button("Cancel", () => api.transfer(j.id, "cancel")));
    }
    if (j.error) main.append(el("span", j.error, "error"));
    if (["failed", "paused"].includes(j.status))
      wrap.append(button("Resume", () => api.transfer(j.id, "retry")));
    if (j.kind === "download" && j.status === "complete")
      wrap.append(button("Show in folder", () => api.show(j.id)));
    return wrap;
  });
}
function render(s) {
  state = s;
  const r = s.room;
  $("directory").hidden = !!r;
  $("room").hidden = !r;
  $("version").textContent = "Version " + s.version;
  $("footer-state").textContent = r
    ? s.connection
    : s.ips.length
      ? "Local network available"
      : "Loopback only";
  $("room-count").textContent =
    s.rooms.length + (s.rooms.length === 1 ? " ROOM" : " ROOMS");
  $("recents").replaceChildren(
    ...(s.rooms.length
      ? s.rooms.map((x) => {
          const expired = x.expires * 1000 <= Date.now();
          return row(
            x.name,
            (x.hosted ? "Hosted here" : "Remote room") +
              " · " +
              (expired
                ? "Expired"
                : "Expires " + new Date(x.expires * 1000).toLocaleString()),
            expired
              ? button("Remove", () => api.forget(x.id))
              : button("Open room", () => api.enter(x.id)),
          );
        })
      : [
          empty(
            "No rooms yet",
            "Create a room or join one with an invitation.",
          ),
        ]),
  );
  $("job-count").textContent =
    s.jobs.filter(
      (j) => !["complete", "cancelled", "failed", "paused"].includes(j.status),
    ).length || "";
  $("all-jobs").replaceChildren(...jobList(s.jobs));
  $("events").replaceChildren(
    ...[...s.activity].reverse().map((a) => {
      const p = el("div");
      p.append(el("time", time(a.time)), el("span", a.message));
      return p;
    }),
  );
  $("folder-name").textContent = s.folder;
  if (document.activeElement !== $("parallel"))
    $("parallel").value = s.parallel;
  $("interfaces").textContent = s.ips.join(" · ") || "Loopback only";
  $("store-status").textContent = s.secure
    ? "OS-encrypted session file"
    : "Memory only";
  if (!r) {
    lastRoom = "";
    lastChat = "";
    return;
  }
  if (lastRoom !== r.Room) {
    $("chat-text").value = "";
    draftKey = "";
    lastRoom = r.Room;
  }
  $("room-name").textContent = r.Name;
  $("room-id").textContent = "ID " + r.Room;
  $("status").textContent = s.connection;
  const msgs = r.Events.filter((e) => e.Kind === "chat"),
    signature = r.Room + ":" + (msgs.at(-1)?.Seq || 0);
  if (signature !== lastChat) {
    lastChat = signature;
    const box = $("messages"),
      near = box.scrollHeight - box.scrollTop - box.clientHeight < 65;
    box.replaceChildren(
      ...(msgs.length
        ? msgs.map((m) => {
            const item = el("div", undefined, "message");
            item.append(
              el("b", m.Sender),
              el("time", time(m.Time)),
              el("p", m.Text),
            );
            return item;
          })
        : [el("p", "No messages yet.", "quiet")]),
    );
    if (near) box.scrollTop = box.scrollHeight;
  }
  $("members").replaceChildren(
    ...r.Members.map((m) => {
      const div = el("div", undefined, "row");
      const p = el("span", undefined, "person");
      p.append(
        el("i", undefined, "led " + (m.Online ? "online" : "")),
        el("b", m.Name),
      );
      div.append(
        p,
        el(
          "small",
          m.ID === s.member ? "You" : m.Online ? "Online" : "Offline",
          "meta",
        ),
      );
      return div;
    }),
  );
  $("files").replaceChildren(
    ...[...r.Files].reverse().map((f) =>
      row(
        f.Name,
        size(f.Size) + " · " + f.Sender + " · " + time(f.Time),
        button("Download", () => api.receive(f.ID)),
      ),
    ),
  );
  $("room-jobs").replaceChildren(
    ...jobList(s.jobs.filter((j) => j.room === r.Room)),
  );
}
api.onState(render);
api
  .state()
  .then(render)
  .catch((e) => notify(cleanError(e)));
nav("rooms");
function field(name, label, type = "text", value = "") {
  const l = el("label", label),
    i = el(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") i.type = type;
  else i.rows = 4;
  i.name = name;
  i.value = value;
  i.autocomplete = "off";
  l.append(i);
  return l;
}
function openModal(type) {
  modalType = type;
  $("form-error").textContent = "";
  const f = $("fields");
  f.replaceChildren();
  const titles = {
    create: "Create room",
    join: "Join room",
    leave: "Leave room",
  };
  $("modal-title").textContent = titles[type].toUpperCase();
  $("submit").textContent = titles[type];
  if (type === "create") {
    f.append(
      field("name", "Room name"),
      field("display", "Your display name", "text", state.display),
      el(
        "p",
        "This desktop hosts the room on your network. Keep it open while sharing.",
      ),
    );
    const det = el("details");
    det.append(
      el("summary", "Use a standalone server"),
      field("origin", "HTTPS server address", "url"),
      field("admin", "Server creation key", "password"),
    );
    if (state.ips.length > 1) {
      const label = el("label", "Host network address"),
        select = el("select");
      select.name = "lan";
      const auto = el("option", "Automatic");
      auto.value = "";
      select.append(auto);
      for (const address of state.ips) {
        const opt = el("option", address);
        opt.value = address;
        select.append(opt);
      }
      label.append(select);
      f.append(label);
    }
    f.append(det);
  } else if (type === "join") {
    f.append(
      field("invite", "Room invitation", "textarea"),
      field("display", "Your display name", "text", state.display),
      el(
        "p",
        "Join only through an invitation you trust. A LAN invitation also identifies the host certificate.",
      ),
    );
  } else
    f.append(
      el(
        "p",
        "Leaving revokes this membership and cancels its unfinished transfers. Use Room directory to return later with your membership.",
      ),
    );
  f.querySelectorAll('[name="name"],[name="display"],[name="invite"]').forEach(
    (i) => (i.required = true),
  );
  $("modal").showModal();
}
document
  .querySelectorAll("[data-open]")
  .forEach((b) => (b.onclick = () => openModal(b.dataset.open)));
$("close").onclick = $("dismiss").onclick = () => $("modal").close();
$("modal-form").onsubmit = async (e) => {
  e.preventDefault();
  const b = $("submit");
  b.disabled = true;
  const d = Object.fromEntries(new FormData(e.target));
  try {
    await api[modalType](d);
    $("modal").close();
    render(await api.state());
  } catch (err) {
    $("form-error").textContent = cleanError(err);
  } finally {
    b.disabled = false;
  }
};
$("back").onclick = () => run(() => api.directory());
$("leave").onclick = () => openModal("leave");
$("copy").onclick = () =>
  run(async () => {
    await api.invite();
    notify("Invitation copied. Share it privately.");
  });
$("pick").onclick = () => run(() => api.send());
$("folder").onclick = () => run(() => api.folder());
$("parallel").onchange = () =>
  run(() => api.parallel(Number($("parallel").value)));
$("chat-form").onsubmit = async (e) => {
  e.preventDefault();
  const input = $("chat-text"),
    text = input.value.trim();
  if (!text) return;
  if (lastDraft !== text || !draftKey) {
    draftKey = crypto.randomUUID().replaceAll("-", "");
    lastDraft = text;
  }
  const b = e.target.querySelector("button");
  b.disabled = true;
  try {
    await api.chat(text, draftKey);
    if (input.value.trim() === text) input.value = "";
    draftKey = "";
  } catch (err) {
    notify(cleanError(err));
  } finally {
    b.disabled = false;
    input.focus();
  }
};
for (const name of ["dragover", "drop"])
  document.addEventListener(name, (e) => e.preventDefault());
const drop = $("drop");
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add("over");
};
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  run(() => api.drop(Array.from(e.dataTransfer.files)));
};
function drawGlobe() {
  const c = $("globe"),
    w = c.clientWidth,
    h = c.clientHeight;
  if (!w || !h) return;
  const d = devicePixelRatio;
  c.width = w * d;
  c.height = h * d;
  const g = c.getContext("2d");
  g.scale(d, d);
  g.fillStyle = "#101610";
  g.fillRect(0, 0, w, h);
  g.lineWidth = 0.5;
  g.strokeStyle = "#253426";
  for (let x = 0; x < w; x += 22) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y < h; y += 22) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  const cx = w * 0.77,
    cy = h * 0.5,
    rad = Math.min(h * 0.365, w * 0.156),
    tau = Math.PI * 2;
  function proj(lat, lon) {
    const x = Math.cos(lat) * Math.cos(lon),
      y = Math.sin(lat),
      z = Math.cos(lat) * Math.sin(lon);
    const yy = y * 0.96 - z * 0.28,
      zz = y * 0.28 + z * 0.96;
    return [
      cx + rad * (x * 0.92 - yy * 0.39),
      cy + rad * (x * 0.39 + yy * 0.92),
      zz,
    ];
  }
  function curve(points, color) {
    g.strokeStyle = color;
    g.beginPath();
    let pen = false;
    for (const [x, y, z] of points) {
      if (z < 0) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(x, y);
      else g.moveTo(x, y);
      pen = true;
    }
    g.stroke();
  }
  g.lineWidth = 1;
  for (let k = -8; k <= 8; k++) {
    const pts = [];
    for (let t = 0; t <= 128; t++)
      pts.push(proj((k * Math.PI) / 18, (t * tau) / 128));
    curve(pts, "#9fed50");
  }
  for (let k = 0; k < 36; k++) {
    const pts = [];
    for (let t = 0; t <= 64; t++)
      pts.push(proj(-Math.PI / 2 + (Math.PI * t) / 64, (k * tau) / 36));
    curve(pts, "#a0ef4c");
  }
  g.strokeStyle = "#c1ff68";
  g.beginPath();
  g.arc(cx, cy, rad, 0, tau);
  g.stroke();
  g.strokeStyle = "#9dafa0";
  g.setLineDash([3, 6]);
  g.beginPath();
  g.ellipse(cx, cy, rad * 1.53, rad * 0.42, -0.43, 0, tau);
  g.stroke();
  g.setLineDash([]);
  for (const [x, y] of [
    [-0.96, -0.7],
    [1.22, 0.58],
    [-1.36, 0.64],
  ]) {
    g.fillStyle = "#ff6bc9";
    g.fillRect(cx + rad * x - 3, cy + rad * y - 3, 6, 6);
  }
}
new ResizeObserver(drawGlobe).observe($("globe"));

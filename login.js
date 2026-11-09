const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const button = document.getElementById("loginBtn");

let busy = false;
let currentUser = null;

function show(text, ok = false) {
  message.textContent = text;
  message.className = ok ? "success" : "";
}

/* =====================================================
   ACCOUNTS: read live from your Google Sheet, every time someone logs in
   column A = name, B = username, C = password
   Works from a local file and from GitHub Pages.
   ===================================================== */
const SHEET_ID = "1JcPBGGQcAQnEkOk2RVHYHjOl6rvFUYopazLrCGYMR5A";

// false = if the sheet can't be read, login fails with a message (recommended)
// true  = if the sheet can't be read, use the ACCOUNTS list below instead
const ALLOW_OFFLINE_FALLBACK = false;
const ACCOUNTS = [
  { name: "Admin", username: "Admin", password: "1234" },
];

/* =====================================================
   ICONS: paste your Apps Script web-app URL here (see mantra-backend.gs)
   ===================================================== */
const ICON_API = "https://script.google.com/macros/s/AKfycbw6UEjNxJF_GV1MGfmw30e_7nY-r2yJpLsn4fvwd__FitfOo7w-BgVz-m7jB6s3uWkTpg/exec";

function rowsToAccounts(rows) {
  return rows
    .map((r) => ({
      name: (r[0] || "").trim(),
      username: (r[1] || "").trim(),
      password: (r[2] || "").trim(),
      role: (r[3] || "").trim(),              // column D: Admin / HR / Employee
      icon: (r[4] || "").trim(),              // column E: the icon they picked (Drive file id), empty = default
    }))
    // skip empty rows, the "Accounts" title row and the Name/Username/Password header row
    .filter((a) => a.username && a.username.toLowerCase() !== "username");
}

// 1) JSON method (works everywhere, but Google drops cells that don't match the column's main type)
function fetchJsonAccounts() {
  return new Promise((resolve) => {
    const callbackName = "sheetCallback" + Date.now();
    const script = document.createElement("script");
    let timer;

    const finish = (result) => {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
      resolve(result);
    };

    timer = setTimeout(() => {
      console.warn("Account sheet: no answer after 6 seconds. Is the sheet shared as 'Anyone with the link can view'?");
      finish(null);
    }, 6000);

    window[callbackName] = (data) => {
      try {
        if (!data || data.status !== "ok") {
          throw new Error("Google answered: " + JSON.stringify(data && data.errors));
        }
        const rows = data.table.rows.map((r) =>
          (r.c || []).map((cell) => {
            if (!cell) return "";
            // prefer the text exactly as shown in the sheet, then the raw value
            if (cell.f !== null && cell.f !== undefined) return String(cell.f);
            return cell.v !== null && cell.v !== undefined ? String(cell.v) : "";
          })
        );
        finish(rowsToAccounts(rows));
      } catch (err) {
        console.warn("Account sheet could not be read:", err.message);
        finish(null);
      }
    };

    script.onerror = () => {
      console.warn("Account sheet could not be loaded (network problem).");
      finish(null);
    };

    // loaded as a script, so the browser does not block it
    script.src =
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
      `?tqx=out:json;responseHandler:${callbackName}&headers=0&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

// 2) CSV method: every cell comes back as text, so numbers and letters can be mixed freely
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function fetchCsvAccounts() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=0&_=${Date.now()}`,
      { signal: ctrl.signal, cache: "no-store" }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return rowsToAccounts(parseCsv(await res.text()));
  } catch (err) {
    console.warn("Account sheet (CSV) could not be read:", err.message);
    return null;
  }
}

// returns the list of accounts (from both methods combined), or null if the sheet could not be read at all
async function fetchAccounts() {
  const [a, b] = await Promise.all([fetchJsonAccounts(), fetchCsvAccounts()]);
  if (!a && !b) return null;
  return [...(a || []), ...(b || [])];
}

/* ---------- Login ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;

  const username = form.username.value.trim();
  const password = form.password.value;

  if (!username || !password) {
    show("Please enter your username and password.");
    return;
  }

  button.disabled = true;
  show("");

  let accounts = await fetchAccounts();     // fresh copy of the sheet on every login
  if (!accounts) {
    if (ALLOW_OFFLINE_FALLBACK) {
      accounts = ACCOUNTS;
    } else {
      show("Couldn't read the account sheet. Check your internet and that the sheet is shared as “Anyone with the link can view”.");
      button.disabled = false;
      return;
    }
  }

  // username is not case-sensitive, password is
  const account = accounts.find(
    (a) => a.username.toLowerCase() === username.toLowerCase() && a.password === password
  );

  // readable-sheet diagnostics (open the browser console to see them)
  console.table(accounts.map((a) => ({ username: a.username, "password read": a.password ? "yes (" + a.password.length + " chars)" : "NO - empty" })));

  if (account) {
    busy = true;
    currentUser = {
      username: account.username,
      password: account.password,
      icon: account.icon || "",
      role: normalizeRole(account.role),
      name: account.name || account.username,
    };
    setUser(account.name || account.username);
    applyIcon(currentUser.icon);
    setupRole();
    show("Login successful!", true);
    setTimeout(playTransition, 300);
  } else {
    show("Incorrect username or password.");
    button.disabled = false;
  }
});

/* ---------- Put the user's name on the dashboard ---------- */
function setUser(fullName) {
  // use only the first word: "Maria Santos" -> "Maria"
  const name = String(fullName).trim().split(/\s+/)[0];

  document.querySelectorAll(".user-name").forEach((el) => (el.textContent = name));
  document.getElementById("avatar").textContent = name.charAt(0).toUpperCase();

  // first notification, so you can see the bell working (delete these lines if you don't want it)
  addNotification({
    title: "Welcome to Mantra",
    text: `Hi ${name}, glad to have you here. Your notifications will show up here.`,
  });
}

/* =====================================================
   NOTIFICATIONS (bell)
   Use it anywhere later:  addNotification({ title: "Title", text: "Message" })
   ===================================================== */
const notifications = [];
const bellBtn = document.getElementById("bellBtn");
const notifList = document.getElementById("notifList");
const notifEmpty = document.getElementById("notifEmpty");
const notifClear = document.getElementById("notifClear");

// kind + thread are optional: they give the notification a "View" button (messages, replies, alerts about an employee)
function addNotification({ title, text, key, kind, thread }) {
  if (key && notifications.some((n) => n.key === key)) return;          // never show the same one twice
  notifications.unshift({ title, text, key, kind, thread, time: new Date(), read: false });
  renderNotifications();
}
window.addNotification = addNotification;

function renderNotifications() {
  notifList.textContent = "";
  notifications.forEach((n) => {
    const li = document.createElement("li");

    const row = document.createElement("div");
    row.className = "n-row";
    const t = document.createElement("span");
    t.className = "n-title";
    t.textContent = n.title;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "n-x";
    x.setAttribute("aria-label", "Remove this notification");
    x.title = "Remove";
    x.textContent = "\u00d7";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = notifications.indexOf(n);
      if (i > -1) notifications.splice(i, 1);
      renderNotifications();
    });
    row.append(t, x);

    const p = document.createElement("span");
    p.className = "n-text";
    p.textContent = n.text;

    const foot = document.createElement("div");
    foot.className = "n-foot";
    const time = document.createElement("span");
    time.className = "n-time";
    time.textContent = n.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    foot.appendChild(time);
    if (n.kind && n.thread) {
      const v = document.createElement("button");
      v.type = "button";
      v.className = "n-view";
      v.textContent = n.kind === "message" ? "View message" : n.kind === "resources" ? "Explore resources" : "View";
      v.addEventListener("click", (e) => { e.stopPropagation(); closeDropdowns(); openNotification(n); });
      foot.appendChild(v);
    }

    li.append(row, p, foot);
    notifList.appendChild(li);
  });
  notifEmpty.classList.toggle("hidden", notifications.length > 0);
  notifClear.hidden = notifications.length === 0;
  bellBtn.classList.toggle("unread", notifications.some((n) => !n.read));
}

notifClear.addEventListener("click", (e) => {
  e.stopPropagation();
  notifications.length = 0;
  renderNotifications();
});
// clicking inside the list (X, Clear all) should not close the bell panel
document.querySelector(".notif").addEventListener("click", (e) => e.stopPropagation());

function markAllRead() {
  notifications.forEach((n) => (n.read = true));
  bellBtn.classList.remove("unread");
}

/* =====================================================
   DROPDOWNS (bell + profile)
   ===================================================== */
const dropdowns = document.querySelectorAll(".dd");

function closeDropdowns(except) {
  dropdowns.forEach((d) => {
    if (d === except) return;
    d.classList.remove("open");
    const b = d.querySelector(":scope > button");
    if (b) b.setAttribute("aria-expanded", "false");
  });
}

dropdowns.forEach((dd) => {
  const btn = dd.querySelector(":scope > button");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !dd.classList.contains("open");
    closeDropdowns(dd);
    dd.classList.toggle("open", opening);
    btn.setAttribute("aria-expanded", String(opening));
    if (opening && dd.classList.contains("bell-wrap")) markAllRead();
  });
  dd.querySelector(".dropdown").addEventListener("click", (e) => e.stopPropagation());
});
document.addEventListener("click", () => closeDropdowns());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDropdowns(); });

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.location.href = window.location.pathname;   // back to the login screen
});

/* =====================================================
   LOGO TRANSITION
   ===================================================== */

/* ---------- Where each piece sits in the lotus ----------
   Order = logo-1 … logo-6 (diamond, M, right green, left green, left gold, right gold)
   A   = size of the piece in the lotus relative to the login layout
   rot = rotation in degrees
   ci  = piece center in the login layout, cj = piece center in the lotus (fractions 0–1) */
const PIECES = [
  { A: 0.8552, rot: 0,   ci: [0.4995, 0.4814], cj: [0.4995, 0.3338] },
  { A: 0.8561, rot: 0,   ci: [0.5003, 0.7524], cj: [0.4995, 0.5662] },
  { A: 0.8560, rot: 45,  ci: [0.8264, 0.3210], cj: [0.8306, 0.6454] },
  { A: 0.8560, rot: -45, ci: [0.1727, 0.3210], cj: [0.1685, 0.6454] },
  { A: 0.8561, rot: -30, ci: [0.3378, 0.3490], cj: [0.2621, 0.4901] },
  { A: 0.8561, rot: 30,  ci: [0.6613, 0.3490], cj: [0.7370, 0.4901] },
];

/* ---------- Timing (ms) ---------- */
const FADE_CARD_MS    = 1000;  // 1. login card slowly fades out
const REARRANGE_START = 600;   // 2. pieces start moving into the lotus this long after the fade begins
const REARRANGE_MS    = 1400;  //    time for each piece to slide into place
const REARRANGE_GAP   = 60;    //    delay between one piece and the next
const LOTUS_SIZE      = 0.9;   //    size of the lotus in the middle (1 = same box as the login logo)
// 3. when the lotus is formed, it flies to the nav

// transform that puts one piece into its lotus spot, for a lotus box {left, top, width}
function pieceTransform(p, start, box) {
  const th = (p.rot * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const rx = cos * p.ci[0] - sin * p.ci[1];
  const ry = sin * p.ci[0] + cos * p.ci[1];
  return {
    tx: box.left - start.left + box.width * (p.cj[0] - p.A * rx),
    ty: box.top  - start.top  + box.width * (p.cj[1] - p.A * ry),
    rot: p.rot,
    m: (box.width * p.A) / start.width,
  };
}
const tf = (t) => `translate(${t.tx}px, ${t.ty}px) rotate(${t.rot}deg) scale(${t.m})`;
const IDENTITY = { tx: 0, ty: 0, rot: 0, m: 1 };

function playTransition() {
  const card = document.querySelector(".login-card");
  const logo = document.querySelector(".logo");
  const navLogo = document.querySelector(".nav-logo");

  // 1. fade the login card slowly to show the logo behind it
  card.style.transition = `opacity ${FADE_CARD_MS}ms ease, transform ${FADE_CARD_MS}ms ease`;
  card.style.opacity = "0";
  card.style.transform = "scale(0.96)";
  card.style.pointerEvents = "none";

  const start = logo.getBoundingClientRect();     // big logo on screen now
  const end   = navLogo.getBoundingClientRect();  // box of the small lotus logo

  setTimeout(() => rearrange(logo, start, end), REARRANGE_START);
}

/* ---------- 2. pieces slowly move into the lotus shape ---------- */
function rearrange(logo, start, end) {
  const layers = [...logo.querySelectorAll("svg")];

  const flyers = layers.map((img) => {
    const f = img.cloneNode(true);
    Object.assign(f.style, {
      position: "fixed",
      left: start.left + "px",
      top: start.top + "px",
      width: start.width + "px",
      height: start.height + "px",
      transformOrigin: "0 0",
      opacity: 0.5,
      zIndex: 10,
      pointerEvents: "none",
    });
    document.body.appendChild(f);
    return f;
  });
  logo.style.visibility = "hidden";

  const W = start.width * LOTUS_SIZE;
  const centerBox = {
    left: start.left + (start.width - W) / 2,
    top: start.top + (start.height - W) / 2,
    width: W,
  };
  const inPlace = PIECES.map((p) => pieceTransform(p, start, centerBox));

  const slide = flyers.map((f, i) =>
    f.animate(
      [
        { transform: tf(IDENTITY), offset: 0 },
        { transform: tf(inPlace[i]), offset: 1 },
      ],
      { duration: REARRANGE_MS, delay: i * REARRANGE_GAP, easing: "ease-in-out", fill: "both" }
    )
  );

  Promise.all(slide.map((a) => a.finished)).then(() => fly(flyers, start, end, inPlace));
}

/* ---------- 3. the lotus flies into the nav logo ---------- */
function fly(flyers, start, end, inPlace) {
  const dash    = document.getElementById("dashboard");
  const navLogo = document.querySelector(".nav-logo");

  // dashboard appears behind the flying pieces
  setTimeout(() => {
    dash.classList.add("show");
    dash.setAttribute("aria-hidden", "false");
  }, 250);

  //                 logo-1 logo-2 logo-3 logo-4 logo-5 logo-6
  const arcs      = [ -120,    90,  -200,  -190,  -100,   100 ];
  const delays    = [    0,   120,   800,     0,   100,   300 ];
  const durations = [ 1900,  1900,  1700,  1100,  1100,  1800 ];

  const flights = flyers.map((f, i) => {
    const a = inPlace[i];
    const b = pieceTransform(PIECES[i], start, end);
    const mid = {
      tx: (a.tx + b.tx) / 2 + arcs[i],
      ty: (a.ty + b.ty) / 2 - Math.abs(arcs[i]) * 0.6,
      rot: PIECES[i].rot,
      m: (a.m + b.m) / 2,
    };

    return f.animate(
      [
        { transform: tf(a),   opacity: 0.5,  offset: 0 },
        { transform: tf(mid), opacity: 0.75, offset: 0.5 },
        { transform: tf(b),   opacity: 1,    offset: 1 },
      ],
      { duration: durations[i], delay: delays[i], easing: "cubic-bezier(.45,.05,.25,1)", fill: "both" }
    );
  });

  // when all six have landed, fade in the real logo image and remove the flyers
  Promise.all(flights.map((a) => a.finished)).then(() => {
    navLogo.classList.add("show");
    setTimeout(() => flyers.forEach((f) => f.remove()), 300);
  });
}

/* =====================================================
   NAVIGATION: Home / Services (Sense, Nurture) / About
   ===================================================== */
const pages = document.querySelectorAll(".page");
const navLinks = document.querySelectorAll(".nav-link");
const parentOf = { sense: "services", nurture: "services", resources: "services", programs: "services", support: "services", counseling: "services", checkin: "services", tracker: "services", occhealth: "services", network: "services" };   // which nav link stays highlighted

function showView(name, fromPop) {
  // employees fill in the Workday Check-In before they get into Mantra Sense
  if (name === "sense" && currentUser && currentUser.role === "employee") {
    if (!checkinDone) name = "checkin";
    else recheckCheckin();                       // data may have been reset since they answered
  }
  if (name === "admin" && !(currentUser && currentUser.role === "admin")) name = "home";
  const target = document.getElementById(name);
  if (!target) return;
  if (name === "occhealth" && typeof ohEnter === "function") ohEnter();
  if (name === "network" && typeof nwEnter === "function") nwEnter();
  if (name === "programs" && typeof pgEnter === "function") pgEnter();
  if (name === "counseling" && typeof apEnter === "function") apEnter();
  if (name === "support" && typeof apSupportEnter === "function") apSupportEnter();
  if (name === "resources" && typeof rsOpen === "function" && $("resources") && !$("resources").classList.contains("active")) rsOpen("all");

  const wasHome = !document.querySelector(".page.active");
  pages.forEach((p) => p.classList.toggle("active", p === target));   // "home" = no page on top
  if (name === "about" && typeof window.aboutEnter === "function") window.aboutEnter();
  const top = parentOf[name] || name;
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.view === top));
  if (target.classList.contains("page")) target.scrollTop = 0;
  else if (!wasHome) {
    // Home comes back with the same fade/slide the other pages use
    const st = document.querySelector(".stage");
    st.classList.remove("home-enter");
    void st.offsetWidth;                       // restart the animation
    st.classList.add("home-enter");
    setTimeout(() => st.classList.remove("home-enter"), 600);
  }
  // every screen is a history step, so the phone's Back button (or the browser's) returns to the previous screen
  if (fromPop || (history.state && history.state.view === name)) history.replaceState({ view: name }, "", "#" + name);
  else history.pushState({ view: name }, "", "#" + name);
  closeDropdowns();
  if (name === "tracker") trEnter();
  if (name === "garden") gdEnter();
}

window.addEventListener("popstate", (e) => {
  const dash = document.getElementById("dashboard");
  if (!currentUser || !dash || !dash.classList.contains("show")) return;     // not logged in: nothing to go back to
  showView((e.state && e.state.view) || "home", true);
});

document.querySelectorAll("[data-view]").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    showView(a.dataset.view);

    // close the Services menu after a click, until the mouse leaves it
    const menu = a.closest(".has-menu");
    if (menu) {
      menu.classList.add("lock");
      menu.addEventListener("mouseleave", () => menu.classList.remove("lock"), { once: true });
      if (document.activeElement) document.activeElement.blur();
    }
  });
});

/* =====================================================
   PROFILE ICON: pick from the PNGs in the Drive folder, saved to the user's row in the sheet
   ===================================================== */
const avatarEl = document.getElementById("avatar");
const iconUrl = (id) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w256`;

function applyIcon(id) {
  const letter = (avatarEl.dataset.letter || avatarEl.textContent || "M").charAt(0);
  avatarEl.dataset.letter = letter;
  avatarEl.textContent = "";
  avatarEl.classList.toggle("has-icon", !!id);
  if (id) {
    const img = new Image();
    img.alt = "";
    img.src = iconUrl(id);
    img.onerror = () => { avatarEl.classList.remove("has-icon"); avatarEl.textContent = letter; };   // broken link -> default
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = letter;
  }
}

const iconModal  = document.getElementById("iconModal");
const iconGrid   = document.getElementById("iconGrid");
const iconNote   = document.getElementById("iconNote");
const iconSave   = document.getElementById("iconSave");
let iconList = null;          // loaded once from the folder
let pickedIcon = "";

function setIconNote(text, bad) {
  iconNote.textContent = text || "";
  iconNote.classList.toggle("bad", !!bad);
}

function renderIconGrid() {
  iconGrid.textContent = "";
  const tiles = [{ id: "", name: "Default" }, ...(iconList || [])];
  tiles.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-tile";
    b.setAttribute("aria-label", t.name);
    b.setAttribute("aria-pressed", String(t.id === pickedIcon));
    b.title = t.name.replace(/\.[^.]+$/, "");
    if (t.id) {
      const img = new Image();
      img.alt = "";
      img.loading = "lazy";
      img.src = iconUrl(t.id);
      b.appendChild(img);
    } else {
      b.classList.add("default");
      b.textContent = avatarEl.dataset.letter || "M";
    }
    b.addEventListener("click", () => {
      pickedIcon = t.id;
      iconGrid.querySelectorAll(".icon-tile").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      setIconNote("");
    });
    iconGrid.appendChild(b);
  });
}

async function openIconPicker() {
  if (!currentUser) return;
  closeDropdowns();
  pickedIcon = currentUser.icon || "";
  iconSave.disabled = true;
  iconModal.hidden = false;
  iconGrid.textContent = "";

  if (!ICON_API) {
    setIconNote("Icons aren't connected yet. Paste your Apps Script URL into ICON_API in login.js.", true);
    return;
  }
  if (!iconList) {
    setIconNote("Loading icons…");
    try {
      const res = await fetch(ICON_API + (ICON_API.includes("?") ? "&" : "?") + "action=icons", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "failed");
      iconList = data.icons;
    } catch (err) {
      console.warn("Icon list could not be loaded:", err);
      setIconNote("Couldn't load the icons. Please try again in a moment.", true);
      return;
    }
  }
  setIconNote(iconList.length ? "" : "No icons were found in the folder.", !iconList.length);
  renderIconGrid();
  iconSave.disabled = false;
}

function closeIconPicker() { iconModal.hidden = true; }

async function saveIcon() {
  if (pickedIcon === (currentUser.icon || "")) { closeIconPicker(); return; }
  iconSave.disabled = true;
  setIconNote("Saving…");
  try {
    await api("icon", { icon: pickedIcon });
    currentUser.icon = pickedIcon;
    applyIcon(pickedIcon);
    closeIconPicker();
    addNotification({ title: "Icon updated", text: "Your new icon has been saved to your account." });
  } catch (err) {
    console.warn("Icon could not be saved:", err);
    setIconNote("Couldn't save your icon. Please try again.", true);
    iconSave.disabled = false;
  }
}

document.getElementById("changeIconBtn").addEventListener("click", openIconPicker);
document.getElementById("iconCancel").addEventListener("click", closeIconPicker);
iconSave.addEventListener("click", saveIcon);
iconModal.addEventListener("click", (e) => { if (e.target === iconModal) closeIconPicker(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !iconModal.hidden) closeIconPicker(); });


/* =====================================================
   ROLES, CHECK-IN, TEAM SIDE BAR, ADMIN
   Account roles come from column D of the accounts sheet: Admin / HR / Employee (blank = Employee)
   ===================================================== */
function normalizeRole(text) {
  const t = String(text || "").trim().toLowerCase();
  if (t.startsWith("admin")) return "admin";
  if (t === "hr") return "hr";
  return "employee";
}
const isStaff = () => currentUser && (currentUser.role === "admin" || currentUser.role === "hr");

// one call to the Apps Script backend (always sends the user's login so the backend can check it)
async function api(action, payload = {}) {
  if (!ICON_API) throw new Error("not-connected");
  const res = await fetch(ICON_API, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },       // plain text avoids a CORS preflight
    body: JSON.stringify({ action, username: currentUser.username, password: currentUser.password, ...payload }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "failed");
  // the newer actions need the newer script; an old deployment would say "ok" without saving anything
  if (action !== "icon" && data.v !== BACKEND_VERSION) throw new Error("outdated");
  return data;
}
const BACKEND_VERSION = 25;

const adminLink = document.getElementById("adminLink");
const teamBtn   = document.getElementById("teamBtn");
let checkinDone = false;           // the check-in is asked once per login
// true  = TESTING: ask at every login (what you have now)
// false = ask only if today's check-in isn't in the sheet yet (Mon/Wed/Fri slot), e.g. after an Admin reset
const ASK_EVERY_LOGIN = true;

function setupRole() {
  adminLink.hidden = currentUser.role !== "admin";
  teamBtn.hidden = !isStaff();
  $("gdAdminTab").hidden = currentUser.role !== "admin";
  $("gdStyle").hidden = currentUser.role !== "admin";
  $("gdFabStyle").hidden = currentUser.role !== "admin";
  document.getElementById("tdClear").hidden = currentUser.role !== "admin";      // only Admin can reset messages
  if (currentUser.role === "employee") {
    api("sync").catch(() => {});                                        // puts their name on their row in the check-in sheet
    if (!ASK_EVERY_LOGIN) checkinStatus().then((done) => { if (done === true) checkinDone = true; });
    setInterval(recheckCheckin, 60000);                                 // notice an Admin reset while they are logged in
  }
  pollNotifications();                                                  // messages for employees, alerts for HR / Admin
  setInterval(() => { if (!document.hidden) pollNotifications(); }, 10000);   // new messages and concerns show up within seconds
  if (currentUser.role === "employee") api("recipients").then((d) => { trHR = d.people || []; }).catch(() => {});     // warm up the tracker
  trLoad();
}

/* ---------- Workday Check-In ---------- */
// Monday/Tuesday -> Monday, Wednesday/Thursday -> Wednesday, Friday/weekend -> Friday
function slotForToday() {
  const d = new Date().getDay();               // 0 = Sunday
  if (d === 1 || d === 2) return "mon";
  if (d === 3 || d === 4) return "wed";
  return "fri";
}

const answers = {};
const ckNote = document.getElementById("ckNote");
const ckSubmit = document.getElementById("ckSubmit");
function setCkNote(text, bad) { ckNote.textContent = text || ""; ckNote.classList.toggle("bad", !!bad); }

document.querySelectorAll("#checkin [data-q]").forEach((group) => {
  const q = group.dataset.q;
  const options = group.querySelectorAll("[data-v]");
  options.forEach((btn) =>
    btn.addEventListener("click", () => {
      answers[q] = Number(btn.dataset.v);
      options.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", String(on));
      });
      setCkNote("");
    })
  );
});

// is today's check-in in the sheet? true / false, or null if the backend can't be reached
async function checkinStatus() {
  try { return (await api("status", { slot: slotForToday() })).done; } catch (e) { return null; }
}

function resetSurvey() {
  Object.keys(answers).forEach((k) => delete answers[k]);
  document.querySelectorAll("#checkin [data-v]").forEach((b) => { b.classList.remove("on"); b.setAttribute("aria-checked", "false"); });
}

// an Admin reset clears the sheet: employees must answer again
async function recheckCheckin() {
  if (!currentUser || currentUser.role !== "employee" || !checkinDone) return;
  if ((await checkinStatus()) === false) {
    checkinDone = false;
    resetSurvey();
    setCkNote("Your check-in data was reset. Please answer the questions again.");
    if (document.getElementById("sense").classList.contains("active")) showView("checkin");
  }
}

ckSubmit.addEventListener("click", async () => {
  if (!currentUser) return;
  if (![1, 2, 3, 4].every((q) => answers[q])) {
    setCkNote("Please answer all 4 questions before submitting.", true);
    return;
  }
  ckSubmit.disabled = true;
  setCkNote("Submitting…");
  try {
    await api("checkin", { slot: slotForToday(), q1: answers[1], q2: answers[2], q3: answers[3], q4: answers[4] });
    checkinDone = true;
    // question 3, first answer: tell the user on the bell (more to come later)
    if (answers[3] === 1) {
      addNotification({ title: "Support resources", text: "Thanks for asking. Browse articles and books on stress, sleep, work-life balance and more.", kind: "resources", thread: "resources" });
    }
    addNotification({ title: "Check-in submitted", text: "Thank you for completing your Workday Check-In." });
    setCkNote("");
    showView("sense");
  } catch (err) {
    console.warn("Check-in could not be saved:", err);
    setCkNote(
      err.message === "not-connected" ? "The check-in isn't connected yet. Paste your Apps Script URL into ICON_API in login.js."
      : err.message === "outdated" ? "The Apps Script is out of date. Open it and redeploy: Deploy > Manage deployments > New version."
      : "Couldn't save your check-in. Please try again.",
      true
    );
  }
  ckSubmit.disabled = false;
});

/* ---------- Team data (Admin + HR) ---------- */
const WL_LABELS = ["", "Very Manageable", "Manageable", "Challenging", "Very Challenging"];
const RC_LABELS = ["", "Well rested", "Mostly rested", "Rarely rested", "Not rested"];
function levelOf(v) {
  const n = Number(v);
  if (!(n > 0)) return 0;
  return n <= 1.5 ? 1 : n <= 2.5 ? 2 : n <= 3.5 ? 3 : 4;
}
function chip(v, labels) {
  const el = document.createElement("span");
  const lv = levelOf(v);
  el.className = "chip" + (lv ? " lv" + lv : "");
  el.textContent = lv ? Number(v).toFixed(1) : "–";
  el.title = lv ? labels[lv] + " (average " + Number(v).toFixed(2) + ")" : "No check-ins yet";
  return el;
}
function avatarFor(p) {
  const av = document.createElement("span");
  av.className = "tp-av";
  const letter = (p.name || "?").trim().charAt(0).toUpperCase();
  av.textContent = letter;
  if (p.icon) {
    const img = new Image();
    img.alt = "";
    img.src = iconUrl(p.icon);
    img.onload = () => { av.textContent = ""; av.appendChild(img); };
  }
  return av;
}
// the avatar, with a red "!" above it when the employee flagged a concern
function avatarWithAlert(p) {
  const wrap = document.createElement("span");
  wrap.className = "tp-avwrap";
  wrap.appendChild(avatarFor(p));
  if (p.fl === "Concern") {
    const bang = document.createElement("span");
    bang.className = "tp-alert";
    bang.title = "Flagged a concern";
    bang.textContent = "!";
    wrap.appendChild(bang);
  }
  return wrap;
}

let team = [];
async function loadTeam() {
  const data = await api("team");
  team = data.people || [];
  renderTeam();
  return team;
}

const teamPanel = document.getElementById("teamPanel");
const tpList = document.getElementById("tpList");
const tpEmpty = document.getElementById("tpEmpty");
const tpSub = document.getElementById("tpSub");
const admRows = document.getElementById("admRows");
const admCount = document.getElementById("admCount");
const admMsg = document.getElementById("admMsg");

function renderTeam() {
  const concerns = team.filter((p) => p.fl === "Concern").length;
  const summary = team.length + (team.length === 1 ? " employee" : " employees") + (concerns ? " · " + concerns + " with a concern" : "");
  tpSub.textContent = summary;
  admCount.textContent = summary;

  // side bar list: click an employee to open their details
  tpList.textContent = "";
  team.forEach((p) => {
    const li = document.createElement("li");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.setAttribute("aria-label", "Open " + p.name);
    const who = document.createElement("div");
    who.className = "tp-who";
    const name = document.createElement("span");
    name.className = "tp-name";
    name.textContent = p.name;
    if (p.awaiting) {
      const t = document.createElement("span");
      t.className = "tag-reply";
      t.textContent = "New reply";
      name.appendChild(t);
    }
    who.append(avatarWithAlert(p), name);
    li.append(who, chip(p.wl, WL_LABELS), chip(p.rc, RC_LABELS));
    li.addEventListener("click", () => openTeamDetail(p.username));
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTeamDetail(p.username); } });
    tpList.appendChild(li);
  });
  tpEmpty.textContent = team.length ? "" : "No employees found.";

  // admin page
  admRows.textContent = "";
  if (!team.length) {
    const e = document.createElement("p");
    e.className = "adm-empty";
    e.textContent = "No employees found.";
    admRows.appendChild(e);
  }
  team.forEach((p) => {
    const row = document.createElement("div");
    row.className = "adm-row";
    const n = document.createElement("span");
    n.textContent = p.name;
    const f = document.createElement("span");
    if (p.fl === "Concern") { f.className = "tag-concern"; f.style.marginLeft = "0"; f.style.justifySelf = "start"; f.textContent = "Concern"; }
    else f.textContent = p.fl === "Idle" ? "Active" : (p.fl || "–");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adm-reset chk";
    btn.textContent = "Reset";
    btn.title = "Reset " + p.name + "'s check-ins";
    armConfirm(btn, "Reset", "Sure?", () => resetData(p.username, p.name, btn));
    const mbtn = document.createElement("button");
    mbtn.type = "button";
    mbtn.className = "adm-reset msg";
    mbtn.textContent = "Reset";
    mbtn.title = "Reset " + p.name + "'s messages";
    armConfirm(mbtn, "Reset", "Sure?", () => resetMessages(p, mbtn));
    row.append(n, chip(p.wl, WL_LABELS), chip(p.rc, RC_LABELS), f, btn, mbtn);
    admRows.appendChild(row);
  });

  if (detailUser) renderDetail();
}

async function refreshTeam() {
  try {
    await loadTeam();
  } catch (err) {
    console.warn("Team could not be loaded:", err);
    const msg = err.message === "not-connected" ? "Not connected yet (set ICON_API in login.js)."
      : err.message === "outdated" ? "Apps Script is out of date. Redeploy it as a New version."
      : "Couldn't load the team. Try again.";
    tpEmpty.textContent = msg;
    admCount.textContent = msg;
  }
}

/* side bar open / close */
function setTeamPanel(open) {
  if (!open) { teamPanel.classList.remove("detail"); detailUser = null; }
  teamPanel.classList.toggle("open", open);
  teamPanel.setAttribute("aria-hidden", String(!open));
  teamBtn.classList.toggle("open", open);
  teamBtn.setAttribute("aria-expanded", String(open));
  if (open) { tpEmpty.textContent = team.length ? "" : "Loading…"; refreshTeam(); }
}
teamBtn.addEventListener("click", (e) => { e.stopPropagation(); closeDropdowns(); setTeamPanel(!teamPanel.classList.contains("open")); });
document.getElementById("tpClose").addEventListener("click", () => setTeamPanel(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setTeamPanel(false); });
setInterval(() => { if (teamPanel.classList.contains("open")) refreshTeam(); }, 60000);

/* ---------- Team check-in: one employee (concern, resolve, messages) ---------- */
let detailUser = null;                       // username of the employee being viewed
const tdAv = document.getElementById("tdAv");
const tdName = document.getElementById("tdName");
const tdSub = document.getElementById("tdSub");
const tdWl = document.getElementById("tdWl");
const tdRc = document.getElementById("tdRc");
const tdConcern = document.getElementById("tdConcern");
const tdThread = document.getElementById("tdThread");
const tdText = document.getElementById("tdText");
const tdSend = document.getElementById("tdSend");
const tdMsg = document.getElementById("tdMsg");
const personOf = (u) => team.find((x) => x.username.toLowerCase() === String(u).toLowerCase());

// chat bubbles; "mine" is the sender type that sits on the right
// a bubble that appears the moment you press send (the real one replaces it when the server answers)
function pendingBubble(box, text) {
  const e = box.querySelector(".thread-empty");
  if (e) e.remove();
  const b = document.createElement("div");
  b.className = "bubble me sending";
  const t = document.createElement("span");
  t.className = "b-text";
  t.textContent = text;
  b.appendChild(t);
  box.appendChild(b);
  box.scrollTop = box.scrollHeight;
  return b;
}
function renderThread(box, msgs, mine) {
  box.textContent = "";
  if (!msgs.length) {
    const e = document.createElement("p");
    e.className = "thread-empty";
    e.textContent = "No messages yet.";
    box.appendChild(e);
    return;
  }
  msgs.forEach((m) => {
    const b = document.createElement("div");
    b.className = "bubble " + (m.sender === mine ? "me" : "them");
    if (m.sender !== mine) {
      const n = document.createElement("span");
      n.className = "b-name";
      n.textContent = m.name;
      b.appendChild(n);
    }
    const t = document.createElement("span");
    t.className = "b-text";
    t.textContent = m.text;
    b.appendChild(t);
    box.appendChild(b);
  });
  box.scrollTop = box.scrollHeight;
}

function renderDetail() {
  const p = personOf(detailUser);
  if (!p) return;
  tdAv.textContent = "";
  tdAv.appendChild(avatarWithAlert(p));
  tdName.textContent = p.name;
  tdSub.textContent = p.fl === "Concern" ? "Flagged a concern" : "Status: " + (p.fl === "Idle" ? "Active" : (p.fl || "no check-in yet"));
  tdWl.textContent = "";
  tdRc.textContent = "";
  const label = (text) => { const s = document.createElement("span"); s.textContent = text; return s; };
  tdWl.append(chip(p.wl, WL_LABELS), label(levelOf(p.wl) ? WL_LABELS[levelOf(p.wl)] : "No check-ins yet"));
  tdRc.append(chip(p.rc, RC_LABELS), label(levelOf(p.rc) ? RC_LABELS[levelOf(p.rc)] : "No check-ins yet"));
  tdConcern.hidden = p.fl !== "Concern";
}

async function loadStaffThread(silent) {
  if (!detailUser) return;
  try {
    const d = await api("thread", { with: detailUser });
    const sig = d.messages.map((m) => m.id).join(",");
    if (detailUser && !(silent && tdThread.dataset.sig === sig)) { renderThread(tdThread, d.messages, "staff"); tdThread.dataset.sig = sig; }
  } catch (err) { console.warn("Messages could not be loaded:", err.message); }
}

function openTeamDetail(username) {
  const p = personOf(username);
  if (!p) return;
  detailUser = p.username;
  tdMsg.textContent = "";
  tdText.value = "";
  tdThread.textContent = "";
  renderDetail();
  teamPanel.classList.add("detail");
  loadStaffThread();
}
// opened from a bell notification
async function viewEmployee(username) {
  if (!teamPanel.classList.contains("open")) setTeamPanel(true);
  if (!personOf(username)) await refreshTeam();
  openTeamDetail(username);
}

document.getElementById("tdBack").addEventListener("click", () => { teamPanel.classList.remove("detail"); detailUser = null; refreshTeam(); });
document.getElementById("tdClose").addEventListener("click", () => setTeamPanel(false));

document.getElementById("tdResolve").addEventListener("click", async () => {
  const p = personOf(detailUser);
  if (!p) return;
  const btn = document.getElementById("tdResolve");
  btn.disabled = true;
  tdMsg.className = "td-msg";
  try {
    await api("resolve", { target: p.username });
    p.fl = "Idle";                              // the red ! disappears
    renderTeam();
    tdMsg.textContent = "Marked as resolved.";
  } catch (err) {
    tdMsg.className = "td-msg bad";
    tdMsg.textContent = "Couldn't mark it as resolved. Please try again.";
  }
  btn.disabled = false;
});

async function sendToEmployee() {
  const text = tdText.value.trim();
  if (!text || !detailUser) return;
  const who = detailUser;
  const bub = pendingBubble(tdThread, text);
  tdText.value = "";
  tdMsg.className = "td-msg";
  try {
    await api("send", { to: who, text });
    tdMsg.textContent = "Sent. " + (personOf(who) || {}).name + " will see it in their notifications.";
    const p = personOf(who);
    if (p) { p.awaiting = false; renderTeam(); }
    loadStaffThread();                           // swaps the grey bubble for the real one
  } catch (err) {
    bub.remove();
    tdText.value = text;
    tdMsg.className = "td-msg bad";
    tdMsg.textContent = "Couldn't send the message. Please try again.";
  }
}
tdSend.addEventListener("click", sendToEmployee);
tdText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendToEmployee(); } });
setInterval(() => { if (detailUser && teamPanel.classList.contains("open")) loadStaffThread(); }, 15000);

// Admin: clear this employee's conversation
armConfirm(document.getElementById("tdClear"), "Clear messages", "Sure?", async () => {
  const p = personOf(detailUser);
  if (!p) return;
  tdMsg.className = "td-msg";
  try {
    await api("clearMsgs", { target: p.username });
    p.awaiting = false;
    renderThread(tdThread, [], "staff");
    renderTeam();
    tdMsg.textContent = "Messages with " + p.name + " were cleared.";
  } catch (err) {
    tdMsg.className = "td-msg bad";
    tdMsg.textContent = "Couldn't clear the messages. Please try again.";
  }
});

/* ---------- Admin page: reset check-in data ---------- */
// a button that needs a second click ("Sure?") within 3 seconds
function armConfirm(btn, label, askLabel, action) {
  let timer;
  btn.addEventListener("click", () => {
    if (btn.classList.contains("confirm")) {
      clearTimeout(timer);
      btn.classList.remove("confirm");
      btn.textContent = label;
      action();
    } else {
      btn.classList.add("confirm");
      btn.textContent = askLabel;
      timer = setTimeout(() => { btn.classList.remove("confirm"); btn.textContent = label; }, 3000);
    }
  });
}

async function resetMessages(p, btn) {
  admMsg.className = "adm-msg";
  admMsg.textContent = "Clearing messages…";
  if (btn) btn.disabled = true;
  try {
    await api("clearMsgs", { target: p.username });
    admMsg.textContent = "Cleared the messages with " + p.name + ".";
    await loadTeam();
  } catch (err) {
    console.warn("Clearing messages failed:", err);
    admMsg.className = "adm-msg bad";
    admMsg.textContent = "Couldn't clear the messages. Please try again.";
    if (btn) btn.disabled = false;
  }
}

async function resetData(target, label, btn) {
  admMsg.className = "adm-msg";
  admMsg.textContent = "Resetting…";
  if (btn) btn.disabled = true;
  try {
    const r = await api("reset", { target });
    admMsg.textContent = target === "ALL" ? "Reset the check-ins of " + r.count + " employees." : "Reset the check-ins of " + label + ".";
    await loadTeam();
  } catch (err) {
    console.warn("Reset failed:", err);
    admMsg.className = "adm-msg bad";
    admMsg.textContent = "Couldn't reset. Please try again.";
    if (btn) btn.disabled = false;
  }
}
armConfirm(document.getElementById("admResetAll"), "Reset all check-ins", "Click again to reset ALL", () => resetData("ALL", "all employees"));
armConfirm(document.getElementById("admClearMsgs"), "Reset all messages", "Click again to reset ALL messages", async () => {
  admMsg.className = "adm-msg";
  admMsg.textContent = "Clearing messages…";
  try {
    const r = await api("clearMsgs", { all: true });
    admMsg.textContent = "Cleared " + r.count + " messages.";
    await loadTeam();
  } catch (err) {
    admMsg.className = "adm-msg bad";
    admMsg.textContent = "Couldn't clear the messages. Please try again.";
  }
});
document.getElementById("admRefresh").addEventListener("click", refreshTeam);
adminLink.addEventListener("click", () => refreshTeam());
document.querySelectorAll("[data-view=admin]").forEach((a) => a.addEventListener("click", () => refreshTeam()));

/* ---------- Notifications from the backend ---------- */
// employees: messages from HR / Admin.   HR / Admin: contact requests, concerns, replies.
function openNotification(n) {
  if (!currentUser || !n.thread) return;
  if (n.kind === "garden") { showView("garden"); return; }
  if (n.kind === "program") { showView("programs"); return; }
  if (n.kind === "resources") { showView("resources"); return; }
  if (n.kind === "appointment") { apKind = String(n.thread).indexOf("a:o:") === 0 ? "other" : "counseling"; showView("counseling"); return; }
  if (n.kind === "concern") { trPendingOpen = String(n.thread).replace(/^c:/, ""); showView("tracker"); return; }
  if (currentUser.role === "employee") openMessages();
  else viewEmployee(n.thread);
}

async function pollNotifications() {
  if (!currentUser || !ICON_API) return;
  const key = "mantraNotifSeen:" + currentUser.username.toLowerCase();
  let since = 0;
  try { since = Number(localStorage.getItem(key)) || 0; } catch (e) {}
  if (!since) since = Date.now() - (isStaff() ? 1 : 7) * 24 * 3600 * 1000;      // first time: only recent ones
  try {
    const data = await api("notifs", { since });
    (data.items || []).forEach((n) => addNotification({ title: n.title, text: n.text, key: "srv" + n.id, kind: n.kind, thread: n.thread }));
    try { localStorage.setItem(key, String(data.latest || since)); } catch (e) {}
    if (currentUser.role === "employee" && (data.items || []).length && !msgModal.hidden) loadEmpThread();
    if ((data.items || []).some((n) => n.kind === "garden")) gdGotItems();
  } catch (err) {
    console.warn("Notifications could not be loaded:", err.message);
  }
}

/* ---------- Employee: read and reply to messages ---------- */
const msgModal = document.getElementById("msgModal");
const mmThread = document.getElementById("mmThread");
const mmText = document.getElementById("mmText");
const mmNote = document.getElementById("mmNote");
const mmSend = document.getElementById("mmSend");
function setMmNote(text, bad) { mmNote.textContent = text || ""; mmNote.classList.toggle("bad", !!bad); }

async function loadEmpThread(silent) {
  try {
    const d = await api("thread");
    const sig = d.messages.map((m) => m.id).join(",");
    if (!(silent && mmThread.dataset.sig === sig)) { renderThread(mmThread, d.messages, "employee"); mmThread.dataset.sig = sig; }
  } catch (err) {
    if (!silent) setMmNote("Couldn't load your messages.", true);
  }
}
async function openMessages() {
  mmText.value = "";
  setMmNote("");
  mmThread.textContent = "";
  msgModal.hidden = false;
  await loadEmpThread();
  mmText.focus();
}
function closeMessages() { msgModal.hidden = true; }

async function sendReply() {
  const text = mmText.value.trim();
  if (!text) return;
  const bub = pendingBubble(mmThread, text);
  mmText.value = "";
  setMmNote("");
  try {
    await api("reply", { text });
    setMmNote("Sent. HR / Admin can see your reply.");
    loadEmpThread();
  } catch (err) {
    bub.remove();
    mmText.value = text;
    setMmNote("Couldn't send your reply. Please try again.", true);
  }
}
mmSend.addEventListener("click", sendReply);
document.getElementById("mmClose").addEventListener("click", closeMessages);
msgModal.addEventListener("click", (e) => { if (e.target === msgModal) closeMessages(); });
mmText.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !msgModal.hidden) closeMessages(); });


/* =====================================================
   WORK INTERVENTION TRACKER
   Employee: write a concern to HR (one open concern at a time) + their history.
   HR: concerns addressed to them; opening an Active one makes it Ongoing; close -> Closed.
   Admin: sees everything without changing statuses; can close and reset.
   ===================================================== */
const $ = (id) => document.getElementById(id);
let trPendingOpen = null;          // a concern to open as soon as the page is ready (from a notification)
let trItems = [];
let trTab = "";
let trHR = null;                   // HR people an employee can address
let trCur = null;                  // concern shown in the detail view
let trCurId = null;
let trLoaded = false;
let trStamp = "";
const trSel = { to: [], cc: [], bcc: [] };

function trNote(text, bad) { const m = $("trMsg"); m.textContent = text || ""; m.classList.toggle("bad", !!bad); }
const trWhen = (ts) => { const d = new Date(ts); return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + ", " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const trOpenOnes = () => trItems.filter((c) => c.status !== "Closed");
const trIsEmp = () => currentUser && currentUser.role === "employee";

// keeps only simple formatting from the editor (no scripts, no odd attributes)
const TR_SKIP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEXTAREA", "SVG", "NOSCRIPT"]);
const TR_OK = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BR", "DIV", "P", "H3", "A", "SPAN"]);
function cleanHtml(html) {
  const doc = new DOMParser().parseFromString("<body>" + String(html || "") + "</body>", "text/html");
  const out = document.createDocumentFragment();
  (function walk(node, into) {
    node.childNodes.forEach((ch) => {
      if (ch.nodeType === 3) { into.appendChild(document.createTextNode(ch.nodeValue)); return; }
      if (ch.nodeType !== 1 || TR_SKIP.has(ch.tagName)) return;
      if (!TR_OK.has(ch.tagName)) { walk(ch, into); return; }
      const el = document.createElement(ch.tagName.toLowerCase());
      if (ch.tagName === "A") {
        const href = ch.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) { el.href = href; el.target = "_blank"; el.rel = "noopener noreferrer"; }
      }
      const st = ch.getAttribute("style") || "";
      const al = /text-align:\s*(left|center|right|justify)/i.exec(st);
      if (al && /^(DIV|P|H3|LI)$/.test(ch.tagName)) el.style.textAlign = al[1].toLowerCase();
      walk(ch, el);
      into.appendChild(el);
    });
  })(doc.body, out);
  return out;
}
function cleanHtmlString(html) { const d = document.createElement("div"); d.appendChild(cleanHtml(html)); return d.innerHTML; }

/* ----- recipients (To / Cc / Bcc) ----- */
function trRenderRecipients() {
  document.querySelectorAll(".tr-to").forEach((box) => {
    const f = box.dataset.f;
    const chips = box.querySelector(".tr-chips");
    chips.textContent = "";
    trSel[f].forEach((p) => {
      const c = document.createElement("span");
      c.className = "tr-chip";
      c.textContent = p.name;
      const x = document.createElement("button");
      x.type = "button"; x.textContent = "\u00d7"; x.setAttribute("aria-label", "Remove " + p.name);
      x.addEventListener("click", () => { trSel[f] = trSel[f].filter((q) => q.username !== p.username); trRenderRecipients(); });
      c.appendChild(x);
      chips.appendChild(c);
    });
    box.classList.toggle("empty", !trSel[f].length);
    const menu = box.querySelector(".tr-menu");
    menu.textContent = "";
    const taken = new Set([].concat(trSel.to, trSel.cc, trSel.bcc).map((p) => p.username));
    const free = (trHR || []).filter((p) => !taken.has(p.username));
    if (!free.length) {
      const e = document.createElement("span");
      e.className = "tr-menu-empty";
      e.textContent = trHR && trHR.length ? "Everyone is already added" : "No HR accounts found";
      menu.appendChild(e);
    }
    free.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = p.name;
      b.addEventListener("click", () => { trSel[f].push(p); menu.hidden = true; trRenderRecipients(); });
      menu.appendChild(b);
    });
  });
}
document.querySelectorAll(".tr-to").forEach((box) => {
  box.querySelector(".tr-add").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = box.querySelector(".tr-menu");
    const was = menu.hidden;
    document.querySelectorAll(".tr-menu").forEach((m) => (m.hidden = true));
    menu.hidden = !was;
  });
});
document.addEventListener("click", () => document.querySelectorAll(".tr-menu").forEach((m) => (m.hidden = true)));
document.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => {
  $(b.dataset.show === "cc" ? "trCcRow" : "trBccRow").hidden = false;
  b.hidden = true;
}));

/* ----- pills, checkboxes, editor ----- */
["trCategory", "trPriority"].forEach((id) => {
  const box = $(id);
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const on = b.classList.contains("on");
    box.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    if (!on) b.classList.add("on");
  }));
});
const trBody = $("trBody");
document.querySelectorAll("#trTools button").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));
document.querySelectorAll("#trTools [data-cmd]").forEach((b) => b.addEventListener("click", () => {
  trBody.focus();
  document.execCommand(b.dataset.cmd, false, null);
}));
$("trBlock").addEventListener("change", (e) => {
  trBody.focus();
  document.execCommand("formatBlock", false, e.target.value === "h3" ? "<h3>" : "<p>");
});
document.querySelector('#trTools [data-act="link"]').addEventListener("click", () => {
  const url = window.prompt("Link address (https://…)");
  if (!url || !/^https?:\/\//i.test(url.trim())) return;
  trBody.focus();
  document.execCommand("createLink", false, url.trim());
});
const trEmoji = $("trEmoji");
["😊", "🙂", "😟", "😔", "😴", "💪", "🙏", "👍", "❤️", "🌿", "☕", "⏰"].forEach((em) => {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = em;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", () => { trBody.focus(); document.execCommand("insertText", false, em); trEmoji.hidden = true; });
  trEmoji.appendChild(b);
});
document.querySelector('#trTools [data-act="emoji"]').addEventListener("click", (e) => { e.stopPropagation(); trEmoji.hidden = !trEmoji.hidden; });
document.addEventListener("click", () => { trEmoji.hidden = true; });
trBody.addEventListener("paste", (e) => {                       // paste as plain text
  e.preventDefault();
  document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
});

function trFormNote(text, bad) { const n = $("trFormNote"); n.textContent = text || ""; n.classList.toggle("bad", !!bad); }
function trResetForm() {
  trSel.to = []; trSel.cc = []; trSel.bcc = [];
  trRenderRecipients();
  $("trSubject").value = "";
  trBody.innerHTML = "";
  document.querySelectorAll("#trCategory .on, #trPriority .on").forEach((b) => b.classList.remove("on"));
  document.querySelectorAll("#trSupport input").forEach((c) => (c.checked = false));
  $("trCcRow").hidden = true; $("trBccRow").hidden = true;
  document.querySelectorAll("[data-show]").forEach((b) => (b.hidden = false));
  trFormNote("");
}

$("trSend").addEventListener("click", async () => {
  const subject = $("trSubject").value.trim();
  const body = cleanHtmlString(trBody.innerHTML);
  const plain = (trBody.textContent || "").trim();
  if (!trSel.to.length) return trFormNote("Choose who to send this to.", true);
  if (!subject) return trFormNote("Add a subject.", true);
  if (!plain) return trFormNote("Describe your concern first.", true);
  const pick = (id) => { const b = document.querySelector("#" + id + " .on"); return b ? b.dataset.v : ""; };
  const btn = $("trSend");
  btn.disabled = true;
  trFormNote("Sending…");
  try {
    const sent = await api("cSubmit", {
      to: trSel.to.map((p) => p.username), cc: trSel.cc.map((p) => p.username), bcc: trSel.bcc.map((p) => p.username),
      subject, body, category: pick("trCategory"), priority: pick("trPriority"),
      support: [...document.querySelectorAll("#trSupport input:checked")].map((c) => c.value),
    });
    trResetForm();
    trNote("Your concern was sent. HR has been notified.");
    if (sent.item) { trApply(sent.item); trLoaded = true; } else await trLoad();
    trTab = "current";
    trRender();
  } catch (err) {
    trFormNote(err.message === "open" ? "You already have an open concern. HR or Admin needs to close it before you can send another." :
      err.message === "outdated" ? "The backend script is out of date. Please deploy the newest version." : (err.message && err.message.length < 80 ? err.message : "Couldn't send. Please try again."), true);
  }
  btn.disabled = false;
});

/* ----- loading and the tabs ----- */
async function trLoad() {
  try {
    const d = await api("cList");
    trItems = d.items || [];
    trLoaded = true;
    return true;
  } catch (err) {
    trNote(err.message === "outdated" ? "The backend script is out of date. Please deploy the newest version." : "Couldn't load concerns right now.", true);
    return false;
  }
}

function trTabsFor() {
  if (trIsEmp()) return [{ k: "current", t: "My Concern" }, { k: "history", t: "History (" + trItems.filter((c) => c.status === "Closed").length + ")" }];
  const open = trOpenOnes().length;
  return [{ k: "open", t: "Open (" + open + ")" }, { k: "history", t: "History (" + (trItems.length - open) + ")" }];
}

function trRender() {
  const tabs = $("trTabs");
  tabs.textContent = "";
  const list = trTabsFor();
  if (!list.some((x) => x.k === trTab)) trTab = list[0].k;
  list.forEach((x) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = x.t; b.setAttribute("role", "tab");
    b.className = x.k === trTab ? "on" : "";
    b.addEventListener("click", () => { trTab = x.k; trNote(""); trRender(); });
    tabs.appendChild(b);
  });
  $("trForm").hidden = true; $("trList").hidden = true; $("trDetail").hidden = true;

  if (trIsEmp() && trTab === "current") {
    const open = trOpenOnes()[0];
    if (open) trShow(open.id, false);
    else { $("trForm").hidden = false; trRenderRecipients(); }
    return;
  }
  const rows = trTab === "history" ? trItems.filter((c) => c.status === "Closed") : trOpenOnes();
  trRenderList(rows);
}

function trRenderList(rows) {
  const box = $("trList");
  box.hidden = false;
  box.textContent = "";
  if (!rows.length) {
    const e = document.createElement("p");
    e.className = "adm-empty";
    e.textContent = trTab === "history" ? "Nothing in the history yet." : trIsEmp() ? "You have no open concern." : "No open concerns right now.";
    box.appendChild(e);
    return;
  }
  const head = document.createElement("div");
  head.className = "tr-row-item tr-th";
  head.innerHTML = "<span>" + (trIsEmp() ? "To" : "Employee") + "</span><span>Subject</span><span>Priority</span><span>Status</span><span>Updated</span>";
  box.appendChild(head);
  rows.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tr-row-item";
    const who = document.createElement("span");
    who.className = "tr-who";
    who.textContent = trIsEmp() ? c.to.map((p) => p.name).join(", ") : c.name;
    const sub = document.createElement("span");
    sub.className = "tr-sub";
    sub.textContent = c.subject;
    const pr = document.createElement("span");
    pr.textContent = c.priority || "–";
    const st = document.createElement("span");
    st.className = "tr-status st-" + c.status.toLowerCase();
    st.textContent = c.status;
    const up = document.createElement("span");
    up.className = "tr-date";
    up.textContent = trWhen(c.updated);
    b.append(who, sub, pr, st, up);
    b.addEventListener("click", () => trShow(c.id, true));
    box.appendChild(b);
  });
}

/* ----- one concern ----- */
function trPaint(c, messages, canGoBack, silent) {
  $("trForm").hidden = true; $("trList").hidden = true;
  $("trDetail").hidden = false;
  $("trBack").hidden = !canGoBack;
  $("trdSubject").textContent = c.subject;
  $("trdMeta").textContent = (trIsEmp() ? "" : "From " + c.name + " \u00b7 ") + "To " + c.to.map((p) => p.name).join(", ") + " \u00b7 " + trWhen(c.created);
  const st = $("trdStatus");
  st.textContent = c.status;
  st.className = "tr-status st-" + c.status.toLowerCase();
  const tags = $("trdTags");
  tags.textContent = "";
  [c.category, c.priority && c.priority + " priority"].concat(c.support).filter(Boolean).forEach((t) => {
    const s = document.createElement("span");
    s.textContent = t;
    tags.appendChild(s);
  });
  const body = $("trdBody");
  body.textContent = "";
  body.appendChild(cleanHtml(c.body));
  const th = $("trdThread");
  if (messages) {
    const sig = messages.map((m) => m.id).join(",");
    if (th.dataset.sig !== sig || !silent) { renderThread(th, messages, trIsEmp() ? "employee" : "staff"); th.dataset.sig = sig; }
  } else { th.textContent = ""; th.dataset.sig = ""; const l = document.createElement("p"); l.className = "thread-empty"; l.textContent = "Loading…"; th.appendChild(l); }
  const closed = c.status === "Closed";
  $("trdCompose").hidden = closed;
  if (!silent) $("trdText").value = "";
  $("trdClose").hidden = trIsEmp() || closed;
  $("trdReset").hidden = !(currentUser && currentUser.role === "admin");
  $("trdNote").textContent = closed ? "Closed" + (c.closedBy ? " by " + c.closedBy : "") + "." : "";
  $("trdNote").classList.remove("bad");
}
function trTabCounts() {
  const tabs = trTabsFor();
  $("trTabs").querySelectorAll("button").forEach((b, n) => { if (tabs[n]) b.textContent = tabs[n].t; });
}
function trApply(c) {                       // keep the list in step with what the server just said
  const i = trItems.findIndex((x) => x.id === c.id);
  if (i > -1) trItems[i] = Object.assign({}, trItems[i], c); else trItems.unshift(c);
  trTabCounts();
}
async function trShow(id, canGoBack, silent) {
  trCurId = id;
  const known = trItems.find((x) => x.id === id);
  if (known && !silent) trPaint(known, null, canGoBack, false);       // show the header at once, the replies follow
  try {
    const d = await api("cGet", { id });
    if (trCurId !== id) return;
    trCur = d.concern;
    trApply(d.concern);
    trPaint(d.concern, d.messages, canGoBack, silent);
  } catch (err) {
    if (!silent) { trNote("Couldn't open that concern.", true); trRender(); }
  }
}
$("trBack").addEventListener("click", () => { trRender(); });

$("trdSend").addEventListener("click", async () => {
  const text = $("trdText").value.trim();
  if (!text || !trCur) return;
  const id = trCur.id;
  // show the reply straight away; the server answer replaces it
  const th = $("trdThread");
  th.querySelector(".thread-empty") && th.querySelector(".thread-empty").remove();
  const bub = document.createElement("div");
  bub.className = "bubble me sending";
  const t = document.createElement("span"); t.className = "b-text"; t.textContent = text;
  bub.appendChild(t); th.appendChild(bub); th.scrollTop = th.scrollHeight;
  $("trdText").value = "";
  try {
    const d = await api("cReply", { id, text });
    trCur = d.concern; trApply(d.concern);
    if (trCurId === id) trPaint(d.concern, d.messages, !$("trBack").hidden, true);
  } catch (err) {
    bub.remove();
    $("trdText").value = text;
    $("trdNote").textContent = err.message === "closed" ? "This concern is already closed." : "Couldn't send the reply.";
    $("trdNote").classList.add("bad");
  }
});
$("trdText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("trdSend").click(); } });
armConfirm($("trdClose"), "Close concern", "Sure? Click again", async () => {
  try {
    await api("cClose", { id: trCur.id });
    await trLoad();
    trNote("Concern closed. It is now in the History.");
    trTab = "history";
    trRender();
  } catch (err) { $("trdNote").textContent = "Couldn't close the concern."; $("trdNote").classList.add("bad"); }
});
armConfirm($("trdReset"), "Reset concern", "Sure? Click again", async () => {
  try {
    await api("cReset", { id: trCur.id });
    await trLoad();
    trNote("Concern deleted.");
    trRender();
  } catch (err) { $("trdNote").textContent = "Couldn't reset the concern."; $("trdNote").classList.add("bad"); }
});
armConfirm($("trResetAll"), "Reset all concerns", "Click again to reset ALL", async () => {
  try {
    const r = await api("cReset", { all: true });
    await trLoad();
    trNote("Deleted " + r.count + " concern" + (r.count === 1 ? "" : "s") + ". Employees can send new ones.");
    trRender();
  } catch (err) { trNote("Couldn't reset the concerns.", true); }
});
$("trRefresh").addEventListener("click", async () => { trNote(""); await trLoad(); trRender(); });

async function trEnter() {
  if (!currentUser) return;
  const emp = trIsEmp();
  $("trTitle").textContent = emp ? "Report a Workload Concern" : "Work Intervention Tracker";
  $("trSub").innerHTML = emp ? "Send a message to our HR and Employee Support Team.<br>Your concern will be reviewed and handled with care."
    : "Review concerns from your employees, reply, and close them when they are handled.<br>" + (currentUser.role === "admin" ? "As Admin you can view everything without changing a status." : "Opening a new concern sets it to Ongoing.");
  $("trResetAll").hidden = currentUser.role !== "admin";
  trNote("");
  if (emp && !trHR) {
    try { trHR = (await api("recipients")).people || []; } catch (e) { trHR = []; }
    trRenderRecipients();
  }
  if (trLoaded && !trPendingOpen) trRender();                       // show what we already have, instantly
  else if (!trLoaded) { $("trList").hidden = false; $("trList").innerHTML = '<p class="adm-empty">Loading…</p>'; $("trForm").hidden = true; $("trDetail").hidden = true; }
  const ok = await trLoad();
  if (!ok) return;
  if (trPendingOpen) {
    const id = trPendingOpen; trPendingOpen = null;
    const c = trItems.find((x) => x.id === id);
    if (c) { trTab = emp ? (c.status === "Closed" ? "history" : "current") : (c.status === "Closed" ? "history" : "open"); trRender(); if (!emp || c.status === "Closed") trShow(id, true); return; }
  }
  trSoftRefresh();
}
// re-draw after fresh data without throwing away what the person is doing (typing a reply, reading a concern)
function trSoftRefresh() {
  if (!$("trDetail").hidden && trCurId) { trTabCounts(); trShow(trCurId, !$("trBack").hidden, true); return; }
  if (!$("trForm").hidden && !trOpenOnes().length) { trTabCounts(); return; }
  trRender();
}

/* =====================================================
   LIVE UPDATES: while a conversation is on screen, check for news every few seconds
   (a tiny "anything new?" call; the full data is only fetched when something changed)
   ===================================================== */
let rtBusy = false;
async function rtTick() {
  if (rtBusy || document.hidden || !currentUser || !ICON_API) return;
  rtBusy = true;
  try {
    const onTracker = $("tracker").classList.contains("active");
    if (onTracker) {
      const p = await api("cPulse");
      if (p.stamp !== trStamp) {
        const first = trStamp === "";
        trStamp = p.stamp;
        if (!first || !trLoaded) { if (await trLoad()) trSoftRefresh(); }
      }
    }
    if (currentUser.role === "employee" && !msgModal.hidden) await loadEmpThread(true);
    if (isStaff() && teamPanel.classList.contains("detail") && detailUser) await loadStaffThread(true);
  } catch (e) { /* offline or busy: try again next time */ }
  rtBusy = false;
}
setInterval(rtTick, 4000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { rtTick(); pollNotifications(); } });


/* =====================================================
   MANTRA GARDEN
   ===================================================== */
const GD_NAMES = { can: "Watering Can", mush: "Mushroom", fert: "Fertilizer", lady: "Ladybug", butter: "Butterfly", afert: "Admin Fertilizer" };
const GD_INFO = {
  can: "+1 to 2 XP", mush: "+3 to 5 XP", fert: "+6 to 10 XP",
  lady: "Flies around. Protects your XP for 1 missed day.", butter: "Flies, then walks, then leaves. Protects 2 missed days.",
  afert: "Jumps your garden to the next level.",
};
const GD_ORDER = ["can", "mush", "fert", "lady", "butter", "afert"];
const GD_STAGES = [
  { n: "Seedling", need: 20, icon: "gdiSeed" }, { n: "Young Sprout", need: 35, icon: "gdiSprout" }, { n: "Growing Tree", need: 70, icon: "gdiSapling" },
  { n: "Thriving Tree", need: 100, icon: "gdiTree" }, { n: "Vigorous Tree", need: 200, icon: "gdiBigTree" }, { n: "Tree of Growth", need: 0, icon: "gdiTog" },
];
const GD_QUOTES = [
  ["The best time to plant a tree was twenty years ago. The second best time is now.", "Chinese proverb"],
  ["A journey of a thousand miles begins with a single step.", "Lao Tzu, Tao Te Ching"],
  ["Great oaks from little acorns grow.", "English proverb"],
  ["It does not matter how slowly you go, as long as you do not stop.", "Confucius"],
  ["To plant a garden is to believe in tomorrow.", "Audrey Hepburn"],
  ["Adopt the pace of nature: her secret is patience.", "Ralph Waldo Emerson"],
  ["Don't judge each day by the harvest you reap, but by the seeds you plant.", "Robert Louis Stevenson"],
  ["The earth laughs in flowers.", "Ralph Waldo Emerson, Hamatreya"],
  ["We must cultivate our garden.", "Voltaire, Candide"],
  ["He that plants trees loves others besides himself.", "Thomas Fuller, Gnomologia"],
  ["To everything there is a season, and a time to every purpose under the heaven.", "Ecclesiastes 3:1"],
  ["Be not afraid of growing slowly, be afraid only of standing still.", "Chinese proverb"],
  ["Rome was not built in a day.", "English proverb"],
  ["Slow and steady wins the race.", "Aesop, The Tortoise and the Hare"],
  ["Small deeds done are better than great deeds planned.", "Peter Marshall"],
  ["Every small step helps me grow.", "Mantra"],
  ["Rest is part of growing too.", "Mantra"],
  ["Progress, not perfection.", "Mantra"],
  ["You are allowed to be both a work in progress and proud of how far you've come.", "Mantra"],
  ["Fall seven times, stand up eight.", "Japanese proverb"],
  ["Be patient with yourself. Nothing in nature blooms all year.", "Mantra"],
  ["Every day you show up, you become a little stronger.", "Mantra"],
  ["Growth begins at the edge of your comfort zone.", "Mantra"],
  ["Asking for help is a way of growing, not a sign of weakness.", "Mantra"],
  ["Take a breath. Being kind to yourself counts as work too.", "Mantra"],
  ["Who you are becoming matters more than how fast you get there.", "Mantra"],
  ["Mistakes are the soil where wisdom grows.", "Mantra"],
  ["Celebrate the small wins. They add up to big change.", "Mantra"],
];
let gd = null;                 // last state from the server
let gdLevelSeen = null;
let gdLastQuote = -1;
let gdTree = "cherry";
let gdTreeBusy = 0;        // tree saves still on their way (their answers must not flip the tree back)
let gdBusy = 0;            // item uses still on their way
const gdThresh = [0, 20, 55, 125, 225, 425];
function gdDay() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function gdToast(text, kind) {
  const t = document.createElement("div");
  t.className = "gd-toast " + (kind || "");
  t.textContent = text;
  $("gdToasts").appendChild(t);
  setTimeout(() => t.remove(), 4700);
}
function gdIcon(id, cls) { return '<svg class="' + (cls || "") + '" viewBox="0 0 64 64"><use href="#' + id + '"/></svg>'; }
const gdItemIcon = (k) => ({ can: "gdiCan", mush: "gdiMush", fert: "gdiFert", lady: "gdiLady", butter: "gdiButter", afert: "gdiAFert", login: "gdiLogin" }[k] || "");


/* ----- the plant "talks": a speech bubble beside the tree that fades away ----- */
const GD_MIDY = { cherry: [700, 640, 653, 545, 405, 210], umbrella: [700, 640, 676, 601, 525, 378] };      // top of the plant in the scene, per level
const GD_RIGHT = { cherry: [34, 120, 167, 336, 508, 936], umbrella: [34, 120, 63, 257, 389, 570] };      // half width
let gdBubbleTimer = 0, gdBubbleFade = 0;
function gdScale() { const g = $("garden"), W = g.clientWidth, H = g.clientHeight, s = Math.max(W / 1600, H / 900); return { W, H, s, ox: (W - 1600 * s) / 2, oy: H - 900 * s }; }
function gdPlaceBubble() {
  const b = $("gdBubble");
  if (b.hidden) return;
  const m = gdScale(), lv = gd ? gd.level : 0;
  const svg = document.querySelector(".gd-svg");
  const k = parseFloat(document.querySelector(".gd-plant").style.getPropertyValue("--gs")) || 1;
  const c = parseFloat(svg.style.getPropertyValue("--gc")) || 1;
  // plant growth scale, then the camera pull-back (about the bottom centre)
  const px = (x) => 800 + (x - 800) * k, py = (y) => 768 + (y - 768) * k;
  const sx = (x) => m.ox + (800 + (px(x) - 800) * c) * m.s, sy = (y) => m.oy + (900 + (py(y) - 900) * c) * m.s;
  const bw = b.offsetWidth, bh = b.offsetHeight, pad = 8;
  const right = sx(800 + GD_RIGHT[gdTree][lv]);
  const midY = sy(GD_MIDY[gdTree][lv]);
  b.classList.remove("tail-r", "tail-l", "tail-b");
  if (m.W > 820 && right + bw + 20 < m.W - 8) {
    // beside the middle of the tree, tail pointing at it
    b.classList.add("tail-l");
    b.style.left = right + 14 + "px";
    b.style.top = Math.max(pad, Math.min(midY - bh / 2, m.H - bh - 90)) + "px";
    b.style.setProperty("--ox", "0%");
  } else {
    b.classList.add("tail-b");
    const cx = m.ox + 800 * m.s;
    const x = Math.min(Math.max(pad, cx - bw / 2), m.W - bw - pad);
    b.style.left = x + "px";
    b.style.top = Math.max(pad, Math.min(midY - bh - 16, m.H - bh - 120)) + "px";
    b.style.setProperty("--tx", Math.min(bw - 30, Math.max(18, cx - x - 9)) + "px");
    b.style.setProperty("--ox", "50%");
  }
}
function gdSay(text, ref, ms) {
  const b = $("gdBubble");
  clearTimeout(gdBubbleTimer); clearTimeout(gdBubbleFade);
  $("gdQuote").textContent = text;
  $("gdRef").textContent = ref || "";
  b.classList.toggle("plain", !ref);
  b.hidden = false;
  b.classList.remove("show");
  gdPlaceBubble();
  void b.offsetWidth;
  b.classList.add("show");
  gdBubbleTimer = setTimeout(() => {
    b.classList.remove("show");
    gdBubbleFade = setTimeout(() => { b.hidden = true; }, 500);
  }, ms || 8000);
}
function gdHideBubble() { clearTimeout(gdBubbleTimer); clearTimeout(gdBubbleFade); const b = $("gdBubble"); b.classList.remove("show"); b.hidden = true; }
window.addEventListener("resize", () => { if (!$("gdBubble").hidden) gdPlaceBubble(); });

/* ----- ambient life: pollen and leaves drifting down ----- */
setInterval(() => {
  if (document.hidden || !$("garden").classList.contains("active")) return;
  const box = $("gdAmbient");
  if (box.childElementCount > 14) return;
  const e = document.createElement("i");
  const leaf = Math.random() < 0.35;
  e.className = "gd-amb " + (leaf ? "leaf" : "pollen");
  e.style.left = Math.random() * 100 + "%";
  e.style.animationDuration = (9 + Math.random() * 9) + "s";
  box.appendChild(e);
  setTimeout(() => e.remove(), 19000);
}, 1400);

/* ----- loading ----- */
async function gdEnter() {
  if (!currentUser) return;
  $("gdAdminTab").hidden = currentUser.role !== "admin";
  $("gdStyle").hidden = currentUser.role !== "admin";
  $("gdFabStyle").hidden = currentUser.role !== "admin";
  if (gd) gdRender(gd, true);
  await gdLoad();
  if (gd) gdSay(gd.loggedToday ? "Thanks for visiting today! Let's keep growing." : "Hi! Tap the quote button to log in today and keep me growing.", "", 7000);
}
async function gdLoad() {
  try {
    const d = await api("gState", { day: gdDay() });
    gdEvents(d.events);
    gdRender(d);
  } catch (err) {
    gdToast(err.message === "outdated" ? "The backend script is out of date. Please deploy the newest version." : "Couldn't load your garden.", "bad");
  }
}
function gdGotItems() {                 // a bell notification said something arrived
  $("gdPack").classList.add("ping");
  setTimeout(() => $("gdPack").classList.remove("ping"), 2600);
  if ($("garden").classList.contains("active")) gdLoad();
}
function gdEvents(events) {
  (events || []).forEach((e) => {
    if (e.type === "xp") gdToast("You missed a day: -" + e.amount + " XP", "bad");
    else if (e.type === "lady-gone") gdToast("You missed a day. A Ladybug left instead of losing XP.", "bad");
    else if (e.type === "fly-walk") gdToast("You missed a day. Your Butterfly stopped flying and is walking on the grass.", "bad");
    else if (e.type === "walk-gone") gdToast("You missed a day. Your walking Butterfly left the garden.", "bad");
  });
}

/* ----- drawing ----- */
function gdRender(d, quiet) {
  gd = d;
  if (!gdTreeBusy && (d.tree === "cherry" || d.tree === "umbrella")) gdTree = d.tree;
  $("gdPick").hidden = !(currentUser && currentUser.role !== "admin" && !d.tree);
  const lv = d.level;
  document.querySelectorAll(".gd-stage").forEach((s) => s.classList.toggle("on", Number(s.dataset.l) === lv && (!s.dataset.t || s.dataset.t === gdTree)));
  document.querySelectorAll("#gdStyle button").forEach((b) => b.classList.toggle("on", b.dataset.t === gdTree));
  // the plant grows (and shrinks) a little with every XP, not only at level changes
  const p = d.max ? 1 : Math.min(1, Math.max(0, d.into / d.need));
  document.querySelector(".gd-plant").style.setProperty("--gs", (lv === 0 ? 0.7 + 0.5 * p : lv >= 5 ? 1 : 0.9 + 0.1 * p).toFixed(3));
  // the soil starts as a mound, then settles and flattens as the tree grows (its roots end up buried)
  const SX = [1, 1.04, 1.12, 1.25, 1.4, 1.55], SY = [1, 1, 0.8, 0.6, 0.45, 0.35], SF = [1, 1, 1, 0.95, 0.9, 0.85];
  const mix = (A) => (lv >= 5 ? A[5] : A[lv] + (A[lv + 1] - A[lv]) * p).toFixed(3);
  const pl = document.querySelector(".gd-plant").style;
  pl.setProperty("--gsl", mix(SX)); pl.setProperty("--gsy", mix(SY)); pl.setProperty("--gsf", mix(SF));
  // the camera pulls back as the tree grows, so the garden around it looks smaller
  const ZOOM = [1, 1, 0.94, 0.85, 0.72, 0.6];
  const z = lv >= 5 ? ZOOM[5] : ZOOM[lv] + (ZOOM[lv + 1] - ZOOM[lv]) * p;
  document.querySelector(".gd-svg").style.setProperty("--gz", z.toFixed(3));
  const CAM = [1, 1, 1, 0.9, 0.76, 0.62];
  const cz = lv >= 5 ? CAM[5] : CAM[lv] + (CAM[lv + 1] - CAM[lv]) * p;
  document.querySelector(".gd-svg").style.setProperty("--gc", cz.toFixed(3));
  $("gdLvNum").textContent = "Level " + lv;
  $("gdLvName").textContent = GD_STAGES[lv].n;
  $("gdLvIcon").setAttribute("href", "#" + GD_STAGES[lv].icon);
  $("gdBar").style.width = (d.max ? 100 : p * 100) + "%";
  $("gdXp").textContent = d.max ? d.xp + " XP" : d.into + "/" + d.need;
  $("gdXpNote").textContent = d.max ? "Fully grown!" : "Until next level";
  if (!quiet && gdLevelSeen !== null && lv !== gdLevelSeen) {
    if (lv > gdLevelSeen) { gdBurst(); gdToast("Level up! Your garden is now a " + GD_STAGES[lv].n + ".", "good"); }
    else gdToast("Your garden shrank back to a " + GD_STAGES[lv].n + ".", "bad");
  }
  gdLevelSeen = lv;
  setTimeout(gdPlaceBubble, 60);
  gdRenderSteps(lv);
  gdRenderItems(d);
  gdRenderActs(d.log);
  const lg = $("gdLogin");
  lg.textContent = d.loggedToday ? "\u2713 Daily login done" : "Tap the quote button to log in today";
  lg.classList.toggle("ok", !!d.loggedToday);
  $("gdQuoteBtn").classList.toggle("done", !!d.loggedToday);
  gdCreatures(d.act);
}
function gdRenderSteps(lv) {
  const ol = $("gdSteps");
  ol.textContent = "";
  GD_STAGES.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = i < lv ? "done" : i === lv ? "now" : "";
    li.innerHTML = '<span class="gd-st">' + gdIcon(s.icon) + "</span><b></b><small></small>";
    li.querySelector("b").textContent = s.n;
    li.querySelector("small").textContent = "Level " + i + (s.need ? " \u00b7 " + s.need + " XP" : " \u00b7 Max");
    ol.appendChild(li);
  });
}
function gdRenderItems(d) {
  const grid = $("gdGrid");
  grid.textContent = "";
  let total = 0;
  GD_ORDER.forEach((k) => {
    if (k === "afert" && !d.infinite) return;
    const n = d.inv[k] || 0;
    total += k === "afert" ? 0 : n;
    const c = document.createElement("div");
    c.className = "gd-itemcard" + (k === "afert" ? " admin" : "") + (!d.infinite && !n ? " zero" : "");
    c.innerHTML = gdIcon(gdItemIcon(k)) + "<b></b><small></small><span class='cnt'></span><button type='button'>Use</button>";
    c.querySelector("b").textContent = GD_NAMES[k];
    c.querySelector("small").textContent = GD_INFO[k];
    c.querySelector(".cnt").textContent = d.infinite ? "\u221e" : "\u00d7" + n;
    const b = c.querySelector("button");
    b.disabled = !d.infinite && !n;
    b.addEventListener("click", () => gdUse(k, b));
    grid.appendChild(c);
  });
  const badge = $("gdPackN");
  badge.textContent = total;
  badge.hidden = d.infinite || !total;
}
function gdRenderActs(log) {
  const ul = $("gdActs");
  ul.textContent = "";
  if (!log || !log.length) { ul.innerHTML = '<li class="gd-empty-li"><span class="gd-empty" style="grid-column:1/-1">Nothing yet. Complete tasks to earn rewards.</span></li>'; return; }
  log.forEach((a) => {
    const li = document.createElement("li");
    const bad = /Missed|reset|shrank/i.test(a.txt);
    const ic = a.item ? gdIcon(gdItemIcon(a.item), "gd-item") : "";
    const when = new Date(a.ts).toLocaleDateString([], { month: "short", day: "numeric" });
    li.innerHTML = '<span class="gd-ico' + (bad ? " bad" : "") + '">' + gdIcon(bad ? "gdiMiss" : "gdiLogin") + "</span><span><b></b><small></small></span><span>" + ic + '</span><button type="button" class="gd-x" aria-label="Clear this activity" title="Clear">&times;</button>';
    li.querySelector(".gd-x").addEventListener("click", () => gdClearLog({ ts: a.ts, txt: a.txt }));
    li.querySelector("b").textContent = a.txt;
    li.querySelector("small").textContent = when;
    ul.appendChild(li);
  });
}
async function gdClearLog(p) {
  if (gd && gd.log) { gd.log = p.all ? [] : gd.log.filter((e) => !(e.ts === p.ts && e.txt === p.txt)); gdRenderActs(gd.log); }
  try { const d = await gdSend("gClearLog", p); gdRender(d, true); }
  catch (err) { gdToast(err.message === "outdated" ? "The backend script is out of date." : "Couldn't clear that.", "bad"); }
}
$("gdClearAll").addEventListener("click", () => { if (gd && gd.log && gd.log.length) gdClearLog({ all: true }); });
/* Admin can switch the tree style any time; Employee/HR choose when they plant (and again after a reset) */
async function gdSetTree(t) {
  if (gdTree === t && gd && gd.tree === t) return;
  const prev = gd ? gd.tree : "", prevTree = gdTree;
  gdTree = t;                                        // the new tree shows immediately
  if (gd) { gd.tree = t; gdRender(gd, true); }
  gdTreeBusy++;
  try {
    const d = await gdSend("gTree", { tree: t, day: gdDay() });
    gdTreeBusy--;
    if (!gdTreeBusy) gdRender(d, true);
  } catch (err) {
    gdTreeBusy--;
    if (!gdTreeBusy) {
      gdTree = prevTree;
      if (gd) { gd.tree = prev; gdRender(gd, true); }
    }
    gdToast(err.message === "outdated" ? "The backend script is out of date." : err.message === "chosen" ? "You already planted a tree." : "Couldn't save your tree.", "bad");
  }
}
document.querySelectorAll("#gdStyle button").forEach((b) => b.addEventListener("click", () => gdSetTree(b.dataset.t)));
document.querySelectorAll("#gdPick button").forEach((b) => b.addEventListener("click", () => gdSetTree(b.dataset.t)));
$("gdViewAll").addEventListener("click", () => { const on = $("gdRecent").classList.toggle("all"); $("gdViewAll").innerHTML = on ? "Show less <b>&uarr;</b>" : "View All <b>&rarr;</b>"; });
$("gdGrowth").addEventListener("click", () => {
  const p = $("gdProgress");
  p.hidden = !p.hidden;
  $("gdGrowth").setAttribute("aria-expanded", String(!p.hidden));
});
$("gdProgClose").addEventListener("click", () => { $("gdProgress").hidden = true; $("gdGrowth").setAttribute("aria-expanded", "false"); });
$("gdPack").addEventListener("click", () => {
  const p = $("gdItems");
  p.hidden = !p.hidden;
  $("gdPack").setAttribute("aria-expanded", String(!p.hidden));
});
$("gdItemsClose").addEventListener("click", () => { $("gdItems").hidden = true; $("gdPack").setAttribute("aria-expanded", "false"); });

/* ----- creatures: ladybugs, flying and walking butterflies ----- */
function gdMakeBug(kind) {
  const el = document.createElement("div");
  el.className = "gd-bug " + kind;
  el.innerHTML = gdIcon(kind === "lady" ? "gdiLady" : "gdiButter");
  const r = (a, b) => a + Math.random() * (b - a);
  el.style.left = r(12, 70) + "%";
  el.style.top = (kind === "walk" ? r(76, 90) : kind === "fly" ? r(20, 52) : r(24, 64)) + "%";
  el.style.setProperty("--d", (kind === "walk" ? r(30, 50) : r(14, 26)).toFixed(1) + "s");
  el.style.setProperty("--dl", "-" + r(0, 20).toFixed(1) + "s");
  return el;
}
function gdCreatures(act) {
  const box = $("gdCreatures");
  [["lady", Math.min(12, act.lady)], ["fly", Math.min(10, act.fly)], ["walk", Math.min(10, act.walk)]].forEach(([kind, want]) => {
    const have = box.querySelectorAll(".gd-bug." + kind);
    for (let i = have.length; i < want; i++) box.appendChild(gdMakeBug(kind));
    for (let i = have.length - 1; i >= want; i--) have[i].remove();
  });
}

/* ----- effects ----- */
function gdFloat(text, bad) {
  const f = document.createElement("div");
  f.className = "gd-float" + (bad ? " bad" : "");
  f.textContent = text;
  $("gdFx").appendChild(f);
  setTimeout(() => f.remove(), 1900);
}
function gdBurst() {
  for (let i = 0; i < 16; i++) {
    const s = document.createElement("i");
    s.className = "gd-spark";
    s.style.left = 50 + (Math.random() * 14 - 7) + "%";
    s.style.top = 46 + (Math.random() * 14 - 4) + "%";
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 9;
    s.style.setProperty("--x", Math.cos(a) * r + "rem");
    s.style.setProperty("--y", Math.sin(a) * r + "rem");
    $("gdFx").appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}
function gdRain() {
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("i");
    s.className = "gd-drop";
    s.style.left = 47 + Math.random() * 6 + "%";
    s.style.top = 34 + Math.random() * 10 + "%";
    s.style.animationDelay = Math.random() * 0.5 + "s";
    $("gdFx").appendChild(s);
    setTimeout(() => s.remove(), 1700);
  }
}

/* ----- using an item ----- */
/* Garden actions answer instantly on screen and are saved in the background, one after another */
let gdQueue = Promise.resolve();
function gdSend(action, payload) {
  const run = () => api(action, payload);
  const p = gdQueue.then(run, run);
  gdQueue = p.catch(() => {});
  return p;
}
const GD_SAY = { can: "Ahh, that water feels great!", mush: "Yum, thank you!", fert: "I feel stronger already!", afert: "Wow, I grew a whole level!", lady: "A new friend! Hello, Ladybug!", butter: "A butterfly! How lovely." };
function gdApplyXp(xp) {
  xp = Math.min(425, Math.max(0, Math.round(xp)));
  let lv = 0;
  for (let i = 1; i < gdThresh.length; i++) if (xp >= gdThresh[i]) lv = i;
  gd.xp = xp; gd.level = lv; gd.max = lv >= 5;
  gd.into = gd.max ? 0 : xp - gdThresh[lv];
  gd.need = gd.max ? 0 : gdThresh[lv + 1] - gdThresh[lv];
}
const GD_RANGE = { can: [1, 2], mush: [3, 5], fert: [6, 10] };
function gdLogNow(txt, item, xp) { if (!gd.log) gd.log = []; gd.log.unshift({ ts: Date.now(), txt, item: item || "", xp: xp || 0 }); }
async function gdUse(item, btn) {
  const before = gd ? JSON.parse(JSON.stringify(gd)) : null;
  if (before && !before.infinite && !(before.inv[item] > 0)) return;
  let roll = 0;
  if (before) {
    if (!before.infinite) gd.inv[item] -= 1;
    if (item === "afert") {
      if (gd.level < 5) { const t = gdThresh[gd.level + 1]; gdLogNow("Used Admin Fertilizer: jumped to the next level", "afert", t - gd.xp); gdApplyXp(t); }
    } else if (GD_RANGE[item]) {
      const r = GD_RANGE[item];
      roll = r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));      // the number is decided here, so it can be shown (and saved) at once
      if (gd.xp < 425) { gdApplyXp(gd.xp + roll); gdLogNow("Used a " + GD_NAMES[item] + ": +" + roll + " XP", item, roll); gdFloat("+" + roll + " XP"); }
    } else if (item === "lady") { gd.act.lady = (gd.act.lady || 0) + 1; gdLogNow("A Ladybug joined the garden", "lady"); gdToast("A Ladybug joined your garden.", "good"); }
    else if (item === "butter") { gd.act.fly = (gd.act.fly || 0) + 1; gdLogNow("A Butterfly joined the garden", "butter"); gdToast("A Butterfly joined your garden.", "good"); }
    gdRender(gd);                                    // tree, bar, items and Recent Activities all change right now
  }
  if (item === "can") gdRain(); else if (item !== "lady" && item !== "butter") gdBurst();
  const plant = document.querySelector(".gd-plant");
  plant.classList.remove("pulse"); void plant.getBoundingClientRect(); plant.classList.add("pulse");
  gdSay(GD_SAY[item] || "Thank you!", "", 5000);
  gdBusy++;
  try {
    const d = await gdSend("gUse", { item, day: gdDay(), roll });
    gdBusy--;
    gdEvents(d.events);
    if (!gdBusy) gdRender(d, true);                  // settle on the saved numbers once every use has been saved
  } catch (err) {
    gdBusy--;
    if (before) { gd = before; gdRender(gd, true); }  // undo
    gdToast(err.message === "full" ? "Your garden is fully grown already." : err.message === "outdated" ? "The backend script is out of date." : "Couldn't use that item.", "bad");
  }
}

/* ----- quote = daily login ----- */
$("gdQuoteBtn").addEventListener("click", async () => {
  let i;
  do { i = Math.floor(Math.random() * GD_QUOTES.length); } while (i === gdLastQuote && GD_QUOTES.length > 1);
  gdLastQuote = i;
  gdSay(GD_QUOTES[i][0], "\u2014 " + GD_QUOTES[i][1], 9000);
  if (gd && gd.loggedToday) return;
  try {
    const d = await api("gLogin", { day: gdDay() });
    gdEvents(d.events);
    gdRender(d);
    if (d.first) gdToast("Daily login done. Your garden is safe today.", "good");
  } catch (err) { gdToast("Couldn't save your daily login. Try again.", "bad"); }
});

/* the day changed while the garden was open */
setInterval(() => { if (gd && !document.hidden && $("garden").classList.contains("active") && gd.today !== gdDay()) gdLoad(); }, 60000);

/* ----- Admin: everybody's garden ----- */
const GD_GIFTS = ["can", "mush", "fert", "lady", "butter"];
function gdGiftOptions(sel) { sel.textContent = ""; GD_GIFTS.forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = GD_NAMES[k]; sel.appendChild(o); }); }
gdGiftOptions($("gdAllItem"));
function gdAdmMsg(t, bad) { const m = $("gdAdmMsg"); m.textContent = t || ""; m.classList.toggle("bad", !!bad); }
$("gdAdminTab").addEventListener("click", () => { $("gdDrawer").hidden = false; gdAdminLoad(); });
$("gdDrawerClose").addEventListener("click", () => { $("gdDrawer").hidden = true; });
const gdRows = {};          // username -> row element, so live updates change rows in place
let gdAdmBusy = false;
async function gdAdminLoad() {
  if (gdAdmBusy) return;
  gdAdmBusy = true;
  try {
    const d = await api("gAdmin");
    const box = $("gdUsers");
    if (!d.people.length) { box.innerHTML = '<p class="gd-empty">No other accounts yet.</p>'; return; }
    const seen = {};
    d.people.forEach((p) => {
      seen[p.username] = 1;
      let row = gdRows[p.username];
      if (!row || !row.isConnected) { row = gdUserRow(p); gdRows[p.username] = row; box.appendChild(row); }
      else row._set(p);
    });
    Object.keys(gdRows).forEach((u) => { if (!seen[u]) { gdRows[u].remove(); delete gdRows[u]; } });
  } catch (err) { gdAdmMsg(err.message === "outdated" ? "The backend script is out of date." : "Couldn't load the gardens.", true); }
  finally { gdAdmBusy = false; }
}
/* Admin watches everybody's trees grow while the drawer is open */
setInterval(() => { if (!$("gdDrawer").hidden && !document.hidden && $("garden").classList.contains("active")) gdAdminLoad(); }, 3000);
function gdUserRow(p) {
  const row = document.createElement("div");
  row.className = "gd-user";
  row.innerHTML = '<div class="top"><span class="av"></span><span class="nm"><b></b><small></small></span><span class="gd-tl"></span></div><div class="gd-bar"><i></i></div><div class="btns"></div>';
  const av = row.querySelector(".av");
  if (p.icon && typeof iconUrl === "function") { const im = document.createElement("img"); im.alt = ""; im.src = iconUrl(p.icon); av.appendChild(im); } else av.textContent = (p.name || "?").charAt(0).toUpperCase();
  row.querySelector("b").textContent = p.name;
  let last = null;
  row._set = (q) => {
    const pct = q.level >= 5 ? 100 : Math.round((q.into / q.need) * 100);
    row.querySelector("small").textContent = (q.role === "hr" ? "HR" : "Employee") + " \u00b7 Level " + q.level + " " + GD_STAGES[q.level].n + " \u00b7 " + q.xp + " XP";
    row.querySelector(".gd-bar i").style.width = pct + "%";
    row.querySelector(".gd-tl").innerHTML = gdIcon(GD_STAGES[q.level].icon);
    if (last !== null && last !== q.xp) { row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); }
    last = q.xp;
  };
  row._set(p);
  const btns = row.querySelector(".btns");
  const gift = document.createElement("button");
  gift.type = "button"; gift.className = "adm-btn"; gift.textContent = "Gift";
  const reset = document.createElement("button");
  reset.type = "button"; reset.className = "adm-btn danger"; reset.textContent = "Reset";
  btns.append(gift, reset);
  gift.addEventListener("click", () => {
    const ex = row.querySelector(".giftrow");
    if (ex) { ex.remove(); return; }
    const g = document.createElement("div");
    g.className = "gd-giftrow giftrow";
    g.innerHTML = '<select aria-label="Item"></select><input type="number" min="1" max="20" value="1" aria-label="How many"><button type="button" class="adm-btn">Send</button>';
    gdGiftOptions(g.querySelector("select"));
    g.querySelector("button").addEventListener("click", () => gdGift(p.username, p.name, g.querySelector("select").value, g.querySelector("input").value));
    row.appendChild(g);
  });
  armConfirm(reset, "Reset", "Sure?", () => gdReset(p.username, p.name));
  return row;
}
async function gdGift(target, label, item, n) {
  gdAdmMsg("Sending…");
  try {
    const r = await api("gGift", { target, item, n: Number(n) || 1 });
    gdAdmMsg("Gifted " + (Number(n) || 1) + " " + GD_NAMES[item] + (target === "ALL" ? " to " + r.count + " people." : " to " + label + "."));
  } catch (err) { gdAdmMsg("Couldn't send the gift.", true); }
}
async function gdReset(target, label) {
  gdAdmMsg(target === "ALL" ? "Resetting all gardens…" : "Resetting " + label + "'s garden…");
  try {
    const r = await gdSend("gReset", { target });
    gdAdmMsg(target === "ALL" ? "Reset " + r.count + " gardens." : "Reset " + label + "'s garden.");
    gdAdminLoad();
  } catch (err) { gdAdmMsg("Couldn't reset.", true); }
}
armConfirm($("gdResetMe"), "Reset my garden", "Click again to reset mine", async () => {
  const snap = gd ? JSON.parse(JSON.stringify(gd)) : null;
  if (gd) {                                          // empty garden right away
    gd = Object.assign({}, gd, { xp: 0, level: 0, max: false, into: 0, need: 20, act: { lady: 0, fly: 0, walk: 0 }, inv: gd.infinite ? gd.inv : {}, log: [{ ts: Date.now(), txt: "You reset your garden", item: "" }].concat(gd.log || []) });
    gdRender(gd, true);
  }
  gdAdmMsg("Your garden was reset.");
  try { const d = await gdSend("gReset", { self: true }); await gdLoad(); }
  catch (err) { if (snap) gdRender(snap, true); gdAdmMsg(err.message === "outdated" ? "The backend script is out of date." : "Couldn't reset your garden.", true); }
});
$("gdGiftAll").addEventListener("click", () => gdGift("ALL", "everyone", $("gdAllItem").value, $("gdAllN").value));
armConfirm($("gdResetAll"), "Reset all gardens", "Click again to reset ALL", () => gdReset("ALL", "everyone"));

/* phone: Recent Activities, Growth Level and Tree style stay closed until their round button is tapped */
document.querySelectorAll(".gd-fab").forEach((b) => b.addEventListener("click", () => {
  const g = $("garden"), want = b.dataset.open;
  g.dataset.open = g.dataset.open === want ? "" : want;
  document.querySelectorAll(".gd-fab").forEach((x) => x.classList.toggle("on", g.dataset.open === x.dataset.open));
  if (g.dataset.open) { $("gdItems").hidden = true; $("gdPack").setAttribute("aria-expanded", "false"); }
}));
$("gdPack").addEventListener("click", () => {
  if (!$("gdItems").hidden) { $("garden").dataset.open = ""; document.querySelectorAll(".gd-fab").forEach((x) => x.classList.remove("on")); }
});

/* mantra Nurture buttons (content pages are still to come) */
document.querySelectorAll("[data-nu]").forEach((b) => b.addEventListener("click", () => {
  const old = document.querySelector(".nu-toast"); if (old) old.remove();
  const t = document.createElement("div"); t.className = "nu-toast";
  t.textContent = { resources: "Resources are coming soon.", programs: "Programs are coming soon.", support: "Professional support requests are coming soon." }[b.dataset.nu];
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}));

/* ---------- Explore Resources: categories + library ---------- */
const RS_NAMES = { stress: "Stress Management", sleep: "Sleep & Shift Recovery", physical: "Physical Health", worklife: "Work-Life Balance", finance: "Financial Well-Being" };
const rsDrop = document.getElementById("rsDrop");
let rsLibData = null, rsCat = "all";
document.getElementById("rsAll").addEventListener("click", () => {
  const open = rsDrop.classList.toggle("open");
  document.getElementById("rsAll").setAttribute("aria-expanded", open);
});
function rsMark(k) {
  document.querySelectorAll(".rs-side, .rs-card").forEach((s) => s.classList.toggle("active", s.dataset.rs === k));
}
const rsCovers = new Map();       // epub id -> data URL (or "" when the book has no cover)
let rsCovQ = Promise.resolve();
function rsCover(b, cover) {
  const put = (src) => {
    const img = new Image(); img.alt = ""; img.className = "rs-img"; img.referrerPolicy = "no-referrer";
    img.onload = () => cover.classList.add("has-img");
    img.src = src; cover.insertBefore(img, cover.firstChild);
  };
  if (b.type === "pdf") { put("https://drive.google.com/thumbnail?id=" + b.id + "&sz=w400"); return; }
  if (rsCovers.has(b.id)) { if (rsCovers.get(b.id)) put(rsCovers.get(b.id)); return; }
  rsCovQ = rsCovQ.then(() => api("libCover", { id: b.id }).then((r) => {
    const url = r.ok ? "data:" + r.mime + ";base64," + r.b64 : "";
    rsCovers.set(b.id, url); if (url && cover.isConnected) put(url);
  }).catch(() => { rsCovers.set(b.id, ""); }));
}
function rsOpen(k) {
  rsCat = k; rsMark(k); rsStopPoll();
  const grid = document.querySelector(".rs-grid"), lib = $("rsLib");
  if (k === "all") { lib.hidden = true; grid.hidden = false; return; }
  grid.hidden = true; lib.hidden = false;
  $("rsLibTitle").textContent = RS_NAMES[k];
  $("rsSearch").value = "";
  rsLibData = null; rsShown = null;
  $("rsBooks").innerHTML = '<div class="rs-msg">Loading the library…</div>';
  rsRefresh(true);
  rsPoll = setInterval(() => { if (!document.hidden && $("rsReader").hidden && $("resources").classList.contains("active")) rsRefresh(false); }, 15000);
}
function rsStopPoll() { if (rsPoll) { clearInterval(rsPoll); rsPoll = null; } }
let rsPoll = null, rsShown = null, rsBusy = false;
// loads the folder fresh from Drive; "loud" shows errors, quiet refreshes only redraw when something changed
function rsRefresh(loud) {
  const k = rsCat; if (k === "all" || rsBusy) return;
  rsBusy = true;
  const btn = $("rsRefresh"); btn.classList.add("spin");
  api("libList", { cat: k }).then((r) => {
    if (rsCat !== k) return;
    const lib = r.lib, sig = JSON.stringify(lib[k] || []) + (lib[k + "_error"] || "");
    rsLibData = lib;
    if (sig !== rsShown) { rsShown = sig; rsRenderBooks(); }
  }).catch((e) => {
    if (rsCat !== k || !loud) return;
    const box = $("rsBooks");
    box.innerHTML = '<div class="rs-msg">' + (e.message === "outdated" ? "The script needs the latest update." : "The library could not be loaded.") + '<br><button type="button">Try again</button></div>';
    box.querySelector("button").addEventListener("click", () => rsRefresh(true));
  }).finally(() => { rsBusy = false; btn.classList.remove("spin"); });
}
function rsRenderBooks() {
  const box = $("rsBooks"), k = rsCat, lib = rsLibData;
  if (!lib) return;
  if (lib[k + "_error"]) { box.innerHTML = '<div class="rs-msg">This folder could not be opened.<br><small></small></div>'; box.querySelector("small").textContent = lib[k + "_error"]; return; }
  const q = $("rsSearch").value.trim().toLowerCase();
  const items = (lib[k] || []).filter((b) => !q || b.name.toLowerCase().includes(q));
  if (!items.length) { box.innerHTML = '<div class="rs-msg">' + (q ? "No books match your search." : "No books here yet.") + "</div>"; return; }
  box.innerHTML = "";
  items.forEach((b) => {
    const el = document.createElement("button");
    el.type = "button"; el.className = "rs-book"; el.dataset.t = b.type;
    el.innerHTML = '<span class="rs-cover"><svg viewBox="0 0 80 80" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M40 24C32 18 20 17 11 20v40c9-3 21-2 29 4 8-6 20-7 29-4V20c-9-3-21-2-29 4Z"/><path d="M40 24v40"/></g></svg></span><span class="rs-btitle"></span>';
    if (b.type === "pdf") el.querySelector(".rs-cover").insertAdjacentHTML("beforeend", '<span class="rs-badge">PDF</span>');
    el.querySelector(".rs-btitle").textContent = b.name;
    rsCover(b, el.querySelector(".rs-cover"));
    el.addEventListener("click", () => rsRead(b));
    box.appendChild(el);
  });
}
document.querySelectorAll(".rs-side, .rs-card").forEach((b) => b.addEventListener("click", () => rsOpen(b.dataset.rs)));
$("rsBack").addEventListener("click", () => rsOpen("all"));
$("rsSearch").addEventListener("input", rsRenderBooks);
$("rsRefresh").addEventListener("click", () => rsRefresh(true));
// when the page is left and opened again it starts from the categories
document.querySelector('[data-view="resources"]').addEventListener("click", () => rsOpen("all"));

/* reader (PDF through Google Drive's viewer, EPUB with epub.js) */
let rsBook = null, rsReaderKey = null;
function rsLoadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector('script[data-src="' + src + '"]')) return res();
    const s = document.createElement("script"); s.src = src; s.dataset.src = src;
    s.onload = res; s.onerror = () => rej(new Error("script")); document.head.appendChild(s);
  });
}
function rsClose() {
  $("rsReader").hidden = true; $("rsRBody").innerHTML = "";
  $("rsRPrev").hidden = $("rsRNext").hidden = true;
  if (rsBook) { try { rsBook.destroy(); } catch (e) {} rsBook = null; }
  rsReaderKey = null; document.removeEventListener("keydown", rsKeys);
}
function rsKeys(e) {
  if (e.key === "Escape") rsClose();
  else if (rsBook && e.key === "ArrowRight") rsBook.rendition && rsBook.rendition.next();
  else if (rsBook && e.key === "ArrowLeft") rsBook.rendition && rsBook.rendition.prev();
}
async function rsRead(b) {
  rsClose();
  const key = (rsReaderKey = b.id);
  $("rsRTitle").textContent = b.name;
  const body = $("rsRBody");
  $("rsReader").hidden = false; document.addEventListener("keydown", rsKeys);
  if (b.type === "pdf") {
    const f = document.createElement("iframe");
    f.src = "https://drive.google.com/file/d/" + b.id + "/preview"; f.setAttribute("allow", "fullscreen");
    body.appendChild(f);
    const sh = document.createElement("div"); sh.className = "rs-shield"; body.appendChild(sh);   // covers the viewer's pop-out / open-in-Drive button
    return;
  }
  body.innerHTML = '<div class="rs-loading">Opening the book…</div>';
  try {
    const r = await api("libFile", { id: b.id });
    await rsLoadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
    await rsLoadScript("https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js");
    if (rsReaderKey !== key) return;
    const bin = atob(r.b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    body.innerHTML = '<div class="rs-epub" id="rsEpub"></div>';
    rsBook = ePub(buf.buffer);
    const rend = rsBook.renderTo("rsEpub", { width: "100%", height: "100%", flow: "paginated", spread: "none" });
    rsBook.rendition = rend;
    await rend.display();
    $("rsRPrev").hidden = $("rsRNext").hidden = false;
  } catch (e) {
    if (rsReaderKey !== key) return;
    body.innerHTML = '<div class="rs-loading">' + (e.message === "too-big" ? "This book is too large to open here." : "This book could not be opened here.") + " Use Download above.</div>";
  }
}
$("rsRClose").addEventListener("click", rsClose);
$("rsRPrev").addEventListener("click", () => rsBook && rsBook.rendition.prev());
$("rsRNext").addEventListener("click", () => rsBook && rsBook.rendition.next());


/* ---------- Join a Program ---------- */
const PG_ITEMS = ["can", "mush", "fert", "lady"];
let pgProgs = [], pgTab = "upcoming", pgAll = false, pgPoll = null, pgIcons = null, pgPick = "", pgRew = {}, pgEditId = null, pgSaving = false;
// icons come through the script as the original PNG (Drive's own thumbnails turn transparency black)
const pgIconCache = new Map(), pgIconQ = []; let pgIconRun = 0;
function pgIconData(id) {
  if (pgIconCache.has(id)) return pgIconCache.get(id);
  const p = new Promise((res, rej) => { pgIconQ.push({ id, res, rej }); pgIconPump(); });
  pgIconCache.set(id, p);
  p.catch(() => pgIconCache.delete(id));
  return p;
}
function pgIconPump() {
  while (pgIconRun < 3 && pgIconQ.length) {
    const t = pgIconQ.shift(); pgIconRun++;
    api("pIcon", { id: t.id }).then((r) => t.res("data:" + r.mime + ";base64," + r.b64), t.rej).finally(() => { pgIconRun--; pgIconPump(); });
  }
}
function pgLoadIcon(img, id, onFail) {
  pgIconData(id).then((u) => { img.src = u; }, () => { if (onFail) onFail(); });
}
const pgIsPast = (p) => p.closed || (p.end && p.end < Date.now());
const pgRole = () => (currentUser ? currentUser.role : "");
function pgFmt(ms) {
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " - " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
function pgToast(msg) {
  const old = document.querySelector(".nu-toast"); if (old) old.remove();
  const t = document.createElement("div"); t.className = "nu-toast"; t.style.zIndex = 99; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
const PG_LOTUS = '<svg viewBox="0 0 80 80" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M40 16c8 8 10 20 0 34-10-14-8-26 0-34Z"/><path d="M40 50C28 50 16 42 14 28c14 0 24 8 26 22ZM40 50c12 0 24-8 26-22-14 0-24 8-26 22Z"/><path d="M18 56c8 8 36 8 44 0"/></g></svg>';
function pgIconEl(p) {
  const d = document.createElement("span"); d.className = "pg-ico";
  if (p.icon) { const i = new Image(); i.alt = ""; i.referrerPolicy = "no-referrer"; i.onload = () => d.classList.add("has"); pgLoadIcon(i, p.icon, () => { d.innerHTML = PG_LOTUS; }); d.appendChild(i); }
  else d.innerHTML = PG_LOTUS;
  return d;
}
function pgEnter() {
  pgTab = "upcoming"; pgAll = false;
  $("pgNew").hidden = pgRole() !== "hr";
  $("pgResetAll").hidden = pgRole() !== "admin";
  document.querySelectorAll(".pg-tab[data-pg]").forEach((b) => b.classList.toggle("active", b.dataset.pg === pgTab));
  pgProgs = [];
  $("pgGrid").innerHTML = '<div class="pg-empty">Loading programs…</div>';
  pgRefresh(true);
  if (pgPoll) clearInterval(pgPoll);
  pgPoll = setInterval(() => {
    if (!document.hidden && $("programs").classList.contains("active") && $("pgDetail").hidden && $("pgForm").hidden) pgRefresh(false);
  }, 20000);
}
function pgRefresh(loud) {
  return api("pList").then((r) => {
    const sig = JSON.stringify(r.progs);
    if (sig !== pgRefresh.sig) { pgRefresh.sig = sig; pgProgs = r.progs; pgRender(); }
  }).catch((e) => {
    if (!loud) return;
    $("pgGrid").innerHTML = '<div class="pg-empty"></div>';
    $("pgGrid").firstChild.textContent = e.message === "outdated" ? "The script needs the latest update." : "Programs could not be loaded.";
  });
}
function pgRender() {
  const past = pgTab === "past";
  let list = pgProgs.filter((p) => pgIsPast(p) === past);
  list.sort((a, b) => (past ? b.start - a.start : a.start - b.start));
  $("pgListTitle").textContent = past ? "Past Programs" : "Upcoming Programs";
  const more = list.length > 4;
  $("pgViewAll").hidden = !more;
  $("pgViewAll").innerHTML = (pgAll ? "Show less" : "View all") + " <b>&rarr;</b>";
  if (more && !pgAll) list = list.slice(0, 4);
  const grid = $("pgGrid"); grid.innerHTML = "";
  if (!list.length) { grid.innerHTML = '<div class="pg-empty"></div>'; grid.firstChild.textContent = past ? "No past programs yet." : pgRole() === "hr" ? "No programs yet. Use “+ New program” to set one." : "No upcoming programs right now. Check back soon!"; return; }
  list.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "pg-card" + (i % 2 ? " o" : ""); card.tabIndex = 0; card.setAttribute("role", "button");
    card.appendChild(pgIconEl(p));
    const t = document.createElement("div"); t.className = "pg-ctitle"; t.textContent = p.title; card.appendChild(t);
    const d = document.createElement("div"); d.className = "pg-cdate"; d.textContent = pgFmt(p.start); card.appendChild(d);
    if (pgRole() !== "employee" && past && !p.closed) { const g = document.createElement("span"); g.className = "pg-tag"; g.textContent = "Ended - not closed yet"; card.appendChild(g); }
    const b = document.createElement("button"); b.type = "button"; b.className = "pg-go";
    const canJoin = pgRole() !== "admin" && !past;
    if (canJoin && !p.joined) { b.innerHTML = "<span>Save my spot</span><b>&rarr;</b>"; b.addEventListener("click", (e) => { e.stopPropagation(); pgJoin(p, false, b); }); }
    else if (p.joined) { b.className += " done"; b.innerHTML = "<span>" + (past ? "You joined" : "Joined") + "</span><b>&#10003;</b>"; }
    else { b.className += past ? " muted" : ""; b.innerHTML = "<span>View details</span><b>&rarr;</b>"; }
    card.appendChild(b);
    card.addEventListener("click", () => pgDetail(p.id));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") pgDetail(p.id); });
    grid.appendChild(card);
  });
}
async function pgJoin(p, leave, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await api("pJoin", { id: p.id, leave: !!leave });
    const i = pgProgs.findIndex((x) => x.id === p.id);
    if (i >= 0) pgProgs[i] = { ...pgProgs[i], ...r.prog };
    pgRefresh.sig = JSON.stringify(pgProgs);
    pgRender();
    if (!$("pgDetail").hidden) pgDetail(p.id);
    pgToast(leave ? "You left the program." : "Your spot is saved!");
    if (!leave) addNotification({ title: "You joined a program", text: "You joined " + p.title + " on " + pgFmt(p.start) + ".", kind: "program", thread: "p:" + p.id });
  } catch (e) {
    pgToast(e.message === "outdated" ? "The script needs the latest update." : e.message);
    if (btn) btn.disabled = false;
    pgRefresh(false);
  }
}
function pgSection(box, label, text) {
  const h = document.createElement("h4"); h.textContent = label; box.appendChild(h);
  const p = document.createElement("p"); p.className = "pg-text"; p.textContent = text; box.appendChild(p);
}
function pgDetail(id) {
  const p = pgProgs.find((x) => x.id === id); if (!p) return;
  const box = $("pgDetailBox"); box.innerHTML = "";
  const x = document.createElement("button"); x.type = "button"; x.className = "pg-x"; x.setAttribute("data-pgclose", ""); x.innerHTML = "&times;"; box.appendChild(x);
  const head = document.createElement("div"); head.className = "pg-dhead"; head.appendChild(pgIconEl(p));
  const h = document.createElement("h3"); h.textContent = p.title; head.appendChild(h); box.appendChild(head);
  const when = document.createElement("p"); when.className = "pg-when";
  when.textContent = (p.end && p.end !== p.start ? pgFmt(p.start) + "  to  " + pgFmt(p.end) : pgFmt(p.start)) + (p.closed ? "  -  Closed" : pgIsPast(p) ? "  -  Ended" : "");
  box.appendChild(when);
  if (p.description) pgSection(box, "About this program", p.description);
  if (p.details) pgSection(box, "Further details", p.details);
  const rw = PG_ITEMS.filter((k) => p.rewards && p.rewards[k]);
  if (rw.length) {
    const h4 = document.createElement("h4"); h4.textContent = "Garden rewards for everyone who joins"; box.appendChild(h4);
    const c = document.createElement("div"); c.className = "pg-chips";
    rw.forEach((k) => { const s = document.createElement("span"); s.className = "pg-chip"; s.textContent = p.rewards[k] + " × " + GD_NAMES[k]; c.appendChild(s); });
    box.appendChild(c);
    const n = document.createElement("p"); n.className = "pg-text"; n.style.cssText = "margin-top:.4rem;font-size:.8rem;color:#8a5a48";
    n.textContent = p.closed ? "These were given to everyone who joined." : "Given once the program is closed.";
    box.appendChild(n);
  }
  const h5 = document.createElement("h4"); h5.textContent = "Participants"; box.appendChild(h5);
  const cnt = document.createElement("p"); cnt.className = "pg-text"; cnt.textContent = p.count + (p.count === 1 ? " person has" : " people have") + " joined" + (p.joined ? " (including you)." : "."); box.appendChild(cnt);
  if (p.people && p.people.length) {
    const ul = document.createElement("ul"); ul.className = "pg-people";
    p.people.forEach((q) => { const li = document.createElement("li"); li.textContent = q.name + " (" + q.role + ")"; ul.appendChild(li); });
    box.appendChild(ul);
  }
  const btns = document.createElement("div"); btns.className = "pg-btns"; box.appendChild(btns);
  const mk = (cls, label) => { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; btns.appendChild(b); return b; };
  const role = pgRole(), past = pgIsPast(p);
  if (role === "hr" && !p.closed) {
    armConfirm(mk("pg-warn", "Delete"), "Delete", "Sure?", async () => { try { await api("pDelete", { id: p.id }); pgModal("pgDetail", false); pgRefresh.sig = ""; await pgRefresh(true); pgToast("Program deleted."); } catch (e) { pgToast(e.message); } });
    mk("pg-ghost", "Edit").addEventListener("click", () => pgOpenForm(p));
  }
  if (role !== "employee" && !p.closed) {
    armConfirm(mk("pg-warn", "Close program"), "Close program", "Close and give rewards?", async () => {
      try { const r = await api("pClose", { id: p.id }); pgModal("pgDetail", false); pgRefresh.sig = ""; await pgRefresh(true); pgToast(r.given ? "Program closed. Rewards sent to " + r.given + (r.given === 1 ? " person." : " people.") : "Program closed."); } catch (e) { pgToast(e.message); }
    });
  }
  if (role !== "admin" && !past) {
    const b = mk(p.joined ? "pg-ghost" : "pg-primary", p.joined ? "Leave program" : "Save my spot");
    b.addEventListener("click", () => pgJoin(p, p.joined, b));
  }
  pgModal("pgDetail", true);
}
function pgModal(id, on) { $(id).hidden = !on; }
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-pgclose]") || e.target.classList.contains("pg-modal")) { pgModal("pgDetail", false); pgModal("pgForm", false); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { pgModal("pgDetail", false); pgModal("pgForm", false); } });
document.querySelectorAll(".pg-tab[data-pg]").forEach((b) => b.addEventListener("click", () => {
  pgTab = b.dataset.pg; pgAll = false;
  document.querySelectorAll(".pg-tab[data-pg]").forEach((x) => x.classList.toggle("active", x === b));
  pgRender();
}));
$("pgViewAll").addEventListener("click", () => { pgAll = !pgAll; pgRender(); });
armConfirm($("pgResetAll"), "Reset all programs", "Sure? Deletes all programs", async () => {
  try { await api("pReset"); pgRefresh.sig = ""; await pgRefresh(true); pgToast("All programs and participation were reset."); } catch (e) { pgToast(e.message); }
});

/* HR: set or edit a program */
const pgLocal = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function pgDrawIcons() {
  const box = $("pgIcons"); box.innerHTML = "";
  if (!pgIcons || !pgIcons.length) { box.innerHTML = '<span class="pg-note">No icons found in the icon folder.</span>'; return; }
  pgIcons.forEach((ic) => {
    const b = document.createElement("button"); b.type = "button"; b.title = ic.name; b.className = ic.id === pgPick ? "sel" : "";
    const i = new Image(); i.alt = ic.name; i.referrerPolicy = "no-referrer"; pgLoadIcon(i, ic.id, () => { i.style.visibility = "hidden"; }); b.appendChild(i);
    b.addEventListener("click", () => { pgPick = pgPick === ic.id ? "" : ic.id; pgDrawIcons(); });
    box.appendChild(b);
  });
}
function pgDrawRewards() {
  const box = $("pgRewards"); box.innerHTML = "";
  PG_ITEMS.forEach((k) => {
    const row = document.createElement("div"); row.className = "pg-rw";
    const name = document.createElement("span"); name.style.cssText = "min-width:0;text-align:left;font-weight:400"; name.textContent = GD_NAMES[k];
    const ctl = document.createElement("div");
    const m = document.createElement("button"), n = document.createElement("span"), a = document.createElement("button");
    m.type = a.type = "button"; m.textContent = "−"; a.textContent = "+"; n.textContent = pgRew[k] || 0;
    m.addEventListener("click", () => { pgRew[k] = Math.max(0, (pgRew[k] || 0) - 1); n.textContent = pgRew[k]; });
    a.addEventListener("click", () => { pgRew[k] = Math.min(10, (pgRew[k] || 0) + 1); n.textContent = pgRew[k]; });
    ctl.append(m, n, a); row.append(name, ctl); box.appendChild(row);
  });
}
function pgOpenForm(p) {
  pgModal("pgDetail", false);
  pgEditId = p ? p.id : null; pgPick = p ? p.icon : ""; pgRew = p ? { ...p.rewards } : {};
  $("pgFormTitle").textContent = p ? "Edit program" : "New program";
  $("pgfTitle").value = p ? p.title : "";
  const s = p ? p.start : new Date(new Date().setHours(10, 0, 0, 0)).getTime() + 86400000;
  $("pgfStart").value = pgLocal(s); $("pgfEnd").value = pgLocal(p ? p.end || p.start : s + 7200000);
  $("pgfDesc").value = p ? p.description : ""; $("pgfDetails").value = p ? p.details : "";
  $("pgfErr").hidden = true; $("pgfSave").disabled = false;
  pgDrawRewards(); pgDrawIcons(); pgModal("pgForm", true);
  api("pIcons").then((r) => { pgIcons = r.icons; pgDrawIcons(); }).catch((e) => { $("pgIcons").innerHTML = '<span class="pg-note"></span>'; $("pgIcons").firstChild.textContent = "Icons could not be loaded: " + e.message; });
}
$("pgNew").addEventListener("click", () => pgOpenForm(null));
$("pgFormEl").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pgSaving) return;
  const err = $("pgfErr"); err.hidden = true;
  const start = new Date($("pgfStart").value).getTime(), end = new Date($("pgfEnd").value).getTime();
  if (!isFinite(start) || !isFinite(end)) { err.textContent = "Please set both dates."; err.hidden = false; return; }
  if (end < start) { err.textContent = "The end must not be before the start."; err.hidden = false; return; }
  pgSaving = true; $("pgfSave").disabled = true;
  try {
    await api("pSave", { id: pgEditId, title: $("pgfTitle").value, icon: pgPick, start, end, description: $("pgfDesc").value, details: $("pgfDetails").value, rewards: pgRew });
    pgModal("pgForm", false); pgRefresh.sig = ""; await pgRefresh(true);
    pgToast(pgEditId ? "Program updated." : "Program set. Everyone was notified.");
  } catch (ex) { err.textContent = ex.message === "outdated" ? "The script needs the latest update." : ex.message; err.hidden = false; }
  pgSaving = false; $("pgfSave").disabled = false;
});


/* ---------- Get Professional Support / Counseling & Therapy ---------- */
let apKind = "counseling", apAll = [], apTab = "current", apSig = "", apPoll = null, apSending = false;
const apStaff = () => pgRole() === "hr" || pgRole() === "admin";
function apSupportEnter() { $("apCardBtn").textContent = apStaff() ? "View requests" : "Request an appointment"; $("apOtherBtn").textContent = apStaff() ? "View requests" : "Request a service"; }
const apGo = (k) => { apKind = k; showView("counseling"); };
$("apCard").addEventListener("click", () => apGo("counseling"));
$("apCard").addEventListener("keydown", (e) => { if (e.key === "Enter") apGo("counseling"); });
$("apOtherCard").addEventListener("click", () => apGo("other"));
$("ohToCounsel").addEventListener("click", () => apGo("counseling"));
$("ohToOther").addEventListener("click", () => apGo("other"));
$("apOtherCard").addEventListener("keydown", (e) => { if (e.key === "Enter") apGo("other"); });
function apEnter() {
  apTab = apStaff() ? "open" : "current"; apSig = "";
  const other = apKind === "other";
  $("apTitle").textContent = $("apSideTitle").textContent = other ? "Other Services" : "Counseling & Therapy";
  $("apResetAll").hidden = pgRole() !== "admin";
  $("apLead").textContent = apStaff() ? "Review requests, reply with the appointment details, and close them when done." : other ? "Tell us what kind of help you need. Someone from HR will review it and reply with the details." : "Share what is on your mind. Someone from HR will review it and reply with your appointment.";
  apTabs(); $("apBody").innerHTML = '<div class="pg-empty">Loading…</div>';
  apRefresh(true);
  if (apPoll) clearInterval(apPoll);
  apPoll = setInterval(() => { if (!document.hidden && $("counseling").classList.contains("active") && $("apModal").hidden && !apTyping()) apRefresh(false); }, 15000);
}
const apTyping = () => { const a = document.activeElement; return a && $("apBody").contains(a) && (a.tagName === "TEXTAREA" || a.tagName === "INPUT"); };
function apTabs() {
  const tabs = apStaff() ? [["open", "Open requests"], ["closed", "Closed"]] : [["current", "My request"], ["history", "History"]];
  const nav = $("apTabs"); nav.innerHTML = "";
  tabs.forEach(([k, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "pg-tab" + (apTab === k ? " active" : "");
    b.innerHTML = "<span></span><b>&rarr;</b>"; b.firstChild.textContent = label;
    b.addEventListener("click", () => { apTab = k; apTabs(); apRender(); });
    nav.appendChild(b);
  });
}
function apRefresh(loud) {
  return api("aList").then((r) => {
    const sig = JSON.stringify(r.list);
    if (sig !== apSig) { apSig = sig; apAll = r.list; apRender(); }
  }).catch((e) => {
    if (!loud) return;
    $("apBody").innerHTML = '<div class="pg-empty"></div>';
    $("apBody").firstChild.textContent = e.message === "outdated" ? "The script needs the latest update." : "Appointments could not be loaded.";
  });
}
function apPill(a) { const s = document.createElement("span"); s.className = "ap-pill" + (a.status === "Scheduled" ? " s" : a.status === "Closed" ? " c" : ""); s.textContent = a.status; return s; }
function apReplyBox(a) {
  const box = document.createElement("div"); box.className = "ap-reply";
  const dl = document.createElement("dl");
  [["From", a.hrName], ["Message", a.message], ["Date", a.when ? pgFmt(a.when) : ""], ["Where", a.location], ["Service provider", a.counselor], ["About the session", a.note]].forEach(([k, v]) => {
    if (!v) return;
    const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; dl.append(dt, dd);
  });
  box.appendChild(dl); return box;
}
const apKindOf = (a) => (a.kind === "other" ? "other" : "counseling");
function apRender() {
  const apList = apAll.filter((a) => apKindOf(a) === apKind);
  const body = $("apBody"); body.innerHTML = "";
  if (apStaff()) {
    const closed = apTab === "closed";
    const list = apList.filter((a) => (a.status === "Closed") === closed).sort((x, y) => (x.status === "Pending" ? 0 : 1) - (y.status === "Pending" ? 0 : 1) || y.created - x.created);
    if (!list.length) { body.innerHTML = '<div class="pg-empty"></div>'; body.firstChild.textContent = closed ? "No closed requests." : "No open requests right now."; return; }
    const wrap = document.createElement("div"); wrap.className = "ap-list";
    list.forEach((a) => {
      const row = document.createElement("button"); row.type = "button"; row.className = "ap-row";
      const m = document.createElement("div"); m.className = "ap-main";
      const n = document.createElement("b"); n.textContent = a.name + (a.service ? "  ·  " + a.service : ""); const sn = document.createElement("span"); sn.className = "ap-snip"; sn.textContent = a.reason;
      m.append(n, sn);
      const t = document.createElement("time"); t.textContent = pgFmt(a.created);
      row.append(m, apPill(a), t); row.addEventListener("click", () => apOpen(a.id)); wrap.appendChild(row);
    });
    body.appendChild(wrap); return;
  }
  // employee
  const open = apList.find((a) => a.status !== "Closed");
  if (apTab === "history") {
    const list = apList.filter((a) => a.status === "Closed");
    if (!list.length) { body.innerHTML = '<div class="pg-empty"></div>'; body.firstChild.textContent = "No past requests yet."; return; }
    const wrap = document.createElement("div"); wrap.className = "ap-list";
    list.forEach((a) => {
      const row = document.createElement("button"); row.type = "button"; row.className = "ap-row";
      const m = document.createElement("div"); m.className = "ap-main";
      const n = document.createElement("b"); n.textContent = (a.service ? a.service + "  ·  " : "Request on ") + pgFmt(a.created); const sn = document.createElement("span"); sn.className = "ap-snip"; sn.textContent = a.reason;
      m.append(n, sn); row.append(m, apPill(a)); row.addEventListener("click", () => apOpen(a.id)); wrap.appendChild(row);
    });
    body.appendChild(wrap); return;
  }
  const panel = document.createElement("div"); panel.className = "ap-panel"; body.appendChild(panel);
  if (!open) {
    const svc = apKind === "other" ? '<label for="apService">Service type</label><input id="apService" maxlength="80" placeholder="What professional help do you need? e.g. financial counseling, legal advice, EAP"><label for="apReason" style="margin-top:1rem">Message</label>' : "";
    panel.innerHTML = '<h3>What would you like to share?</h3><p>Tell us what is going on and what kind of support you are looking for.</p>' + svc + '<textarea id="apReason" maxlength="2000" placeholder="Write here…"></textarea><p class="ap-note" style="margin-top:.6rem">You can send one request at a time. You will be notified when HR replies.</p><p class="ap-err" id="apErr" hidden></p><div class="pg-btns"><button type="button" class="pg-primary" id="apSend">Send request</button></div>';
    $("apSend").addEventListener("click", apSend); return;
  }
  const h = document.createElement("h3"); h.textContent = "Your request"; panel.appendChild(h);
  const pl = document.createElement("p"); pl.appendChild(apPill(open)); const when = document.createElement("span"); when.className = "ap-note"; when.textContent = "  Sent " + pgFmt(open.created); pl.appendChild(when); panel.appendChild(pl);
  if (open.service) { const sv = document.createElement("p"); sv.innerHTML = "<b>Service type:</b> <span></span>"; sv.lastChild.textContent = open.service; panel.appendChild(sv); }
  const rp = document.createElement("p"); rp.style.whiteSpace = "pre-wrap"; rp.style.overflowWrap = "anywhere"; rp.textContent = open.reason; panel.appendChild(rp);
  if (open.status === "Pending") { const w = document.createElement("p"); w.className = "ap-note"; w.textContent = "Waiting for HR to review. You will be notified when they reply. You can send a new request once this one is closed."; panel.appendChild(w); }
  else { const rh = document.createElement("h3"); rh.textContent = open.status === "Scheduled" ? "Your appointment" : "Reply from HR"; rh.style.marginTop = "1rem"; panel.appendChild(rh); panel.appendChild(apReplyBox(open)); const w = document.createElement("p"); w.className = "ap-note"; w.style.marginTop = "0.8rem"; w.textContent = "You can send a new request once HR closes this one."; panel.appendChild(w); }
}
async function apSend() {
  if (apSending) return;
  const v = $("apReason").value.trim(), err = $("apErr"); err.hidden = true;
  if (!v) { err.textContent = "Please write something first."; err.hidden = false; return; }
  apSending = true; $("apSend").disabled = true;
  const svc = $("apService") ? $("apService").value.trim() : "";
  if (apKind === "other" && !svc) { err.textContent = "Please say what kind of help you need."; err.hidden = false; apSending = false; $("apSend").disabled = false; return; }
  try { await api("aRequest", { reason: v, service: svc, kind: apKind }); pgToast("Your request was sent to HR."); apSig = ""; await apRefresh(true); }
  catch (e) { err.textContent = e.message === "open" ? "You already have an open request." : e.message === "outdated" ? "The script needs the latest update." : e.message; err.hidden = false; apRefresh(false); }
  apSending = false; if ($("apSend")) $("apSend").disabled = false;
}
function apOpen(id) {
  const a = apAll.find((x) => x.id === id); if (!a) return;
  const box = $("apModalBox"); box.innerHTML = "";
  const x = document.createElement("button"); x.type = "button"; x.className = "pg-x"; x.innerHTML = "&times;"; x.addEventListener("click", () => { $("apModal").hidden = true; }); box.appendChild(x);
  const h = document.createElement("h3"); h.textContent = apStaff() ? a.name : "Request on " + pgFmt(a.created); box.appendChild(h);
  const sub = document.createElement("p"); sub.className = "pg-when"; sub.appendChild(apPill(a)); const s2 = document.createElement("span"); s2.textContent = "  " + pgFmt(a.created); sub.appendChild(s2); box.appendChild(sub);
  if (a.service) { const hs = document.createElement("h4"); hs.textContent = "Service type"; box.appendChild(hs); const ps = document.createElement("p"); ps.className = "pg-text"; ps.textContent = a.service; box.appendChild(ps); }
  const h4 = document.createElement("h4"); h4.textContent = apStaff() ? "What they shared" : "What you shared"; box.appendChild(h4);
  const p = document.createElement("p"); p.className = "pg-text"; p.textContent = a.reason; box.appendChild(p);
  const hasReply = a.message || a.when || a.location || a.counselor || a.note;
  if (hasReply && !(pgRole() === "hr" && a.status !== "Closed")) { const h5 = document.createElement("h4"); h5.textContent = "Reply and appointment"; box.appendChild(h5); box.appendChild(apReplyBox(a)); }
  const btns = document.createElement("div"); btns.className = "pg-btns";
  if (pgRole() === "hr" && a.status !== "Closed") {
    const f = (id, label, el) => { const l = document.createElement("label"); l.textContent = label; l.htmlFor = id; el.id = id; box.append(l, el); return el; };
    const msg = f("apfMsg", "Short message", Object.assign(document.createElement("textarea"), { maxLength: 600, value: a.message }));
    const two = document.createElement("div"); two.className = "ap-two"; box.appendChild(two);
    const mk = (id, label, el) => { const d = document.createElement("div"); const l = document.createElement("label"); l.textContent = label; l.htmlFor = id; el.id = id; d.append(l, el); two.appendChild(d); return el; };
    const when = mk("apfWhen", "Appointment date and time", Object.assign(document.createElement("input"), { type: "datetime-local", value: a.when ? pgLocal(a.when) : "" }));
    const loc = mk("apfLoc", "Location", Object.assign(document.createElement("input"), { maxLength: 200, value: a.location }));
    const two2 = document.createElement("div"); two2.className = "ap-two"; box.appendChild(two2);
    const mk2 = (id, label, el) => { const d = document.createElement("div"); const l = document.createElement("label"); l.textContent = label; l.htmlFor = id; el.id = id; d.append(l, el); two2.appendChild(d); return el; };
    const cn = mk2("apfName", "Service provider", Object.assign(document.createElement("input"), { maxLength: 120, value: a.counselor }));
    const note = f("apfNote", "Short description for the service provider", Object.assign(document.createElement("textarea"), { maxLength: 600, value: a.note }));
    const err = document.createElement("p"); err.className = "ap-err"; err.hidden = true; box.appendChild(err);
    const save = document.createElement("button"); save.type = "button"; save.className = "pg-primary"; save.textContent = a.status === "Pending" ? "Send reply" : "Update reply";
    save.addEventListener("click", async () => {
      err.hidden = true; save.disabled = true;
      try { await api("aReply", { id: a.id, message: msg.value, when: when.value ? new Date(when.value).getTime() : 0, location: loc.value, counselor: cn.value, note: note.value }); $("apModal").hidden = true; pgToast("Reply sent."); apSig = ""; await apRefresh(true); }
      catch (e) { err.textContent = e.message; err.hidden = false; save.disabled = false; }
    });
    btns.appendChild(save);
  }
  if (apStaff() && a.status !== "Closed") {
    const cl = document.createElement("button"); cl.type = "button"; cl.className = "pg-warn"; cl.textContent = "Close request"; btns.prepend(cl);
    armConfirm(cl, "Close request", "Close it? 2 Mushrooms are sent", async () => {
      try { await api("aClose", { id: a.id }); $("apModal").hidden = true; pgToast("Request closed. Mushrooms sent."); apSig = ""; await apRefresh(true); } catch (e) { pgToast(e.message); }
    });
  }
  if (btns.children.length) box.appendChild(btns);
  $("apModal").hidden = false;
}
$("apModal").addEventListener("click", (e) => { if (e.target === $("apModal")) $("apModal").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("apModal").hidden = true; });
armConfirm($("apResetAll"), "Reset all appointments", "Sure? Deletes all requests", async () => {
  try { await api("aReset"); apSig = ""; await apRefresh(true); pgToast("All appointments were reset."); } catch (e) { pgToast(e.message); }
});

document.querySelectorAll("[data-soon]").forEach((el) => el.addEventListener("click", () => pgToast(el.dataset.soon)));

/* ---------- About: slow scroll-driven transitions ---------- */
(function () {
  var page = $("about"), track = $("abTrack"), stage = $("abStage");
  if (!page || !track) return;
  var logo = document.querySelector(".nav-logo");
  if (logo) [].forEach.call(page.querySelectorAll("[data-lotus]"), function (s) { var c = logo.cloneNode(true); c.removeAttribute("class"); var ids = []; c.outerHTML.replace(/\sid="([^"]+)"/g, function (m, id) { ids.push(id); }); var html = c.outerHTML; ids.forEach(function (id) { html = html.split('id="' + id + '"').join('id="' + id + '-ab"').split("url(#" + id + ")").join("url(#" + id + "-ab)").split('href="#' + id + '"').join('href="#' + id + '-ab"'); }); s.insertAdjacentHTML("beforeend", html); });
  var units = [], dots = $("abDots"), cur = 0, raf = 0, mobile = null;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function fitMobile() {
    if (!mobile) return;
    var st = $("abStage");
    units.forEach(function (u) {
      u.style.removeProperty("--u"); u.style.justifyContent = "flex-start";
      var k = 1;
      while (k > 0.5 && u.scrollHeight > u.clientHeight + 1) { k -= 0.04; u.style.setProperty("--u", "calc(min(1rem, 100vh / 54.05) * " + k.toFixed(2) + ")"); }
      u.style.justifyContent = "";
    });
  }
  function snaps() {
    [].forEach.call(track.querySelectorAll(".ab-snap"), function (n) { n.remove(); });
    if (!mobile) return;
    var max = track.offsetHeight - stage.offsetHeight;
    units.forEach(function (u, i) { var a = document.createElement("i"); a.className = "ab-snap"; a.style.top = Math.round(max * i / (units.length - 1)) + "px"; track.appendChild(a); });
  }
  function collect(force) {
    var m = window.innerWidth <= 820;
    if (m === mobile && !force) return; mobile = m;
    units.forEach(function (u) { u.style.cssText = ""; });
    var sc = [].slice.call(page.querySelectorAll(".ab-screen"));
    units = m ? [sc[0].querySelector(".ab-top"), sc[0].querySelector(".ab-bottom"), sc[1], sc[2], sc[3]] : sc;
    dots.innerHTML = ""; units.forEach(function (u, i) {
      var d = document.createElement("i"); d.addEventListener("click", function () { var max = track.offsetHeight - stage.offsetHeight; page.scrollTo({ top: max * i / (units.length - 1), behavior: "smooth" }); }); dots.appendChild(d); });
    fitMobile(); snaps();
  }
  function target() {
    var max = track.offsetHeight - stage.offsetHeight;
    return max > 0 ? Math.max(0, Math.min(1, page.scrollTop / max)) * (units.length - 1) : 0;
  }
  function ease(t) { return t * t * (3 - 2 * t); }
  function paint() {
    var hold = 0.22;
    units.forEach(function (s, i) {
      var d = cur - i, a = Math.abs(d), t = Math.min(1, Math.max(0, (a - hold) / (1 - hold)));
      var o = 1 - ease(Math.min(1, t * 1.7)), y = (d < 0 ? 1 : -1) * ease(t) * 7;
      s.style.opacity = o.toFixed(3);
      s.style.transform = "translateY(" + y.toFixed(2) + "rem) scale(" + (1 - ease(t) * 0.04).toFixed(3) + ")";
      s.style.visibility = o < 0.01 ? "hidden" : "visible";
      s.style.pointerEvents = a < 0.5 ? "auto" : "none";
      s.classList.toggle("on", a < 0.55);
    });
    var n = Math.round(cur);
    [].forEach.call(dots.children, function (d, i) { d.classList.toggle("on", i === n); });
    $("abHint").style.opacity = cur < 0.15 ? 1 : 0;
  }
  function loop() {
    var t = target();
    cur = reduce ? t : cur + (t - cur) * 0.06;
    if (Math.abs(t - cur) < 0.0005) cur = t;
    paint();
    raf = (cur !== t) ? requestAnimationFrame(loop) : 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  page.addEventListener("scroll", kick, { passive: true });
  window.addEventListener("resize", function () { collect(true); kick(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { collect(true); paint(); });
  window.aboutEnter = function () { collect(true); page.scrollTop = 0; cur = 0; paint(); kick(); };
  (function () {
    var cols = ["#f6b9a0", "#f2cf8d", "#c9c8a0", "#f9d5c3"];
    for (var i = 0; i < 16; i++) {
      var p = document.createElement("i"); p.className = "ab-fl";
      var sz = 0.5 + Math.random() * 1.1;
      p.style.cssText = "left:" + (Math.random() * 100).toFixed(1) + "%;width:" + sz.toFixed(2) + "rem;height:" + (i % 3 ? sz : sz * 1.6).toFixed(2) + "rem;background:" + cols[i % 4] + ";animation-duration:" + (14 + Math.random() * 14).toFixed(1) + "s;animation-delay:-" + (Math.random() * 20).toFixed(1) + "s;border-radius:" + (i % 3 ? "50%" : "60% 0 60% 0") + ";";
      stage.insertBefore(p, stage.children[2]);
    }
  })();
  collect(); paint();
})();


/* ---------- Occupational Health (partner hospitals) + Our Provider Network ---------- */
const nwStaff = () => !!currentUser && (currentUser.role === "hr" || currentUser.role === "admin");
const nwEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NW_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const NW_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="5"/></svg>';
const NW_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const NW_CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
let ohList = [], nwCats = [], nwCur = null, ohOpenId = "", nwOpenId = "";

function nwError(box, e) {
  const msg = e && e.message === "outdated" ? "The script is out of date. Redeploy it as a New version." : e && e.message === "not-connected" ? "Not connected to the sheet yet." : "Couldn't load right now. Please try again.";
  box.innerHTML = '<div class="nw-note">' + nwEsc(msg) + "</div>";
}

/* shared add / edit form: fields = [{id,label,type,max,value,ph}] */
function nwOpenForm(title, fields, save) {
  $("nwFormTitle").textContent = title;
  $("nwFields").innerHTML = fields.map((f) => '<label for="nwf_' + f.id + '">' + nwEsc(f.label) + "</label>" + (f.type === "area"
    ? '<textarea id="nwf_' + f.id + '" rows="3" maxlength="' + f.max + '" placeholder="' + nwEsc(f.ph || "") + '">' + nwEsc(f.value || "") + "</textarea>"
    : '<input id="nwf_' + f.id + '" maxlength="' + f.max + '" value="' + nwEsc(f.value || "") + '" placeholder="' + nwEsc(f.ph || "") + '"' + (f.required ? " required" : "") + ">")).join("");
  $("nwErr").hidden = true; $("nwSave").disabled = false;
  $("nwModal").hidden = false;
  const first = $("nwFields").querySelector("input,textarea"); if (first) setTimeout(() => first.focus(), 50);
  $("nwForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const vals = {}; fields.forEach((f) => { vals[f.id] = $("nwf_" + f.id).value.trim(); });
    $("nwSave").disabled = true;
    try { await save(vals); $("nwModal").hidden = true; }
    catch (e) { $("nwErr").textContent = e && e.message === "outdated" ? "The script is out of date. Redeploy it as a New version." : (e && e.message) || "Couldn't save."; $("nwErr").hidden = false; $("nwSave").disabled = false; }
  };
}
$("nwX").addEventListener("click", () => { $("nwModal").hidden = true; });
$("nwCancel").addEventListener("click", () => { $("nwModal").hidden = true; });
$("nwModal").addEventListener("click", (e) => { if (e.target === $("nwModal")) $("nwModal").hidden = true; });
const nwPartnerFields = (v) => [
  { id: "name", label: "Name", max: 100, required: true, value: v && v.name, ph: "e.g. St. Luke's Medical Center" },
  { id: "description", label: "Description", type: "area", max: 500, value: v && v.description, ph: "What they offer, coverage notes…" },
  { id: "location", label: "Location", max: 250, value: v && v.location, ph: "Address or area" },
];

/* one accordion row; used by hospitals and by partners */
function nwItem(item, openId, onToggle, staffActs) {
  const d = document.createElement("div"); d.className = "nw-item" + (openId === item.id ? " open" : "");
  const head = document.createElement("button"); head.type = "button"; head.className = "nw-head";
  head.innerHTML = '<span class="dot">' + NW_PLUS + '</span><span class="nm">' + nwEsc(item.name) + "</span>" + NW_CHEV;
  head.addEventListener("click", () => onToggle(openId === item.id ? "" : item.id));
  const more = document.createElement("div"); more.className = "nw-more";
  more.innerHTML = "<h4>Description</h4><p>" + (item.description ? nwEsc(item.description) : "—") + "</p><h4>Location</h4><p>" + (item.location ? nwEsc(item.location) : "—") + "</p>";
  if (staffActs && nwStaff()) {
    const acts = document.createElement("div"); acts.className = "nw-acts";
    const ed = document.createElement("button"); ed.type = "button"; ed.textContent = "Edit"; ed.addEventListener("click", staffActs.edit);
    acts.append(ed); more.appendChild(acts);
    const rm = document.createElement("button"); rm.type = "button"; rm.className = "nw-rm"; rm.textContent = "Remove"; rm.title = "Remove";
    armConfirm(rm, "Remove", "Sure?", staffActs.del);
    d.classList.add("staff"); d.append(head, rm, more); return d;
  }
  d.append(head, more); return d;
}

/* ----- Occupational Health ----- */
async function ohEnter() { $("ohResetAll").hidden = pgRole() !== "admin"; ohOpenId = ""; $("ohBody").innerHTML = '<div class="nw-note">Loading…</div>'; await ohRefresh(); }
async function ohRefresh() {
  try { const r = await api("hList"); ohList = r.hospitals || []; ohRender(); } catch (e) { nwError($("ohBody"), e); }
}
function ohRender() {
  const box = $("ohBody"); box.innerHTML = "";
  const bar = document.createElement("div"); bar.className = "nw-bar";
  bar.innerHTML = "<h3>Partner hospitals</h3><span class=\"sp\"></span>";
  if (nwStaff()) {
    const add = document.createElement("button"); add.type = "button"; add.className = "nw-add"; add.textContent = "+ Add hospital";
    add.addEventListener("click", () => nwOpenForm("Add partner hospital", nwPartnerFields(), async (v) => { await api("hSave", v); pgToast("Hospital added"); await ohRefresh(); }));
    bar.appendChild(add);
  }
  box.appendChild(bar);
  if (!ohList.length) { const n = document.createElement("div"); n.className = "nw-note"; n.textContent = nwStaff() ? "No partner hospitals yet. Add the hospitals covered by your HMO." : "No partner hospitals have been added yet."; box.appendChild(n); return; }
  const list = document.createElement("div"); list.className = "nw-list";
  ohList.forEach((h) => list.appendChild(nwItem(h, ohOpenId, (id) => { ohOpenId = id; ohRender(); }, {
    edit: () => nwOpenForm("Edit hospital", nwPartnerFields(h), async (v) => { await api("hSave", Object.assign({ id: h.id }, v)); pgToast("Saved"); await ohRefresh(); }),
    del: async () => { try { await api("hDelete", { id: h.id }); ohOpenId = ""; pgToast("Hospital removed"); await ohRefresh(); } catch (e) { pgToast("Couldn't remove it"); } },
  })));
  box.appendChild(list);
}

/* ----- Our Provider Network ----- */
async function nwEnter() { $("nwResetAll").hidden = pgRole() !== "admin"; nwCur = null; nwOpenId = ""; $("nwBody").innerHTML = '<div class="nw-note">Loading…</div>'; await nwRefresh(); }
async function nwRefresh() {
  try { const r = await api("nList"); nwCats = r.cats || []; if (nwCur && !nwCats.some((c) => c.id === nwCur)) nwCur = null; nwRender(); } catch (e) { nwError($("nwBody"), e); }
}
function nwRender() {
  const box = $("nwBody"); box.innerHTML = "";
  const cat = nwCats.filter((c) => c.id === nwCur)[0];
  $("nwLead").textContent = cat ? "Select a partner to see its description and location." : "Browse our partners by category. Open a category, then select a partner to see its details and location.";
  const bar = document.createElement("div"); bar.className = "nw-bar";
  if (!cat) {
    bar.innerHTML = "<h3>Categories</h3><span class=\"sp\"></span>";
    if (nwStaff()) {
      const add = document.createElement("button"); add.type = "button"; add.className = "nw-add"; add.textContent = "+ Add category";
      add.addEventListener("click", () => nwOpenForm("Add category", [{ id: "name", label: "Category name", max: 80, required: true, ph: "e.g. Dental, Laboratory, Clinics" }], async (v) => { await api("nCat", v); pgToast("Category added"); await nwRefresh(); }));
      bar.appendChild(add);
    }
    box.appendChild(bar);
    if (!nwCats.length) { const n = document.createElement("div"); n.className = "nw-note"; n.textContent = nwStaff() ? "No categories yet. Add a category, then add your partners inside it." : "No provider categories have been added yet."; box.appendChild(n); return; }
    const grid = document.createElement("div"); grid.className = "nw-cats";
    nwCats.forEach((c) => {
      const card = document.createElement("div"); card.className = "nw-cat"; card.tabIndex = 0; card.setAttribute("role", "button");
      card.innerHTML = '<div class="dot">' + NW_FOLDER + "</div><h4>" + nwEsc(c.name) + '</h4><span class="cnt">' + c.providers.length + (c.providers.length === 1 ? " partner" : " partners") + "</span>";
      const open = () => { nwCur = c.id; nwOpenId = ""; nwRender(); };
      card.addEventListener("click", open); card.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
      if (nwStaff()) {
        const acts = document.createElement("div"); acts.className = "nw-acts";
        const ed = document.createElement("button"); ed.type = "button"; ed.textContent = "Rename";
        ed.addEventListener("click", (e) => { e.stopPropagation(); nwOpenForm("Rename category", [{ id: "name", label: "Category name", max: 80, required: true, value: c.name }], async (v) => { await api("nCat", { id: c.id, name: v.name }); pgToast("Saved"); await nwRefresh(); }); });
        const del = document.createElement("button"); del.type = "button"; del.textContent = "Delete";
        del.addEventListener("click", (e) => e.stopPropagation());
        armConfirm(del, "Delete", c.providers.length ? "Delete with partners?" : "Sure?", async () => { try { await api("nCatDelete", { id: c.id }); pgToast("Category removed"); await nwRefresh(); } catch (er) { pgToast("Couldn't remove it"); } });
        acts.append(ed, del); card.appendChild(acts);
      }
      grid.appendChild(card);
    });
    box.appendChild(grid); return;
  }
  const back = document.createElement("button"); back.type = "button"; back.className = "nw-back"; back.textContent = "All categories";
  back.addEventListener("click", () => { nwCur = null; nwOpenId = ""; nwRender(); });
  const t = document.createElement("h3"); t.textContent = cat.name;
  bar.append(back, t, Object.assign(document.createElement("span"), { className: "sp" }));
  if (nwStaff()) {
    const add = document.createElement("button"); add.type = "button"; add.className = "nw-add"; add.textContent = "+ Add partner";
    add.addEventListener("click", () => nwOpenForm("Add partner to " + cat.name, nwPartnerFields(), async (v) => { await api("nProv", Object.assign({ cat: cat.id }, v)); pgToast("Partner added"); await nwRefresh(); }));
    bar.appendChild(add);
  }
  box.appendChild(bar);
  if (!cat.providers.length) { const n = document.createElement("div"); n.className = "nw-note"; n.textContent = nwStaff() ? "No partners in this category yet. Use “+ Add partner”." : "No partners have been added to this category yet."; box.appendChild(n); return; }
  const list = document.createElement("div"); list.className = "nw-list";
  cat.providers.forEach((p) => list.appendChild(nwItem(p, nwOpenId, (id) => { nwOpenId = id; nwRender(); }, {
    edit: () => nwOpenForm("Edit partner", nwPartnerFields(p), async (v) => { await api("nProv", Object.assign({ id: p.id }, v)); pgToast("Saved"); await nwRefresh(); }),
    del: async () => { try { await api("nProvDelete", { id: p.id }); nwOpenId = ""; pgToast("Partner removed"); await nwRefresh(); } catch (e) { pgToast("Couldn't remove it"); } },
  })));
  box.appendChild(list);
}

/* the Occupational Health card on the support page */
$("ohCard").addEventListener("click", () => showView("occhealth"));
$("ohCard").addEventListener("keydown", (e) => { if (e.key === "Enter") showView("occhealth"); });

armConfirm($("ohResetAll"), "Reset all hospitals", "Sure? Deletes all hospitals", async () => {
  try { await api("hReset"); ohList = []; ohOpenId = ""; ohRender(); pgToast("Hospitals reset"); } catch (e) { pgToast("Couldn't reset"); }
});
armConfirm($("nwResetAll"), "Reset provider network", "Sure? Deletes all categories & partners", async () => {
  try { await api("nReset"); nwCats = []; nwCur = null; nwOpenId = ""; nwRender(); pgToast("Provider network reset"); } catch (e) { pgToast("Couldn't reset"); }
});

/* phones: the sidebar title is a dropdown that opens the other options */
document.querySelectorAll("#programs .pg-side, #support .pg-side, #occhealth .pg-side, #network .pg-side, #counseling .pg-side").forEach((side) => {
  const h = side.querySelector("h3");
  if (h) h.addEventListener("click", () => side.classList.toggle("open"));
  side.addEventListener("click", (e) => { if (e.target.closest(".pg-tab")) side.classList.remove("open"); });
});
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
      v.textContent = n.kind === "message" ? "View message" : "View";
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
const parentOf = { sense: "services", nurture: "services", checkin: "services", tracker: "services" };   // which nav link stays highlighted

function showView(name) {
  // employees fill in the Workday Check-In before they get into Mantra Sense
  if (name === "sense" && currentUser && currentUser.role === "employee") {
    if (!checkinDone) name = "checkin";
    else recheckCheckin();                       // data may have been reset since they answered
  }
  if (name === "admin" && !(currentUser && currentUser.role === "admin")) name = "home";
  const target = document.getElementById(name);
  if (!target) return;

  const wasHome = !document.querySelector(".page.active");
  pages.forEach((p) => p.classList.toggle("active", p === target));   // "home" = no page on top
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
  history.replaceState(null, "", "#" + name);
  closeDropdowns();
  if (name === "tracker") trEnter();
}

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
const BACKEND_VERSION = 7;

const adminLink = document.getElementById("adminLink");
const teamBtn   = document.getElementById("teamBtn");
let checkinDone = false;           // the check-in is asked once per login
// true  = TESTING: ask at every login (what you have now)
// false = ask only if today's check-in isn't in the sheet yet (Mon/Wed/Fri slot), e.g. after an Admin reset
const ASK_EVERY_LOGIN = true;

function setupRole() {
  adminLink.hidden = currentUser.role !== "admin";
  teamBtn.hidden = !isStaff();
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
      addNotification({ title: "Support resources", text: "Thanks for asking. Information about available support resources will appear here soon." });
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
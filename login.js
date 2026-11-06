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

function addNotification({ title, text }) {
  notifications.unshift({ title, text, time: new Date(), read: false });
  renderNotifications();
}
window.addNotification = addNotification;

function renderNotifications() {
  notifList.textContent = "";
  notifications.forEach((n) => {
    const li = document.createElement("li");
    const t = document.createElement("span");
    t.className = "n-title";
    t.textContent = n.title;
    const p = document.createElement("span");
    p.className = "n-text";
    p.textContent = n.text;
    const time = document.createElement("span");
    time.className = "n-time";
    time.textContent = n.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    li.append(t, p, time);
    notifList.appendChild(li);
  });
  notifEmpty.classList.toggle("hidden", notifications.length > 0);
  bellBtn.classList.toggle("unread", notifications.some((n) => !n.read));
}

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
const parentOf = { sense: "services", nurture: "services", checkin: "services" };   // which nav link stays highlighted

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
const BACKEND_VERSION = 3;

const adminLink = document.getElementById("adminLink");
const teamBtn   = document.getElementById("teamBtn");
let checkinDone = false;           // the check-in is asked once per login
// true  = TESTING: ask at every login (what you have now)
// false = ask only if today's check-in isn't in the sheet yet (Mon/Wed/Fri slot), e.g. after an Admin reset
const ASK_EVERY_LOGIN = true;

function setupRole() {
  adminLink.hidden = currentUser.role !== "admin";
  teamBtn.hidden = !isStaff();
  if (currentUser.role === "employee") {
    api("sync").catch(() => {});                                        // puts their name on their row in the check-in sheet
    if (!ASK_EVERY_LOGIN) checkinStatus().then((done) => { if (done === true) checkinDone = true; });
    setInterval(recheckCheckin, 60000);                                 // notice an Admin reset while they are logged in
  }
  if (isStaff()) {
    pollNotifications();
    setInterval(pollNotifications, 45000);
  }
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

  // side bar
  tpList.textContent = "";
  team.forEach((p) => {
    const li = document.createElement("li");
    const who = document.createElement("div");
    who.className = "tp-who";
    const name = document.createElement("span");
    name.className = "tp-name";
    name.textContent = p.name;
    if (p.fl === "Concern") {
      const t = document.createElement("span");
      t.className = "tag-concern";
      t.textContent = "Concern";
      name.appendChild(t);
    }
    who.append(avatarFor(p), name);
    li.append(who, chip(p.wl, WL_LABELS), chip(p.rc, RC_LABELS));
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
    else f.textContent = p.fl || "–";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adm-reset";
    btn.textContent = "Reset";
    armConfirm(btn, "Reset", "Sure?", () => resetData(p.username, p.name, btn));
    row.append(n, chip(p.wl, WL_LABELS), chip(p.rc, RC_LABELS), f, btn);
    admRows.appendChild(row);
  });
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

async function resetData(target, label, btn) {
  admMsg.className = "adm-msg";
  admMsg.textContent = "Resetting…";
  if (btn) btn.disabled = true;
  try {
    const r = await api("reset", { target });
    admMsg.textContent = target === "ALL" ? "Reset check-in data for " + r.count + " employees." : "Reset check-in data for " + label + ".";
    await loadTeam();
  } catch (err) {
    console.warn("Reset failed:", err);
    admMsg.className = "adm-msg bad";
    admMsg.textContent = "Couldn't reset. Please try again.";
    if (btn) btn.disabled = false;
  }
}
armConfirm(document.getElementById("admResetAll"), "Reset all employees", "Click again to reset ALL", () => resetData("ALL", "all employees"));
document.getElementById("admRefresh").addEventListener("click", refreshTeam);
adminLink.addEventListener("click", () => refreshTeam());
document.querySelectorAll("[data-view=admin]").forEach((a) => a.addEventListener("click", () => refreshTeam()));

/* ---------- Notifications for Admin / HR (contact requests, concerns) ---------- */
async function pollNotifications() {
  if (!currentUser || !isStaff() || !ICON_API) return;
  const key = "mantraNotifSeen:" + currentUser.username.toLowerCase();
  let since = 0;
  try { since = Number(localStorage.getItem(key)) || 0; } catch (e) {}
  if (!since) since = Date.now() - 24 * 3600 * 1000;               // first time: only the last day
  try {
    const data = await api("notifs", { since });
    (data.items || []).forEach((n) => addNotification({ title: n.title, text: n.text }));
    try { localStorage.setItem(key, String(data.latest || since)); } catch (e) {}
  } catch (err) {
    console.warn("Notifications could not be loaded:", err.message);
  }
}
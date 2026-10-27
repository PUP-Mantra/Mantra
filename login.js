const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const button = document.getElementById("loginBtn");

let busy = false;

function show(text, ok = false) {
  message.textContent = text;
  message.className = ok ? "success" : "";
}

/* =====================================================
   ACCOUNTS: read live from your Google Sheet, every time someone logs in
   column A = name, B = username, C = password
   Works from a local file and from GitHub Pages.
   ===================================================== */
const SHEET_ID = "1i3XUVKENu_1zIk4eJCk3T2K9Y8BAdTyTJwvmey2SlBs";

// false = if the sheet can't be read, login fails with a message (recommended)
// true  = if the sheet can't be read, use the ACCOUNTS list below instead
const ALLOW_OFFLINE_FALLBACK = false;
const ACCOUNTS = [
  { name: "Admin", username: "Admin", password: "1234" },
];

function rowsToAccounts(rows) {
  return rows
    .map((r) => ({
      name: (r[0] || "").trim(),
      username: (r[1] || "").trim(),
      password: (r[2] || "").trim(),
    }))
    // skip empty rows, the "Accounts" title row and the Name/Username/Password header row
    .filter((a) => a.username && a.password && a.username.toLowerCase() !== "username");
}

// returns the list of accounts, or null if the sheet could not be read
function fetchAccounts() {
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
          (r.c || []).map((cell) => (cell && cell.v !== null && cell.v !== undefined ? String(cell.v) : ""))
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

  if (account) {
    busy = true;
    setUser(account.name || account.username);
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
  const layers = [...logo.querySelectorAll("img")];

  const flyers = layers.map((img) => {
    const f = img.cloneNode();
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
const parentOf = { sense: "services", nurture: "services" };   // which nav link stays highlighted

function showView(name) {
  const target = document.getElementById(name);
  if (!target) return;

  pages.forEach((p) => p.classList.toggle("active", p === target));   // "home" = no page on top
  const top = parentOf[name] || name;
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.view === top));
  if (target.classList.contains("page")) target.scrollTop = 0;
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
const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const button = document.getElementById("loginBtn");

// true  = demo mode (works on GitHub Pages, no server needed)
// false = sends the login to a real backend
const DEMO_MODE = true;
const LOGIN_URL = "/api/login";

let busy = false;

function show(text, ok = false) {
  message.textContent = text;
  message.className = ok ? "success" : "";
}

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

  try {
    let ok;

    if (DEMO_MODE) {
      await new Promise((r) => setTimeout(r, 600));
      ok = username === "admin" && password === "1234";
    } else {
      const res = await fetch(LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      ok = res.ok;
    }

    if (ok) {
      busy = true;
      show("Login successful!", true);
      setTimeout(playTransition, 300);
    } else {
      show("Incorrect username or password.");
      button.disabled = false;
    }
  } catch (err) {
    show("Could not reach the server. Please try again.");
    button.disabled = false;
  }
});

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
// 3. when the lotus is formed, it flies to the nav (2.5 s)

/* ---------- helpers ---------- */
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

/* ---------- The transition ---------- */
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

/* ---------- 2. pieces slowly move into the lotus shape (position + rotation only) ---------- */
function rearrange(logo, start, end) {
  const layers = [...logo.querySelectorAll("img")];

  // one "flyer" copy per layer, placed exactly over the big logo (still 50% opacity)
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
  logo.style.visibility = "hidden";               // the flyers replace it

  // lotus in the middle of the screen, centered on the login logo
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

  // 3. once the lotus is formed, fly it to the nav
  Promise.all(slide.map((a) => a.finished)).then(() => fly(flyers, start, end, inPlace));
}

/* ---------- 3. the lotus flies into the nav logo (2.5 s) ---------- */
function fly(flyers, start, end, inPlace) {
  const dash     = document.getElementById("dashboard");
  const navLogo  = document.querySelector(".nav-logo");
  const heroLogo = document.querySelector(".hero-logo");

  // dashboard appears behind the flying pieces
  setTimeout(() => {
    dash.classList.add("show");
    dash.setAttribute("aria-hidden", "false");
  }, 250);

  const arcs   = [-120, 90, -200, 190, -100, 100];     // sideways bend of each flight (px)
  const delays = [0, 120, 240, 360, 480, 600];         // gap between pieces (ms)
  const duration = 1900;                               // last piece: 600 + 1900 = 2500 ms

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
      { duration, delay: delays[i], easing: "cubic-bezier(.45,.05,.25,1)", fill: "both" }
    );
  });

  // when all six have landed, fade in the real logo image and remove the flyers
  Promise.all(flights.map((a) => a.finished)).then(() => {
    navLogo.classList.add("show");
    setTimeout(() => flyers.forEach((f) => f.remove()), 300);
  });

  // second logo fades in on the hero
  setTimeout(() => heroLogo.classList.add("show"), 1100);
}

/* ---------- Navigation: Home / Features / About ---------- */
const navLinks = document.querySelectorAll(".nav-links a");
const views = document.querySelectorAll(".view");
const panel = document.querySelector(".panel");

function showView(name) {
  const target = document.getElementById(name);
  if (!target) return;

  views.forEach((v) => v.classList.toggle("active", v === target));
  navLinks.forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  panel.scrollTop = 0;
  history.replaceState(null, "", "#" + name);
}

navLinks.forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    showView(a.dataset.view);
  });
});
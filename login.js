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

/* ---------- Where each piece ends up in the lotus ----------
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

/* ---------- Transition (logo flight lasts 2.5 s in total) ---------- */
function playTransition() {
  const logo     = document.querySelector(".logo");
  const card     = document.querySelector(".login-card");
  const dash     = document.getElementById("dashboard");
  const navLogo  = document.querySelector(".nav-logo");
  const heroLogo = document.querySelector(".hero-logo");
  const layers   = [...logo.querySelectorAll("img")];

  const start = logo.getBoundingClientRect();     // big logo on screen now
  const end   = navLogo.getBoundingClientRect();  // box of the small lotus logo

  // one "flyer" copy per layer, placed exactly over the big logo
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

  // login card fades away
  card.style.transition = "opacity 0.5s ease, transform 0.5s ease";
  card.style.opacity = "0";
  card.style.transform = "scale(0.96)";
  card.style.pointerEvents = "none";

  // dashboard appears behind the flying pieces
  setTimeout(() => {
    dash.classList.add("show");
    dash.setAttribute("aria-hidden", "false");
  }, 250);

  const arcs   = [-120, 90, -200, 190, -100, 100];     // sideways bend of each flight (px)
  const delays = [0, 120, 240, 360, 480, 600];         // gap between pieces (ms)
  const duration = 1900;                               // last piece: 600 + 1900 = 2500 ms

  const animations = flyers.map((f, i) => {
    const p = PIECES[i];
    const th = (p.rot * Math.PI) / 180;
    const cos = Math.cos(th), sin = Math.sin(th);

    // size and position that put this piece in its lotus spot
    const m  = (end.width * p.A) / start.width;
    const rx = cos * p.ci[0] - sin * p.ci[1];
    const ry = sin * p.ci[0] + cos * p.ci[1];
    const tx = end.left - start.left + end.width * (p.cj[0] - p.A * rx);
    const ty = end.top  - start.top  + end.width * (p.cj[1] - p.A * ry);

    return f.animate(
      [
        { transform: "translate(0px, 0px) rotate(0deg) scale(1)", opacity: 0.5, offset: 0 },
        {
          transform: `translate(${tx * 0.5 + arcs[i]}px, ${ty * 0.5 - Math.abs(arcs[i]) * 0.6}px) rotate(${p.rot * 0.5}deg) scale(${(1 + m) / 2})`,
          opacity: 0.75,
          offset: 0.5,
        },
        { transform: `translate(${tx}px, ${ty}px) rotate(${p.rot}deg) scale(${m})`, opacity: 1, offset: 1 },
      ],
      { duration, delay: delays[i], easing: "cubic-bezier(.45,.05,.25,1)", fill: "both" }
    );
  });

  // when all six have landed, fade in the real logo image and remove the flyers
  Promise.all(animations.map((a) => a.finished)).then(() => {
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
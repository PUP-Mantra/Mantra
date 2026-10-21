const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const button = document.getElementById("loginBtn");

// true  = demo mode (no server, for testing the design only)
// false = sends the login to your real backend
const DEMO_MODE = true;
const LOGIN_URL = "/api/login";          // your backend endpoint
const SUCCESS_REDIRECT = "dashboard.html";

function show(text, ok = false) {
  message.textContent = text;
  message.className = ok ? "success" : "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

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
      await new Promise((r) => setTimeout(r, 600));   // fake delay
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
      show("Login successful!", true);
      setTimeout(() => (window.location.href = SUCCESS_REDIRECT), 600);
    } else {
      show("Incorrect username or password.");
    }
  } catch (err) {
    show("Could not reach the server. Please try again.");
  } finally {
    button.disabled = false;
  }
});
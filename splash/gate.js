// Splash screen and password gate. Shown before the dashboard loads anything.
// The password is checked against a salted SHA-256 hash, so it isn't stored in
// plain text in the code. This is a soft lock for a private league tool, not
// real security: anyone with the source can bypass it.

const SALT = 'wv-gate-v1:';
const HASH = 'bca433af6c0354da52a864efede7f1c02781a322c658b8e00eb11b37a652cbfd';
const KEY = 'gate:unlockedAt';
const REMEMBER_DAYS = 30;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function isUnlocked() {
  const r = await chrome.storage.local.get(KEY);
  const at = r[KEY] || 0;
  return at && Date.now() - at < REMEMBER_DAYS * 86400e3;
}

export async function lock() {
  await chrome.storage.local.remove(KEY);
  location.reload();
}

// Resolves once the visitor is in. Shows the splash if they aren't yet.
export async function gate() {
  if (await isUnlocked()) return;
  document.body.classList.add('gated');
  const el = document.createElement('div');
  el.id = 'gate';
  el.innerHTML = `
    <div class="gate-bg" aria-hidden="true"></div>
    <div class="gate-shade" aria-hidden="true"></div>
    <form class="gate-card" autocomplete="off">
      <img class="gate-mark" src="../icons/icon128.png" alt="">
      <div class="gate-eyebrow">Private preview</div>
      <h1>Casey's Dynasty Dashboard</h1>
      <p class="gate-lede">A scouting file on every manager in the league: graded trades, who's tanking, who wants your players, and what to do this week.</p>
      <p class="gate-note">For league members only. Enter the password from your invite.</p>
      <label class="gate-label" for="gate-pw">League password</label>
      <input id="gate-pw" type="password" required autofocus>
      <div class="gate-err" role="alert"></div>
      <button type="submit">Open the dashboard</button>
      <ul class="gate-points">
        <li>Loads your own team when you're logged in to Sleeper</li>
        <li>Every trade graded, every manager profiled</li>
        <li>Runs in your browser; nothing is shared</li>
      </ul>
    </form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  const input = el.querySelector('#gate-pw');
  const err = el.querySelector('.gate-err');
  setTimeout(() => input.focus(), 50);
  await new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if ((await sha256(SALT + input.value)) === HASH) {
        await chrome.storage.local.set({ [KEY]: Date.now() });
        el.classList.add('open');
        setTimeout(() => { el.remove(); document.body.classList.remove('gated'); }, 700);
        resolve();
      } else {
        err.textContent = 'That password is not right.';
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        input.select();
      }
    });
  });
}

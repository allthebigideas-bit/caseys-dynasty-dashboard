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
      <img class="gate-crest" src="../splash/crest.png" alt="Casey's Dynasty League, fantasy football">
      <h1 class="sr-only">Casey's Dynasty Dashboard</h1>
      <div class="gate-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="16" r="1.2"/></svg>
        <input id="gate-pw" type="password" placeholder="League password" aria-label="League password" required>
        <button type="button" class="gate-eye" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>
      </div>
      <div class="gate-err" role="alert"></div>
      <button type="submit" class="gate-go">Log In</button>
      <p class="gate-hint">Forgot it? Ask the commissioner.</p>
    </form>`;
  document.body.appendChild(el);
  const form = el.querySelector('form');
  const input = el.querySelector('#gate-pw');
  const err = el.querySelector('.gate-err');
  const eye = el.querySelector('.gate-eye');
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.classList.toggle('on', show);
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });
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

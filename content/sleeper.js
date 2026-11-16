// Runs on sleeper.com. Copies your login token (which the Sleeper web app
// keeps in this site's localStorage) into the extension so it can make
// adds for you overnight. Nothing is sent anywhere else.

(function () {
  let last = null;

  function looksLikeJwt(v) {
    return typeof v === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v);
  }

  function findToken() {
    let v = null;
    try {
      v = localStorage.getItem('token');
    } catch {
      return null;
    }
    if (v && v.startsWith('"')) {
      try { v = JSON.parse(v); } catch { /* keep raw */ }
    }
    if (looksLikeJwt(v)) return v;
    // Fallback: any localStorage value that is a JWT.
    try {
      for (let i = 0; i < localStorage.length; i++) {
        let x = localStorage.getItem(localStorage.key(i));
        if (x && x.startsWith('"')) { try { x = JSON.parse(x); } catch { /* ignore */ } }
        if (looksLikeJwt(x)) return x;
      }
    } catch { /* ignore */ }
    return null;
  }

  function check() {
    const t = findToken();
    if (t && t !== last) {
      last = t;
      chrome.runtime.sendMessage({ type: 'sleeperToken', token: t }).catch(() => {});
    }
  }

  check();
  let n = 0;
  const fast = setInterval(() => {
    check();
    if (++n >= 12) {
      clearInterval(fast);
      setInterval(check, 60000);
    }
  }, 5000);
})();

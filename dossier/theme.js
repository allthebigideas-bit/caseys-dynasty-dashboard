// Applies the saved colour theme before the page paints (no flash).
// 'auto' follows the computer's light/dark setting.
try {
  const t = localStorage.getItem('cdd-theme') || 'auto';
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch { /* storage blocked: follow the system */ }

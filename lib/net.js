// Network + parsing helpers shared by the dossier modules.

// fetch that gives up after `timeout` ms. The timeout covers reading the body
// too: `read` gets the response, and what it returns is the result.
export async function timedFetch(url, { timeout = 25000, ...init }, read) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    return await read(await fetch(url, { cache: 'no-store', ...init, signal: ctl.signal }));
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${new URL(url).host} timed out`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url, { timeout = 25000, headers = {}, method = 'GET', body, credentials = 'omit' } = {}) {
  return timedFetch(url, { timeout, headers, method, body, credentials }, async (res) => {
    const text = await res.text();
    if (!res.ok) {
      const e = new Error(`${new URL(url).host} returned HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return text;
  });
}

export async function fetchJSON(url, opts) {
  const t = await fetchText(url, opts);
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`${new URL(url).host} sent something that isn't JSON`);
  }
}

// Run async jobs with at most `n` in flight. Results keep input order;
// a failed job yields {error}.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      try {
        out[k] = await fn(items[k], k);
      } catch (e) {
        out[k] = { error: e.message || String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// RFC-4180-ish CSV parser (quotes, doubled quotes, CRLF). Returns objects.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map((r) => {
    const o = {};
    head.forEach((h, k) => { const v = r[k]; o[h] = v === undefined || v === 'NA' ? '' : v; });
    return o;
  });
}

// Pull a JSON value assigned to `var name = ...;` (object or array literal).
export function extractAssigned(text, name) {
  const at = text.search(new RegExp('\\b' + name + '\\s*=\\s*[\\[{]'));
  if (at < 0) return null;
  const start = text.slice(at).search(/[[{]/) + at;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") { inStr = true; quote = c; }
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Contents of <script ... id="ID" ...>...</script> parsed as JSON.
export function extractScriptJSON(html, id) {
  const re = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1].trim()); } catch { return null; }
}

export const DAY = 86400e3;
export const HOUR = 3600e3;

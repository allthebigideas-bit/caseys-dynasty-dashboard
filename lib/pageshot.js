// Report pages → JPG images → one .zip, with no libraries.
// Each page (a <section class="pr-page">) is drawn by the browser itself: the page's HTML plus the
// dossier's stylesheet (print rules included) go into an SVG <foreignObject>, which is painted onto
// a canvas and saved as JPEG. Images must be inlined as data URLs first or the canvas can't export.

const W = 1056, H = 816; // 11in × 8.5in at 96 dpi: the same landscape-letter page the PDF uses

// All CSS rules from the page's stylesheets, with @media print blocks unwrapped so they apply.
export function collectCss() {
  let out = '';
  const walk = (rules) => {
    for (const r of rules) {
      if (r.type === CSSRule.MEDIA_RULE && /\bprint\b/.test(r.media.mediaText)) walk(r.cssRules);
      else out += `${r.cssText}\n`;
    }
  };
  for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch { /* cross-origin sheet: skip */ } }
  return out;
}

// Only the @media print rules, unwrapped: injected into the page while image pages are built,
// so they're measured with exactly the styles they'll be drawn with.
export function collectPrintCss() {
  let out = '';
  const walk = (rules, inPrint) => {
    for (const r of rules) {
      if (r.type === CSSRule.MEDIA_RULE) { if (/\bprint\b/.test(r.media.mediaText)) walk(r.cssRules, true); }
      else if (inPrint) out += `${r.cssText}\n`;
    }
  };
  for (const ss of document.styleSheets) { try { walk(ss.cssRules, false); } catch { /* cross-origin */ } }
  return out;
}

// Web fonts (Inter from Google Fonts) can't load inside an SVG image, so embed the Latin
// subset as data URLs. Falls back to the system font if they can't be fetched.
let fontCssPromise = null;
export function embeddedFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => /fonts\.googleapis\.com/.test(h));
      let out = '';
      for (const href of links) {
        try {
          const css = await (await fetch(href)).text();
          for (const block of css.match(/@font-face\s*{[^}]*}/g) || []) {
            const range = /unicode-range:\s*([^;]+);/.exec(block);
            if (range && !/U\+0000-00FF/i.test(range[1])) continue; // Latin subset only
            const url = /url\(([^)]+)\)/.exec(block);
            if (!url) continue;
            const data = await toDataUrl(url[1].replace(/["']/g, ''));
            if (data) out += `${block.replace(url[0], `url(${data})`)}\n`;
          }
        } catch { /* system font fallback */ }
      }
      return out;
    })();
  }
  return fontCssPromise;
}

const dataUrlCache = new Map();
async function toDataUrl(url) {
  if (!dataUrlCache.has(url)) {
    dataUrlCache.set(url, (async () => {
      try {
        const res = await fetch(url, { cache: 'force-cache' });
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
      } catch { return null; }
    })());
  }
  return dataUrlCache.get(url);
}

// One page section → JPEG blob.
async function pageToJpeg(section, css, bodyStyle, scale, quality, w = W, h = H) {
  const clone = section.cloneNode(true);
  // Team logos are inlined; any other image (headshots, which the report hides) is dropped.
  for (const im of [...clone.querySelectorAll('img')]) {
    const src = im.getAttribute('src') || '';
    const data = im.classList.contains('tlogo') && /^https?:/.test(src) ? await toDataUrl(src) : null;
    if (data) im.setAttribute('src', data); else im.remove();
  }
  const wrap = document.createElement('div');
  wrap.id = 'print';
  wrap.setAttribute('style', `display:block;width:${w}px;height:${h}px;overflow:hidden;${bodyStyle}`);
  const st = document.createElement('style');
  st.textContent = css;
  wrap.appendChild(st);
  wrap.appendChild(clone);
  const xhtml = new XMLSerializer().serializeToString(wrap);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0b0a1f';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  return new Promise((ok, bad) => cv.toBlob((b) => (b ? ok(b) : bad(new Error('Could not encode the page as JPEG'))), 'image/jpeg', quality));
}

// ---- zip (stored, no compression: JPEGs are already compressed) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export async function makeZip(files) { // files: [{ name, blob }]
  const enc = new TextEncoder();
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + (p.byteLength != null ? p.byteLength : p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// Render every page in `host` and download them as one zip.
// names(section, index) → file name without extension. onProgress(done, total).
// opts.selector picks the pages; opts.sizeOf(section) → { w, h } for pages that aren't letter-size.
export async function downloadPagesAsZip(host, zipName, names, { scale = 2, quality = 0.92, onProgress, selector = 'section.pr-page', sizeOf = null } = {}) {
  const css = (await embeddedFontCss()) + collectCss();
  const bs = getComputedStyle(document.body);
  const bodyStyle = `font-family:${bs.fontFamily};font-size:${bs.fontSize};line-height:${bs.lineHeight};color:${bs.color};`.replace(/"/g, "'");
  const pages = [...host.querySelectorAll(selector)];
  const sizes = pages.map((p) => (sizeOf ? sizeOf(p) : { w: W, h: H })); // measure before cloning
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(i, pages.length);
    const { w, h } = sizes[i];
    // Keep long images inside the browser's canvas limits (32k px a side, ~250M px area).
    const sc = Math.max(1, Math.min(scale, 30000 / h, 30000 / w, Math.sqrt(2e8 / (w * h))));
    files.push({ name: `${names(pages[i], i)}.jpg`, blob: await pageToJpeg(pages[i], css, bodyStyle, sc, quality, w, h) });
  }
  if (onProgress) onProgress(pages.length, pages.length);
  const zip = await makeZip(files);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
  return files.length;
}

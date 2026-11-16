// Shareable PNG posters (Trade summary, Season table), drawn on a canvas with
// the league art: winners across the top, the crest, a gold title ribbon, award
// ribbons, the table, and the slumped players along the bottom.

const BASE_W = 1800;
const PAD = 56;
const GOLD = '#f2b632', GOLD2 = '#ffd768', INK = '#1b1030';
const TEXT = '#fbf6ff', MUTED = '#c4b3e6', FAINT = '#8f7bb6';
const GOOD = '#5fe39a', BAD = '#ff8a8a';
const FONT = '"Inter", system-ui, sans-serif';

const loadImg = (src) => new Promise((res) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

// Avatars come from Sleeper's CDN; fetch them as blobs so the canvas stays exportable.
async function loadRemote(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch { return null; }
}

function font(px, weight = 600) { return `${weight} ${px}px ${FONT}`; }

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw `img` cropped like CSS background-size: cover + position (px, py in 0..1).
function cover(ctx, img, x, y, w, h, px = 0.5, py = 0.5, zoom = 1) {
  if (!img) return;
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const sw = w / s, sh = h / s;
  const sx = (img.width - sw) * px, sy = (img.height - sh) * py;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function goldGrad(ctx, y, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, GOLD2); g.addColorStop(0.55, GOLD); g.addColorStop(1, '#cf8c17');
  return g;
}

// Gold banner ribbon with swallowtail ends and folds, centred on cx.
function ribbon(ctx, cx, y, text, { size = 40, padX = 46 } = {}) {
  ctx.font = font(size, 900);
  const tw = ctx.measureText(text).width;
  const h = size * 1.7, w = tw + padX * 2, x = cx - w / 2;
  const tail = h * 0.75, drop = h * 0.32;
  // tails
  ctx.fillStyle = '#b97a12';
  for (const side of [-1, 1]) {
    const ex = side < 0 ? x : x + w;
    ctx.beginPath();
    ctx.moveTo(ex - side * 18, y + drop);
    ctx.lineTo(ex + side * tail, y + drop);
    ctx.lineTo(ex + side * (tail - h * 0.32), y + drop + h / 2);
    ctx.lineTo(ex + side * tail, y + drop + h);
    ctx.lineTo(ex - side * 18, y + drop + h);
    ctx.closePath(); ctx.fill();
    // fold shadow
    ctx.fillStyle = '#6e4508';
    ctx.beginPath();
    ctx.moveTo(ex, y + h); ctx.lineTo(ex - side * 18, y + drop + h); ctx.lineTo(ex, y + drop + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b97a12';
  }
  // band
  ctx.fillStyle = goldGrad(ctx, y, h);
  rr(ctx, x, y, w, h, 6); ctx.fill();
  ctx.strokeStyle = '#5a1fb8'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + w - 4, y + 4); ctx.moveTo(x + 4, y + h - 4); ctx.lineTo(x + w - 4, y + h - 4); ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y + h / 2 + 2);
  return y + h + drop;
}

function initials(s) { return String(s || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }

function avatar(ctx, img, name, x, y, d) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = '#3a1a6e'; ctx.fill(); ctx.clip();
  if (img) ctx.drawImage(img, x, y, d, d);
  else { ctx.fillStyle = TEXT; ctx.font = font(d * 0.38, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(initials(name), x + d / 2, y + d / 2 + 1); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,215,104,.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.stroke();
}

function fitText(ctx, text, maxW) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Award card: small ribbon label, avatar, name, stat.
function award(ctx, x, y, w, a, img) {
  const h = 128;
  ctx.fillStyle = a.gloom ? 'rgba(40,12,60,.82)' : 'rgba(30,10,64,.82)';
  rr(ctx, x, y, w, h, 16); ctx.fill();
  ctx.strokeStyle = a.gloom ? 'rgba(255,138,138,.45)' : 'rgba(255,215,104,.55)'; ctx.lineWidth = 2; rr(ctx, x, y, w, h, 16); ctx.stroke();
  // label tab
  ctx.font = font(15, 800);
  const lab = a.label.toUpperCase();
  const lw = ctx.measureText(lab).width + 34;
  ctx.fillStyle = a.gloom ? '#d65a5a' : goldGrad(ctx, y - 14, 30);
  ctx.beginPath(); ctx.moveTo(x + 22, y - 14); ctx.lineTo(x + 22 + lw, y - 14); ctx.lineTo(x + 22 + lw - 10, y + 1); ctx.lineTo(x + 22 + lw, y + 16); ctx.lineTo(x + 22, y + 16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = a.gloom ? '#fff' : INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(lab, x + 36, y + 2);
  avatar(ctx, img, a.name, x + 22, y + 34, 70);
  ctx.fillStyle = TEXT; ctx.font = font(26, 800);
  ctx.fillText(fitText(ctx, a.name, w - 130), x + 108, y + 58);
  ctx.fillStyle = a.gloom ? BAD : GOLD2; ctx.font = font(21, 700);
  ctx.fillText(fitText(ctx, a.stat, w - 130), x + 108, y + 92);
}

/**
 * spec = {
 *   file, title, eyebrow, subtitle,
 *   awards: [{ label, name, stat, avatar, gloom }],
 *   groups: [{ label, cols: [{ label, sub, w, align, key, hero }] }],   // first group should hold rank + name
 *   rows: [{ name, sub, avatar, isMe, cutAfter, cells: { key: { text, color, bold, bar } } }],
 *   notes: [string], footLabel
 * }
 */
export async function drawPoster(spec) {
  const W = spec.width || BASE_W;
  try { await Promise.all([document.fonts.load(font(20, 600)), document.fonts.load(font(20, 800)), document.fonts.load(font(20, 900))]); } catch { /* system font */ }
  const [hero, bg, crest] = await Promise.all([loadImg('../splash/hero.jpg'), loadImg('../splash/background.jpg'), loadImg('../splash/crest.png')]);
  const avs = await Promise.all(spec.rows.map((r) => loadRemote(r.avatar)));
  const awardAvs = await Promise.all((spec.awards || []).map((a) => loadRemote(a.avatar)));

  const ROW = 70, HEAD1 = 40, HEAD2 = 62;
  const HEADER = 430, AWARDS = (spec.awards || []).length ? 190 : 0;
  const tableH = HEAD1 + HEAD2 + spec.rows.length * ROW + 24;
  const notesH = 40 + (spec.notes || []).length * 30;
  const FOOT = 250;
  const H = HEADER + AWARDS + tableH + notesH + FOOT;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // backdrop: deep purple with the wide art faded in at the sides
  ctx.fillStyle = '#14072a'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.28; cover(ctx, bg, 0, HEADER - 40, W, H - HEADER - FOOT + 80, 0.5, 0.35); ctx.globalAlpha = 1;
  const mid = ctx.createLinearGradient(0, 0, W, 0);
  mid.addColorStop(0, 'rgba(20,7,42,.35)'); mid.addColorStop(0.2, 'rgba(20,7,42,.9)'); mid.addColorStop(0.8, 'rgba(20,7,42,.9)'); mid.addColorStop(1, 'rgba(20,7,42,.35)');
  ctx.fillStyle = mid; ctx.fillRect(0, HEADER - 40, W, H - HEADER - FOOT + 80);

  // header art: the celebrating players
  cover(ctx, hero, 0, 0, W, HEADER, 0.0, 0.12, 1.0);
  const hg = ctx.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, 'rgba(20,7,42,.05)'); hg.addColorStop(0.42, 'rgba(20,7,42,.45)'); hg.addColorStop(0.62, 'rgba(20,7,42,.92)'); hg.addColorStop(1, 'rgba(20,7,42,.98)');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, HEADER);
  const hb = ctx.createLinearGradient(0, HEADER - 140, 0, HEADER);
  hb.addColorStop(0, 'rgba(20,7,42,0)'); hb.addColorStop(1, 'rgba(20,7,42,1)');
  ctx.fillStyle = hb; ctx.fillRect(0, HEADER - 140, W, 140);

  // crest + title block on the right
  const cx = W - 470;
  if (crest) { const cw = 230, ch = cw * crest.height / crest.width; ctx.drawImage(crest, cx - cw / 2, 26, cw, ch); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = GOLD2; ctx.font = font(18, 800);
  ctx.fillText(spec.eyebrow.toUpperCase().split('').join(' '), cx, 262);
  ribbon(ctx, cx, 278, spec.title.toUpperCase(), { size: 40 });
  ctx.fillStyle = MUTED; ctx.font = font(19, 500); ctx.textAlign = 'center';
  ctx.fillText(spec.subtitle, cx, 404);

  // awards row
  let y = HEADER + 10;
  if (AWARDS) {
    const n = spec.awards.length, gap = 24, aw = (W - PAD * 2 - gap * (n - 1)) / n;
    spec.awards.forEach((a, i) => award(ctx, PAD + i * (aw + gap), y + 26, aw, a, awardAvs[i]));
    y += AWARDS;
  }

  // table panel
  const tx = PAD, tw = W - PAD * 2;
  ctx.fillStyle = 'rgba(29,13,61,.92)'; rr(ctx, tx, y, tw, tableH, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(242,182,50,.45)'; ctx.lineWidth = 2; rr(ctx, tx, y, tw, tableH, 18); ctx.stroke();

  // column geometry: widths are weights; name column takes what's left
  const cols = spec.groups.flatMap((g) => g.cols.map((col) => ({ ...col, group: g })));
  const fixed = cols.reduce((s, col) => s + (col.w || 0), 0);
  const flexW = tw - 36 - fixed;
  let cxp = tx + 18;
  for (const col of cols) { col.x = cxp; col.width = col.w || flexW; cxp += col.width; }

  // group header row
  let gy = y + 12;
  for (const g of spec.groups) {
    const gc = cols.filter((col) => col.group === g);
    if (!g.label) continue;
    const gx = gc[0].x + 6, gw = gc.reduce((s, col) => s + col.width, 0) - 12;
    ctx.fillStyle = g.hero ? 'rgba(242,182,50,.18)' : 'rgba(157,77,255,.18)';
    rr(ctx, gx, gy, gw, 30, 8); ctx.fill();
    ctx.fillStyle = g.hero ? GOLD2 : '#d9c2ff'; ctx.font = font(14, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.label.toUpperCase().split('').join(' '), gx + gw / 2, gy + 15);
  }
  // column header row (label + small sub-label)
  const hy = y + HEAD1 + 8;
  for (const col of cols) {
    const al = col.align || 'right';
    const x = al === 'right' ? col.x + col.width - 10 : al === 'center' ? col.x + col.width / 2 : col.x + 10;
    ctx.textAlign = al; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = col.hero ? GOLD2 : TEXT; ctx.font = font(col.hero ? 17 : 16, 800);
    ctx.fillText(col.label, x, hy + 22);
    if (col.sub) { ctx.fillStyle = FAINT; ctx.font = font(13, 600); ctx.fillText(col.sub, x, hy + 42); }
  }
  ctx.strokeStyle = 'rgba(242,182,50,.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(tx + 18, y + HEAD1 + HEAD2 + 4); ctx.lineTo(tx + tw - 18, y + HEAD1 + HEAD2 + 4); ctx.stroke();

  // highlight the hero columns
  for (const col of cols.filter((x) => x.hero)) {
    ctx.fillStyle = 'rgba(242,182,50,.07)';
    ctx.fillRect(col.x + 4, y + HEAD1 + 6, col.width - 8, HEAD2 + spec.rows.length * ROW);
  }

  // rows
  let ry = y + HEAD1 + HEAD2 + 8;
  spec.rows.forEach((r, i) => {
    if (i % 2 === 1) { ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(tx + 18, ry, tw - 36, ROW); }
    if (r.isMe) {
      ctx.fillStyle = 'rgba(242,182,50,.10)'; ctx.fillRect(tx + 18, ry, tw - 36, ROW);
      ctx.fillStyle = GOLD; ctx.fillRect(tx + 18, ry + 6, 5, ROW - 12);
    }
    for (const col of cols) {
      const al = col.align || 'right';
      const mid = ry + ROW / 2;
      if (col.key === '#') {
        const rank = r.rank ?? i + 1, d = 40, bx = col.x + col.width / 2 - d / 2;
        ctx.beginPath(); ctx.arc(bx + d / 2, mid, d / 2, 0, Math.PI * 2);
        ctx.fillStyle = rank <= 3 ? goldGrad(ctx, mid - d / 2, d) : 'rgba(157,77,255,.25)'; ctx.fill();
        ctx.fillStyle = rank <= 3 ? INK : TEXT; ctx.font = font(18, 900); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(rank), bx + d / 2, mid + 1);
        continue;
      }
      if (col.key === 'name') {
        avatar(ctx, avs[i], r.name, col.x + 8, mid - 24, 48);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = TEXT; ctx.font = font(21, 800);
        ctx.fillText(fitText(ctx, r.name, col.width - 80), col.x + 70, r.sub ? mid - 2 : mid + 8);
        if (r.sub) { ctx.fillStyle = FAINT; ctx.font = font(14, 600); ctx.fillText(fitText(ctx, r.sub, col.width - 80), col.x + 70, mid + 20); }
        continue;
      }
      const cell = r.cells[col.key];
      if (!cell) continue;
      if (cell.wl !== undefined) {
        // one week's result: solid for played, faded with the win chance for projected
        const bw = col.width - 6, bh = ROW - 12, bx = col.x + 3, by = ry + 6;
        const win = cell.wl === 'W', loss = cell.wl === 'L';
        if (win || loss || cell.wl === 'T') {
          ctx.fillStyle = win ? (cell.proj ? 'rgba(47,198,107,.16)' : 'rgba(47,198,107,.55)') : loss ? (cell.proj ? 'rgba(240,90,90,.14)' : 'rgba(240,90,90,.5)') : 'rgba(200,200,200,.25)';
          rr(ctx, bx, by, bw, bh, 5); ctx.fill();
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = cell.proj ? 'rgba(251,246,255,.55)' : '#fff'; ctx.font = font(cell.proj ? 15 : 18, 800);
        ctx.fillText(cell.wl || '·', bx + bw / 2, cell.proj && cell.p != null ? mid - 8 : mid + 1);
        if (cell.proj && cell.p != null) { ctx.fillStyle = 'rgba(251,246,255,.6)'; ctx.font = font(12, 700); ctx.fillText(String(cell.p), bx + bw / 2, mid + 12); }
        continue;
      }
      if (cell.bar != null) {
        const bw = col.width - 92, bx = col.x + 10, by = mid + 4;
        ctx.fillStyle = 'rgba(255,255,255,.1)'; rr(ctx, bx, by, bw, 8, 4); ctx.fill();
        if (cell.bar > 0.005) { ctx.fillStyle = cell.color || GOLD; rr(ctx, bx, by, Math.max(8, bw * Math.min(1, cell.bar)), 8, 4); ctx.fill(); }
        ctx.fillStyle = TEXT; ctx.font = font(18, 800); ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(cell.text, col.x + col.width - 10, mid + 12);
        continue;
      }
      const x = al === 'right' ? col.x + col.width - 10 : al === 'center' ? col.x + col.width / 2 : col.x + 10;
      ctx.textAlign = al; ctx.textBaseline = 'middle';
      ctx.fillStyle = cell.color || TEXT; ctx.font = font(col.hero ? 22 : 19, cell.bold || col.hero ? 800 : 600);
      ctx.fillText(cell.text, x, cell.sub ? mid - 9 : mid + 1);
      if (cell.sub) { ctx.fillStyle = cell.subColor || FAINT; ctx.font = font(14, 700); ctx.fillText(cell.sub, x, mid + 14); }
    }
    ry += ROW;
    if (r.cutAfter) {
      ctx.setLineDash([10, 8]); ctx.strokeStyle = GOLD; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx + 18, ry); ctx.lineTo(tx + tw - 18, ry); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = font(12, 900); const lab = 'PLAYOFF LINE'; const lw = ctx.measureText(lab).width + 20;
      ctx.fillStyle = GOLD; rr(ctx, tx + tw - 40 - lw, ry - 11, lw, 22, 11); ctx.fill();
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(lab, tx + tw - 40 - lw / 2, ry + 1);
    }
  });

  // notes
  let ny = y + tableH + 34;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = font(16, 500); ctx.fillStyle = MUTED;
  for (const n of spec.notes || []) { ctx.fillText(n, PAD + 6, ny); ny += 30; }

  // footer: the slumped players, faded up into the page
  const fy = H - FOOT;
  cover(ctx, bg, 0, fy, W, FOOT, 1, 0.9, 1);
  const fg = ctx.createLinearGradient(0, fy, 0, H);
  fg.addColorStop(0, 'rgba(20,7,42,1)'); fg.addColorStop(0.3, 'rgba(20,7,42,.35)'); fg.addColorStop(1, 'rgba(20,7,42,.05)');
  ctx.fillStyle = fg; ctx.fillRect(0, fy, W, FOOT);
  const fl = ctx.createLinearGradient(0, 0, W, 0);
  fl.addColorStop(0, 'rgba(20,7,42,.9)'); fl.addColorStop(0.42, 'rgba(20,7,42,.35)'); fl.addColorStop(1, 'rgba(20,7,42,0)');
  ctx.fillStyle = fl; ctx.fillRect(0, fy, W, FOOT);
  if (spec.footLabel) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = BAD; ctx.font = font(15, 800); ctx.fillText(spec.footLabel.title.toUpperCase().split('').join(' '), PAD, H - 120);
    ctx.fillStyle = TEXT; ctx.font = font(30, 800); ctx.fillText(spec.footLabel.text, PAD, H - 82);
  }
  ctx.fillStyle = FAINT; ctx.font = font(15, 600); ctx.textAlign = 'left';
  ctx.fillText(`Casey's Dynasty Dashboard · ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`, PAD, H - 34);

  return c;
}

export async function downloadPoster(spec) {
  const c = await drawPoster(spec);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = spec.file || 'caseys-dynasty.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return c;
}

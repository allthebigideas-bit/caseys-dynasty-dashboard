// Game day page: a Yahoo-style head-to-head scoreboard. Gets a built matchup
// (buildGameDay in lib/gameday.js) and returns HTML; dossier.js fetches, polls
// and wires the buttons (data-action gdWeek, gdRefresh, gdPick).

const f2 = (x) => (x == null ? '–' : Number(x).toFixed(2));

export function gameDayHtml(v, h) {
  const { esc, headshot } = h;
  const { gd, week, span, A, B, strip, updated, live, error, busy, canPrev, canNext } = v;

  const top = `<div class="gd-bar-top">
      <div class="gd-weeknav">
        <button class="iconbtn" data-action="gdWeek" data-d="-1" ${canPrev ? '' : 'disabled'} aria-label="Previous week">‹</button>
        <span>Week ${week}${span ? `: ${esc(span)}` : ''}</span>
        <button class="iconbtn" data-action="gdWeek" data-d="1" ${canNext ? '' : 'disabled'} aria-label="Next week">›</button>
      </div>
      <div class="gd-upd">${live ? '<span class="gd-dot"></span>Live · ' : ''}${busy ? 'Updating…' : updated ? `Updated ${esc(updated)}` : ''}${live ? ' · refreshes every 30 s' : ''}
        <button class="btn" data-action="gdRefresh" ${busy ? 'disabled' : ''}>Refresh</button></div>
    </div>${error ? `<div class="notice">${esc(error)}</div>` : ''}`;

  if (!gd) {
    return `<div class="gd">${top}<div class="card"><p class="muted">No matchup for this team in week ${week}${busy ? ' yet. Loading…' : '.'}</p></div>${stripHtml(strip, esc)}</div>`;
  }
  const { a, b, winA } = gd;
  const fav = winA == null ? null : winA >= 0.5;
  const sideHead = (t, s, right) => `<div class="gd-team ${right ? 'r' : 'l'}">
      ${right ? t.avatar : ''}
      <div class="gd-tn"><a href="#manager/${s.rid}">${esc(t.name)}</a>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}<span>${esc(t.record)}</span></div>
      ${right ? '' : t.avatar}
    </div>`;
  const lp = (s) => `<span class="${s.liveProj >= s.origProj ? 'gd-up' : 'gd-down'}">${f2(s.liveProj)}</span>`;
  const head = `<div class="card gd-head">
      ${sideHead(A, a, false)}
      <div class="gd-score">
        <div class="gd-big"><span class="${b && a.points > b.points ? 'lead' : ''}">${f2(a.points)}</span><i>vs.</i><span class="${b && b.points > a.points ? 'lead' : ''}">${b ? f2(b.points) : '–'}</span></div>
        <div class="gd-proj"><span>${f2(a.origProj)}</span><i>Orig proj</i><span>${b ? f2(b.origProj) : '–'}</span></div>
        <div class="gd-proj"><span>${lp(a)}</span><i>Proj pts</i><span>${b ? lp(b) : '–'}</span></div>
      </div>
      ${b ? sideHead(B, b, true) : '<div class="gd-team r muted">No opponent</div>'}
      <div class="gd-odds">
        <span class="gd-left">${a.left} player${a.left === 1 ? '' : 's'} remaining</span>
        ${winA == null ? '<span></span>' : `<span class="gd-wp"><b>${fav ? 'Favorite' : 'Underdog'} ${Math.round(winA * 100)}%</b><span class="muted">${winA === 1 || winA === 0 ? 'Winner' : 'Projected winner'}</span><b>${Math.round((1 - winA) * 100)}% ${fav ? 'Underdog' : 'Favorite'}</b></span>`}
        <span class="gd-left r">${b ? `Players remaining ${b.left}` : ''}</span>
        ${winA == null ? '' : `<div class="gd-meter" role="img" aria-label="Win chance ${Math.round(winA * 100)} to ${Math.round((1 - winA) * 100)}"><span class="gd-m-a ${fav ? 'fav' : ''}" style="width:${(winA * 100).toFixed(1)}%"></span><span class="gd-m-b ${fav ? '' : 'fav'}" style="width:${((1 - winA) * 100).toFixed(1)}%"></span></div>`}
      </div>
    </div>`;

  const hdr = `<tr>
      <th class="gd-stat">Stats</th><th>Player</th><th class="num gd-x">ECR</th><th class="num gd-x">FP Proj</th><th class="num">Proj</th><th class="num">Fan Pts</th>
      <th class="gd-pos">Pos</th>
      <th class="num">Fan Pts</th><th class="num">Proj</th><th class="num gd-x">FP Proj</th><th class="num gd-x">ECR</th><th>Player</th><th class="gd-stat">Stats</th></tr>`;

  const player = (r) => {
    if (!r) return '';
    if (!r.sid) return '<span class="muted">Empty</span>';
    const inj = r.inj ? ` <span class="gd-inj" title="${esc(r.inj)}">${esc(r.inj === 'Questionable' ? 'Q' : r.inj === 'Doubtful' ? 'D' : r.inj === 'Out' ? 'O' : r.inj === 'IR' ? 'IR' : r.inj[0])}</span>` : '';
    return `<div class="gd-who">${headshot(r.sid)}<div><div><button class="link" data-action="player" data-sid="${esc(r.sid)}" title="${esc(r.name)}">${esc(shortName(r.name, r.pos))}</button> <span class="gd-tp">${esc(r.team)} - ${esc(r.pos)}</span>${inj}</div><div class="gd-g ${r.state}">${esc(r.game)}</div></div></div>`;
  };
  const projCell = (r) => {
    if (!r || !r.sid) return '';
    const showLive = r.state === 'live' || r.state === 'final';
    const cls = r.liveProj > r.proj + 0.05 ? 'gd-up' : r.liveProj < r.proj - 0.05 ? 'gd-down' : '';
    return `${f2(r.proj)}${showLive ? `<div class="gd-lp ${cls}">${f2(r.liveProj)}</div>` : ''}`;
  };
  const ptsCell = (r) => (!r || !r.sid ? '' : r.state === 'pre' || r.state === 'bye' ? (r.pts ? f2(r.pts) : '–') : f2(r.pts || 0));
  const cells = (r, right) => {
    const lv = r && r.state === 'live' ? ' lv' : '';
    const c = [
      `<td class="gd-stat${lv}">${r && r.line ? esc(r.line) : ''}</td>`,
      `<td class="gd-pl${lv}">${player(r)}</td>`,
      `<td class="num gd-x gd-dim${lv}">${r && r.posRank ? esc(r.posRank) : r && r.sid ? '–' : ''}</td>`,
      `<td class="num gd-x gd-dim${lv}">${r && r.fpProj != null ? f2(r.fpProj) : r && r.sid ? '–' : ''}</td>`,
      `<td class="num gd-pj${lv}">${projCell(r)}</td>`,
      `<td class="num gd-pts${lv}">${ptsCell(r)}</td>`,
    ];
    return (right ? c.reverse() : c).join('');
  };
  const rows = (la, lb, slotOf) => la.map((x, i) => {
    const y = lb ? lb[i] : null;
    return `<tr>${cells(x, false)}<td class="gd-pos"><span class="pos">${esc(slotOf(x, y))}</span></td>${cells(y, true)}</tr>`;
  }).join('');
  const startRows = rows(a.starters, b && b.starters, (x) => slotName(x.slot));
  const total = `<tr class="gd-total"><td class="gd-stat"></td><td></td><td class="gd-x"></td><td class="gd-x"></td>
      <td class="num">${f2(a.origProj)}</td><td class="num"><b>${f2(a.points)}</b></td><td class="gd-pos">Total</td>
      <td class="num"><b>${b ? f2(b.points) : ''}</b></td><td class="num">${b ? f2(b.origProj) : ''}</td><td class="gd-x"></td><td class="gd-x"></td><td></td><td class="gd-stat"></td></tr>`;
  const n = Math.max(a.bench.length, b ? b.bench.length : 0);
  const pad = (arr) => Array.from({ length: n }, (_, i) => arr[i] || null);
  const benchRows = n ? rows(pad(a.bench), b ? pad(b.bench) : null, () => 'BN') : '';

  const table = `<div class="card gd-tcard"><div class="scroll"><table class="gd-t">
      <thead>${hdr}</thead><tbody>${startRows}${total}</tbody>
      ${benchRows ? `<tbody class="gd-bench"><tr class="gd-sub"><td colspan="13">Bench</td></tr>${benchRows}</tbody>` : ''}
    </table></div>
    <p class="muted small gd-foot">Fan Pts are Sleeper's, scored with your league's settings. Proj is Sleeper's projection scored the same way; the figure under it is the live projection: points so far plus the rest of the projection for the time left in the game. ECR and FP Proj are FantasyPros' weekly consensus. Green rows are in games being played now.</p></div>`;

  return `<div class="gd">${top}${head}${table}${stripHtml(strip, esc)}</div>`;
}

// Yahoo-style "J. Williams"; "C.J. Stroud" and team defences stay as they are.
function shortName(name, pos) {
  const w = String(name || '').split(' ');
  if (pos === 'DEF' || w.length < 2 || /\./.test(w[0])) return name;
  return `${w[0][0]}. ${w.slice(1).join(' ')}`;
}

function slotName(s) {
  return { SUPER_FLEX: 'SF', FLEX: 'W/R/T', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', IDP_FLEX: 'IDP' }[s] || s;
}

function stripHtml(strip, esc) {
  if (!strip || !strip.length) return '';
  return `<div class="card gd-strip"><h3>Around the league</h3><div class="gd-games">${strip.map((p) => `
      <button class="gd-game ${p.on ? 'on' : ''}" data-action="gdPick" data-rid="${p.a.rid}">
        <span class="${p.a.pts > p.b.pts ? 'lead' : ''}"><em>${esc(p.a.name)}</em><b>${f2(p.a.pts)}</b></span>
        <span class="${p.b.pts > p.a.pts ? 'lead' : ''}"><em>${esc(p.b.name)}</em><b>${f2(p.b.pts)}</b></span>
      </button>`).join('')}</div></div>`;
}

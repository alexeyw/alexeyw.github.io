(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const D = JSON.parse($('#dossier-data').textContent);
const T = D.t, RECORDS = D.records, N = RECORDS.length;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const paper = matchMedia('(prefers-color-scheme: light)');

/* ---------- derived model ---------- */
const YEAR0 = 2002, YEAR1 = 2027.2, NOW_Y = 2026.9;
const yearOf = s => { const [y, m] = String(s).split('-').map(Number); return y + (m ? (m - 1) / 12 : 0); };
const index = Object.fromEntries(RECORDS.map((r, i) => [r.id, i]));
const adj = RECORDS.map(() => []);
const EDGES = D.links.map(([a, b, sp]) => { const i = index[a], j = index[b]; adj[i].push(j); adj[j].push(i); return { i, j, sp: !!sp }; });
const MASS = { project: 1, pillar: .9, role: .8, skill: .55 };
RECORDS.forEach(r => { r.nx = r.from ? (yearOf(r.from) - YEAR0) / (YEAR1 - YEAR0) : r.px; r.mass = MASS[r.k]; });
/* rest activation: recent records hold more of it, old ones decay */
const rest = new Float32Array(N);
RECORDS.forEach((r, i) => { if (r.from) rest[i] = Math.exp(-(NOW_Y - yearOf(r.from)) / 9); });
RECORDS.forEach((r, i) => { if (!r.from) { const d = adj[i].filter(j => RECORDS[j].from); rest[i] = d.length ? .8 * d.reduce((s, j) => s + rest[j], 0) / d.length : .2; } });
/* records with no dated neighbour inherit from the records they hang off */
RECORDS.forEach((r, i) => { if (!r.from && !adj[i].some(j => RECORDS[j].from)) rest[i] = .8 * adj[i].reduce((s, j) => s + rest[j], 0) / adj[i].length; });

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rich = s => esc(s).replace(/\[#(\d+)\]/g, (_, n) => `<span class="rd" style="--n:${n}" role="img" aria-label="${esc(T.withheld)}" title="${esc(T.withheld)}"></span>`);
/* a check older than a month says so itself */
const days = Math.floor((Date.now() - Date.parse(D.checked)) / 864e5);
const AGE = days > 30 ? ' · ' + T.ago.replace('{n}', days) : '';
if (AGE) { $$('[data-chk]').forEach(e => { e.textContent += AGE; }); $$('.stamp.v').forEach(e => e.classList.add('old')); }
$$('.rd.wh').forEach(e => { e.title = T.withheld; e.setAttribute('role', 'img'); e.setAttribute('aria-label', T.withheld); });

/* ---------- retrieval: words in any of the three languages, no model ---------- */
const STOP = new Set(('a an the of in on at for to and or is are was what who how he his does did do with about ' +
  'что кто как он его это в на и или с по для о об у ' +
  'que quien como el su sus de la los las en y o con para por del al un una').split(' '));
const words = s => (s.toLowerCase().replace(/c\+\+/g, 'cpp').normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu) || []);
/* "AI" is everywhere in this file (even in a company name), so it only counts when nothing else was asked */
const WEAK = new Set(['ai', 'ia', 'ии']);
const queryWords = s => {
  const asked = words(s).filter(w => !STOP.has(w));
  const strong = asked.filter(w => !WEAK.has(w));
  return strong.length ? strong : asked;
};
const docs = RECORDS.map(r => {
  const m = new Map();
  const add = (s, w) => words(s).forEach(t => { if (t.length > 1 && !STOP.has(t)) m.set(t, Math.max(m.get(t) || 0, w)); });
  add(r.ia, 3); add(r.ib, 2); add(r.ic, 1);
  return m;
});
const df = new Map();
docs.forEach(m => m.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
const similar = (q, d) => {
  if (q === d) return 1;
  const n = Math.min(q.length, d.length);
  if (n < 3) return 0;
  let c = 0; while (c < n && q[c] === d[c]) c++;
  return c >= Math.max(3, n - 2) && c >= Math.min(4, n) ? .7 : 0;
};
const score = (i, qs) => qs.reduce((sum, q) => {
  let best = 0;
  docs[i].forEach((w, d) => { const m = similar(q, d); if (m) best = Math.max(best, m * w * Math.log(1 + N / df.get(d))); });
  return sum + best;
}, 0);

/* ---------- activation state ---------- */
const cur = new Float32Array(N), tgt = new Float32Array(N), base = new Float32Array(N);
base.set(rest); tgt.set(rest);
let hover = -1, selected = -1, gain = reduce ? 1 : 0, t0 = 0;
let view = { type: 'boot' }, booted = false, timers = [];
const phase = RECORDS.map((_, i) => i * 2.399);

function spread(i) {
  const t = new Float32Array(N);
  for (let k = 0; k < N; k++) t[k] = rest[k] * .18;
  adj[i].forEach(j => adj[j].forEach(k => { t[k] = Math.max(t[k], .24); }));
  adj[i].forEach(j => { t[j] = Math.max(t[j], .62); });
  t[i] = 1.15;
  return t;
}
let scrub = null;
function push() {
  tgt.set(hover >= 0 ? spread(hover) : scrub || base);
  if (reduce) { cur.set(tgt); draw(); }
  marks();
}
function setBase(t) { base.set(t); push(); }

/* ---------- map ---------- */
const field = $('#field'), cv = $('#terrain'), ctx = cv.getContext('2d'), svg = $('#map');
const NS = 'http://www.w3.org/2000/svg';
const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const gTicks = el('g', {}, svg), gEdges = el('g', {}, svg), gPulse = el('g', {}, svg), gNodes = el('g', {}, svg);
const TICKS = [2003, 2011, 2014, 2017, 2021, 2026];
const tickEls = TICKS.map(y => ({ y, l: el('line', { class: 'tick' }, gTicks), t: el('text', { class: 'tk', 'text-anchor': 'middle' }, gTicks) }));
tickEls.forEach(k => { k.t.textContent = k.y; });
const edgeEls = EDGES.map(e => el('path', { class: 'edge' + (e.sp ? ' spine' : '') }, gEdges));
const R0 = { project: 6.5, pillar: 5.5, role: 5, skill: 3.6 };
const nodeEls = RECORDS.map((r, i) => {
  const g = el('g', { class: `n k-${r.k} ${r.s}`, role: 'button', tabindex: '0', 'aria-label': `${r.t}. ${r.s === 'v' ? T.stV : r.s === 'k' ? T.stK : T.stS}` }, gNodes);
  el('circle', { class: 'hit', r: 15 }, g);
  const d = el('circle', { class: 'd', r: R0[r.k] }, g);
  const tx = el('text', {}, g);
  tx.textContent = r.l;
  const a = r.a || 'r', gap = R0[r.k] + 5;
  tx.setAttribute('text-anchor', a === 'r' ? 'start' : a === 'l' ? 'end' : 'middle');
  tx.setAttribute('x', a === 'r' ? gap : a === 'l' ? -gap : 0);
  tx.setAttribute('y', a === 't' ? -gap - 2 : a === 'b' ? gap + 9 : 3.5);
  g.addEventListener('pointerenter', () => { hover = i; push(); });
  g.addEventListener('pointerleave', () => { hover = -1; push(); });
  g.addEventListener('focus', () => { hover = i; push(); });
  g.addEventListener('blur', () => { hover = -1; push(); });
  g.addEventListener('click', () => select(i));
  g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } });
  return { g, d };
});

/* the time scale can be read with the pointer: whatever was going on in that year lights up */
const axis = el('rect', { class: 'axis' }, svg);
const yLine = el('line', { class: 'yc', visibility: 'hidden' }, svg), yText = el('text', { class: 'yt', 'text-anchor': 'middle', visibility: 'hidden' }, svg);
let geo = null;
function activeIn(y) {
  const t = new Float32Array(N);
  for (let k = 0; k < N; k++) t[k] = rest[k] * .18;
  RECORDS.forEach((r, i) => {
    if (!r.from) return;
    const a = yearOf(r.from), b = r.to === 'now' ? NOW_Y : r.to ? yearOf(r.to) : a + .5;
    if (y < a - .05 || y > b + .05) return;
    t[i] = 1;
    adj[i].forEach(j => { if (!RECORDS[j].from) t[j] = Math.max(t[j], .5); });
  });
  return t;
}
function scrubTo(e) {
  if (!geo) return;
  const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * (W / b.width);
  const y = Math.max(2003, Math.min(NOW_Y, YEAR0 + (x - geo.padL) / geo.span * (YEAR1 - YEAR0)));
  const X = (geo.padL + (y - YEAR0) / (YEAR1 - YEAR0) * geo.span).toFixed(1);
  scrub = activeIn(y);
  yLine.setAttribute('x1', X); yLine.setAttribute('x2', X); yLine.setAttribute('y1', geo.top); yLine.setAttribute('y2', H - 24);
  yText.setAttribute('x', X); yText.setAttribute('y', H - 27); yText.textContent = Math.floor(y);
  yLine.setAttribute('visibility', 'visible'); yText.setAttribute('visibility', 'visible');
  push();
}
axis.addEventListener('pointermove', scrubTo);
axis.addEventListener('pointerdown', scrubTo);
axis.addEventListener('pointerleave', () => { scrub = null; yLine.setAttribute('visibility', 'hidden'); yText.setAttribute('visibility', 'hidden'); push(); });

/* a pulse runs from the record that was asked for to each record it woke */
let pulses = [];
function burst(src, vals) {
  pulses.forEach(p => p.c.remove()); pulses = [];
  if (reduce) return;
  EDGES.forEach((e, n) => {
    if (e.i !== src && e.j !== src) return;
    if (vals[e.i === src ? e.j : e.i] < .3) return;
    pulses.push({ c: el('circle', { class: 'pulse', r: 2.6, opacity: 0 }, gPulse), p: edgeEls[n], rev: e.j === src, t: 0 });
  });
}
function movePulses(t) {
  pulses = pulses.filter(p => {
    if (!p.t) p.t = t;
    const u = (t - p.t) / 640;
    if (u >= 1) { p.c.remove(); return false; }
    const at = p.p.getPointAtLength(p.p.getTotalLength() * (p.rev ? 1 - u : u));
    p.c.setAttribute('cx', at.x.toFixed(1)); p.c.setAttribute('cy', at.y.toFixed(1)); p.c.setAttribute('opacity', (1 - u * u).toFixed(2));
    return true;
  });
}

let W = 0, H = 0, G = 7, cols = 0, rows = 0, F = new Float32Array(0), K = [];
const LV = [.16, .26, .38, .52, .68, .86, 1.06, 1.3];
const MAP_MIN = 760; /* below this the labels collide, so narrow screens pan the map instead of squeezing it */
let panned = false;
function layout() {
  const b = field.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const narrow = innerWidth <= 880;
  const pan = narrow && b.width < 640;
  W = pan ? MAP_MIN : b.width; H = b.height;
  cv.style.width = svg.style.width = pan ? W + 'px' : '';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const padL = 24, padR = 22, padT = narrow ? 24 : 46, padB = 34;
  const px = n => padL + n * (W - padL - padR), py = n => padT + n * (H - padT - padB);
  RECORDS.forEach(r => { r.x_ = px(r.nx); r.y_ = py(r.py); });
  geo = { padL, span: W - padL - padR, top: padT - 6 };
  axis.setAttribute('x', 0); axis.setAttribute('y', H - 32); axis.setAttribute('width', W); axis.setAttribute('height', 32);
  tickEls.forEach(k => {
    const x = px((k.y - YEAR0) / (YEAR1 - YEAR0));
    k.l.setAttribute('x1', x); k.l.setAttribute('x2', x); k.l.setAttribute('y1', padT - 6); k.l.setAttribute('y2', H - 24);
    k.t.setAttribute('x', x); k.t.setAttribute('y', H - 10);
  });
  EDGES.forEach((e, n) => {
    const a = RECORDS[e.i], z = RECORDS[e.j];
    const mx = (a.x_ + z.x_) / 2, my = (a.y_ + z.y_) / 2, dx = z.x_ - a.x_, dy = z.y_ - a.y_, bow = e.sp ? 0 : .12;
    edgeEls[n].setAttribute('d', `M${a.x_.toFixed(1)} ${a.y_.toFixed(1)}Q${(mx - dy * bow).toFixed(1)} ${(my + dx * bow).toFixed(1)} ${z.x_.toFixed(1)} ${z.y_.toFixed(1)}`);
  });
  RECORDS.forEach((r, i) => nodeEls[i].g.setAttribute('transform', `translate(${r.x_.toFixed(1)} ${r.y_.toFixed(1)})`));
  /* one kernel per record, precomputed; each frame is only a weighted sum */
  G = 7;
  cols = Math.ceil(W / G) + 2; rows = Math.ceil(H / G) + 2;
  F = new Float32Array(cols * rows);
  const sig = Math.max(36, Math.min(W * .07, 76)), s2 = 2 * sig * sig;
  K = RECORDS.map(r => {
    const k = new Float32Array(cols * rows);
    for (let y = 0, p = 0; y < rows; y++) for (let x = 0; x < cols; x++, p++) {
      const dx = x * G - r.x_, dy = y * G - r.y_;
      k[p] = r.mass * Math.exp(-(dx * dx + dy * dy) / s2);
    }
    return k;
  });
  /* the map opens on the recent years; older ones are a swipe away */
  if (!panned && field.scrollWidth > field.clientWidth) { field.scrollLeft = field.scrollWidth; panned = true; }
  if (reduce) draw();
}
function marks() {
  const vals = hover >= 0 ? spread(hover) : scrub || base;
  const focus = hover >= 0 || !!scrub || selected >= 0 || view.type === 'query';
  nodeEls.forEach((n, i) => {
    n.g.classList.toggle('hot', focus && vals[i] >= .5);
    n.g.classList.toggle('dim', focus && vals[i] < .22);
    n.g.classList.toggle('sel', i === hover || (hover < 0 && i === selected));
    n.d.setAttribute('r', R0[RECORDS[i].k] + (focus && vals[i] >= .9 ? 2 : 0));
  });
  edgeEls.forEach((p, n) => {
    const e = EDGES[n], a = vals[e.i], b = vals[e.j];
    p.classList.toggle('hot', focus && a >= .5 && b >= .5);
    p.classList.toggle('dim', focus && (a < .3 || b < .3));
  });
}
function draw() {
  if (!cols) return;
  F.fill(0);
  for (let n = 0; n < N; n++) {
    const a = cur[n] * gain; if (a < .004) continue;
    const k = K[n]; for (let i = 0; i < F.length; i++) F[i] += a * k[i];
  }
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 1;
  for (let l = 0; l < LV.length; l++) {
    const v = LV[l];
    ctx.beginPath();
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c, a = F[i], b = F[i + 1], d = F[i + cols], e = F[i + cols + 1];
      const idx = (a > v ? 8 : 0) | (b > v ? 4 : 0) | (e > v ? 2 : 0) | (d > v ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = c * G, y = r * G, x2 = x + G, y2 = y + G;
      const tx = x + G * (v - a) / (b - a), ry = y + G * (v - b) / (e - b), bx = x + G * (v - d) / (e - d), ly = y + G * (v - a) / (d - a);
      switch (idx) {
        case 1: case 14: ctx.moveTo(x, ly); ctx.lineTo(bx, y2); break;
        case 2: case 13: ctx.moveTo(bx, y2); ctx.lineTo(x2, ry); break;
        case 3: case 12: ctx.moveTo(x, ly); ctx.lineTo(x2, ry); break;
        case 4: case 11: ctx.moveTo(tx, y); ctx.lineTo(x2, ry); break;
        case 6: case 9: ctx.moveTo(tx, y); ctx.lineTo(bx, y2); break;
        case 7: case 8: ctx.moveTo(x, ly); ctx.lineTo(tx, y); break;
        case 5: ctx.moveTo(x, ly); ctx.lineTo(tx, y); ctx.moveTo(bx, y2); ctx.lineTo(x2, ry); break;
        case 10: ctx.moveTo(tx, y); ctx.lineTo(x2, ry); ctx.moveTo(x, ly); ctx.lineTo(bx, y2); break;
      }
    }
    /* thin amber lines fade on paper faster than on black, so the light theme holds them stronger */
    ctx.strokeStyle = paper.matches ? `rgba(199,132,50,${(.26 + .085 * l).toFixed(2)})` : `rgba(225,172,110,${(.13 + .1 * l).toFixed(2)})`;
    ctx.stroke();
  }
}
paper.addEventListener('change', () => { if (reduce) draw(); });
let lastF = 0, onScreen = true;
function frame(t) {
  requestAnimationFrame(frame);
  if (!onScreen) return;
  if (pulses.length) movePulses(t);
  if (t - lastF < 33) return;
  lastF = t;
  if (!t0) t0 = t;
  gain = Math.min(1, (t - t0) / 1400); gain = 1 - (1 - gain) * (1 - gain);
  for (let i = 0; i < N; i++) {
    const breath = Math.sin(t * .0007 + phase[i]) * .05 * Math.min(1, tgt[i] * 2);
    cur[i] += (tgt[i] + breath - cur[i]) * .085;
  }
  draw();
}

/* ---------- console ---------- */
const out = $('#out'), input = $('#q'), chipsEl = $('#chips');
function rowHtml(row, open) {
  const r = RECORDS[row.i];
  const head = `<button class="rec-h" type="button" data-id="${row.i}"><span class="ra" aria-hidden="true"><i style="--a:${Math.min(1, row.act).toFixed(2)}"></i></span><i class="g ${r.s}"></i><span class="rt">${esc(r.t)}</span><span class="rw">${esc(r.w)}</span></button>`;
  if (!open) return `<article class="rec">${head}</article>`;
  const src = r.s === 'v'
    ? `<span class="stamp v${AGE ? ' old' : ''}">${esc(T.stV)}</span><a href="${esc(r.src)}" target="_blank" rel="noopener">${esc(r.sl || r.src.replace('https://', ''))} ↗</a><span>${esc(T.checked)} ${D.checked}${esc(AGE)}</span>`
    : r.s === 'k'
      ? `<span class="stamp k">${esc(T.stK)}</span><span>${esc(T.srcK)}</span>`
      : `<span class="stamp s">${esc(T.stS)}</span><span>${esc(T.srcCv)}, ${esc(T.cvDate)}</span>`;
  const old = r.legacy ? `<button class="oldbtn" type="button" data-legacy="1">${esc(T.legacy)}</button>` : '';
  return `<article class="rec open">${head}<div class="rec-b"><p>${rich(r.x)}</p><div class="rec-f">${src}${old}</div></div></article>`;
}
function renderRows(list, open) { out.innerHTML = list.map(r => rowHtml(r, r.i === open)).join(''); out.scrollTop = 0; }
function setMessage(s) { out.innerHTML = `<p class="msg">${esc(s)}</p>`; }
function pressChip(n) { [...chipsEl.children].forEach((c, i) => c.setAttribute('aria-pressed', i === n ? 'true' : 'false')); }

function run(q, chip) {
  selected = -1;
  const qs = queryWords(q);
  pressChip(chip == null ? -1 : chip);
  if (!qs.length) { view = { type: 'rest' }; setBase(rest); setMessage(T.rest); return; }
  view = { type: 'query', q, chip };
  const sc = RECORDS.map((_, i) => score(i, qs)), max = Math.max(...sc);
  const t = new Float32Array(N); for (let k = 0; k < N; k++) t[k] = rest[k] * .18;
  if (max <= 0) { setBase(t); setMessage(T.empty); return; }
  const list = sc.map((s, i) => ({ i, r: s / max })).filter(x => x.r >= .36).sort((a, b) => b.r - a.r).slice(0, 7)
    .map(x => ({ i: x.i, act: .42 + .55 * x.r }));
  list.forEach(r => { t[r.i] = Math.max(t[r.i], r.act * 1.1); adj[r.i].forEach(j => { t[j] = Math.max(t[j], r.act * .42); }); });
  setBase(t);
  burst(list[0].i, t);
  renderRows(list, list[0].i);
}
function showAll(chip) {
  selected = -1; view = { type: 'all', chip }; pressChip(chip); input.value = '';
  setBase(rest);
  const list = RECORDS.map((_, i) => ({ i, act: Math.min(.99, rest[i]) })).sort((a, b) => b.act - a.act);
  renderRows(list, list[0].i);
}
function select(i) {
  finishBoot();
  hover = -1; selected = i; view = { type: 'select', i }; input.value = ''; pressChip(-1);
  setBase(spread(i));
  burst(i, tgt);
  const near = adj[i].map(j => ({ i: j, act: .45 + .35 * rest[j] })).sort((a, b) => b.act - a.act);
  renderRows([{ i, act: 1 }, ...near], i);
}
chipsEl.innerHTML = T.chips.map(c => `<button class="chip" type="button" aria-pressed="false">${esc(c)}</button>`).join('') +
  `<button class="chip" type="button" aria-pressed="false">${esc(T.all)} · ${N}</button>`;
[...chipsEl.children].forEach((b, n) => b.addEventListener('click', () => {
  finishBoot();
  if (n === T.chips.length) { showAll(n); return; }
  input.value = T.chips[n]; run(T.chips[n], n);
}));

/* wake sequence: never covers the subject card, ends on its own in about two seconds, plays once per visit */
function finishBoot() {
  if (booted) return;
  booted = true;
  timers.forEach(clearTimeout); timers = [];
  input.value = T.chips[0];
  run(input.value, 0);
}
function boot() {
  let woke = false;
  try { woke = sessionStorage.getItem('dossier-woke') === '1'; sessionStorage.setItem('dossier-woke', '1'); } catch (e) { /* storage is optional */ }
  if (reduce || woke) { finishBoot(); return; }
  const pre = document.createElement('div'); pre.className = 'log'; out.innerHTML = ''; out.appendChild(pre);
  let i = 0;
  const line = () => {
    if (i < T.boot.length) { pre.textContent += (i ? '\n' : '') + T.boot[i++]; timers.push(setTimeout(line, 240)); return; }
    const s = T.chips[0]; let j = 0;
    const type = () => { input.value = s.slice(0, ++j); if (j < s.length) timers.push(setTimeout(type, 26)); else timers.push(setTimeout(finishBoot, 140)); };
    type();
  };
  line();
  addEventListener('keydown', finishBoot, { once: true });
  addEventListener('pointerdown', finishBoot, { once: true });
}

/* ---------- approval card and legacy viewer ---------- */
const ap = $('#approve'), mail = $('.pr-mail').textContent;
let statusT = 0;
function status(s) { const e = $('#status'); e.textContent = s; clearTimeout(statusT); statusT = setTimeout(() => { e.textContent = ''; }, 5000); }
$$('.js-contact').forEach(b => b.addEventListener('click', () => { $('#apAsk').hidden = false; $('#apOk').hidden = true; ap.showModal(); }));
$('#apDeny').addEventListener('click', () => { ap.close(); status(T.denied); });
$('#apAllow').addEventListener('click', () => {
  $('#apAsk').hidden = true; $('#apOk').hidden = false;
  $('#apMail').textContent = mail; $('#apSend').href = 'mailto:' + mail;
});
$('#apClose').addEventListener('click', () => ap.close());
$('#apCopy').addEventListener('click', e => {
  const b = e.currentTarget;
  navigator.clipboard.writeText(mail).then(() => { b.textContent = T.copied; setTimeout(() => { b.textContent = T.copy; }, 1800); }).catch(() => {
    const r = document.createRange(); r.selectNodeContents($('#apMail')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
});
const lg = $('#legacy');
['#lgX', '#lgOk'].forEach(s => $(s).addEventListener('click', () => lg.close()));

/* ---------- wiring ---------- */
document.addEventListener('click', e => { if (e.target.closest('[data-legacy]')) lg.showModal(); });
out.addEventListener('click', e => { const h = e.target.closest('.rec-h'); if (h) select(+h.dataset.id); });
let qT = 0;
input.addEventListener('input', () => { finishBoot(); clearTimeout(qT); qT = setTimeout(() => run(input.value, null), 90); });
$('#qf').addEventListener('submit', e => { e.preventDefault(); finishBoot(); run(input.value, null); });
input.addEventListener('keydown', e => { if (e.key === 'Escape') { input.value = ''; run('', null); input.blur(); } });
addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== input && !$('dialog[open]')) { e.preventDefault(); scrollTo({ top: 0 }); input.focus(); }
});
input.addEventListener('focus', () => input.select());

/* file index follows the reader */
const links = $$('.index a[href^="#sec-"]');
if ('IntersectionObserver' in window && links.length) {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-20% 0px -70% 0px' });
  $$('.sec').forEach(s => io.observe(s));
  new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }).observe(field);
}

/* the first screen's figures count up once; the stamps further down are pressed as the reader reaches them */
if (!reduce && 'IntersectionObserver' in window) {
  const count = e => {
    const m = /^(\d+)(.*)$/.exec(e.textContent);
    if (!m) return;
    const end = +m[1], tail = m[2];
    let t1 = 0;
    const step = t => {
      if (!t1) t1 = t;
      const u = Math.min(1, (t - t1) / 900);
      e.textContent = Math.round(end * (1 - Math.pow(1 - u, 3))) + tail;
      if (u < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    /* frames can stall (a background tab, a throttled pane); a checked figure must not be left half-counted */
    setTimeout(() => { t1 = -1e9; e.textContent = end + tail; }, 1300);
  };
  const seen = new IntersectionObserver(es => es.forEach(x => {
    if (!x.isIntersecting) return;
    seen.unobserve(x.target);
    if (x.target.hasAttribute('data-count')) count(x.target); else x.target.classList.add('in');
  }), { threshold: .6 });
  $$('[data-count], .doc .stamp').forEach(e => seen.observe(e));
}

/* the line of work: a stage shows its practices, and a light walks the line, waiting at each point where a person decides */
const flow = $('#flow');
if (flow) {
  const sec = $('#sec-ai'), btns = $$('button[data-ps]', flow), caps = $$('.cap[data-p]', sec), steps = $$('.flow li', flow);
  let sticky = null, k = -1, inView = false;
  const show = b => {
    const ps = b ? b.dataset.ps.split(' ') : null;
    sec.classList.toggle('picking', !!ps);
    caps.forEach(c => c.classList.toggle('pick', !!ps && ps.includes(c.dataset.p)));
    btns.forEach(x => x.setAttribute('aria-pressed', x === sticky ? 'true' : 'false'));
  };
  btns.forEach(b => {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('pointerenter', () => show(b));
    b.addEventListener('focus', () => show(b));
    b.addEventListener('pointerleave', () => show(sticky));
    b.addEventListener('blur', () => show(sticky));
    b.addEventListener('click', () => { sticky = sticky === b ? null : b; show(sticky); });
  });
  if (!reduce && 'IntersectionObserver' in window) {
    new IntersectionObserver(es => { inView = es[0].isIntersecting; }).observe(flow);
    setInterval(() => {
      if (!inView) return;
      k = (k + 1) % (steps.length + 2);
      steps.forEach((li, i) => { li.classList.toggle('on', i === k); li.classList.toggle('done', i < k && k <= steps.length); });
    }, 850);
  }
}

new ResizeObserver(layout).observe(field);
layout();
marks();
if (reduce) { cur.set(tgt); draw(); } else requestAnimationFrame(frame);
boot();
})();

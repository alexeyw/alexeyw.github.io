(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const D = JSON.parse($('#dossier-data').textContent);
const T = D.t, RECORDS = D.records, N = RECORDS.length;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
function push() {
  tgt.set(hover >= 0 ? spread(hover) : base);
  if (reduce) { cur.set(tgt); draw(); }
  marks();
}
function setBase(t) { base.set(t); push(); }

/* ---------- map ---------- */
const field = $('#field'), cv = $('#terrain'), ctx = cv.getContext('2d'), svg = $('#map');
const NS = 'http://www.w3.org/2000/svg';
const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const gTicks = el('g', {}, svg), gEdges = el('g', {}, svg), gNodes = el('g', {}, svg);
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

let W = 0, H = 0, G = 7, cols = 0, rows = 0, F = new Float32Array(0), K = [];
const LV = [.16, .26, .38, .52, .68, .86, 1.06, 1.3];
function layout() {
  const b = field.getBoundingClientRect();
  W = b.width; H = b.height;
  if (!W || !H) return;
  const compact = W < 640 && innerWidth <= 880;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const padL = compact ? 8 : 24, padR = compact ? 8 : 22, padT = compact ? 6 : 46, padB = compact ? 6 : 34;
  const px = n => padL + n * (W - padL - padR), py = n => padT + n * (H - padT - padB);
  RECORDS.forEach(r => { r.x_ = px(r.nx); r.y_ = py(r.py); });
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
  G = compact ? 5 : 7;
  cols = Math.ceil(W / G) + 2; rows = Math.ceil(H / G) + 2;
  F = new Float32Array(cols * rows);
  const sig = Math.max(compact ? 20 : 36, Math.min(W * .07, 76)), s2 = 2 * sig * sig;
  K = RECORDS.map(r => {
    const k = new Float32Array(cols * rows);
    for (let y = 0, p = 0; y < rows; y++) for (let x = 0; x < cols; x++, p++) {
      const dx = x * G - r.x_, dy = y * G - r.y_;
      k[p] = r.mass * Math.exp(-(dx * dx + dy * dy) / s2);
    }
    return k;
  });
  if (reduce) draw();
}
function marks() {
  const vals = hover >= 0 ? spread(hover) : base;
  const focus = hover >= 0 || selected >= 0 || view.type === 'query';
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
    ctx.strokeStyle = `rgba(225,172,110,${(.13 + .1 * l).toFixed(2)})`;
    ctx.stroke();
  }
}
let lastF = 0, onScreen = true;
function frame(t) {
  requestAnimationFrame(frame);
  if (!onScreen || t - lastF < 33) return;
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
  const head = `<button class="rec-h" type="button" data-id="${row.i}"><span class="ra">${row.act.toFixed(2)}</span><i class="g ${r.s}"></i><span class="rt">${esc(r.t)}</span><span class="rw">${esc(r.w)}</span></button>`;
  if (!open) return `<article class="rec">${head}</article>`;
  const src = r.s === 'v'
    ? `<span class="stamp v">${esc(T.stV)}</span><a href="${esc(r.src)}" target="_blank" rel="noopener">${esc(r.sl || r.src.replace('https://', ''))} ↗</a><span>${esc(T.checked)} ${D.checked}</span>`
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

new ResizeObserver(layout).observe(field);
layout();
marks();
if (reduce) { cur.set(tgt); draw(); } else requestAnimationFrame(frame);
boot();
})();

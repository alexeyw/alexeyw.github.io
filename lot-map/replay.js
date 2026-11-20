// The replay on the lot-map page. The made-up session of ./session.js is fed, moment by moment, to the mod's own code
// in ./mod/ (classifier, drawing, rows, strings: lot-map's files with their types stripped). Here: the clock and the page.
import { formatMs } from './mod/classify.js'
import { drawMap } from './mod/draw.js'
import { foldRows, nowParts, describeNow } from './mod/feed.js'
import { DARK, LIGHT } from './mod/palette.js'
import { setupFrom } from './mod/setup.js'
import { BOUNDARIES, LENGTH, T0, boardAt } from './session.js'

const REST = 4200

// ---- the page --------------------------------------------------------------------------------------

const $ = id => document.getElementById(id)
const pane = $('pane')
const mapBox = $('map')
const rowsBox = $('rows')
const nowBox = $('now')
const handedBox = $('handed')
const keptBox = $('kept')
const tallyBox = $('tally')
const playButton = $('play')
const bar = $('progress')

const prefersLight = matchMedia('(prefers-color-scheme: light)')
const prefersStill = matchMedia('(prefers-reduced-motion: reduce)')
const state = {
  time: 0,
  isPlaying: !prefersStill.matches,
  language: 'en',
  theme: prefersLight.matches ? 'light' : 'dark',
  motion: prefersStill.matches ? 'reduced' : 'full',
  drawnAt: -1,
}
let setup = setupFrom({ language: state.language, theme: state.theme, motion: state.motion, memoryServers: 'notes' })
let last = performance.now()

const text = (tag, className, content) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.textContent = content
  return node
}

function drawRows(board) {
  const { t } = setup
  const column = Math.max(8, ...Object.values(t.stations).map(name => name.length))
  const turnMs = new Map()
  let askedAt
  for (const x of board.entries) {
    if (x.station === 'you' && x.from === 'inbound' && x.mark === undefined) askedAt = x.startedAt
    if (x.mark === 'done' && askedAt !== undefined) turnMs.set(x.id, x.startedAt - askedAt)
  }
  const rows = foldRows(board.entries).map(({ entry, times, tookMs }) => {
    const mark = entry.status === 'run' ? '●' : entry.status === 'ok' ? '·' : '✕'
    const whole = turnMs.get(entry.id)
    const took = entry.endedAt === undefined ? t.running : whole !== undefined && whole > 0 ? formatMs(whole, t) : tookMs > 0 ? formatMs(tookMs, t) : '—'
    const line = document.createElement('div')
    line.className = `row ${entry.status === 'run' ? 'is-run' : entry.status === 'ok' ? 'is-ok' : 'is-fault'}`
    line.append(text('span', 'row-what', `${mark} ${t.stations[entry.station].padEnd(column)} ${entry.label}${times > 1 ? `  +${times - 1}` : ''}`), text('span', 'row-took', took))
    return line
  })
  rowsBox.replaceChildren(...(rows.length > 0 ? rows : [text('div', 'row is-ok', t.nothingYet)]))
}

function drawHanded(handed, handedChars, keptChars) {
  const { t } = setup
  if (handed === undefined) {
    handedBox.textContent = '—'
    keptBox.textContent = '—'
  } else {
    handedBox.textContent = `${handed.tool}\n${JSON.stringify(handed.input, null, 2)}`
    keptBox.textContent = `${t.stations[handed.row.station]}  ${handed.row.label}`
  }
  tallyBox.textContent = handedChars === 0 ? '' : `Handed so far: ${handedChars.toLocaleString('en')} characters of input. Kept: ${keptChars.toLocaleString('en')}.`
}

function draw() {
  const drawn = BOUNDARIES.filter(b => b <= state.time).pop() ?? 0
  bar.style.transform = `scaleX(${Math.min(1, state.time / LENGTH)})`
  if (drawn === state.drawnAt) return
  state.drawnAt = drawn
  const { board, handed, handedChars, keptChars } = boardAt(drawn, setup)
  // The mod draws the whole map anew at every change and the pane swaps it in; so does this.
  mapBox.innerHTML = drawMap(board, T0 + drawn, setup)
  const svg = mapBox.querySelector('svg')
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${setup.t.title}. ${describeNow(board, setup.t)}`)
  if (!state.isPlaying) svg.pauseAnimations()
  nowBox.textContent = nowParts(board, setup.t).what
  drawRows(board)
  drawHanded(handed, handedChars, keptChars)
}

function restyle() {
  setup = setupFrom({ language: state.language, theme: state.theme, motion: state.motion, memoryServers: 'notes' })
  const p = state.theme === 'light' ? LIGHT : DARK
  for (const [name, value] of Object.entries(p)) pane.style.setProperty(`--p-${name}`, value)
  pane.dataset.theme = state.theme
  $('pane-title').textContent = setup.t.title
  state.drawnAt = -1
  draw()
}

function setPlaying(isPlaying) {
  state.isPlaying = isPlaying
  playButton.textContent = isPlaying ? 'Pause' : 'Play'
  playButton.setAttribute('aria-pressed', String(isPlaying))
  const svg = mapBox.querySelector('svg')
  if (svg) isPlaying ? svg.unpauseAnimations() : svg.pauseAnimations()
  last = performance.now()
}

function tick(at) {
  // A hidden tab gets no frames; the gap is not played through at once when it comes back.
  const passed = Math.min(1000, at - last)
  last = at
  if (state.isPlaying) {
    state.time += passed
    if (state.time > LENGTH + REST) {
      state.time = 0
      state.drawnAt = -1
    }
    draw()
  }
  requestAnimationFrame(tick)
}

playButton.addEventListener('click', () => setPlaying(!state.isPlaying))
$('restart').addEventListener('click', () => {
  state.time = 0
  state.drawnAt = -1
  draw()
  setPlaying(true)
})
$('language').addEventListener('change', e => {
  state.language = e.target.value
  restyle()
})
$('theme').addEventListener('change', e => {
  state.theme = e.target.value
  restyle()
})
$('motion').addEventListener('change', e => {
  state.motion = e.target.checked ? 'reduced' : 'full'
  restyle()
})
$('theme').value = state.theme
$('motion').checked = state.motion === 'reduced'
// With reduced motion asked for, the page starts on a full board and stays still until Play.
if (!state.isPlaying) state.time = 13_600
// ?t=19600 opens the replay at that moment, standing still: for a look at one scene and for the preview picture.
const asked = Number(new URLSearchParams(location.search).get('t'))
if (Number.isFinite(asked) && asked > 0) {
  state.time = Math.min(asked, LENGTH)
  state.isPlaying = false
}

const copy = $('copy')
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('install').textContent.trim())
    copy.textContent = 'Copied'
  } catch {
    copy.textContent = 'Select'
  }
  setTimeout(() => (copy.textContent = 'Copy'), 1600)
})

restyle()
setPlaying(state.isPlaying)
requestAnimationFrame(tick)

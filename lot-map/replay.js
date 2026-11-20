// The replay on the lot-map page. A made-up session is fed, call by call, to the mod's own code in ./mod/ (classifier,
// drawing, rows, strings: lot-map's files with their types stripped). What stands in for Claude Code is here: a clock
// and the bookkeeping of the board, which in the mod lives in hooks/board.ts and needs the engine.
import { classify, formatMs, shortModel } from './mod/classify.js'
import { drawMap } from './mod/draw.js'
import { foldRows, nowParts, describeNow } from './mod/feed.js'
import { DARK, LIGHT } from './mod/palette.js'
import { setupFrom } from './mod/setup.js'

const MODEL = 'claude-opus-5-5'
const T0 = 1_000_000
const LENGTH = 27_400
const REST = 4200

// The session. Every path, address, key and query in it is invented for this page.
// at: when it starts, ms. dur: how long it runs. agent: made by the subagent's loop.
const SESSION = [
  { at: 0, kind: 'you' },
  { at: 150, kind: 'hook' },
  { at: 400, kind: 'step', dur: 1400, context: 18 },
  { at: 1800, kind: 'call', dur: 500, tool: 'Read', input: { file_path: '/Users/dana/orders-api/src/auth/session.ts' } },
  { at: 1900, kind: 'call', dur: 600, tool: 'Grep', input: { pattern: 'refreshToken\\(', path: 'src', output_mode: 'content' } },
  { at: 2500, kind: 'step', dur: 1300, context: 21 },
  { at: 3800, kind: 'call', dur: 2600, status: 'err', tool: 'Bash', input: { command: 'npm test -- auth --reporter dot', description: 'Run the auth tests' } },
  { at: 6400, kind: 'step', dur: 1200, context: 23 },
  { at: 7600, kind: 'call', dur: 700, tool: 'mcp__notes__search', input: { query: 'what did Marta say about customers being logged out after an hour' } },
  { at: 8300, kind: 'step', dur: 1100, context: 24 },
  { at: 9400, kind: 'call', dur: 400, tool: 'Edit', input: { file_path: '/Users/dana/orders-api/src/auth/session.ts', old_string: 'const REFRESH_TTL = 3600', new_string: 'const REFRESH_TTL = 14 * 24 * 3600' } },
  { at: 9800, kind: 'step', dur: 900, context: 25 },
  { at: 10700, kind: 'call', dur: 1500, tool: 'WebFetch', input: { url: 'https://dana:pw-7731@docs.example.com/api/tokens?key=sk_live_9f2c41', prompt: 'How long may a refresh token live?' } },
  { at: 10900, kind: 'call', dur: 1200, tool: 'Bash', input: { command: 'curl -s -H "Authorization: Bearer sk_live_9f2c41" https://api.example.com/v1/sessions | jq .count' } },
  { at: 12300, kind: 'step', dur: 1200, context: 29 },
  { at: 13500, kind: 'call', dur: 5000, tool: 'Agent', input: { description: 'Review the diff', prompt: 'Read the change to src/auth/session.ts and say whether a fourteen-day refresh token is safe here. The customer who complained is Hollis Freight.' } },
  { at: 13900, kind: 'step', dur: 800, agent: 'a1' },
  { at: 14700, kind: 'call', dur: 500, agent: 'a1', tool: 'Bash', input: { command: 'git diff --stat HEAD' } },
  { at: 15300, kind: 'call', dur: 400, agent: 'a1', tool: 'Read', input: { file_path: '/Users/dana/orders-api/src/auth/session.ts' } },
  { at: 15800, kind: 'step', dur: 2400, agent: 'a1' },
  { at: 18500, kind: 'step', dur: 1000, context: 31 },
  { at: 19500, kind: 'refusal', tool: 'Bash', input: { command: 'rm -rf build && npm run build' } },
  { at: 20100, kind: 'step', dur: 900, context: 32 },
  { at: 21000, kind: 'call', dur: 1400, tool: 'Bash', input: { command: 'PGPASSWORD=hunter2 psql -h db.internal -c "select email from users where plan = \'freight\' limit 5"' } },
  { at: 22400, kind: 'call', dur: 2300, tool: 'Bash', input: { command: 'npm test -- auth --reporter dot', description: 'Run the auth tests' } },
  { at: 24700, kind: 'step', dur: 1300, context: 33 },
  { at: 26000, kind: 'done' },
]

const BOUNDARIES = [...new Set(SESSION.flatMap(e => (e.dur === undefined ? [e.at] : [e.at, e.at + e.dur])))].sort((a, b) => a - b)

/** The board as the mod would hold it at `time`, and the newest call it was handed. */
function boardAt(time, setup) {
  const { t } = setup
  const board = { entries: [], counts: {}, model: MODEL, faults: {}, agents: [] }
  let handed
  let handedChars = 0
  let keptChars = 0
  let steps = 0
  let agentSteps = 0
  const add = (entry, e, i) => {
    const isOver = e.dur === undefined || e.at + e.dur <= time
    const status = isOver ? (entry.status ?? e.status ?? 'ok') : 'run'
    const row = { id: `e${i}`, from: 'core', ...entry, startedAt: T0 + e.at, status, ...(isOver ? { endedAt: T0 + e.at + (e.dur ?? 0) } : {}) }
    board.entries.push(row)
    board.counts[row.station] = (board.counts[row.station] ?? 0) + 1
    if ((status === 'err' || status === 'block') && row.station !== 'you') board.faults[row.station] = (board.faults[row.station] ?? 0) + 1
    if (row.agentId !== undefined && !board.agents.includes(row.agentId)) board.agents.push(row.agentId)
    return row
  }
  SESSION.forEach((e, i) => {
    if (e.at > time) return
    if (e.kind === 'you') {
      board.faults = {}
      add({ station: 'you', label: t.newMessage, from: 'inbound' }, e, i)
    } else if (e.kind === 'hook') {
      add({ station: 'hooks', label: t.addedContext(t.toMessage) }, e, i)
    } else if (e.kind === 'step') {
      if (e.agent === undefined) {
        steps++
        board.step = steps
        add({ station: 'model', label: `${shortModel(MODEL)} · ${t.step(steps)}` }, e, i)
        if (e.at + e.dur <= time) board.context = e.context
      } else {
        agentSteps++
        add({ station: 'model', label: `${shortModel(MODEL)} · ${t.step(agentSteps)} · ${t.subagent}`, from: 'agents', agentId: e.agent }, e, i)
      }
    } else if (e.kind === 'call') {
      const seen = classify(e.tool, e.input, setup)
      const row = add({ ...seen, ...(e.agent === undefined ? {} : { from: 'agents', agentId: e.agent }) }, e, i)
      handed = { tool: e.tool, input: e.input, row }
      handedChars += JSON.stringify(e.input).length
      keptChars += seen.label.length
    } else if (e.kind === 'refusal') {
      const row = add({ station: 'hooks', label: t.stopped(e.tool), status: 'block' }, e, i)
      handed = { tool: e.tool, input: e.input, row, isRefused: true }
      handedChars += JSON.stringify(e.input).length
      keptChars += e.tool.length
    } else if (e.kind === 'done') {
      add({ station: 'you', label: t.answerReady, mark: 'done' }, e, i)
    }
  })
  return { board, handed, handedChars, keptChars }
}

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
    copy.textContent = 'Select and copy'
  }
  setTimeout(() => (copy.textContent = 'Copy'), 1600)
})

restyle()
setPlaying(state.isPlaying)
requestAnimationFrame(tick)

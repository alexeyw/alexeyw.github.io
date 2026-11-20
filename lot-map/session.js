// The made-up session of the lot-map page and the board the mod would hold at each moment of it. What stands in for
// Claude Code is here: the bookkeeping of the board, which in the mod lives in hooks/board.ts and needs the engine.
import { classify, shortModel } from './mod/classify.js'

export const MODEL = 'claude-opus-5-5'
export const T0 = 1_000_000
export const LENGTH = 27_400

// The session. Every path, address, key and query in it is invented for this page.
// at: when it starts, ms. dur: how long it runs. agent: made by the subagent's loop.
export const SESSION = [
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

export const BOUNDARIES = [...new Set(SESSION.flatMap(e => (e.dur === undefined ? [e.at] : [e.at, e.at + e.dur])))].sort((a, b) => a - b)

/** The board as the mod would hold it at `time`, and the newest call it was handed. */
export function boardAt(time, setup) {
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

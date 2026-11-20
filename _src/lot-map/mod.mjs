// Makes the landing's copy of lot-map's own drawing: six files of the mod at one tag, types stripped and `.js` added to
// their imports, written as browser modules into ../../lot-map/mod/. Run: node mod.mjs [tag] (default v0.12.0).
// The files are read with `git show` from the lot-map checkout; its branch and working tree are not touched.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const TAG = process.argv[2] ?? 'v0.12.0'
const REPO = `${homedir()}/ClaudeCodeProjects/lot-map`
const OUT = fileURLToPath(new URL('../../lot-map/mod/', import.meta.url))
const FILES = ['classify', 'draw', 'feed', 'palette', 'setup', 'text']
mkdirSync(OUT, { recursive: true })
for (const name of FILES) {
  const source = execFileSync('git', ['-C', REPO, 'show', `${TAG}:hooks/${name}.ts`], { encoding: 'utf8', maxBuffer: 1 << 24 })
  const plain = stripTypeScriptTypes(source, { mode: 'strip' })
  const left = [...plain.matchAll(/from '(\.[^']+)'/g)].map(m => m[1])
  for (const path of left) if (!FILES.includes(path.replace('./', ''))) throw new Error(`${name}.ts imports ${path}, which is not copied`)
  if (/from 'claude-code'/.test(plain)) throw new Error(`${name}.ts needs the engine`)
  const head = `// lot-map ${TAG}, hooks/${name}.ts with its types stripped and .js added to its imports; nothing else changed. MIT, github.com/alexeyw/lot-map\n`
  writeFileSync(`${OUT}${name}.js`, head + plain.replace(/from '(\.\/[^']+)'/g, "from '$1.js'"))
  console.log(`${name}.js ${plain.length}`)
}

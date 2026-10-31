#!/usr/bin/env node
/**
 * 生成 GitHub Release 的说明（notes）：
 *   - 从 CHANGELOG.md 摘出本版段落
 *   - 加上「上一个 tag 以来」的提交列表
 *   - 附安装命令（git 安装 / zip 安装）
 *
 * 用法：
 *   node scripts/make-notes.mjs 0.9.2                 # 输出到 stdout
 *   node scripts/make-notes.mjs 0.9.2 --out notes.md
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REPO = 'Iceseas/dsh-ds-whale'

const argv = process.argv.slice(2)
const version = argv.find((a) => !a.startsWith('-') && /^\d+\.\d+\.\d+/.test(a))
if (!version) {
  console.error('用法: node scripts/make-notes.mjs <version> [--out notes.md]')
  process.exit(1)
}
const outIdx = argv.indexOf('--out')
const outFile = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : null

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/* 1. CHANGELOG 段落：从 "## <version>" 行到下一条 "## " 行 */
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
let section = []
let inside = false
for (const line of changelog) {
  const isHeading = line.startsWith('## ')
  if (!inside && isHeading && line.slice(3).startsWith(version)) {
    inside = true
    section.push(line)
    continue
  }
  if (inside && isHeading) break
  if (inside) section.push(line)
}
if (!section.length) section = [`## ${version}`, '', '- （CHANGELOG 里没有这一段）']
while (section.length && section[section.length - 1].trim() === '') section.pop()

/* 2. 上一个 tag 以来的提交 */
const tags = git(['tag', '--sort=-v:refname']).split(/\r?\n/).filter(Boolean)
const prev = tags.find((t) => t !== `v${version}`)
const range = prev ? `${prev}..v${version}` : `v${version}`
const log = git(['log', range, '--no-merges', '--pretty=- %s (%h)']).split(/\r?\n/).filter(Boolean).slice(0, 40)

/* 3. 拼装 */
const lines = [
  ...section,
  '',
  '### 变更提交',
  '',
  ...(log.length ? log : ['- （无）']),
  '',
  '### 安装',
  '',
  '```bash',
  `dsh plugin add github:${REPO}#v${version}`,
  '```',
  '',
  `免 git 安装：下载下方 \`dsh-ds-whale-${version}.zip\`，把整份内容合并进 ` +
    '`<DSH_HOME>/profiles/<profile>/node_modules/dsh-ds-whale/`，重启 DSH 即可。',
  ''
]
const text = lines.join('\n')

if (outFile) {
  fs.writeFileSync(outFile, text, 'utf8')
  console.log(`notes written: ${outFile} (${text.length} chars, range=${range})`)
} else {
  process.stdout.write(text)
}

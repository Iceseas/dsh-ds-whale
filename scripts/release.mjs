#!/usr/bin/env node
/**
 * 一条命令发版（Node 版，跨平台，不依赖 PowerShell）：
 *   bump 版本号 → 写 CHANGELOG → 语法自检 → commit → 打 tag → 推送
 * 推上去之后 .github/workflows/release.yml 会自动打包 zip 并生成 GitHub Release。
 *
 * 用法（在仓库根目录、main 分支）：
 *   node scripts/release.mjs patch                  # 0.9.1 -> 0.9.2（修 bug）
 *   node scripts/release.mjs minor                  # 0.9.2 -> 0.10.0（加功能）
 *   node scripts/release.mjs major                  # 0.10.0 -> 1.0.0（正式版）
 *   node scripts/release.mjs 0.9.5                  # 指定版本号
 *   node scripts/release.mjs patch -m "修左边气泡被裁"   # 带 CHANGELOG 条目（可重复 -m）
 *   node scripts/release.mjs patch --dry-run        # 只看会改什么，改完自动还原
 *   node scripts/release.mjs patch --no-push        # 只提交+打 tag，不推
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const FILES = ['package.json', 'lib/index.js', 'lib/client.js', 'CHANGELOG.md']

const argv = process.argv.slice(2)
const notes = []
let bump = null
let version = null
let dryRun = false
let noPush = false

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry-run' || a === '-n') dryRun = true
  else if (a === '--no-push') noPush = true
  else if (a === '-m' || a === '--note' || a === '--message') notes.push(argv[++i])
  else if (a === '--version') version = argv[++i]
  else if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0])
    process.exit(0)
  } else if (/^(patch|minor|major)$/.test(a)) bump = a
  else if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(a)) version = a
  else die(`不认识的参数：${a}（用 --help 看用法）`)
}

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}
function git(args, opts = {}) {
  const stdio = opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio })
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const write = (p, t) => fs.writeFileSync(path.join(ROOT, p), t, 'utf8')

// --- 0. 前置检查 ---
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true }).trim()
if (branch !== 'main') die(`当前分支是 ${branch}，先切回 main`)

const dirty = git(['status', '--porcelain'], { capture: true }).trim()
if (dirty) {
  console.log('\x1b[33m⚠ 工作区有未提交改动（不会被一起提交，只提交下面 4 个文件）：\x1b[0m')
  console.log(dirty)
}

const pkgPath = path.join(ROOT, 'package.json')
const cur = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version

if (!version) {
  const kind = bump || 'patch'
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(cur)
  if (!m) die(`package.json 里的版本号看不懂：${cur}`)
  let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (kind === 'major') { maj += 1; min = 0; pat = 0 }
  else if (kind === 'minor') { min += 1; pat = 0 }
  else pat += 1
  version = `${maj}.${min}.${pat}`
}
if (cur === version) die(`版本号还是 ${cur}`)
if (git(['tag', '-l', `v${version}`], { capture: true }).trim()) die(`tag v${version} 已存在`)

console.log(`\x1b[36m\nv${cur}  ->  v${version}\x1b[0m`)

const originals = {}
for (const f of FILES) originals[f] = read(f)

// --- 1. package.json ---
write('package.json', read('package.json').replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`))

// --- 2. lib/index.js 里的 version 字段（通常是 2 处）---
const idxSrc = read('lib/index.js')
const hits = (idxSrc.match(/version: '[^']+'/g) || []).length
write('lib/index.js', idxSrc.replace(/version: '\d[^']*'/g, `version: '${version}'`))
console.log(`lib/index.js 版本字段替换 ${hits} 处`)

// --- 3. lib/client.js 的 BUILD 标记（线上自检用）---
write('lib/client.js', read('lib/client.js').replace(/const BUILD = 'v[^']*'/, `const BUILD = 'v${version}'`))

// --- 4. CHANGELOG 顶部插一段（在第一处 "\n## " 之前，保留 # Changelog 标题与简介）---
const date = new Date()
const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const section = [`## ${version} — ${ymd}`, '', ...(notes.length ? notes.map((n) => `- ${n}`) : ['- （待补充）']), '', ''].join('\n')
const chg = read('CHANGELOG.md')
const cut = chg.indexOf('\n## ')
if (cut < 0) die('CHANGELOG.md 里找不到 "## " 段落')
write('CHANGELOG.md', chg.slice(0, cut + 1) + section + chg.slice(cut + 1))

// --- 5. 语法自检 ---
try {
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'lib/index.js')], { stdio: 'inherit' })
  execFileSync(process.execPath, ['--check', path.join(ROOT, 'lib/client.js')], { stdio: 'inherit' })
  JSON.parse(read('package.json'))
  console.log('package.json ok')
} catch (err) {
  for (const f of FILES) write(f, originals[f])
  die(`自检失败，已还原文件：${err.message}`)
}

if (dryRun) {
  git(['--no-pager', 'diff', '--stat'])
  for (const f of FILES) write(f, originals[f])
  console.log('\x1b[33m\n[dry-run] 上面是将会产生的改动，文件已还原。确认后去掉 --dry-run 重跑。\x1b[0m')
  process.exit(0)
}

// --- 6. commit + tag + push ---
git(['add', ...FILES])
git(['commit', '-m', `chore(release): v${version}`])
git(['tag', '-a', `v${version}`, '-m', `v${version}`])
console.log(`\x1b[32m已提交并打 tag v${version}\x1b[0m`)

if (noPush) {
  console.log(`\x1b[33m已跳过推送。手动执行：git push origin main && git push origin v${version}\x1b[0m`)
} else {
  git(['push', 'origin', 'main'])
  git(['push', 'origin', `v${version}`])
  console.log(`\x1b[32m\n✅ 已推送。GitHub Actions 会自动打包 zip 并生成 Release：\x1b[0m`)
  console.log('   https://github.com/Iceseas/dsh-ds-whale/actions')
  console.log('   https://github.com/Iceseas/dsh-ds-whale/releases')
}

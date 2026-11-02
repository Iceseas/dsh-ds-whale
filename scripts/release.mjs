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
 *   node scripts/release.mjs patch --no-watch       # 推完不等 Actions 生成 Release
 *   node scripts/release.mjs patch --stable -m "..."  # 0.x 也发成正式版（GitHub Latest 指向它）
 *
 * 注意：0.x 版本默认会被 workflow 标成 Pre-release —— 仓库首页 Releases 卡片不显示，
 * /releases/latest 也返回 404。想要「正式发布」，加 --stable（会在 CHANGELOG 里写 [stable]）。
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
let noWatch = false
let stable = false

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dry-run' || a === '-n') dryRun = true
  else if (a === '--no-push') noPush = true
  else if (a === '--no-watch') noWatch = true
  /* 0.x 默认被 workflow 标成 Pre-release，GitHub 的 /releases/latest 不会指向它。
     --stable 会在 CHANGELOG 该版段落里写一行 [stable]，workflow 见到就按正式版发 */
  else if (a === '--stable') stable = true
  /* 兼容 `release.mjs patch github` 这种写法：GitHub Release 不需要参数，
     推 tag 之后 .github/workflows/release.yml 会自己生成，这里显式吃掉即可 */
  else if (a === 'github' || a === '--github' || a === 'gh') continue
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

/* 发布包清单里的东西必须真的在仓库里：v0.9.6 就是栽在这里 —— 新增的立绘是 untracked，
   package.json 的 files 却已经列了它们，Actions 打包阶段 existsSync 直接报「缺少文件」并失败 */
const declared = JSON.parse(read('package.json')).files || []
const lost = declared.filter((f) => !fs.existsSync(path.join(ROOT, f)))
if (lost.length) die(`package.json 的 files 里缺少文件：${lost.join(', ')}\n  先把素材放进仓库（git add）再发版`)

/* tag 检查分两边看：远端有 → push 会被拒；只有本地有 → 多半是上次发版失败留下的 */
const localTag = git(['tag', '-l', `v${version}`], { capture: true }).trim()
let remoteTag = ''
try {
  remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/v${version}`], { capture: true }).trim()
} catch {
  /* 没网 / 没 origin 时跳过这条检查，交给后面的 push 报错 */
}
if (remoteTag) die(`远端已经有 tag v${version} 了，先删掉再发版：git push origin :refs/tags/v${version}`)
if (localTag) {
  die(
    `本地还留着 tag v${version}（远端没有，通常是上次发版失败留下的）：\n` +
      `  git tag -d v${version}  然后重跑本命令`
  )
}

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
const bullets = notes.length ? notes.map((n) => `- ${n}`) : ['- （待补充）']
/* [stable] 是给 workflow 看的标记：0.x 版本默认发成 Pre-release，带上它就照正式版发 */
if (stable) bullets.push('- [stable] 这一版按正式版发布（GitHub 的 Latest 会指向它）')
const section = [`## ${version} — ${ymd}`, '', ...bullets, '', ''].join('\n')
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
/* 该进包的文件一个都不能漏：除了改版本的 4 个文件，还要把 files 白名单里新增的素材
   （新立绘之类）和已经跟踪的改动一起提交，否则 Actions 找不到文件会直接失败 */
const addTargets = [...new Set([...FILES, ...declared])]
git(['add', '-A', '--', ...addTargets])
git(['add', '-u']) // 已跟踪文件（README / locale / tools …）的改动也一起走
const staged = git(['diff', '--cached', '--name-only'], { capture: true }).trim()
if (!staged) die('没有可提交的改动')
console.log(`\x1b[36m将提交 ${staged.split('\n').length} 个文件：\x1b[0m`)
console.log(staged)

git(['commit', '-m', `chore(release): v${version}`])
git(['tag', '-a', `v${version}`, '-m', `v${version}`])
console.log(`\x1b[32m已提交并打 tag v${version}\x1b[0m`)

const repoSlug = (() => {
  try {
    const url = git(['remote', 'get-url', 'origin'], { capture: true }).trim()
    const m = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(url)
    return m ? `${m[1]}/${m[2]}` : null
  } catch {
    return null
  }
})()

/** 推完别急着说成功：轮询 GitHub API，确认 Release 真的建出来了 */
async function watchRelease(slug, v) {
  const url = `https://api.github.com/repos/${slug}/releases/tags/v${v}`
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 6000))
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'dsh-ds-whale-release', accept: 'application/vnd.github+json' }
      })
      if (res.status === 200) {
        const j = await res.json()
        return { url: j.html_url, prerelease: j.prerelease, assets: (j.assets || []).map((a) => a.name) }
      }
    } catch {
      /* 网络抖动继续等 */
    }
    process.stdout.write('.')
  }
  return null
}

if (noPush) {
  console.log(`\x1b[33m已跳过推送。手动执行：git push origin main && git push origin v${version}\x1b[0m`)
} else {
  git(['push', 'origin', 'main'])
  git(['push', 'origin', `v${version}`])
  console.log(`\x1b[32m\n✅ 已推送，等 Actions 打包并生成 Release …\x1b[0m`)

  if (noWatch || !repoSlug) {
    console.log(`   https://github.com/${repoSlug || 'Iceseas/dsh-ds-whale'}/actions`)
    console.log(`   https://github.com/${repoSlug || 'Iceseas/dsh-ds-whale'}/releases`)
  } else {
    const rel = await watchRelease(repoSlug, version)
    if (rel) {
      console.log(`\x1b[32m\n🎉 Release 已生成：${rel.url}\x1b[0m`)
      console.log(`   附件：${rel.assets.join(', ') || '（无）'}`)
      if (rel.prerelease && !stable) {
        console.log(
          '\x1b[33m   注意：0.x 版本按 workflow 规则标成了 Pre-release，GitHub 的 /releases/latest 不会指向它，\n' +
            '   仓库首页 Releases 卡片也不显示它。想让这一版变成正式版，去 Release 页面点「Edit」取消 Pre-release。\x1b[0m'
        )
      }
    } else {
      console.log(
        `\x1b[31m\n✗ 90 秒内没等到 Release。多半是 Actions 失败了，去看日志：\x1b[0m\n` +
          `   https://github.com/${repoSlug}/actions/workflows/release.yml`
      )
      process.exitCode = 1
    }
  }
}

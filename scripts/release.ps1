# 一条命令发版：bump 版本号 → 写 CHANGELOG → 提交 → 打 tag → 推送
# 推上去之后 .github/workflows/release.yml 会自动打包 zip 并生成 GitHub Release。
#
# 用法（在仓库根目录、main 且工作区干净时）：
#   pwsh -File scripts/release.ps1 -Bump patch      # 0.9.0 -> 0.9.1（修 bug）
#   pwsh -File scripts/release.ps1 -Bump minor      # 0.9.1 -> 0.10.0（加功能）
#   pwsh -File scripts/release.ps1 -Bump major      # 0.10.0 -> 1.0.0（正式版）
#   pwsh -File scripts/release.ps1 -Version 0.9.2 -Note "修左边气泡被裁"   # 指定版本
#   pwsh -File scripts/release.ps1 -Bump patch -DryRun                     # 只看会做什么
param(
  [ValidateSet('patch', 'minor', 'major')][string]$Bump = 'patch',
  [string]$Version,
  [string[]]$Note = @(),
  [switch]$DryRun,
  [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-Utf8([string]$p) { [System.IO.File]::ReadAllText((Resolve-Path $p), [System.Text.Encoding]::UTF8) }
function Write-Utf8([string]$p, [string]$t) { [System.IO.File]::WriteAllText((Resolve-Path $p), $t, $utf8) }

# --- 0. 前置检查 ---
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { throw "当前分支是 $branch，先切回 main" }
if ((git status --porcelain)) { Write-Host "⚠ 工作区有未提交改动，会一起提交：" -ForegroundColor Yellow; git status --short }

$orig = @{}
foreach ($f in @('package.json', 'lib/index.js', 'lib/client.js', 'CHANGELOG.md')) { $orig[$f] = Read-Utf8 $f }

$pkg = (Read-Utf8 'package.json') | ConvertFrom-Json
$cur = $pkg.version
if (-not $Version) {
  $p = $cur.Split('.')
  $maj = [int]$p[0]; $min = [int]$p[1]; $pat = ([int]($p[2] -replace '-.*$', ''))
  switch ($Bump) {
    'major' { $maj++; $min = 0; $pat = 0 }
    'minor' { $min++; $pat = 0 }
    'patch' { $pat++ }
  }
  $Version = "$maj.$min.$pat"
}
if ($cur -eq $Version) { throw "版本号还是 $cur" }
if ((git tag -l "v$Version")) { throw "tag v$Version 已存在" }

Write-Host "`nv$cur  ->  v$Version" -ForegroundColor Cyan

# --- 1. package.json ---
$raw = Read-Utf8 'package.json'
$raw = [regex]::Replace($raw, '("version"\s*:\s*")[^"]*(")', "`${1}$Version`${2}", 1)
Write-Utf8 'package.json' $raw

# --- 2. lib/index.js 里的两处 version ---
$idx = Read-Utf8 'lib/index.js'
$before = ([regex]::Matches($idx, "version: '[^']+'")).Count
$idx = [regex]::Replace($idx, "version: '[0-9][^']*'", "version: '$Version'")
Write-Utf8 'lib/index.js' $idx
Write-Host "lib/index.js 版本字段替换 $before 处"

# --- 3. lib/client.js 的 BUILD 标记（用于线上自检） ---
$cli = Read-Utf8 'lib/client.js'
$cli = [regex]::Replace($cli, "const BUILD = 'v[^']*'", "const BUILD = 'v$Version'")
Write-Utf8 'lib/client.js' $cli

# --- 4. CHANGELOG 顶部插入一段 ---
$date = Get-Date -Format 'yyyy-MM-dd'
$lines = @("## $Version — $date", '')
if ($Note.Count -gt 0) { foreach ($n in $Note) { $lines += "- $n" } }
else { $lines += '- （待补充）' }
$lines += ''
$chg = Read-Utf8 'CHANGELOG.md'
# 插在第一个 "## " 段落之前，保留 "# Changelog" 标题与简介
$cut = $chg.IndexOf("`n## ")
if ($cut -lt 0) { throw 'CHANGELOG.md 里找不到 ## 段落' }
$head = $chg.Substring(0, $cut + 1)
$tail = $chg.Substring($cut + 1)
$chgNew = $head + ($lines -join "`n") + "`n" + $tail
Write-Utf8 'CHANGELOG.md' $chgNew

# --- 5. 语法自检 ---
node --check lib/index.js
node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('package.json ok')"

if ($DryRun) {
  git --no-pager diff --stat
  foreach ($f in $orig.Keys) { Write-Utf8 $f $orig[$f] }
  Write-Host "`n[DryRun] 只演练：上面是将会产生的改动，文件已还原。确认后去掉 -DryRun 重跑。" -ForegroundColor Yellow
  return
}

# --- 6. commit + tag + push ---
git add package.json lib/index.js lib/client.js CHANGELOG.md
git commit -m "chore(release): v$Version" | Out-Null
git tag -a "v$Version" -m "v$Version"
Write-Host "已提交并打 tag v$Version" -ForegroundColor Green

if ($SkipPush) {
  Write-Host "已跳过推送。手动执行：git push origin main; git push origin v$Version" -ForegroundColor Yellow
} else {
  git push origin main
  git push origin "v$Version"
  Write-Host "`n✅ 已推送。GitHub Actions 会自动打包 zip 并生成 Release：" -ForegroundColor Green
  Write-Host "   https://github.com/Iceseas/dsh-ds-whale/actions"
  Write-Host "   https://github.com/Iceseas/dsh-ds-whale/releases"
}

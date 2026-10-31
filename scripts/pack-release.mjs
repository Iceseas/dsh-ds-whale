#!/usr/bin/env node
/**
 * 把插件目录打成可直接分发的 zip（Node 版，不需要 python）。
 * 进包内容以 package.json 的 files 为准（外加 package.json 自己与 tools/），
 * 仓库里的草稿、下载图不会误进发布包。
 *
 * 为什么不用 Compress-Archive：它写出的 entry 名是反斜杠（lib\index.js），
 * Linux/macOS 解压会得到怪文件名。这里统一正斜杠，且 package.json 在 zip 根层
 * （套一层目录会让 `dsh plugin add` 找不到入口）。
 *
 * 用法：
 *   node scripts/pack-release.mjs 0.9.2
 *   node scripts/pack-release.mjs 0.9.2 --out-dir dist
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'assets-src', '__pycache__', 'dist'])

/* ---------------- crc32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/* ---------------- zip 写入（store/deflate，UTF-8 名） ---------------- */
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function writeZip(outPath, entries) {
  const chunks = []
  const central = []
  let offset = 0

  for (const { name, data, mtime } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const stored = zlib.deflateRawSync(data, { level: 9 })
    const useDeflate = stored.length < data.length
    const body = useDeflate ? stored : data
    const method = useDeflate ? 8 : 0
    const crc = crc32(data)
    const { time, date } = dosTime(mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 名称
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, body)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0o644 << 16, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))

    offset += local.length + nameBuf.length + body.length
  }

  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  fs.writeFileSync(outPath, Buffer.concat([...chunks, cdBuf, eocd]))
}

/* ---------------- 收集文件 ---------------- */
function collectItems() {
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'))
  const items = [...((pkg.files || []).map(String))]
  for (const extra of ['package.json', 'tools']) if (!items.includes(extra)) items.push(extra)
  return items
}

function walk(rel, out, missing) {
  const full = path.join(SRC, rel)
  let st
  try {
    st = fs.statSync(full)
  } catch {
    missing.push(rel)
    return
  }
  if (st.isFile()) {
    out.push({ name: rel.split(path.sep).join('/'), data: fs.readFileSync(full), mtime: st.mtime })
    return
  }
  for (const dirent of fs.readdirSync(full, { withFileTypes: true })) {
    if (dirent.isDirectory() && SKIP_DIRS.has(dirent.name)) continue
    walk(path.join(rel, dirent.name), out, missing)
  }
}

/* ---------------- main ---------------- */
const argv = process.argv.slice(2)
const version = argv.find((a) => !a.startsWith('-') && /^\d+\.\d+\.\d+/.test(a))
if (!version) {
  console.error('用法: node scripts/pack-release.mjs <version> [--out-dir dist]')
  process.exit(1)
}
const outDirArg = argv.indexOf('--out-dir')
const outDir = path.resolve(SRC, outDirArg >= 0 ? argv[outDirArg + 1] : '.')

fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `dsh-ds-whale-${version}.zip`)
if (fs.existsSync(outPath)) fs.rmSync(outPath)

const entries = []
const missing = []
for (const item of collectItems()) walk(item, entries, missing)

entries.sort((a, b) => a.name.localeCompare(b.name))
writeZip(outPath, entries)

const names = entries.map((e) => e.name)
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
if (!names.includes('package.json')) fail('package.json 不在 zip 根层')
if (names.some((n) => n.includes('\\'))) fail('zip 里出现了反斜杠路径')
if (!names.includes('lib/index.js') || !names.includes('lib/client.js')) fail('核心文件缺失')
if (!names.includes('cordis.patch.yml')) fail('cordis.patch.yml 缺失')

for (const m of missing) console.log(`warn: 跳过不存在的 ${m}`)
console.log(`files=${entries.length} entries=${names.length} size=${fs.statSync(outPath).size}`)
console.log(`out=${outPath}`)

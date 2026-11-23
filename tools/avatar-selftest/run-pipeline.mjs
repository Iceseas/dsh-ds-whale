/**
 * 用真图跑 lib/client.js 里的立绘处理管线（avatar-pipeline:begin/end 之间那段）。
 *
 * 由 selftest.py 调用：manifest.json 里是 Pillow 解出来的原始 RGBA + 每张图的参数；
 * 这里把输出写成 {case}-{size}.rgba，再由 Pillow 编码 PNG、算指标、拼对比图。
 * 这样做的好处：测的就是随包发布的那段代码，不是另抄一份。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = process.argv[2]
if (!manifestPath) {
  console.error('usage: node run-pipeline.mjs <manifest.json>')
  process.exit(2)
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const clientPath = manifest.clientPath || path.join(here, '..', '..', 'lib', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')
const beginMark = '/* ===== avatar-pipeline:begin ===== */'
const endMark = '/* ===== avatar-pipeline:end ===== */'
const begin = src.indexOf(beginMark)
const end = src.indexOf(endMark)
if (begin < 0 || end <= begin) throw new Error('avatar-pipeline markers not found: ' + clientPath)
const code = src.slice(begin + beginMark.length, end)
const api = new Function(code + '\nreturn { avatarMatte, avatarSquare, avatarBbox, avatarBorderStats }')()

const inDir = manifest.inDir
const outDir = manifest.outDir
fs.mkdirSync(outDir, { recursive: true })
const report = []

for (const c of manifest.cases) {
  const raw = fs.readFileSync(path.join(inDir, c.name + '.rgba'))
  const data = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength)
  const t0 = Date.now()
  const res = api.avatarMatte(data, c.w, c.h, { matte: c.matte !== false })
  const sizes = c.sizes || [512, 128]
  const files = {}
  for (const size of sizes) {
    const out = api.avatarSquare(res.data, c.w, c.h, res.box, c.pad == null ? 0.05 : c.pad, size)
    fs.writeFileSync(path.join(outDir, c.name + '-' + size + '.rgba'), Buffer.from(out.buffer, out.byteOffset, out.byteLength))
    files[size] = true
  }
  report.push({
    name: c.name,
    ms: Date.now() - t0,
    matted: !!res.matted,
    removed: res.removed,
    box: res.box,
    stats: res.stats,
    sizes: Object.keys(files).map(Number)
  })
}

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ cases: report.map((r) => r.name + ' ' + r.ms + 'ms matted=' + r.matted + ' removed=' + r.removed.toFixed(3)) }, null, 1))

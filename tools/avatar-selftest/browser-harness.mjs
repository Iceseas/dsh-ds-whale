/**
 * 浏览器端立绘链路自测（无头 Chrome）。
 *
 *   node tools/avatar-selftest/browser-harness.mjs <outDir> <inputDir>
 *
 * 起一个本地 HTTP 服务：发测试页、发 lib/client.js、发图片；测试页把 client.js 里
 * avatar-pipeline 那段原样 eval 出来，用 createImageBitmap + canvas 真解码 -> 处理 ->
 * PNG 编码，再把结果 POST 回来。这样测的是浏览器里真正跑的那条链路，而不是另写的替身。
 * 收齐所有用例后写 report.json 并退出（Python 侧等这个文件）。
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const outDir = process.argv[2]
const inDir = process.argv[3]
if (!outDir || !inDir) {
  console.error('usage: node browser-harness.mjs <outDir> <inputDir>')
  process.exit(2)
}
fs.mkdirSync(outDir, { recursive: true })
const cases = JSON.parse(fs.readFileSync(path.join(inDir, 'cases.json'), 'utf8'))
const pending = new Set(cases.map((c) => c.name))
const report = []
let failed = false

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>avatar-selftest</title>
<pre id="log" style="white-space:pre-wrap"></pre>
<script>
(async () => {
  const log = (s) => { document.getElementById('log').textContent += s + '\\n' }
  const cases = await (await fetch('/cases.json')).json()
  const src = await (await fetch('/client.js')).text()
  const beginMark = '/* ===== avatar-pipeline:begin ===== */'
  const endMark = '/* ===== avatar-pipeline:end ===== */'
  const begin = src.indexOf(beginMark)
  const end = src.indexOf(endMark)
  if (begin < 0 || end <= begin) throw new Error('markers not found')
  const code = src.slice(begin + beginMark.length, end)
  const api = new Function(code + '\\nreturn { buildAvatarFiles }')()
  for (const c of cases) {
    const resp = await fetch('/input/' + encodeURIComponent(c.file))
    if (!resp.ok) throw new Error('fetch input failed: ' + c.file)
    const blob = await resp.blob()
    const file = new File([blob], c.file, { type: c.mime || blob.type })
    const t0 = performance.now()
    const built = await api.buildAvatarFiles(file, {
      matte: c.matte !== false,
      pad: c.pad == null ? 0.05 : c.pad,
      sizes: c.sizes || [512, 128]
    })
    const ms = Math.round(performance.now() - t0)
    await fetch('/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: c.name,
        ms: ms,
        matted: built.matted,
        removed: built.removed,
        big: built.big,
        small: built.small,
        tiny: built.tiny
      })
    })
    log('done ' + c.name + ' ' + ms + 'ms')
  }
  document.title = 'DONE'
  await fetch('/done', { method: 'POST' })
})().catch((err) => {
  document.title = 'ERROR'
  fetch('/error', { method: 'POST', body: String((err && err.stack) || err) })
})
</script>`

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function finish(code) {
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log('REPORT_READY')
  setTimeout(() => process.exit(code), 200)
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (process.env.WHALE_SELFTEST_LOG) console.log('REQ ' + req.method + ' ' + url.pathname)
    if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE)
    if (url.pathname === '/client.js') {
      return send(res, 200, 'text/javascript; charset=utf-8', fs.readFileSync(path.join(root, 'lib', 'client.js')))
    }
    if (url.pathname === '/cases.json') {
      return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(cases))
    }
    if (url.pathname.startsWith('/input/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice('/input/'.length)))
      const file = path.join(inDir, name)
      if (!fs.existsSync(file)) return send(res, 404, 'text/plain', 'missing')
      const ext = path.extname(name).toLowerCase()
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
      return send(res, 200, mime, fs.readFileSync(file))
    }
    if (url.pathname === '/save' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 40 * 1024 * 1024)).toString('utf8'))
      const write = (field, suffix, size) => {
        if (!body[field]) return
        const buf = Buffer.from(body[field], 'base64')
        fs.writeFileSync(path.join(outDir, body.name + '-' + size + '.png'), buf)
      }
      write('big', '', 512)
      write('small', '', 128)
      write('tiny', '', 64)
      report.push({ name: body.name, ms: body.ms, matted: !!body.matted, removed: body.removed })
      pending.delete(body.name)
      if (!pending.size && !failed) finish(0)
      return send(res, 200, 'application/json', '{"ok":true}')
    }
    if (url.pathname === '/done' && req.method === 'POST') {
      if (pending.size) return send(res, 200, 'text/plain', 'waiting:' + Array.from(pending).join(','))
      return send(res, 200, 'text/plain', 'ok')
    }
    if (url.pathname === '/error' && req.method === 'POST') {
      failed = true
      const text = (await readBody(req, 1024 * 1024)).toString('utf8')
      fs.writeFileSync(path.join(outDir, 'browser-error.txt'), text)
      send(res, 200, 'text/plain', 'ok')
      finish(1)
      return
    }
    return send(res, 404, 'text/plain', 'not found')
  } catch (err) {
    failed = true
    fs.writeFileSync(path.join(outDir, 'browser-error.txt'), String((err && err.stack) || err))
    return send(res, 500, 'text/plain', 'error')
  }
})

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  console.log('PORT=' + port)
})

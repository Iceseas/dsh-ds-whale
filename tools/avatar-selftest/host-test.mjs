/**
 * 宿主侧立绘接口自测：直接 import lib/index.js，用假 req/res 打真路由。
 *
 *   node tools/avatar-selftest/host-test.mjs <fixturesDir>
 *
 * fixturesDir 里需要 512.png / 128.png / 64.png 三张方图（由 selftest.py 生成）。
 * 覆盖：上传落盘、/avatar.png 立刻换图、尺寸/格式校验、恢复默认、回环栅栏。
 * 全程把 DSH_HOME 指到临时目录，不会碰用户真的立绘。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const fixtureDir = process.argv[2] || path.join(here, 'work', 'host', 'fixtures')
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-avatar-host-'))
process.env.DSH_HOME = tmpHome

const modImport = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
const mod = modImport.__internals
assert.ok(mod && typeof mod.createStore === 'function', 'lib/index.js 没有导出 __internals.createStore')
const store = mod.createStore(path.join(tmpHome, 'state.json'))
const ctx = { get: () => undefined }
const routes = mod.makeRoutes(ctx, store)
const byPath = (p) => {
  const route = routes.find((r) => r.path === p)
  assert.ok(route, 'route missing: ' + p)
  return route
}
const PREFIX = '/api/dsh-ds-whale'

function makeReq(url, body, opts) {
  const options = opts || {}
  const payload = body == null ? null : Buffer.from(JSON.stringify(body))
  const req = {
    url: url,
    method: payload ? 'POST' : 'GET',
    headers: Object.assign({ host: '127.0.0.1:43210' }, options.headers || {}),
    socket: { remoteAddress: options.remote || '127.0.0.1' }
  }
  req[Symbol.asyncIterator] = async function* () {
    if (payload) yield payload
  }
  return req
}

function makeRes() {
  const out = { status: 0, headers: null, body: Buffer.alloc(0) }
  return {
    out: out,
    writeHead(status, headers) {
      out.status = status
      out.headers = headers
    },
    end(body) {
      out.body = body ? Buffer.from(body) : Buffer.alloc(0)
    }
  }
}

async function invoke(route, req) {
  const res = makeRes()
  await route.handler(req, res)
  return { status: res.out.status, headers: res.out.headers, body: res.out.body, json: () => JSON.parse(res.out.body.toString('utf8')) }
}

const read = (name) => fs.readFileSync(path.join(fixtureDir, name))
const b64 = (buf) => buf.toString('base64')
const png512 = read('512.png')
const png128 = read('128.png')
const png64 = read('64.png')
const avatarPng = byPath(PREFIX + '/avatar.png')
const upload = byPath(PREFIX + '/avatar/upload')
const reset = byPath(PREFIX + '/avatar/reset')

let passed = 0
function ok(label) {
  passed++
  console.log('  ok  ' + label)
}

let calmRev = ''

// 1) 正常上传：三张图落盘，元数据带 rev
{
  const r = await invoke(
    upload,
    makeReq(PREFIX + '/avatar/upload', { mood: 'calm', name: '测试.png', big: b64(png512), small: b64(png128), tiny: b64(png64) })
  )
  assert.equal(r.status, 200)
  const body = r.json()
  assert.equal(body.ok, true, JSON.stringify(body))
  assert.ok(body.avatars && body.avatars.calm && body.avatars.calm.rev, 'missing avatars.calm')
  assert.equal(body.avatars.calm.name, '测试.png')
  calmRev = body.avatars.calm.rev
  for (const name of ['whale.png', 'whale-128.png', 'whale-64.png']) {
    assert.ok(fs.existsSync(path.join(mod.avatarDir(), name)), 'missing ' + name)
  }
  ok('上传 calm：512/128/64 落盘 + avatars.calm 元数据')
}

// 2) /avatar.png 立刻返回新图（看用户目录优先）
{
  const r = await invoke(avatarPng, makeReq(PREFIX + '/avatar.png?size=512'))
  assert.equal(r.status, 200)
  assert.equal(r.headers['content-type'], 'image/png')
  assert.ok(r.body.equals(png512), 'avatar.png 不是刚上传的文件')
  ok('/avatar.png 立刻换成新图（ETag 走 mtime+size）')
}

// 3) 128 尺寸也换成新图
{
  const r = await invoke(avatarPng, makeReq(PREFIX + '/avatar.png?size=128'))
  assert.equal(r.status, 200)
  assert.ok(r.body.equals(png128), '128 缩略图没换')
  ok('/avatar.png?size=128 同步换图')
}

// 3b) 默认缓存键（d1 / 0）只发包内 assets；自定义 rev 仍返回上传图
{
  const pkg512 = fs.readFileSync(path.join(root, 'assets', 'whale.png'))
  const pkg128 = fs.readFileSync(path.join(root, 'assets', 'whale-128.png'))
  for (const token of ['d1', '0']) {
    const r = await invoke(avatarPng, makeReq(PREFIX + '/avatar.png?size=512&v=' + token))
    assert.equal(r.status, 200)
    assert.ok(r.body.equals(pkg512), '默认 token ' + token + ' 没有返回包内 assets')
  }
  const r128 = await invoke(avatarPng, makeReq(PREFIX + '/avatar.png?size=128&v=d1'))
  assert.equal(r128.status, 200)
  assert.ok(r128.body.equals(pkg128), '128 默认 token 没回包内 assets')
  const rRev = await invoke(avatarPng, makeReq(PREFIX + '/avatar.png?size=512&v=' + calmRev))
  assert.ok(rRev.body.equals(png512), '自定义 rev 没返回上传图')
  ok('默认缓存键 d1/0 只发包内 assets；自定义 rev 仍返回上传图')
}

// 4) 尺寸不对 -> bad-size，且不破坏已有文件
{
  const r = await invoke(upload, makeReq(PREFIX + '/avatar/upload', { mood: 'angry', big: b64(png128), small: b64(png128) }))
  assert.equal(r.status, 200)
  assert.equal(r.json().ok, false)
  assert.equal(r.json().error, 'bad-size')
  assert.ok(!fs.existsSync(path.join(mod.avatarDir(), 'whale-angry.png')))
  ok('尺寸校验：bad-size 被拒，不落盘')
}

// 5) 不是 PNG -> not-png
{
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)])
  const r = await invoke(upload, makeReq(PREFIX + '/avatar/upload', { mood: 'blush', big: b64(jpeg), small: b64(png128) }))
  assert.equal(r.json().ok, false)
  assert.equal(r.json().error, 'not-png')
  ok('格式校验：JPEG 伪装 PNG 被拒')
}

// 6) 状态名不对 -> bad-mood
{
  const r = await invoke(upload, makeReq(PREFIX + '/avatar/upload', { mood: '../evil', big: b64(png512), small: b64(png128) }))
  assert.equal(r.json().ok, false)
  assert.equal(r.json().error, 'bad-mood')
  ok('状态白名单：../evil 被拒')
}

// 7) 非回环来源的写请求 -> 403（本机数据不能被网页改）
{
  const r = await invoke(upload, makeReq(PREFIX + '/avatar/upload', { mood: 'calm' }, { remote: '10.1.2.3' }))
  assert.equal(r.status, 403)
  assert.equal(r.json().error, 'not-loopback')
  ok('回环栅栏：非本机写请求 403')
}

// 8) 恢复默认：删文件 + 删元数据，/avatar.png 回落到包内 assets
{
  const r = await invoke(reset, makeReq(PREFIX + '/avatar/reset', { mood: 'calm' }))
  assert.equal(r.status, 200)
  assert.ok(!r.json().avatars.calm, '恢复默认后仍报自定义立绘')
  for (const name of ['whale.png', 'whale-128.png', 'whale-64.png']) {
    assert.ok(!fs.existsSync(path.join(mod.avatarDir(), name)), name + ' 没删掉')
  }
  const fallback = await invoke(avatarPng, makeReq(PREFIX + '/avatar.png?size=512'))
  assert.equal(fallback.status, 200)
  assert.ok(fallback.body.length > 0)
  assert.ok(!fallback.body.equals(png512), '恢复默认后还返回用户图')
  ok('恢复默认：文件/元数据清理，回落到包内 assets')
}

// 9) pngSizeOf 独立校验
{
  assert.equal(mod.pngSizeOf(png512).width, 512)
  assert.equal(mod.pngSizeOf(png128).height, 128)
  assert.equal(mod.pngSizeOf(Buffer.from('not a png')), null)
  ok('pngSizeOf：签名 + IHDR 宽高识别正确')
}

// 10) 音频上传接口没被立绘改动带坏（顺带回归一下）
{
  const sceneRoute = byPath(PREFIX + '/sound/upload')
  const r = await invoke(sceneRoute, makeReq(PREFIX + '/sound/upload', { scene: 'click', name: 'x.wav', mime: 'audio/wav', data: b64(Buffer.from('RIFF0000WAVEfmt ', 'latin1')) }))
  assert.equal(r.status, 200)
  assert.equal(r.json().ok, true)
  ok('音效上传接口回归通过')
}

// 11) 僵尸锁：只清「本进程 + 够旧」的 package.json.lock
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-lock-'))
  const lock = path.join(dir, 'package.json.lock')
  const err = new Error('atomic-write: timed out waiting for the writer lock at ' + lock)
  assert.equal(mod.writerLockFromError(err), lock)
  const old = new Date(Date.now() - 60000)
  fs.writeFileSync(lock, String(process.pid) + '\n')
  fs.utimesSync(lock, old, old)
  assert.equal(mod.clearLeakedWriterLock(err), true)
  assert.ok(!fs.existsSync(lock), '旧的僵尸锁没被清掉')
  fs.writeFileSync(lock, String(process.pid) + '\n')
  assert.equal(mod.clearLeakedWriterLock(err), false, '新锁不能被清')
  fs.writeFileSync(lock, '999999\n')
  fs.utimesSync(lock, old, old)
  assert.equal(mod.clearLeakedWriterLock(err), false, '别人的锁不能被清')
  fs.rmSync(dir, { recursive: true, force: true })
  ok('僵尸锁：只清本进程且超过 20 秒的 package.json.lock')
}

// 12) profile 写失败但锁已过期：清锁后自动重试一次就成功
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-lock-'))
  const lock = path.join(dir, 'package.json.lock')
  fs.writeFileSync(lock, String(process.pid) + '\n')
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(lock, old, old)
  let calls = 0
  const fake = {
    update: async () => {
      calls++
      if (calls === 1) throw new Error('atomic-write: timed out waiting for the writer lock at ' + lock)
      return true
    }
  }
  const res = await mod.writeProfileSettings(fake, { avatarPad: 0.05 })
  assert.equal(res.ok, true)
  assert.equal(calls, 2)
  assert.ok(!fs.existsSync(lock))
  fs.rmSync(dir, { recursive: true, force: true })
  ok('profile 写：超时 -> 清僵尸锁 -> 自动重试成功')
}

// 13) /settings 路由：profile 锁超时也能把运行时值写进去，并在第二次成功时不留 warning
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-lock-route-'))
  const lock = path.join(dir, 'package.json.lock')
  fs.writeFileSync(lock, String(process.pid) + '\n')
  const old = new Date(Date.now() - 60000)
  fs.utimesSync(lock, old, old)
  let calls = 0
  const fakeSettings = {
    update: async () => {
      calls++
      if (calls === 1) throw new Error('atomic-write: timed out waiting for the writer lock at ' + lock)
      return true
    }
  }
  const store2 = mod.createStore(path.join(tmpHome, 'state2.json'))
  const ctx2 = { get: (name) => (name === 'settings' ? fakeSettings : undefined) }
  const routes2 = mod.makeRoutes(ctx2, store2)
  const settingsRoute = routes2.find((r) => r.path === PREFIX + '/settings')
  const r = await invoke(settingsRoute, makeReq(PREFIX + '/settings', { config: { avatarPad: 0.07 } }))
  const body = r.json()
  assert.equal(body.ok, true)
  assert.equal(body.settings.avatarPad, 0.07)
  assert.equal(body.viaConfig, true)
  assert.ok(!body.warning, '重试成功后不该再带 warning')
  assert.ok(!fs.existsSync(lock))
  fs.rmSync(dir, { recursive: true, force: true })
  ok('/settings：锁超时 -> 清锁重试 -> 设置生效且无告警')
}

// 14) /settings 路由：锁一直占着时返回 warning，但运行时值照样生效（不是硬失败）
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-lock-route2-'))
  const lock = path.join(dir, 'package.json.lock')
  fs.writeFileSync(lock, String(process.pid) + '\n')
  const fakeSettings = {
    update: async () => {
      throw new Error('atomic-write: timed out waiting for the writer lock at ' + lock)
    }
  }
  const store3 = mod.createStore(path.join(tmpHome, 'state3.json'))
  const ctx3 = { get: (name) => (name === 'settings' ? fakeSettings : undefined) }
  const routes3 = mod.makeRoutes(ctx3, store3)
  const settingsRoute = routes3.find((r) => r.path === PREFIX + '/settings')
  const r = await invoke(settingsRoute, makeReq(PREFIX + '/settings', { config: { avatarPad: 0.08 } }))
  const body = r.json()
  assert.equal(body.ok, true)
  assert.equal(body.settings.avatarPad, 0.08)
  assert.equal(body.viaConfig, false)
  assert.ok(String(body.warning || '').indexOf('profile-write-failed:') === 0)
  fs.rmSync(dir, { recursive: true, force: true })
  ok('/settings：锁一直被占 -> warning 提示，但值已生效')
}

// 15) settings.update 串行队列：同一时刻只有一个在写
{
  const order = []
  await Promise.all([
    mod.enqueueSettingsWrite(async () => {
      order.push('a1')
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push('a2')
    }),
    mod.enqueueSettingsWrite(async () => {
      order.push('b')
    })
  ])
  assert.deepEqual(order, ['a1', 'a2', 'b'])
  ok('settings 写入队列：同一时刻只有一个在写')
}

// 16) 自定义数据目录：解析绝对路径、首次迁移账本/立绘、运行期切换 dataHome
{
  const prevHome = mod.dataHome()
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-data-src-'))
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-data-dst-'))
  fs.mkdirSync(path.join(src, 'dsh-ds-whale-assets'), { recursive: true })
  fs.writeFileSync(path.join(src, '.dsh-ds-whale.json'), '{"v":1}')
  fs.writeFileSync(path.join(src, 'dsh-ds-whale-assets', 'whale.png'), 'fake')
  const res = mod.resolveDataHome({}, { dataDir: dst })
  assert.equal(path.resolve(res), path.resolve(dst))
  const mig = mod.migrateDataHome(src, dst)
  assert.ok(mig.copied.includes('.dsh-ds-whale.json'), '账本没有复制')
  assert.ok(mig.copied.includes('dsh-ds-whale-assets'), '立绘目录没有复制')
  assert.ok(fs.existsSync(path.join(dst, 'dsh-ds-whale-assets', 'whale.png')), '立绘文件没有复制')
  mod.setDataHome(dst)
  assert.equal(path.resolve(mod.dataHome()), path.resolve(dst))
  assert.equal(path.resolve(mod.avatarDir()), path.resolve(path.join(dst, 'dsh-ds-whale-assets')))
  mod.setDataHome(prevHome)
  fs.rmSync(src, { recursive: true, force: true })
  fs.rmSync(dst, { recursive: true, force: true })
  ok('数据目录：绝对路径解析 + 首次迁移账本/立绘 + 运行期 dataHome 切换')
}

fs.rmSync(tmpHome, { recursive: true, force: true })
console.log('\n宿主接口自测通过：' + passed + ' 项')

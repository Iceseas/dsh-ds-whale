/**
 * dsh-ds-whale — DeepSeek 专用小鲸鱼挂件（Host 侧）
 *
 * 职责：
 *   1. 取余额：优先 DSH 凭据 DEEPSEEK_API_KEY → https://api.deepseek.com/user/balance；没有 key 时退回 DSH 账号登录态（deepseekAccount 服务）。
 *   2. 观测记账：两次余额观测的下降累积成「今日已用」，上升记为充值并标记「待核对余额调整」。
 *   3. usage 记账：监听 session/event 的 assistant/message，按峰谷单价把每轮 token 换算成金额。
 *   4. 官网用量：用 DSH 账号登录态调 Platform 的 /api/v0/usage/by_api_key/{amount,cost}，
 *      今日消费 / 请求次数 / tokens 三者与官网用量页完全同源（唯一权威口径）。
 *   5. 提供 /api/dsh-ds-whale/* 路由给浏览器侧挂件取数。
 *
 * 所有数据只落在 $DSH_HOME/.dsh-ds-whale.json（本机，不上传）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG = 'dsh-ds-whale'
const API_PREFIX = '/api/dsh-ds-whale'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const API_KEY_REF = 'DEEPSEEK_API_KEY'
const DATA_FILE_NAME = '.dsh-ds-whale.json'
const FETCH_TIMEOUT_MS = 9000
const MAX_BODY = 64 * 1024
const KEEP_DAYS = 180
/** 收起态可常驻显示的参数白名单 */
const MINI_FIELDS = ['balance', 'today', 'estimate', 'peak', 'turn']
/** 形象的表情图：calm 用兜底图，其余各自一份（-128 版本由命名规则推导） */
const MOOD_FILES = {
  angry: 'whale-angry.png',
  blush: 'whale-blush.png',
  panic: 'whale-panic.png'
}
/** 官网用量接口（Platform，需 x-dsh-auth-token = DSH 账号登录态 token） */
const USAGE_AMOUNT_PATH = '/api/v0/usage/by_api_key/amount'
const USAGE_COST_PATH = '/api/v0/usage/by_api_key/cost'
/** 北京时间固定 UTC+8（无夏令时），官网用量页默认按它切天 */
const BJ_TZ_SEC = 8 * 3600

/* ------------------------------------------------------------------ */
/* 定价表：CNY / 百万 tokens，[空闲价, 高峰价] */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Config Schema：让 DSH 设置页自动生成本插件的设置面板 */
/* ------------------------------------------------------------------ */

async function loadSchemaLib() {
  try {
    const mod = await import('@deepseek-ai/schemastery')
    if (mod && mod.default) return mod.default
  } catch {}

  const bases = []
  if (process.env.DSH_PROFILE_DIR) bases.push(process.env.DSH_PROFILE_DIR)
  const profilesRoot = path.join(dshHome(), 'profiles')
  try {
    for (const name of fs.readdirSync(profilesRoot)) bases.push(path.join(profilesRoot, name))
  } catch {}

  for (const base of bases) {
    const file = path.join(base, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs')
    try {
      if (!fs.existsSync(file)) continue
      const mod = await import(pathToFileURL(file).href)
      if (mod && mod.default) return mod.default
    } catch {}
  }
  return undefined
}

const SCHEMA = await loadSchemaLib()

function buildConfig(z) {
  const live = (schema) => (typeof schema.volatile === 'function' ? schema.volatile() : schema)
  return z.object({
    nickname: live(
      z.string().default('').description('使用者昵称：播报会这样称呼你，留空不喊名字 / Nickname used in voice lines (empty = no name)')
    ),
    scale: live(z.number().min(0.6).max(2).step(0.05).default(1).description('挂件缩放 / Avatar scale')),
    miniFields: live(
      z
        .array(z.string())
        .default(['balance', 'today'])
        .description('常驻气泡参数，最多 3 个：balance / today / estimate / turn / peak · Bubble fields (max 3)')
    ),
    snap: live(z.boolean().default(true).description('拖拽后贴最近的边，按页面中线判定左右 / Snap to nearest side (page midline)')),
    turnPop: live(z.boolean().default(true).description('每轮对话后弹消耗播报，需点「知道啦」关闭 / Turn cost announcer (dismiss manually)')),
    soundOn: live(z.boolean().default(true).description('轮末提示音 / Chime on turn end')),
    soundVolume: live(z.number().min(0).max(1).step(0.05).default(0.3).description('提示音音量 / Chime volume')),
    warnBelow: live(z.number().min(0).default(5).description('余额预警线（元），0 = 关闭 / Balance alert line in CNY (0 = off)')),
    dailyBudget: live(z.number().min(0).default(0).description('今日预算（元），0 = 关闭 / Daily budget in CNY (0 = off)')),
    refreshMs: live(
      z.number().min(15000).max(3600000).step(1000).default(60000).description('余额自动刷新间隔（毫秒） / Balance refresh interval (ms)')
    ),
    showPeak: live(z.boolean().default(true).description('显示峰谷时段与倒计时 / Peak & off-peak countdown')),
    language: live(
      z
        .string()
        .default('auto')
        .description('界面语言：auto 跟随系统，zh 中文，en 英文 / UI language: auto | zh | en')
    ),
    cacheInInput: live(
      z.boolean().default(false).description('inputTokens 是否含缓存命中（DeepSeek 不含，保持关闭） / inputTokens already includes cache hits')
    )
  })
}

export const Config = SCHEMA ? buildConfig(SCHEMA) : undefined

/** 诊断：设置页能不能投影本插件的表单，取决于 schema 里有没有 meta.volatile */
function schemaDiagnostics() {
  if (!SCHEMA) return { present: false }
  try {
    const probe = SCHEMA.string().default('x')
    const schema = buildConfig(SCHEMA)
    const dict = (schema && schema.dict) || {}
    const flags = {}
    for (const key of Object.keys(dict)) flags[key] = !!(dict[key] && dict[key].meta && dict[key].meta.volatile)
    return {
      present: true,
      volatileFn: typeof probe.volatile === 'function',
      fields: Object.keys(dict),
      flags
    }
  } catch (err) {
    return { present: true, error: String((err && err.message) || err) }
  }
}

/** 诊断：设置投影为什么没带上本插件（看 entry id / fiber 状态 / runtime.Config） */
function configEntryDiagnostics(ctx) {
  try {
    const settings = svc(ctx, 'settings')
    const editor = settings && settings.ownerContext && settings.ownerContext.configEditor
    if (!editor || typeof editor.configuration !== 'function') return { error: 'no-editor' }
    const rows = editor.configuration()
    const pick = (row) => {
      const entry = row && row.entry
      const o = (entry && entry.options) || {}
      return {
        id: o.id == null ? null : String(o.id),
        patchId: o.patchId == null ? null : String(o.patchId),
        name: o.name == null ? null : String(o.name),
        fiberState: entry && entry.fiber ? entry.fiber.state : null,
        hasRuntime: !!(entry && entry.fiber && entry.fiber.runtime),
        hasConfig: !!(entry && entry.fiber && entry.fiber.runtime && entry.fiber.runtime.Config),
        hasToJSON: !!(entry && entry.fiber && entry.fiber.runtime && entry.fiber.runtime.Config && 'toJSON' in entry.fiber.runtime.Config)
      }
    }
    const all = rows.map(pick)
    let names = null
    try {
      const list = settings.describe({ redactSecrets: false })
      names = list.map((d) => String(d.ns))
    } catch (err) {
      names = ['error:' + String((err && err.message) || err)]
    }
    return {
      total: all.length,
      describeCount: names ? names.length : null,
      describeHasWhale: names ? names.some((n) => n.includes('whale')) : null,
      mine: all.filter((r) => /whale/.test(String(r.id) + String(r.name)))
    }
  } catch (err) {
    return { error: String((err && err.message) || err) }
  }
}

/** 设置页里的字段名 -> 运行时 settings 的字段名 */
const CONFIG_KEYS = [
  'scale',
  'refreshMs',
  'warnBelow',
  'dailyBudget',
  'turnPop',
  'soundOn',
  'soundVolume',
  'snap',
  'showPeak',
  'cacheInInput',
  'miniFields',
  'nickname',
  'language'
]

/** 把 DSH 设置页写入的 Config 合并进运行时 settings（只认明确给出的字段） */
function pickConfig(config) {
  if (!config || typeof config !== 'object') return {}
  const patch = {}
  for (const key of CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue
    if (config[key] === undefined) continue
    patch[key] = config[key]
  }
  return cleanupSettings(patch)
}

/**
 * 读「使用者亲手写进设置页」的那一层配置。
 *
 * 不能用 apply(ctx, config) 里的 config：cordis 会把整份 schema 强制归一化后传进来
 * （没填的字段被压成 min / true / []），照它写会把用户设置冲掉。
 * settings.describe() 的 descriptor.user 才是用户真正填过的字段。
 */
function readAuthoredSettings(ctx) {
  try {
    const settings = svc(ctx, 'settings')
    if (!settings || typeof settings.describe !== 'function') return { names: ['no-service'] }
    const list = settings.describe({ redactSecrets: false })
    if (!Array.isArray(list)) return { names: ['describe-not-array'] }
    const names = list.map((d) => (d && d.ns != null ? String(d.ns) : '?'))
    let found = null
    for (const d of list) {
      const ns = d && d.ns != null ? String(d.ns) : ''
      if (ns === PKG || ns === `include:${PKG}` || ns.endsWith(`/${PKG}`) || ns.endsWith(`:${PKG}`)) found = d
    }
    if (!found) return { names }
    return {
      names,
      authored: pickConfig(found.user),
      effective: pickConfig(found.value),
      revision: found.revision
    }
  } catch (err) {
    return { names: ['error:' + String((err && err.message) || err)] }
  }
}

/** 把设置页里的值同步进运行时（节流，20s 一次；/state 也会触发） */
function syncAuthoredSettings(ctx, store, force) {
  const now = Date.now()
  if (!force && store.state.configSyncedAt && now - store.state.configSyncedAt < 15000) return false
  store.state.configSyncedAt = now
  const read = readAuthoredSettings(ctx)
  if (!read) return false
  store.state.configProbe = read.names || null
  const source = Object.keys(read.authored || {}).length ? read.authored : {}
  store.state.configUser = read.authored
  if (!Object.keys(source).length) return false
  const merged = Object.assign({}, store.state.settings, source)
  const changed = JSON.stringify(merged) !== JSON.stringify(store.state.settings)
  if (!changed) return false
  store.state.settings = merged
  store.schedule()
  return true
}

const PRICING = {
  flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  pro: { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] }
}

function priceTier(model) {
  const m = String(model || '').toLowerCase()
  if (m.includes('pro') || m.includes('reasoner') || m.includes('r1')) return 'pro'
  return 'flash'
}

/* ------------------------------------------------------------------ */
/* 峰谷（北京时间 UTC+8，无夏令时，可以直接平移后取 UTC 分量） */
/* ------------------------------------------------------------------ */

const SHIFT = 8 * 3600 * 1000

function bjParts(ts) {
  const d = new Date((ts == null ? Date.now() : ts) + SHIFT)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay() // 0=周日 … 6=周六
  }
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

/** 北京时间的日期键 YYYY-MM-DD */
function dayKey(ts) {
  const p = bjParts(ts)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/** 北京时间当天 00:00 对应的 epoch ms */
function dayStart(ts) {
  const p = bjParts(ts)
  return Date.UTC(p.year, p.month - 1, p.day) - SHIFT
}

function isWeekend(ts) {
  const w = bjParts(ts).weekday
  return w === 0 || w === 6
}

function isPeakAt(ts) {
  if (isWeekend(ts)) return false
  const h = bjParts(ts).hour
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

/** 下一次峰谷切换的时间戳（用于倒计时） */
function nextSwitch(ts) {
  const base = ts == null ? Date.now() : ts
  const p = bjParts(base)
  const startOfDay = dayStart(base)
  const HOUR = 3600 * 1000
  const at = (h) => startOfDay + h * HOUR
  if (isWeekend(base)) {
    // 谷价 → 下一个工作日 9:00
    let addDays = 1
    let probe = startOfDay + 24 * HOUR
    while (isWeekend(probe)) {
      addDays += 1
      probe = startOfDay + addDays * 24 * HOUR
    }
    return probe + 9 * HOUR
  }
  const h = p.hour
  if (h < 9) return at(9)
  if (h < 12) return at(12)
  if (h < 14) return at(14)
  if (h < 18) return at(18)
  // 18:00 之后 → 次日规则
  let addDays = 1
  let probe = startOfDay + addDays * 24 * HOUR
  while (isWeekend(probe)) {
    addDays += 1
    probe = startOfDay + addDays * 24 * HOUR
  }
  return probe + 9 * HOUR
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const round8 = (n) => Math.round(n * 1e8) / 1e8
const clampNum = (v, min, max, fallback) => {
  const n = num(v)
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

function svc(ctx, name) {
  try {
    if (ctx && typeof ctx.get === 'function') {
      const v = ctx.get(name)
      if (v) return v
    }
  } catch {}
  try {
    const v = ctx ? ctx[name] : undefined
    if (v) return v
  } catch {}
  return undefined
}

function assetsDir() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets')
  } catch {
    return ''
  }
}

const assetCache = new Map()

/**
 * 读资源并带「文件签名」缓存：key 里含 mtime+size，换图后无需重载宿主即可生效。
 * 返回 { buf, etag } 或 null。
 */
function readAsset(name) {
  const candidates = [path.join(assetsDir(), name), path.join(dshHome(), 'dsh-ds-whale-assets', name)]
  for (const file of candidates) {
    try {
      const st = fs.statSync(file)
      const sig = `${file}:${Math.round(st.mtimeMs)}:${st.size}`
      const hit = assetCache.get(name)
      if (hit && hit.sig === sig) return hit
      const buf = fs.readFileSync(file)
      const entry = { sig, buf, etag: '"' + Math.round(st.mtimeMs).toString(36) + '-' + st.size.toString(36) + '"' }
      assetCache.set(name, entry)
      return entry
    } catch {}
  }
  assetCache.set(name, null)
  return null
}

function writeJson(res, status, body) {
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer'
    })
    res.end(JSON.stringify(body))
  } catch {}
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) return undefined
      chunks.push(chunk)
    }
  } catch {
    return undefined
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '0.0.0.0' || h === '::'
}

function isLoopbackSocket(req) {
  const ra = String((req.socket && req.socket.remoteAddress) || '')
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1'
}

/**
 * 请求栅栏：跨站请求直接拒；带 Origin 时必须同源；写操作必须是回环源（防止本机数据被改）
 */
function guard(req, res, opts) {
  const needWrite = !!(opts && opts.write)
  const hostHeader = String(req.headers.host || '')
  if (!hostHeader) {
    writeJson(res, 403, { ok: false, error: 'missing-host' })
    return false
  }
  let hostname = ''
  try {
    hostname = new URL('http://' + hostHeader).hostname
  } catch {
    writeJson(res, 403, { ok: false, error: 'bad-host' })
    return false
  }
  if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') {
    writeJson(res, 403, { ok: false, error: 'cross-site' })
    return false
  }
  const origin = req.headers.origin
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(String(origin)).host
    } catch {
      writeJson(res, 403, { ok: false, error: 'bad-origin' })
      return false
    }
    if (originHost !== hostHeader) {
      writeJson(res, 403, { ok: false, error: 'origin-mismatch' })
      return false
    }
  }
  if (isLoopbackHost(hostname)) {
    if (!isLoopbackSocket(req)) {
      writeJson(res, 403, { ok: false, error: 'not-loopback' })
      return false
    }
  } else if (needWrite) {
    writeJson(res, 403, { ok: false, error: 'write-requires-loopback' })
    return false
  }
  return true
}

/* ------------------------------------------------------------------ */
/* 状态存储 */
/* ------------------------------------------------------------------ */

function defaultSettings() {
  return {
    /** 挂件缩放 / Avatar scale 0.6 ~ 2 */
    scale: 1,
    /** 余额自动刷新间隔（秒） */
    refreshMs: 60000,
    /** 余额低于多少元时预警，0 = 关闭 */
    warnBelow: 5,
    /** 今日预算（元），0 = 关闭 / Daily budget in CNY (0 = off) */
    dailyBudget: 0,
    /** 每轮对话结束后弹泡泡 */
    turnPop: true,
    /** 泡泡自动关闭秒数，0 = 不自动关 */
    turnPopCloseMs: 6000,
    /** 音效音量 */
    soundOn: true,
    soundVolume: 0.3,
    /** 拖拽后吸附到最近的窗口边 */
    snap: true,
    /** 显示峰谷状态与倒计时 */
    showPeak: true,
    /** 上报的 inputTokens 是否已经包含 cacheReadTokens（DeepSeek 不含，默认 false） */
    cacheInInput: false,
    /** 头像旁边常驻气泡显示哪些参数（最多 3 个） */
    miniFields: ['balance', 'today'],
    /** 使用者昵称（留空则用「你」） */
    nickname: '',
    /** 界面语言：auto = 跟随系统区域，zh / en 为强制 */
    language: 'auto'
  }
}

function defaultDay() {
  return {
    /** 余额观测口径的消费（元） */
    spent: 0,
    /** 观测口径的充值（元） */
    topup: 0,
    /** 余额上跳的部分，记为「待核对余额调整」 */
    pendingAdjust: 0,
    /** 本机 usage 估算消费（元） */
    estimate: 0,
    /** 当日第一笔观测前的官网余额（对账基准） */
    base: null,
    /** estimate - spent 的偏差，用于自查价格表是否与官网一致 */
    drift: 0,
    entries: []
  }
}

function createStore(file) {
  const state = {
    v: 1,
    settings: defaultSettings(),
    balance: null,
    balanceFetchedAt: 0,
    balanceError: null,
    obs: null,
    days: {},
    lastTurn: null
  }

  let timer = null
  let writing = null

  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        if (parsed.settings && typeof parsed.settings === 'object') {
          Object.assign(state.settings, cleanupSettings(parsed.settings))
        }
        if (parsed.balance && typeof parsed.balance === 'object') state.balance = parsed.balance
        state.balanceFetchedAt = num(parsed.balanceFetchedAt)
        state.balanceError = parsed.balanceError || null
        if (parsed.obs && typeof parsed.obs === 'object') state.obs = parsed.obs
        if (parsed.days && typeof parsed.days === 'object') state.days = parsed.days
        if (parsed.lastTurn && typeof parsed.lastTurn === 'object') state.lastTurn = parsed.lastTurn
      }
    } catch {}
    pruneDays()
  }

  function pruneDays() {
    const keys = Object.keys(state.days).sort()
    if (keys.length <= KEEP_DAYS) return
    for (const key of keys.slice(0, keys.length - KEEP_DAYS)) delete state.days[key]
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, 400)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  function flush() {
    const payload = JSON.stringify(
      {
        v: state.v,
        settings: state.settings,
        balance: state.balance,
        balanceFetchedAt: state.balanceFetchedAt,
        balanceError: state.balanceError,
        obs: state.obs,
        days: state.days,
        lastTurn: state.lastTurn
      },
      null,
      0
    )
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, payload, 'utf8')
      fs.renameSync(tmp, file)
    } catch {}
  }

  function dispose() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    flush()
  }

  load()
  return { state, schedule, flush, dispose, pruneDays }
}

function cleanupSettings(input) {
  const s = defaultSettings()
  const out = {}
  const take = (key, coerce) => {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = coerce(input[key])
  }
  take('scale', (v) => clampNum(v, 0.6, 2, s.scale))
  take('refreshMs', (v) => Math.round(clampNum(v, 15000, 3600000, s.refreshMs)))
  take('warnBelow', (v) => clampNum(v, 0, 100000, s.warnBelow))
  take('dailyBudget', (v) => clampNum(v, 0, 100000, s.dailyBudget))
  take('turnPop', (v) => v !== false)
  take('turnPopCloseMs', (v) => Math.round(clampNum(v, 0, 120000, s.turnPopCloseMs)))
  take('soundOn', (v) => v !== false)
  take('soundVolume', (v) => clampNum(v, 0, 1, s.soundVolume))
  take('snap', (v) => v !== false)
  take('showPeak', (v) => v !== false)
  take('cacheInInput', (v) => v !== false)
  take('miniFields', (v) =>
    Array.isArray(v)
      ? v
          .filter((id) => typeof id === 'string' && MINI_FIELDS.includes(id))
          .filter((id, i, arr) => arr.indexOf(id) === i)
          .slice(0, 3)
      : []
  )
  take('nickname', (v) =>
    typeof v === 'string'
      ? v
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .trim()
          .slice(0, 16)
      : s.nickname
  )
  take('language', (v) => (v === 'zh' || v === 'en' || v === 'auto' ? v : s.language))
  return out
}

/* ------------------------------------------------------------------ */
/* 余额 */
/* ------------------------------------------------------------------ */

function normalizeApiBalance(payload) {
  if (!payload || typeof payload !== 'object') return null
  const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : []
  if (!infos.length) return null
  const pick =
    infos.find((i) => String((i && i.currency) || '').toUpperCase() === 'CNY') || infos[0] || {}
  const topped = num(pick.topped_up_balance)
  const granted = num(pick.granted_balance)
  const total = num(pick.total_balance) || topped + granted
  return {
    currency: String(pick.currency || 'CNY').toUpperCase(),
    total: total,
    topped: topped,
    granted: granted,
    available: payload.is_available !== false,
    source: 'api-key'
  }
}

function normalizeAccountBalance(balance) {
  if (!balance || balance.status !== 'ready') return null
  const wallets = Array.isArray(balance.value) ? balance.value : []
  const bonus = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : []
  const sum = (list) => list.reduce((acc, w) => acc + num(w && w.balance), 0)
  const topped = sum(wallets)
  const granted = sum(bonus)
  const currency = String((wallets[0] && wallets[0].currency) || (bonus[0] && bonus[0].currency) || 'CNY').toUpperCase()
  return {
    currency,
    total: topped + granted,
    topped,
    granted,
    available: true,
    source: 'account'
  }
}

async function fetchBalanceFromApiKey(ctx) {
  const credentials = svc(ctx, 'credentials')
  if (!credentials || typeof credentials.resolve !== 'function') return { skipped: 'no-credentials-service' }
  let resolved
  try {
    resolved = await credentials.resolve(API_KEY_REF)
  } catch (err) {
    return { error: 'credentials-resolve-failed: ' + ((err && err.message) || String(err)) }
  }
  const key = resolved && typeof resolved.value === 'string' ? resolved.value.trim() : ''
  if (!key) return { skipped: 'no-api-key' }
  let res
  try {
    res = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined
    })
  } catch (err) {
    return { error: 'network: ' + ((err && err.message) || String(err)) }
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {}
    return { error: `http-${res.status}` + (detail ? ': ' + detail : '') }
  }
  let payload
  try {
    payload = await res.json()
  } catch (err) {
    return { error: 'bad-json: ' + ((err && err.message) || String(err)) }
  }
  const normalized = normalizeApiBalance(payload)
  if (!normalized) return { error: 'empty-balance-infos' }
  return { balance: normalized }
}

async function fetchBalanceFromAccount(ctx) {
  const account = svc(ctx, 'deepseekAccount')
  if (!account || typeof account.getBalance !== 'function') return { skipped: 'no-account-service' }
  const meta = {
    version: '0.9.0',
    locale: 'zh',
    timezoneOffsetSeconds: -(new Date().getTimezoneOffset() * 60)
  }
  try {
    const balance = await Promise.race([
      account.getBalance(meta),
      new Promise((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS))
    ])
    const normalized = normalizeAccountBalance(balance)
    if (!normalized) return { error: 'account-balance-unavailable' }
    return { balance: normalized }
  } catch (err) {
    return { error: 'account: ' + ((err && err.message) || String(err)) }
  }
}

function applyObservation(store, balance) {
  const st = store.state
  const prev = st.obs
  const at = Date.now()
  const next = { at, total: round8(balance.total) }
  if (prev && Number.isFinite(prev.total) && Number.isFinite(balance.total)) {
    const delta = round8(balance.total - prev.total)
    const key = dayKey(at)
    const day = ensureDay(store, key)
    // 当日基准余额 = 今日第一笔观测之前那一刻的官网余额，供对账
    if (day.base === null || day.base === undefined) day.base = round8(prev.total)
    if (delta < -0.00000001) {
      day.spent = round8(day.spent + -delta)
    } else if (delta > 0.00000001) {
      day.topup = round8(day.topup + delta)
      day.pendingAdjust = round8(day.pendingAdjust + delta)
    }
    day.drift = round8(num(day.estimate) - num(day.spent))
  }
  st.obs = next
  st.balance = Object.assign({}, balance, { at })
  st.balanceFetchedAt = at
  st.balanceError = null
  store.schedule()
}

function ensureDay(store, key) {
  const st = store.state
  let day = st.days[key]
  if (!day || typeof day !== 'object') {
    day = defaultDay()
    st.days[key] = day
  }
  day.spent = num(day.spent)
  day.topup = num(day.topup)
  day.pendingAdjust = num(day.pendingAdjust)
  day.estimate = num(day.estimate)
  if (!Array.isArray(day.entries)) day.entries = []
  return day
}

/* ------------------------------------------------------------------ */
/* usage 记账                                                          */
/* ------------------------------------------------------------------ */

let inflightBalance = null
let bootRetry = 0

function sleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    if (t && typeof t.unref === 'function') t.unref()
  })
}

function kickBalance(ctx, store, force) {
  if (inflightBalance) return inflightBalance
  store.state.lastAttemptAt = Date.now()
  const run = (async () => {
    const primary = await fetchBalanceFromApiKey(ctx)
    let result = primary
    if (!result || !result.balance) {
      const fallback = await fetchBalanceFromAccount(ctx)
      if (fallback && fallback.balance) result = fallback
      else if (!result || (!result.skipped && !result.error)) result = fallback
    }
    const st = store.state
    if (result && result.balance) {
      bootRetry = 0
      applyObservation(store, result.balance)
      return st.balance
    }
    const message = (result && (result.error || result.skipped)) || 'unknown'
    st.balanceError = { at: Date.now(), message }
    store.schedule()
    // 启动早期 credentials / 账号服务可能还没挂上：退避重试，用户不必手点刷新
    if (/^no-(credentials|account)-service$/.test(message) && bootRetry < 8) {
      bootRetry += 1
      const wait = Math.min(60000, 4000 * bootRetry)
      setTimeout(() => {
        kickBalance(ctx, store, true)
      }, wait).unref?.()
    }
    return null
  })()
    .catch(() => null)
    .finally(() => {
      inflightBalance = null
    })
  inflightBalance = run
  return run
}

/** 数据太旧 / 上次取数失败 → 立刻补一次，最多等 2.5s 免得卡住首屏 */
async function ensureFresh(ctx, store, force) {
  const st = store.state
  const now = Date.now()
  const age = st.balanceFetchedAt ? now - st.balanceFetchedAt : Infinity
  const errAge = st.balanceError ? now - st.balanceError.at : Infinity
  const since = now - (num(st.lastAttemptAt) || 0)
  const interval = Math.max(15000, num(st.settings.refreshMs) || 60000)
  // 每次请求最多补一次，且两次上游请求之间至少间隔：无余额 5s / 报错 20s / 到期 interval
  const wants =
    force === true ||
    (!st.balance && since > 5000) ||
    (errAge > 10000 && since > 20000) ||
    (age > interval && since > Math.min(interval, 25000))
  if (!wants) return
  await Promise.race([kickBalance(ctx, store, force === true), sleep(2500)])
}

async function fetchAccountLinks(ctx, store) {
  const account = svc(ctx, 'deepseekAccount')
  if (!account || typeof account.getState !== 'function') return null
  try {
    const view = await Promise.race([account.getState(), sleep(1500).then(() => null)])
    const links = view && view.links
    if (!links) return null
    const out = { usageUrl: String(links.usageUrl || ''), topUpUrl: String(links.topUpUrl || '') }
    store.state.links = out
    store.schedule()
    return out
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 官网用量（Platform API，与官网用量页同源） */
/* ------------------------------------------------------------------ */

/** 今天 00:00（北京时间）对应的 epoch 秒 */
function bjDayStartSec(now) {
  const sec = Math.floor(now / 1000)
  return Math.floor((sec + BJ_TZ_SEC) / 86400) * 86400 - BJ_TZ_SEC
}

/** 下一个整点（北京时间）对应的 epoch 秒；官网接口要求 start/end 按整点对齐 */
function bjHourEndSec(now) {
  const sec = Math.floor(now / 1000)
  return Math.ceil((sec + BJ_TZ_SEC) / 3600) * 3600 - BJ_TZ_SEC
}

function emptyOfficial(now) {
  return {
    at: 0,
    dayStart: bjDayStartSec(now || Date.now()),
    end: 0,
    currency: 'CNY',
    cost: 0,
    requests: 0,
    tokens: { hit: 0, miss: 0, response: 0, total: 0 },
    models: [],
    hours: [],
    error: null
  }
}

/** 拿 DSH 账号登录态（origin + token + 部署头），用它签名 Platform 接口 */
async function fetchPlatformSession(ctx) {
  const account = svc(ctx, 'deepseekAccount')
  if (!account || typeof account.getPlatformSession !== 'function') {
    return { error: 'no-account-service' }
  }
  try {
    const session = await Promise.race([account.getPlatformSession(), sleep(2500).then(() => null)])
    if (!session || !session.token) return { error: 'no-platform-session' }
    const origin = String(session.origin || 'https://platform.deepseek.com').replace(/\/+$/, '')
    const headers = session.requestHeaders && typeof session.requestHeaders === 'object' ? session.requestHeaders : {}
    return { origin, token: String(session.token), headers }
  } catch (err) {
    return { error: 'session: ' + ((err && err.message) || String(err)) }
  }
}

async function platformUsageGet(session, apiPath, query) {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) search.set(k, String(v))
  const url = `${session.origin}${apiPath}?${search.toString()}`
  const headers = Object.assign({}, session.headers, {
    'x-dsh-auth-token': session.token,
    accept: 'application/json'
  })
  let res
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined
    })
  } catch (err) {
    throw new Error('network: ' + ((err && err.message) || String(err)))
  }
  if (!res.ok) throw new Error('http-' + res.status)
  let payload
  try {
    payload = await res.json()
  } catch (err) {
    throw new Error('bad-json: ' + ((err && err.message) || String(err)))
  }
  if (!payload || payload.code !== 0) {
    throw new Error('platform-code-' + ((payload && payload.code) || '?') + ': ' + ((payload && payload.msg) || ''))
  }
  const data = payload.data || {}
  if (data.biz_code !== 0) throw new Error('platform-biz-' + data.biz_code + ': ' + (data.biz_msg || ''))
  return data.biz_data || {}
}

let inflightOfficial = null
let officialRetry = 0

/** 拉今日官网用量：消费金额 / 请求次数 / tokens 全部来自官网 */
function fetchOfficialUsage(ctx, store, force) {
  if (inflightOfficial) return inflightOfficial
  const st = store.state
  store.state.lastOfficialAttemptAt = Date.now()
  const run = (async () => {
    const session = await fetchPlatformSession(ctx)
    if (session.error) {
      st.official = Object.assign(emptyOfficial(), { at: Date.now(), error: session.error })
      store.schedule()
      // 启动早期账号服务可能还没挂上：退避重试
      if (/^no-(account|platform)-|^session:/.test(session.error) && officialRetry < 6) {
        officialRetry += 1
        setTimeout(() => {
          fetchOfficialUsage(ctx, store, true)
        }, Math.min(60000, 5000 * officialRetry)).unref?.()
      }
      return null
    }
    const now = Date.now()
    const start = bjDayStartSec(now)
    const end = Math.max(start + 3600, bjHourEndSec(now))
    const query = { start, end, tz: BJ_TZ_SEC }
    let amount
    let cost
    try {
      ;[amount, cost] = await Promise.all([
        platformUsageGet(session, USAGE_AMOUNT_PATH, query),
        platformUsageGet(session, USAGE_COST_PATH, query)
      ])
    } catch (err) {
      st.official = Object.assign(emptyOfficial(now), { at: now, error: (err && err.message) || String(err) })
      store.schedule()
      return null
    }

    const perModel = new Map()
    const perHour = new Map()
    const bump = (model, hour, field, delta) => {
      if (!delta) return
      if (model) {
        const acc = perModel.get(model) || { model, cost: 0, requests: 0, hit: 0, miss: 0, response: 0 }
        acc[field] += delta
        perModel.set(model, acc)
      }
      if (hour != null) {
        const acc = perHour.get(hour) || { time: hour, cost: 0, requests: 0, hit: 0, miss: 0, response: 0 }
        acc[field] += delta
        perHour.set(hour, acc)
      }
    }

    let requests = 0
    let hit = 0
    let miss = 0
    let response = 0
    for (const series of Array.isArray(amount.series) ? amount.series : []) {
      const model = String(series.model || '')
      for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
        const u = (bucket && bucket.usage) || {}
        const r = num(u.REQUEST)
        const h = num(u.PROMPT_CACHE_HIT_TOKEN)
        const m = num(u.PROMPT_CACHE_MISS_TOKEN)
        const o = num(u.RESPONSE_TOKEN)
        requests += r
        hit += h
        miss += m
        response += o
        bump(model, bucket.time, 'requests', r)
        bump(model, bucket.time, 'hit', h)
        bump(model, bucket.time, 'miss', m)
        bump(model, bucket.time, 'response', o)
      }
    }

    let currency = 'CNY'
    let costSum = 0
    const costByCurrency = new Map()
    for (const cur of Array.isArray(cost.data) ? cost.data : []) {
      const code = String(cur.currency || 'CNY')
      for (const series of Array.isArray(cur.series) ? cur.series : []) {
        const model = String(series.model || '')
        for (const bucket of Array.isArray(series.buckets) ? series.buckets : []) {
          const c = num(bucket && bucket.cost)
          if (!c) continue
          costByCurrency.set(code, round8(num(costByCurrency.get(code)) + c))
          bump(model, bucket.time, 'cost', c)
        }
      }
    }
    if (costByCurrency.has('CNY')) currency = 'CNY'
    else if (costByCurrency.size) currency = Array.from(costByCurrency.keys())[0]
    costSum = round8(num(costByCurrency.get(currency)))

    const models = Array.from(perModel.values())
      .map((m) => ({
        model: m.model,
        cost: round8(m.cost),
        requests: m.requests,
        tokens: m.hit + m.miss + m.response,
        hit: m.hit,
        miss: m.miss,
        response: m.response
      }))
      .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
      .slice(0, 12)

    const hours = Array.from(perHour.values())
      .sort((a, b) => a.time - b.time)
      .map((h) => ({
        time: h.time,
        cost: round8(h.cost),
        requests: h.requests,
        tokens: h.hit + h.miss + h.response
      }))

    officialRetry = 0
    st.official = {
      at: now,
      dayStart: start,
      end,
      currency,
      cost: costSum,
      requests,
      tokens: { hit, miss, response, total: hit + miss + response },
      models,
      hours,
      error: null
    }
    store.schedule()
    return st.official
  })()
    .catch(() => null)
    .finally(() => {
      inflightOfficial = null
    })
  inflightOfficial = run
  return run
}

/** 官网用量节流自愈：默认 45s 内不重复打接口，force 时立刻拉 */
async function ensureOfficialFresh(ctx, store, force) {
  const st = store.state
  const now = Date.now()
  const art = st.official
  if (force !== true && art && art.at) {
    const sameDay = art.dayStart === bjDayStartSec(now)
    const age = now - art.at
    if (sameDay && !art.error && age < 45000) return art
    if (sameDay && now - (num(st.lastOfficialAttemptAt) || 0) < 15000) return art
  }
  await Promise.race([fetchOfficialUsage(ctx, store, force === true), sleep(3000)])
  return store.state.official
}

function usageNumbers(usage, cacheInInput) {
  const hit = Math.max(num(usage && usage.cacheReadTokens), 0)
  const input = Math.max(num(usage && usage.inputTokens), 0)
  const cachedWrite = Math.max(num(usage && usage.cacheWriteTokens), 0)
  const out = Math.max(num(usage && usage.outputTokens) || num(usage && usage.reasoningTokens), 0)
  const miss = cacheInInput ? Math.max(input - hit, 0) : input
  return { hit, miss, input, out, cachedWrite }
}

function costOf(model, usage, peak, cacheInInput) {
  const tier = priceTier(model)
  const table = PRICING[tier]
  const slot = peak ? 1 : 0
  const u = usageNumbers(usage, cacheInInput)
  const cost = (u.hit * table.hit[slot] + u.miss * table.miss[slot] + u.out * table.out[slot]) / 1e6
  return { cost: round8(cost), tier, u }
}

function wireUsageTracking(ctx, store) {
  const turns = new Map()
  const seen = new Map()

  const dropOld = () => {
    if (turns.size > 400) {
      const keys = Array.from(turns.keys()).slice(0, turns.size - 300)
      for (const k of keys) turns.delete(k)
    }
    if (seen.size > 400) {
      const keys = Array.from(seen.keys()).slice(0, seen.size - 300)
      for (const k of keys) seen.delete(k)
    }
  }

  const onEvent = (session, event) => {
    if (!event || typeof event !== 'object') return
    const type = event.type
    if (type !== 'assistant/message' && type !== 'turn/end') return
    const sessionId = (session && (session.id || session.sessionId)) || 'unknown'
    const data = event.data || {}

    if (type === 'assistant/message') {
      const turn = num(data.turn)
      const key = `${sessionId}:${turn}`
      const seq = num(event.seq)
      // seq 去重：同一条事件重复投递时跳过
      const prevSeq = seen.get(key)
      if (Number.isFinite(seq) && seq > 0 && prevSeq != null && seq <= prevSeq) return
      if (Number.isFinite(seq) && seq > 0) seen.set(key, seq)

      const usage = data.usage
      if (!usage || typeof usage !== 'object') return
      const model = (data.message && data.message.source && data.message.source.model) || ''
      const peak = isPeakAt(Date.now())
      const calc = costOf(model, usage, peak, store.state.settings.cacheInInput)
      const bucket = turns.get(key) || {
        sessionId,
        turn,
        model: '',
        cost: 0,
        hit: 0,
        input: 0,
        out: 0,
        steps: 0,
        startedAt: Date.now(),
        peak
      }
      bucket.model = bucket.model || model
      bucket.cost = round8(bucket.cost + calc.cost)
      bucket.hit += calc.u.hit
      bucket.input += calc.u.input
      bucket.out += calc.u.out
      bucket.steps += 1
      bucket.peak = bucket.peak || peak
      turns.set(key, bucket)
      dropOld()
      return
    }

    // turn/end：把整轮结算进 lastTurn + 写入当日 entries
    const turn = num(data.turn)
    const key = `${sessionId}:${turn}`
    const bucket = turns.get(key)
    turns.delete(key)
    if (!bucket || !bucket.cost) return
    const at = Date.now()
    const day = ensureDay(store, dayKey(at))
    day.estimate = round8(day.estimate + bucket.cost)
    const entry = {
      t: at,
      model: bucket.model || 'deepseek',
      tier: priceTier(bucket.model),
      cost: bucket.cost,
      input: bucket.input,
      output: bucket.out,
      hit: bucket.hit,
      steps: bucket.steps,
      peak: !!bucket.peak
    }
    day.entries.push(entry)
    if (day.entries.length > 4000) day.entries.splice(0, day.entries.length - 4000)
    const reason = (data.reason && data.reason.kind) || 'completed'
    store.state.lastTurn = Object.assign({}, entry, {
      t: at,
      turn: bucket.turn,
      sessionId: bucket.sessionId,
      reason
    })
    store.schedule()
  }

  const disposer = ctx.on('session/event', onEvent)
  return () => {
    try {
      if (typeof disposer === 'function') disposer()
      else if (typeof ctx.off === 'function') ctx.off('session/event', onEvent)
    } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* 汇总给前端的 payload */
/* ------------------------------------------------------------------ */

function officialToday(st, now) {
  const o = st && st.official
  if (!o) return null
  const stamp = now == null ? Date.now() : now
  if (o.dayStart !== bjDayStartSec(stamp)) return null
  return o
}

function aggregate(store) {
  const st = store.state
  const now = Date.now()
  const today = dayKey(now)
  const todayDay = st.days[today] || null
  const recent = []
  for (let i = 0; i < 14; i += 1) {
    const ts = now - i * 86400000
    const key = dayKey(ts)
    const day = st.days[key]
    recent.push({
      date: key,
      spent: day ? round8(day.spent) : 0,
      topup: day ? round8(day.topup) : 0,
      estimate: day ? round8(day.estimate) : 0,
      pendingAdjust: day ? round8(day.pendingAdjust) : 0,
      count: day && Array.isArray(day.entries) ? day.entries.length : 0
    })
  }

  let totalSpent = 0
  let totalTopup = 0
  let totalEstimate = 0
  let last7Spent = 0
  let last7Estimate = 0
  let entryCount = 0
  const sevenAgo = dayStart(now) - 6 * 86400000
  const modelMap = new Map()

  for (const key of Object.keys(st.days)) {
    const day = st.days[key]
    if (!day || typeof day !== 'object') continue
    const spent = num(day.spent)
    const topup = num(day.topup)
    const estimate = num(day.estimate)
    totalSpent += spent
    totalTopup += topup
    totalEstimate += estimate
    if (dayStart(new Date(key + 'T00:00:00Z').getTime() + SHIFT) >= sevenAgo) {
      last7Spent += spent
      last7Estimate += estimate
    }
    if (Array.isArray(day.entries)) {
      entryCount += day.entries.length
      for (const e of day.entries) {
        const name = (e && e.model) || 'unknown'
        const acc = modelMap.get(name) || { model: name, cost: 0, count: 0 }
        acc.cost = round8(acc.cost + num(e && e.cost))
        acc.count += 1
        modelMap.set(name, acc)
      }
    }
  }

  const models = Array.from(modelMap.values()).sort((a, b) => b.cost - a.cost).slice(0, 8)

  return {
    today: {
      date: today,
      spent: todayDay ? round8(num(todayDay.spent)) : 0,
      topup: todayDay ? round8(num(todayDay.topup)) : 0,
      estimate: todayDay ? round8(num(todayDay.estimate)) : 0,
      pendingAdjust: todayDay ? round8(num(todayDay.pendingAdjust)) : 0,
      base: todayDay && Number.isFinite(Number(todayDay.base)) ? round8(todayDay.base) : null,
      drift: todayDay ? round8(num(todayDay.estimate) - num(todayDay.spent)) : 0,
      count: todayDay && Array.isArray(todayDay.entries) ? todayDay.entries.length : 0,
      official: officialToday(st, now)
    },
    recent,
    totals: {
      spent: round8(totalSpent),
      topup: round8(totalTopup),
      estimate: round8(totalEstimate),
      last7Spent: round8(last7Spent),
      last7Estimate: round8(last7Estimate),
      turns: entryCount,
      days: Object.keys(st.days).length
    },
    models,
    todayEntries: todayDay && Array.isArray(todayDay.entries) ? todayDay.entries.slice(-40).reverse() : []
  }
}

function peakInfo(now) {
  const peak = isPeakAt(now)
  const next = nextSwitch(now)
  return {
    isPeak: peak,
    label: peak ? '高峰' : '空闲',
    nextChangeAt: next,
    secondsLeft: Math.max(0, Math.round((next - now) / 1000)),
    weekend: isWeekend(now),
    serverNow: now
  }
}

function statePayload(ctx, store, extra) {
  const st = store.state
  const now = Date.now()
  const agg = aggregate(store)
  const tierModel = 'deepseek-flash'
  const peak = peakInfo(now)
  const table = PRICING[priceTier(tierModel)]
  const slot = peak.isPeak ? 1 : 0
  return Object.assign(
    {
      ok: true,
      version: '0.9.0',
      settings: Object.assign({}, st.settings),
      balance: st.balance,
      balanceAge: st.balanceFetchedAt ? now - st.balanceFetchedAt : null,
      balanceError: st.balanceError,
      peak: peak,
      price: {
        currency: 'CNY',
        unit: '元 / 百万 tokens',
        slot: peak.isPeak ? 'peak' : 'idle',
        flash: {
          hit: table.hit[slot],
          miss: table.miss[slot],
          out: table.out[slot]
        },
        pro: {
          hit: PRICING.pro.hit[slot],
          miss: PRICING.pro.miss[slot],
          out: PRICING.pro.out[slot]
        }
      },
      today: agg.today,
      recent: agg.recent,
      totals: agg.totals,
      models: agg.models,
      todayEntries: agg.todayEntries,
      lastTurn: st.lastTurn,
      links: st.links || null,
      official: officialToday(st, now),
      officialRaw: st.official || null,
      configUser: st.configUser || null,
      configProbe: st.configProbe || null,
      settingsPage: st.settingsPage || null,
      schema: schemaDiagnostics(),
      configEntries: configEntryDiagnostics(ctx),
      clientInfo: st.clientInfo || null,
      dataFile: path.join(dshHome(), DATA_FILE_NAME)
    },
    extra || {}
  )
}

/* ------------------------------------------------------------------ */
/* 路由 */
/* ------------------------------------------------------------------ */

function makeRoutes(ctx, store) {
  const routes = []

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/client-hello`,
    handler: async (req, res) => {
      if (!guard(req, res, { write: true })) return
      const body = (await readJsonBody(req)) || {}
      store.state.clientInfo = {
        at: Date.now(),
        build: typeof body.build === 'string' ? body.build.slice(0, 40) : null,
        mood: typeof body.mood === 'string' ? body.mood.slice(0, 20) : null,
        bubble: typeof body.bubble === 'string' ? body.bubble.slice(0, 20) : null,
        px: num(body.px) || null
      }
      store.schedule()
      writeJson(res, 200, { ok: true })
    }
  })

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/avatar.png`,
    handler: (req, res) => {
      const url = String(req.url || '')
      const size = /[?&]size=128\b/.test(url) ? 128 : 512
      const moodMatch = /[?&]mood=([a-z]+)\b/.exec(url)
      const mood = moodMatch ? moodMatch[1] : 'calm'
      const moodFile = MOOD_FILES[mood] || null
      const name = moodFile
        ? size === 128
          ? moodFile.replace(/\.png$/, '-128.png')
          : moodFile
        : size === 128
          ? 'whale-128.png'
          : 'whale.png'
      const asset = readAsset(name)
      if (!asset) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('avatar missing')
        return
      }
      // 允许浏览器缓存，但每次回源校验 ETag —— 换图后 F5 立刻看到新形象
      const inm = req.headers['if-none-match']
      if (inm && String(inm) === asset.etag) {
        res.writeHead(304, { etag: asset.etag, 'cache-control': 'no-cache' })
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': asset.buf.length,
        etag: asset.etag,
        'cache-control': 'no-cache',
        'referrer-policy': 'no-referrer'
      })
      res.end(asset.buf)
    }
  })

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: async (req, res) => {
      if (!guard(req, res, { write: false })) return
      const body = (await readJsonBody(req)) || {}
      try {
        syncAuthoredSettings(ctx, store, body.refresh === true)
      } catch {}
      await Promise.all([ensureFresh(ctx, store, body.refresh === true), ensureOfficialFresh(ctx, store, body.refresh === true)])
      if (!store.state.links) await fetchAccountLinks(ctx, store)
      writeJson(res, 200, statePayload(ctx, store))
    }
  })

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/refresh`,
    handler: async (req, res) => {
      if (!guard(req, res, { write: true })) return
      await Promise.all([kickBalance(ctx, store, true), fetchOfficialUsage(ctx, store, true)])
      writeJson(res, 200, statePayload(ctx, store))
    }
  })

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/settings`,
    handler: async (req, res) => {
      if (!guard(req, res, { write: true })) return
      const body = (await readJsonBody(req)) || {}
      // config：写进 profile patch（DSH 设置页看到的那一层，重启也在）
      if (body.config && typeof body.config === 'object') {
        const settings = svc(ctx, 'settings')
        if (!settings || typeof settings.update !== 'function') {
          writeJson(res, 200, statePayload(ctx, store, { patched: [], error: 'no-settings-service' }))
          return
        }
        const authored = pickConfig(body.config)
        try {
          await settings.update(PKG, authored)
        } catch (err) {
          writeJson(res, 200, statePayload(ctx, store, { patched: [], error: String((err && err.message) || err) }))
          return
        }
        syncAuthoredSettings(ctx, store, true)
        writeJson(res, 200, statePayload(ctx, store, { patched: Object.keys(authored) }))
        return
      }
      const patch = body.patch && typeof body.patch === 'object' ? body.patch : body
      const cleaned = cleanupSettings(patch || {})
      Object.assign(store.state.settings, cleaned)
      store.schedule()
      writeJson(res, 200, statePayload(ctx, store, { patched: Object.keys(cleaned) }))
    }
  })

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/ledger`,
    handler: async (req, res) => {
      if (!guard(req, res, { write: true })) return
      const body = (await readJsonBody(req)) || {}
      const action = String(body.action || '')
      if (action === 'clear-today') {
        const key = dayKey(Date.now())
        const day = ensureDay(store, key)
        day.spent = 0
        day.topup = 0
        day.pendingAdjust = 0
        day.estimate = 0
        day.entries = []
      } else if (action === 'clear-all') {
        store.state.days = {}
      } else if (action === 'ack-adjust') {
        const key = dayKey(Date.now())
        ensureDay(store, key).pendingAdjust = 0
      } else if (action === 'rebaseline') {
        store.state.obs = null
      }
      store.schedule()
      writeJson(res, 200, statePayload(ctx, store, { action }))
    }
  })

  routes.push({
    kind: 'exact',
    path: `${API_PREFIX}/history`,
    handler: async (req, res) => {
      if (!guard(req, res, { write: false })) return
      const body = (await readJsonBody(req)) || {}
      const query = String(body.query || '').trim().toLowerCase()
      const date = String(body.date || '').trim()
      const out = []
      const keys = Object.keys(store.state.days).sort().reverse()
      for (const key of keys) {
        if (date && key !== date) continue
        const day = store.state.days[key]
        if (!day || !Array.isArray(day.entries)) continue
        for (let i = day.entries.length - 1; i >= 0; i -= 1) {
          const e = day.entries[i]
          if (!e) continue
          if (query) {
            const hay = `${e.model || ''} ${key} ${e.tier || ''}`.toLowerCase()
            if (!hay.includes(query)) continue
          }
          out.push(Object.assign({ date: key }, e))
          if (out.length >= 300) break
        }
        if (out.length >= 300) break
      }
      let sum = 0
      const models = new Map()
      for (const e of out) {
        sum += num(e.cost)
        const name = e.model || 'unknown'
        const acc = models.get(name) || { model: name, cost: 0, count: 0 }
        acc.cost = round8(acc.cost + num(e.cost))
        acc.count += 1
        models.set(name, acc)
      }
      writeJson(res, 200, {
        ok: true,
        entries: out,
        sum: round8(sum),
        count: out.length,
        models: Array.from(models.values()).sort((a, b) => b.cost - a.cost)
      })
    }
  })

  return routes
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

export const __internals = {
  PRICING,
  priceTier,
  dayKey,
  dayStart,
  isWeekend,
  isPeakAt,
  nextSwitch,
  peakInfo,
  costOf,
  usageNumbers,
  bjDayStartSec,
  bjHourEndSec,
  officialToday,
  fetchOfficialUsage,
  ensureOfficialFresh,
  fetchPlatformSession,
  normalizeApiBalance,
  normalizeAccountBalance,
  cleanupSettings,
  dshHome
}

export function apply(ctx, config) {
  const store = createStore(path.join(dshHome(), DATA_FILE_NAME))

  // 设置页（DSH Settings 里的自动表单）里的值，以用户真正填过的那层为准
  try {
    syncAuthoredSettings(ctx, store, true)
  } catch {}

  // usage 记账（整进程生命周期）
  try {
    ctx.effect(() => wireUsageTracking(ctx, store), `${PKG}: usage tracking`)
  } catch {
    wireUsageTracking(ctx, store)
  }

  // 首次启动预热一次余额（服务可能还没挂上，kickBalance 内部会退避重试）
  try {
    kickBalance(ctx, store, false)
  } catch {}

  // 首次启动预热一次官网用量
  try {
    fetchOfficialUsage(ctx, store, false)
  } catch {}

  // 后台保活：即使浏览器没开，也持续用官网余额口径记账
  try {
    ctx.effect(() => {
      const tick = () => {
        const st = store.state
        const age = st.balanceFetchedAt ? Date.now() - st.balanceFetchedAt : Infinity
        const interval = Math.max(15000, num(st.settings.refreshMs) || 60000)
        if (!st.balance || age > interval) kickBalance(ctx, store, false)
        // 官网用量：白天每 60s 对齐刷新一次（后台限流下也不会更慢）
        const offAge = st.official && st.official.at ? Date.now() - st.official.at : Infinity
        if (offAge > 60000) fetchOfficialUsage(ctx, store, false)
        // 设置页（DSH Settings）里改过的值，节流同步进来
        try {
          syncAuthoredSettings(ctx, store, false)
        } catch {}
      }
      const timer = setInterval(tick, 20000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => clearInterval(timer)
    }, `${PKG}: balance keepalive`)
  } catch {}

  // 官网用量 / 充值入口链接
  try {
    fetchAccountLinks(ctx, store)
  } catch {}

  // 设置页：在 DSH 设置里生成本插件的表单（auto: true → 宿主按 Config schema 自动渲染）
  try {
    ctx.inject(['settings'], (sctx) => {
      sctx.effect(() => {
        const settings = sctx.settings
        const diag = { injected: true, service: !!settings, configure: typeof (settings && settings.configure) }
        store.state.settingsPage = diag
        if (!settings || typeof settings.configure !== 'function') return () => {}
        const owner = ctx.fiber || sctx.fiber
        try {
          const dispose = settings.configure({ auto: true }, owner)
          diag.ok = true
          store.state.settingsPage = diag
          return typeof dispose === 'function' ? dispose : () => {}
        } catch (err) {
          diag.ok = false
          diag.error = String((err && err.message) || err)
          store.state.settingsPage = diag
          return () => {}
        }
      }, `${PKG}: settings page`)

      // 设置页改完立刻同步（事件在 emit 栈里，延后再读，别和写入路径抢）
      sctx.effect(() => {
        const onUpdated = () => {
          const timer = setTimeout(() => {
            try {
              syncAuthoredSettings(ctx, store, true)
            } catch {}
          }, 150)
          if (timer && typeof timer.unref === 'function') timer.unref()
        }
        let dispose = null
        try {
          dispose = sctx.on('settings/document-updated', onUpdated)
        } catch {}
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, `${PKG}: settings sync`)
    })
  } catch (err) {
    store.state.settingsPage = { injected: false, error: String((err && err.message) || err) }
  }

  // HTTP 路由
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const routes = makeRoutes(sctx, store)
      const disposers = []
      for (const route of routes) {
        try {
          const dispose = sctx.webServer.register(route)
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch (err) {
          try {
            console.warn(`[${PKG}] route ${route.path} failed: ${(err && err.message) || err}`)
          } catch {}
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
      }
    }, `${PKG}: routes`)
  })

  try {
    ctx.effect(
      () => () => {
        try {
          store.dispose()
        } catch {}
      },
      `${PKG}: store flush`
    )
  } catch {}
}


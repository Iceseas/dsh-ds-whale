/**
 * dsh-ds-whale — DeepSeek 专用小鲸鱼挂件（Client 侧）
 * 挂在 shell.overlay 浮动层：右下角常驻小鲸鱼 + 可展开面板。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ds-whale',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback, useMemo } = React

    const API = '/api/dsh-ds-whale'
    const POS_KEY = 'dsh-ds-whale:pos'
    /** 位置存档版本：v2 = { side, dx, ry }「贴哪一边 + 距那条边多远」；v1 是 { rx, ry }「距右边多远」 */
    const POS_VER = 2
    const SIZE_KEY = 'dsh-ds-whale:size'
    const SEEN_KEY = 'dsh-ds-whale:lastTurn'
    const WHALE_PX = 124
    const AVATAR_BIG = API + '/avatar.png?size=512&v=6'
    const AVATAR_ANGRY = API + '/avatar.png?size=512&v=6&mood=angry'
    const AVATAR_BLUSH = API + '/avatar.png?size=512&v=6&mood=blush'
    const AVATAR_PANIC = API + '/avatar.png?size=512&v=6&mood=panic'
    const AVATAR_GREET = API + '/avatar.png?size=512&v=6&mood=greet'
    const AVATAR_THINK = API + '/avatar.png?size=512&v=6&mood=think'
    const HIT_MS = 1500
    const BUILD = 'v0.9.11'
    /** 点鲸鱼刷新的最小间隔兜底（设置里的 clickCooldownMs 优先） */
    const CLICK_COOLDOWN_MS = 6000
    /** 刷新动效的最短展示时间：请求再快也让用户看见「正在刷新」 */
    const REFRESH_MIN_MS = 620
    /** 开机问候延迟：等首帧布局稳定再冒泡 */
    const GREET_DELAY_MS = 700
    /** 右键菜单宽度 */
    const MENU_W = 214
    /** 右键菜单整体高度上限（5 项 + 底部提示），用来把菜单收回窗口内 */
    const MENU_H = 250
    /** 账号服务没给链接时的兜底充值页 */
    const TOPUP_FALLBACK = 'https://platform.deepseek.com/top_up'
    /** 窗口顶部安全区：和官方浮层（dockkit）同一套口径 —— 标题栏高度 + 20px */
    const TOP_GAP = 20

    /* 桌面端窗口是「内容延伸到标题栏下面」的类型（— □ ✕ 浮在画面上），
       webview 视口把标题栏那一截也算进 innerHeight，于是拖到最上面时
       鲸鱼的头会钻到标题栏底下被盖住。DSH 自己在 <html> 上挂了
       data-windows-titlebar + --dsh-windows-titlebar-height（当前 40px），
       全屏时再加 data-fullscreen；读它比猜稳，env() 只作变量尚未就绪时的兜底。 */
    function titlebarInset() {
      let h = 0
      try {
        const html = document.documentElement
        if (html && html.hasAttribute('data-windows-titlebar') && !html.hasAttribute('data-fullscreen')) {
          const css = getComputedStyle(html).getPropertyValue('--dsh-windows-titlebar-height')
          const n = Number.parseFloat(css)
          if (Number.isFinite(n) && n > 0) return n
          const probe = document.createElement('div')
          probe.setAttribute('aria-hidden', 'true')
          probe.style.cssText =
            'position:fixed;left:-9999px;top:0;width:1px;height:env(titlebar-area-height,0px);' +
            'pointer-events:none;visibility:hidden'
          document.body.appendChild(probe)
          h = Math.round(probe.getBoundingClientRect().height) || 0
          probe.remove()
        }
      } catch {}
      return Math.max(0, h)
    }

    /* ---------------- 位置存档 / 视口订阅 ----------------
       0.9.10 起位置按「贴在哪个边 + 距该边多远」存（side + dx + ry）：
       窗口拉大时贴左的鲸鱼继续贴左，不再因为「距右距离」这个绝对值不变而漂到中间。
       v1 的旧存档 { rx, ry } 会按当前视口搬一次（当时靠左的就搬成贴左），位置基本不跳。 */
    function readDockPos() {
      try {
        const raw = window.localStorage.getItem(POS_KEY)
        if (raw) {
          const p = JSON.parse(raw)
          if (
            p &&
            p.v === POS_VER &&
            (p.side === 'left' || p.side === 'right') &&
            Number.isFinite(p.dx) &&
            Number.isFinite(p.ry)
          ) {
            return { side: p.side, dx: p.dx, ry: p.ry }
          }
          if (p && Number.isFinite(p.rx) && Number.isFinite(p.ry)) {
            /* v1 只有「距右边多远」。先原样按贴右还原（视觉和旧版一致），
               等视口量准了再由组件按几何位置决定该贴哪一边，并写回 v2 */
            return { side: 'right', dx: p.rx, ry: p.ry, legacy: true }
          }
        }
      } catch {}
      return { side: 'right', dx: 22, ry: 20 }
    }

    function writeDockPos(p) {
      if (!p) return
      try {
        window.localStorage.setItem(
          POS_KEY,
          JSON.stringify({
            v: POS_VER,
            side: p.side === 'left' ? 'left' : 'right',
            dx: Math.round(p.dx * 10) / 10,
            ry: Math.round(p.ry * 10) / 10
          })
        )
      } catch {}
    }

    function readViewport() {
      return {
        vw: Math.max(0, Math.round(window.innerWidth || 0)),
        vh: Math.max(0, Math.round(window.innerHeight || 0)),
        tb: titlebarInset()
      }
    }

    /* 视口尺寸 + 标题栏高度一起订阅：窗口恢复尺寸（Electron 常在首帧之后才把真实大小给 webview）、
       改缩放、切全屏、标题栏样式迟到，任何一种都要重算位置，否则鲸鱼会停在窗外/标题栏底下 */
    function useViewport() {
      const [vp, setVp] = useState(readViewport)
      useEffect(() => {
        let raf = 0
        const apply = () => {
          raf = 0
          const next = readViewport()
          setVp((prev) => (prev.vw === next.vw && prev.vh === next.vh && prev.tb === next.tb ? prev : next))
        }
        const sync = () => {
          if (raf) return
          if (typeof window.requestAnimationFrame === 'function') raf = window.requestAnimationFrame(apply)
          else apply()
        }
        /* 窗口恢复尺寸可能晚于首帧，且个别窗口管理器不发 resize：开头几拍主动补测几次 */
        const timers = [60, 180, 400, 900, 1800].map((ms) => window.setTimeout(apply, ms))
        window.addEventListener('resize', sync)
        window.addEventListener('orientationchange', sync)
        window.addEventListener('focus', sync)
        document.addEventListener('visibilitychange', sync)
        const vv = window.visualViewport
        if (vv && typeof vv.addEventListener === 'function') vv.addEventListener('resize', sync)
        let ro = null
        try {
          if (typeof ResizeObserver === 'function') {
            ro = new ResizeObserver(sync)
            ro.observe(document.documentElement)
          }
        } catch {}
        return () => {
          timers.forEach((t) => window.clearTimeout(t))
          if (raf && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(raf)
          window.removeEventListener('resize', sync)
          window.removeEventListener('orientationchange', sync)
          window.removeEventListener('focus', sync)
          document.removeEventListener('visibilitychange', sync)
          if (vv && typeof vv.removeEventListener === 'function') vv.removeEventListener('resize', sync)
          if (ro) {
            try {
              ro.disconnect()
            } catch {}
          }
        }
      }, [])
      return vp
    }

    /* ---------------- 语言（中英双语，默认跟随系统） ---------------- */

    let LANG = 'zh'

    /** 中文原文 → English；键就是代码里写的中文，改成英文只查这张表 */
    const EN = {
      " / 出 ": " / out ",
      " / 预算 ¥": " / budget ¥",
      " · 今日 ¥": " · today ¥",
      " · 今日已用取官网用量接口（唯一权威口径），本机 token 估算只作对照": " · today's spend comes from the official usage API (the only authoritative source); local token estimates are for reference only",
      " · 起始余额 ¥": " · base balance ¥",
      " · 入 ": " · in ",
      " · 数据只存在本机": " · data stays on this machine",
      " · 与本机估算偏差 ": " · vs local estimate ±",
      " · 预警线 ¥": " · alert line ¥",
      " · 预算 ¥": " · budget ¥",
      " 本机估算": " local estimate",
      " 出 ": " out ",
      " 次请求 · ": " requests · ",
      " 观测消费": " observed spend",
      " 花出去啦，钱包还没皱眉。": " spent. The wallet did not even flinch.",
      " 啦，": " at, ",
      " 了，我记账记到手软。": ", my paws hurt from bookkeeping.",
      " 了……": " left…",
      " 轮": " rounds",
      " 轮记账": " rounds logged",
      " 秒": "s",
      " 哦……这话不便宜，但是值得。": "… not cheap, but worth it.",
      " 全花在这轮上了，我尾巴都竖起来了。": " all in one single round. Even my tail stood up.",
      " 呀，安心聊。": ". Chat away, no worries.",
      "！钱包在发抖，咱悠着点好不好。": "! My wallet is shaking. Easy there, okay?",
      "（待核对余额调整）": " (pending balance adjustment)",
      "（每 4 秒自动重试）": " (retrying every 4s)",
      "（自动重试中，": " (retrying; ",
      "，半根冰棍的钱，我替你记住了。": " — half an ice pop. Filed away.",
      "，比一粒气泡还轻，我都懒得记账。": " — lighter than a bubble, barely worth logging.",
      "，不多不少，正好一口气泡。": ", exactly one bubble of air.",
      "，超过预算 ¥": ", over the ¥",
      "，明天再战？": " budget. Again tomorrow?",
      "，我先替你把账记明白。": ". I will keep the books straight for you.",
      "，我有点心疼了哦。": "… a little sting, honestly.",
      "，我在心里数了三遍。": " — I counted it three times in my head.",
      "[dsh-ds-whale] settings section 注册失败：": "[dsh-ds-whale] failed to register the settings section: ",
      "……嗯，基本等于没花。": "… basically nothing spent.",
      "DeepSeek 小鲸鱼": "DeepSeek whale",
      "DeepSeek 小鲸鱼（慌张）": "DeepSeek whale (panicking)",
      "DeepSeek 小鲸鱼（脸红说话）": "DeepSeek whale (blushing, talking)",
      "DeepSeek 小鲸鱼（气鼓鼓）": "DeepSeek whale (pouting)",
      "DeepSeek 余额": "DeepSeek balance",
      "DeepSeek 余额 ¥": "DeepSeek balance ¥",
      "DeepSeek 账本": "DeepSeek ledger",
      "按模型名 / 日期搜索": "Search by model / date",
      "按页面中线判断，左半边贴左、右半边贴右": "Judged by the page midline: the left half docks left, the right half docks right",
      "版本 ": "version ",
      "保存失败：": "Save failed: ",
      "本机估算": "Local estimate",
      "本轮消耗": "This round",
      "本轮小结": "This turn",
      "比如：小蓝": "e.g. Whale",
      "播报里会这样喊你，留空就不喊名字（最多 16 字）": "How the widget addresses you in voice lines. Leave empty for no name (max 16 chars)",
      "常驻气泡参数": "Always-on bubble fields",
      "充值 ¥": "Top-up ¥",
      "充值后重置基线，避免被算成消费": "Reset the baseline after a top-up so it is not counted as spend",
      "出": "out",
      "当前余额 ¥": "Balance ¥",
      "低于这个数会换成慌张表情并提醒充值；0 = 关闭": "Below this the whale switches to a panicking face and reminds you to top up; 0 = off",
      "对账：官网用量页 ↗": "Reconcile on the official usage page ↗",
      "5 折": "50% off",
      "全价": "full price",
      "高峰": "peak",
      "空闲": "off-peak",
      "距": "to ",
      "工作日": "weekday",
      "周末": "weekend",
      "工作日 09:00–12:00、14:00–18:00 为高峰（全价），其余时段与周末为空闲（5 折）":
        "Weekdays 09:00–12:00 and 14:00–18:00 are peak (full price); other hours and weekends are off-peak (50% off).",
      "工作日 09:00–12:00 · 14:00–18:00 全价，其余时段和周末 5 折":
        "Weekdays 09:00–12:00 & 14:00–18:00 full price; other hours and weekends 50% off",
      "下一段": "next",
      "峰谷": "Peak",
      "峰谷倒计时": "Peak/off-peak clock",
      "刚花了 ": "just spent ",
      "刚这轮 ": "that round: ",
      "高峰期": "peak",
      "关闭": "Close",
      "官网": "official",
      "官网：": "Official: ",
      "官网接口未通，暂用余额下降口径": "Official API unreachable — falling back to balance drop",
      "官网口径": "official",
      "官网用量页 ↗": "Official usage page ↗",
      "还原": "Reset",
      "核对": "Check",
      "记录": "Records",
      "加载中…": "Loading…",
      "价": " pricing",
      "价：缓存": " pricing · cache ",
      "今日": "Today",
      "今日 ¥": "today ¥",
      "今日消费超过它时提醒一次；0 = 不限": "Warn once when today's spend exceeds it; 0 = no limit",
      "今日已用": "Spent today",
      "今日有充值记录 ¥": "Top-up recorded today ¥",
      "今日预算（元）": "Daily budget (CNY)",
      "今天已经花了 ¥": "we already spent ¥",
      "近 7 天": "Last 7 days",
      "近7天": "7d",
      "就 ": "only ",
      "看用量": "View usage",
      "可用余额": "Available balance",
      "空闲价是高峰价的一半，倒计时告诉你下一次切换还有多久": "Off-peak costs half of peak; the countdown shows when the next switch happens",
      "空闲期": "off-peak",
      "累计充值": "Total top-ups",
      "立即刷新余额": "Refresh balance now",
      "轮次": "Rounds",
      "每轮播报和告警时轻轻响一声": "A soft chime on every voice line and alert",
      "每轮对话结束后弹拟人播报，需要点「知道啦~」才关闭": "A voice bubble pops after each turn; it stays until you tap Got it",
      "每轮消耗播报": "Turn cost announcer",
      "模型占比": "Model share",
      "你的昵称": "Your nickname",
      "昵称、缩放、常驻参数等已移到 DSH 设置 → 插件 → dsh-ds-whale 里改": "Nickname, scale and bubble fields now live in DSH Settings → Plugins → dsh-ds-whale",
      "清空今日": "Clear today",
      "清空全部": "Clear all",
      "清空全部历史": "Clear all history",
      "请求失败：": "Request failed: ",
      "取余额失败：": "Balance fetch failed: ",
      "去充值": "Top up",
      "全部": "All",
      "入": "in",
      "上一轮 ≈ ¥": "Last round ≈ ¥",
      "收起面板": "Close panel",
      "版本": "Version",
      "查看新版": "Check for updates",
      "数据文件：": "Data file: ",
      "数字取自官网用量接口": "Numbers come from the official usage API",
      "刷新": "Refresh",
      "刷新间隔": "Refresh interval",
      "刷新余额": "Refresh balance",
      "刷新中…": "Refreshing…",
      "搜索": "Search",
      "提示音": "Sound",
      "头像的基准尺寸倍数，拖拽时也会按它算边界": "Multiple of the base avatar size; drag bounds use it too",
      "头像旁边始终显示的小气泡内容，最多 3 项（": "Fields always shown in the small bubble next to the avatar, up to 3 (",
      "拖拽到中间自动贴边": "Snap to the nearest side",
      "未取到": "n/a",
      "未设": "not set",
      "未知": "unknown",
      "喂喂，余额 ": "hey, the balance is ",
      "我尾巴有点抖，要不要先充一点？": "my tail is trembling — top up a little?",
      "我先把账报给你，别让我哭着提醒第二遍。": "reporting the numbers before I have to cry twice.",
      "下方数字是上次成功的结果": "the numbers below are from the last successful fetch",
      "显示峰谷时段": "Show peak windows",
      "常显气泡顶上那条：当前是高峰还是空闲、按全价还是 5 折计费、离下次切换还有多久":
        "The strip on top of the always-on bubble: current window, price tier, and time to the next switch",
      "现在是 ": "we are at ",
      "小鲸鱼": "Whale",
      "小鲸鱼余额挂件": "Whale Balance Widget",
      "形象大小": "Avatar scale",
      "用量记录": "Usage records",
      "余额": "Balance",
      "余额不足不可用": "Balance too low to use",
      "余额差": "balance drop",
      "余额差观测 ¥": "Observed balance drop ¥",
      "余额差口径": "balance-drop basis",
      "余额取数失败：": "Balance fetch failed: ",
      "余额提醒": "Balance alert",
      "余额预警线（元）": "Balance alert line (CNY)",
      "余额只剩 ": "only ",
      "余额自动刷新周期，也影响账单新鲜度": "Auto refresh period for the balance; also how fresh the ledger is",
      "预警线是 ¥": "the alert line is ¥",
      "预算": "Budget",
      "预算见底啦：今日 ¥": "budget is gone: today ¥",
      "再聊下去我要开始担心了。": "keep going and I will start worrying.",
      "暂无记录": "No records yet",
      "暂无可用余额": "no balance available yet",
      "赠金 ¥": "Grant ¥",
      "账号登录态": "account sign-in",
      "这轮 ": "this round: ",
      "这一轮 ": "this turn ",
      "这一轮一分没花，白聊一轮，赚到～": "Nothing spent this turn — free chat, lucky us.",
      "知道啦": "Got it",
      "知道啦~": "Got it~",
      "只清今日账本": "Clear today's ledger only",
      "重置基线": "Reset baseline",
      "语言": "Language",
      "界面语言": "Interface language",
      "跟随系统": "System",
      "跟随系统区域自动选择": "Auto-detect from your system",
      "中文": "中文",
      "立即刷新余额": "Refresh balance now",
      "查看余额详情": "Balance details",
      "今日天气": "Weather today",
      "打个招呼": "Hello",
      "今日预算": "Daily budget",
      "小鲸鱼提示": "Whale tip",
      "打开小鲸鱼设置": "Whale settings",
      "刷新中…": "Refreshing…",
      "已更新": "Updated",
      "刷新失败": "Refresh failed",
      "天气城市": "Weather city",
      "必填：例如 上海 / Tokyo。没填时点天气会先请你去填": "Required, e.g. Shanghai / Tokyo. Without it the weather asks you to fill it in first",
      "例如 上海": "e.g. Shanghai",
      "记好啦～再右键小鲸鱼点一次「今日天气」试试": "Saved — right-click the whale and hit “Weather today” again",
      "先告诉我在哪座城市嘛～": "Which city are you in?",
      "右键菜单 → 打开小鲸鱼设置 → 天气城市填一下，存好再点一次「今日天气」就好啦": "Right-click → Whale settings → Weather city → save, then tap “Weather today” once more",
      "去填城市": "Fill it in",
      "保存并看天气": "Save & check sky",
      "保存中…": "Saving…",
      "没写进配置：": "Could not write the setting: ",
      "（已存在本机，重启后可能丢）": " (kept on this machine; may be gone after a restart)",
      "城市没能写进去，再点一次「存一下」试试": "The city did not go through — hit save once more",
      "先写个城市名嘛～": "type a city first",
      "在这儿填一下就好，不用去设置页翻。存好我直接帮你看今天的天气。": "Type it right here — no need to open settings. I will check the sky for you.",
      "先填个城市嘛～": "need a city first",
      "请手动打开 设置 → 插件 → 小鲸鱼": "open Settings → Plugins → 小鲸鱼 by hand",
      "DeepSeek 小鲸鱼（打招呼）": "DeepSeek whale (waving hello)",
      "DeepSeek 小鲸鱼（托腮思考）": "DeepSeek whale (thinking)",
      "打开 DSH 时打招呼": "Greet when DSH opens",
      "按昵称问好，和每轮播报用同一套形象": "Say hi by nickname, same look as the per-turn voice",
      "点击刷新最小间隔（毫秒）": "Minimum click-refresh interval (ms)",
      "防止连点把余额接口刷爆，2000 ~ 120000": "Keeps repeated clicks from hammering the balance API (2000 ~ 120000)",
      "左键刷新余额 · 右键打开菜单": "Left click refreshes · right click opens the menu"
    }

    function tt(zh) {
      if (LANG !== 'en') return zh
      return Object.prototype.hasOwnProperty.call(EN, zh) ? EN[zh] : zh
    }

    function resolveLang(settings) {
      const pref = settings && settings.language
      if (pref === 'zh' || pref === 'en') return pref
      let nav = ''
      try {
        nav = (navigator.languages && navigator.languages[0]) || navigator.language || ''
      } catch {}
      return /^zh/i.test(nav) ? 'zh' : 'en'
    }

    // 模块加载时先按浏览器区域定一次，避免首帧闪中文
    LANG = resolveLang(null)

    /** 峰谷标签跟随语言（宿主的 label 是中文） */
    function peakLabel(peak) {
      if (!peak) return ''
      if (LANG === 'en') return peak.isPeak ? 'peak' : 'off-peak'
      return peak.label || ''
    }

    const MOOD_CSS =
      '.dsh-ds-whale-mood{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
      'pointer-events:none;user-select:none;transition:opacity 320ms cubic-bezier(.4,0,.2,1),transform 420ms cubic-bezier(.34,1.4,.64,1);}' +
      '.dsh-ds-whale-bubble{animation:dsh-ds-whale-pop 300ms cubic-bezier(.34,1.56,.64,1);}' +
      '@keyframes dsh-ds-whale-pop{0%{opacity:0;transform:translateY(8px) scale(.9)}100%{opacity:1;transform:translateY(0) scale(1)}}' +
      '@keyframes dsh-ds-whale-talk{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-4px) scale(1.015)}}' +
      '.dsh-ds-whale-btn{appearance:none;cursor:pointer;border-radius:999px;padding:7px 16px;font-size:12.5px;font-weight:700;' +
      'letter-spacing:.2px;transition:transform 140ms ease,box-shadow 200ms ease,filter 160ms ease;border:1px solid transparent;}' +
      '.dsh-ds-whale-btn:hover{transform:translateY(-1px);filter:brightness(1.06);}' +
      '.dsh-ds-whale-btn:active{transform:translateY(0) scale(.97);}' +
      '.dsh-ds-whale-btn-primary{color:#fff;background:linear-gradient(135deg,#4d8dff,#2563eb 62%,#1d4ed8);' +
      'box-shadow:0 6px 16px rgba(37,99,235,.35);}' +
      '.dsh-ds-whale-btn-ghost{color:var(--dsw-alias-label-secondary,#64748b);background:transparent;' +
      'border-color:var(--dsw-alias-border-l1,rgba(100,116,139,.28));}'
    const HIT_CSS =
      '@keyframes dsh-ds-whale-hit-a{' +
      '0%{transform:translate3d(0,0,0) rotate(0) scale(1)}' +
      '16%{transform:translate3d(-5px,1px,0) rotate(-2.6deg) scale(1.07)}' +
      '34%{transform:translate3d(5px,-2px,0) rotate(2.6deg) scale(1.06)}' +
      '52%{transform:translate3d(-4px,1px,0) rotate(-1.8deg) scale(1.05)}' +
      '72%{transform:translate3d(3px,0,0) rotate(1.2deg) scale(1.03)}' +
      '100%{transform:translate3d(0,0,0) rotate(0) scale(1)}}' +
      '@keyframes dsh-ds-whale-hit-b{' +
      '0%{transform:translate3d(0,0,0) rotate(0) scale(1)}' +
      '16%{transform:translate3d(5px,1px,0) rotate(2.6deg) scale(1.07)}' +
      '34%{transform:translate3d(-5px,-2px,0) rotate(-2.6deg) scale(1.06)}' +
      '52%{transform:translate3d(4px,1px,0) rotate(1.8deg) scale(1.05)}' +
      '72%{transform:translate3d(-3px,0,0) rotate(-1.2deg) scale(1.03)}' +
      '100%{transform:translate3d(0,0,0) rotate(0) scale(1)}}'

    /* 刷新动效 + 右键菜单：刷新必须是「一眼看见」的，所以同时给光环、转圈和角标 */
    const REFRESH_CSS =
      '@keyframes dsh-ds-whale-spin{to{transform:rotate(360deg)}}' +
      '@keyframes dsh-ds-whale-glow{0%,100%{opacity:.28;transform:scale(.92)}50%{opacity:.92;transform:scale(1.06)}}' +
      '@keyframes dsh-ds-whale-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}' +
      '@keyframes dsh-ds-whale-dots{0%,80%,100%{opacity:.2;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}' +
      '@keyframes dsh-ds-whale-menu-in{0%{opacity:0;transform:translateY(6px) scale(.96)}100%{opacity:1;transform:translateY(0) scale(1)}}' +
      '@keyframes dsh-ds-whale-badge-in{0%{opacity:0;transform:translateY(-4px) scale(.9)}100%{opacity:1;transform:translateY(0) scale(1)}}' +
      '.dsh-ds-whale-spin{animation:dsh-ds-whale-spin .92s linear infinite;}' +
      '.dsh-ds-whale-glow{animation:dsh-ds-whale-glow 1.15s ease-in-out infinite;}' +
      '.dsh-ds-whale-pulse{animation:dsh-ds-whale-pulse .9s ease-in-out infinite;}' +
      '.dsh-ds-whale-badge{animation:dsh-ds-whale-badge-in 180ms cubic-bezier(.34,1.5,.64,1);}' +
      '.dsh-ds-whale-dots span{animation:dsh-ds-whale-dots 1.05s infinite;}' +
      '.dsh-ds-whale-dots span:nth-child(2){animation-delay:.16s;}' +
      '.dsh-ds-whale-dots span:nth-child(3){animation-delay:.32s;}' +
      '.dsh-ds-whale-menu{animation:dsh-ds-whale-menu-in 150ms cubic-bezier(.34,1.4,.64,1);}' +
      '.dsh-ds-whale-menu-item{appearance:none;border:none;background:transparent;cursor:pointer;width:100%;' +
      'text-align:left;display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;' +
      'font-size:12.5px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary,#0f172a);' +
      'position:relative;transform:translateX(0);' +
      'transition:background 150ms ease,color 150ms ease,box-shadow 150ms ease,transform 150ms cubic-bezier(.34,1.4,.64,1);}' +
      '.dsh-ds-whale-menu-item::before{content:"";position:absolute;left:3px;top:50%;width:3px;height:0;' +
      'border-radius:2px;background:var(--dsw-alias-brand-primary,#2563eb);opacity:0;transform:translateY(-50%);' +
      'transition:height 150ms ease,opacity 150ms ease;}' +
      '.dsh-ds-whale-menu-icon{display:inline-flex;align-items:center;justify-content:center;font-size:13px;' +
      'line-height:1;transition:transform 150ms cubic-bezier(.34,1.6,.64,1);}' +
      '.dsh-ds-whale-menu-item:hover,.dsh-ds-whale-menu-item:focus-visible{' +
      'background:rgba(37,99,235,.14);color:var(--dsw-alias-brand-primary,#2563eb);' +
      'box-shadow:inset 0 0 0 1px rgba(37,99,235,.26);transform:translateX(2px);outline:none;}' +
      '.dsh-ds-whale-menu-item:hover::before,.dsh-ds-whale-menu-item:focus-visible::before{height:56%;opacity:1;}' +
      '.dsh-ds-whale-menu-item:hover .dsh-ds-whale-menu-icon,' +
      '.dsh-ds-whale-menu-item:focus-visible .dsh-ds-whale-menu-icon{transform:scale(1.16) rotate(-6deg);}' +
      '.dsh-ds-whale-menu-item:active{transform:translateX(1px) scale(.985);background:rgba(37,99,235,.24);}'

    /* ---------------- 基础工具 ---------------- */

    function balanceOf(data) {
      const v = data && data.balance ? Number(data.balance.total) : NaN
      return Number.isFinite(v) ? v : null
    }

    /** 官网口径的今日数据（官网用量接口原样返回；没有就退回余额下降口径） */
    function officialOf(data) {
      const o = data && data.today ? data.today.official : null
      return o && !o.error ? o : null
    }

    function todayCostOf(data) {
      const o = officialOf(data)
      if (o) return Number(o.cost) || 0
      return data && data.today ? Number(data.today.spent) || 0 : 0
    }

    function todaySourceOf(data) {
      return officialOf(data) ? tt('官网') : tt('余额差')
    }

    function secondsLeftNow(data) {
      const p = data && data.peak
      if (!p || !p.nextChangeAt) return 0
      return Math.max(0, Math.round((p.nextChangeAt - Date.now()) / 1000))
    }

    function money(n) {
      const v = Number(n)
      if (!Number.isFinite(v)) return '0.00'
      const a = Math.abs(v)
      if (a === 0) return '0.00'
      if (a >= 1) return v.toFixed(2)
      if (a >= 0.01) return v.toFixed(3)
      return v.toFixed(5)
    }

    function tokenText(n) {
      const v = Number(n) || 0
      if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M'
      if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
      return String(Math.round(v))
    }

    /** 使用者昵称（留空则不喊名字） */
    function nickOf(settings) {
      const n = settings && typeof settings.nickname === 'string' ? settings.nickname.trim() : ''
      return n
    }

    /** 每轮消耗的说法：按金额分档，中英各一套，带昵称 */
    function turnVoice(turn, settings) {
      const nick = nickOf(settings)
      const c = Number(turn && turn.cost) || 0
      const amount = '¥' + money(c)
      const en = LANG === 'en'
      const head = nick ? nick + (en ? ', ' : '，') : ''
      let pool
      if (c <= 0) {
        pool = en
          ? ['Nothing spent this turn — free chat, lucky us.']
          : [tt('这一轮一分没花，白聊一轮，赚到～')]
      } else if (c < 0.005) {
        pool = en
          ? [
              head + 'just ' + amount + ' this turn — lighter than a bubble, I barely logged it.',
              head + amount + '… basically nothing. Chat away.',
              head + 'only ' + amount + '. Not even worth a frown.'
            ]
          : [
              head + tt('这一轮 ') + amount + tt('，比一粒气泡还轻，我都懒得记账。'),
              head + amount + tt('……嗯，基本等于没花。'),
              head + tt('就 ') + amount + tt(' 呀，安心聊。')
            ]
      } else if (c < 0.03) {
        pool = en
          ? [
              head + amount + ' this turn — half an ice pop. Filed away.',
              head + amount + ' spent. Wallet did not even flinch.',
              head + 'that round cost ' + amount + ', exactly one bubble of air.'
            ]
          : [
              head + tt('这一轮 ') + amount + tt('，半根冰棍的钱，我替你记住了。'),
              head + amount + tt(' 花出去啦，钱包还没皱眉。'),
              head + tt('刚这轮 ') + amount + tt('，不多不少，正好一口气泡。')
            ]
      } else if (c < 0.12) {
        pool = en
          ? [
              head + amount + ' this turn… a little sting, honestly.',
              head + amount + '. Not cheap, but worth it.',
              head + 'spent ' + amount + ' — I counted it three times in my head.'
            ]
          : [
              head + tt('这一轮 ') + amount + tt('，我有点心疼了哦。'),
              head + amount + tt(' 哦……这话不便宜，但是值得。'),
              head + tt('刚花了 ') + amount + tt('，我在心里数了三遍。')
            ]
      } else {
        pool = en
          ? [
              head + amount + ' this turn! My wallet is shaking — easy there?',
              head + amount + ' all in one round. Even my tail stood up.',
              head + 'that round: ' + amount + '. I will keep the books straight.'
            ]
          : [
              head + tt('这一轮 ') + amount + tt('！钱包在发抖，咱悠着点好不好。'),
              head + amount + tt(' 全花在这轮上了，我尾巴都竖起来了。'),
              head + tt('这轮 ') + amount + tt('，我先替你把账记明白。')
            ]
      }
      return pool[Math.floor(Math.random() * pool.length)]
    }

    /** 余额告警的拟人播报：慌张但不催命，先给数字再给出口 */
    function warnVoice(total, settings) {
      const nick = nickOf(settings)
      const en = LANG === 'en'
      const head = nick ? nick + (en ? ', ' : '，') : ''
      const amount = '¥' + money(total)
      const line = settings && settings.warnBelow > 0 ? (en ? 'the alert line is ¥' + money(settings.warnBelow) + ', ' : tt('预警线是 ¥') + money(settings.warnBelow) + '，') : ''
      const pool = en
        ? [
            head + 'only ' + amount + ' left… ' + line + 'my tail is trembling, top up a little?',
            head + 'hey, balance is ' + amount + ', ' + line + 'keep going and I will start worrying.',
            head + 'we are at ' + amount + ' now, ' + line + 'reporting the numbers before I cry twice.'
          ]
        : [
            head + tt('余额只剩 ') + amount + tt(' 了……') + line + tt('我尾巴有点抖，要不要先充一点？'),
            head + tt('喂喂，余额 ') + amount + '，' + line + tt('再聊下去我要开始担心了。'),
            head + tt('现在是 ') + amount + tt(' 啦，') + line + tt('我先把账报给你，别让我哭着提醒第二遍。')
          ]
      return pool[Math.floor(Math.random() * pool.length)]
    }

    /** 今日超预算的拟人播报 */
    function budgetVoice(spent, settings) {
      const nick = nickOf(settings)
      const en = LANG === 'en'
      const head = nick ? nick + (en ? ', ' : '，') : ''
      const budget = settings && settings.dailyBudget
      const pool = en
        ? [
            head + 'we already spent ¥' + money(spent) + ' today, over the ¥' + money(budget) + ' budget — my paws hurt from bookkeeping.',
            head + 'budget is gone: today ¥' + money(spent) + ' / budget ¥' + money(budget) + '. Again tomorrow?'
          ]
        : [
            head + tt('今天已经花了 ¥') + money(spent) + tt('，超过预算 ¥') + money(budget) + tt(' 了，我记账记到手软。'),
            head + tt('预算见底啦：今日 ¥') + money(spent) + tt(' / 预算 ¥') + money(budget) + tt('，明天再战？')
          ]
      return pool[Math.floor(Math.random() * pool.length)]
    }

    /* ---------------- 开机问候 / 天气文案 ---------------- */

    /** 每次打开 DSH 的问候：按时间段换说法，称呼用昵称，形象与每轮播报一致 */
    function greetVoice(settings) {
      const nick = nickOf(settings)
      const en = LANG === 'en'
      const head = nick ? (en ? nick + ', ' : nick + '，') : ''
      const hour = new Date().getHours()
      let pool
      if (hour < 5) {
        pool = en
          ? [
              head + 'still awake? I will watch the balance, you go get some sleep.',
              head + 'the night shift is on — nothing here needs your worry.'
            ]
          : [head + '还没睡呀？账我盯着，你去睡一会儿吧。', head + '这么晚还醒着，那我把夜班接过来啦。']
      } else if (hour < 11) {
        pool = en
          ? [
              head + 'good morning! Balance checked, I am ready when you are.',
              head + 'morning~ new day, new tokens. Let me keep the books.'
            ]
          : [head + '早上好呀！余额我盯好了，随时可以开工。', head + '早安～新的一天，token 我帮你记账。']
      } else if (hour < 14) {
        pool = en
          ? [head + 'lunch break? I will hold the fort.', head + 'noon already — eat something, then we continue.']
          : [head + '中午啦，先吃点东西，账我来守。', head + '午安～吃饱了再一起打怪。']
      } else if (hour < 18) {
        pool = en
          ? [head + 'good afternoon — where do we start?', head + 'afternoon check-in: balance is fine, ready to go.']
          : [head + '下午好呀，今天从哪件事开始？', head + '下午茶时间到，我陪你继续干。']
      } else if (hour < 23) {
        pool = en
          ? [head + 'good evening! One more push before bed?', head + 'evening~ I am here, tail and all.']
          : [head + '晚上好呀，还差一点点就收工啦。', head + '晚间报到～尾巴已经摇起来了。']
      } else {
        pool = en
          ? [head + 'late night session — I will keep the numbers tidy.', head + 'so late… let us finish this and rest.']
          : [head + '这么晚还在忙，我陪你把这轮收尾。', head + '夜深啦，干完这票就去睡觉哦。']
      }
      return pool[Math.floor(Math.random() * pool.length)]
    }

    /** 问候的副标题：日期 + 余额 + 峰谷，一眼看清今天的底 */
    function greetSub(settings, data) {
      const en = LANG === 'en'
      let date = ''
      try {
        date = new Date().toLocaleDateString(en ? 'en-US' : 'zh-CN', {
          month: en ? 'short' : 'long',
          day: 'numeric',
          weekday: en ? 'short' : 'long'
        })
      } catch {}
      const v = balanceOf(data)
      const bal = v == null ? '' : (en ? ' · balance ¥' : ' · 余额 ¥') + money(v)
      const peak = data && data.peak ? ' · ' + peakLabel(data.peak) : ''
      return date + bal + peak
    }

    /** 气泡小标题：按 kind 分（不能用 tone 判断，告警和天气失败都是 warn） */
    function bubbleHeadline(bubble) {
      const kind = (bubble && bubble.kind) || (bubble && bubble.tone === 'warn' ? 'warn' : 'turn')
      if (kind === 'weather') return tt('今日天气')
      if (kind === 'greet') return tt('打个招呼')
      if (kind === 'budget') return tt('今日预算')
      if (kind === 'tip') return tt('小鲸鱼提示')
      if (kind === 'warn') return tt('余额提醒')
      return tt('本轮小结')
    }

    /** 天气标题：城市 + 实况温度 + 一句话 */
    function weatherTitle(w) {
      const en = LANG === 'en'
      const c = (w && w.current) || {}
      const city = (w && w.location && w.location.city) || ''
      const temp = Number.isFinite(Number(c.temp)) ? Math.round(Number(c.temp)) : '--'
      const text = en ? c.textEn || '' : c.text || ''
      return (city ? city + ' · ' : '') + temp + '°C ' + text
    }

    /** 天气副标题：今天区间 + 降雨概率 + 未来几小时 + 一句贴心话 */
    function weatherSub(w) {
      const en = LANG === 'en'
      const t = (w && w.today) || {}
      const c = (w && w.current) || {}
      const parts = []
      const deg = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : '--')
      parts.push(
        (en ? 'Today ' : '今天 ') +
          deg(t.min) +
          '~' +
          deg(t.max) +
          '°C · ' +
          (en ? t.textEn || '' : t.text || '')
      )
      if (Number.isFinite(Number(t.rain))) parts.push((en ? 'rain ' : '降雨 ') + Math.round(Number(t.rain)) + '%')
      const hours = Array.isArray(w && w.hours) ? w.hours.slice(0, 3) : []
      if (hours.length) {
        parts.push(
          (en ? 'next: ' : '接下来 ') +
            hours
              .map((x) => {
                const raw = String(x.hour || '')
                const h = en ? raw : raw.replace(':00', '点')
                const ww = en ? x.textEn : x.text
                const rain = Math.round(Number(x.rain) || 0)
                return (
                  h +
                  ' ' +
                  deg(x.temp) +
                  '°' +
                  (ww ? ' ' + ww : '') +
                  (rain > 0 ? ' ' + rain + '%' : '')
                )
              })
              .join(' · ')
        )
      }
      if (Number.isFinite(Number(c.feels)) && Math.abs(Number(c.feels) - Number(c.temp)) >= 2) {
        parts.push((en ? 'feels ' : '体感 ') + deg(c.feels) + '°C')
      }
      if (w && w.advice) parts.push(en ? w.advice.en : w.advice.zh)
      return parts.join(' · ')
    }

    function hms(sec) {
      const s = Math.max(0, Math.round(Number(sec) || 0))
      const hh = Math.floor(s / 3600)
      const mm = Math.floor((s % 3600) / 60)
      const ss = s % 60
      const p = (n) => (n < 10 ? '0' + n : String(n))
      if (hh > 0) return `${hh}:${p(mm)}:${p(ss)}`
      return `${p(mm)}:${p(ss)}`
    }

    /** 周末的空闲能连着 60 多个小时，hms 会写成 61:00:00，这里换成「2 天 13:12」 */
    function dhm(sec) {
      const s = Math.max(0, Math.round(Number(sec) || 0))
      if (s < 86400) return hms(s)
      const d = Math.floor(s / 86400)
      const rest = s % 86400
      const p = (n) => (n < 10 ? '0' + n : String(n))
      const tail = `${p(Math.floor(rest / 3600))}:${p(Math.floor((rest % 3600) / 60))}`
      return LANG === 'en' ? `${d}d ${tail}` : `${d} 天 ${tail}`
    }

    function clockText(ts) {
      if (!ts) return ''
      try {
        return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
      } catch {
        return ''
      }
    }

    async function api(path, body, timeoutMs) {
      /* 天气那条链路要串几个外部接口，给个上限：卡住时报错，别让「正在看天…」无限转 */
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = ctrl && timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null
      try {
        const res = await fetch(API + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
          signal: ctrl ? ctrl.signal : undefined
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    /* ---------------- 音效（WebAudio 合成，无需资源文件） ---------------- */

    let audioCtx = null
    function beep(volume) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        if (!audioCtx) audioCtx = new AC()
        if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume()
        const t0 = audioCtx.currentTime
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(760, t0)
        osc.frequency.exponentialRampToValueAtTime(1180, t0 + 0.09)
        gain.gain.setValueAtTime(Math.max(0.0001, Number(volume) || 0.3) * 0.25, t0)
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32)
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.start(t0)
        osc.stop(t0 + 0.34)
      } catch {}
    }

    /* ---------------- 主题 ---------------- */

    const T = {
      bg: 'var(--dsw-alias-bg-layer-2, #ffffff)',
      bgSoft: 'var(--dsw-alias-bg-layer-1, #f7f8fa)',
      border: 'var(--dsw-alias-border-l1, rgba(15,23,42,0.10))',
      borderSoft: 'var(--dsw-alias-border-l2, rgba(15,23,42,0.06))',
      text: 'var(--dsw-alias-label-primary, #0f172a)',
      sub: 'var(--dsw-alias-label-secondary, #64748b)',
      brand: 'var(--dsw-alias-brand-primary, #2563eb)',
      brandSoft: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #2563eb) 14%, transparent)',
      ok: 'var(--dsw-alias-state-success-primary, #16a34a)',
      warn: 'var(--dsw-alias-state-warn-primary, #d97706)',
      err: 'var(--dsw-alias-state-error-primary, #dc2626)'
    }

    const FIELD_OPTIONS = [
      { id: 'balance', label: tt('余额') },
      { id: 'today', label: tt('今日已用') },
      { id: 'estimate', label: tt('本机估算') },
      { id: 'turn', label: tt('本轮消耗') },
      { id: 'peak', label: tt('峰谷倒计时') }
    ]

    function linkStyle() {
      return {
        appearance: 'none',
        cursor: 'pointer',
        border: '1px solid ' + T.border,
        borderRadius: 8,
        padding: '4px 9px',
        fontSize: 11,
        color: T.brand,
        textDecoration: 'none'
      }
    }

    const cardStyle = {
      width: 328,
      maxHeight: 'min(70vh, 560px)',
      overflow: 'auto',
      padding: '12px 13px 13px',
      borderRadius: 16,
      background: T.bg,
      border: '1px solid ' + T.border,
      boxShadow: '0 18px 48px rgba(15,23,42,0.22), 0 2px 6px rgba(15,23,42,0.08)',
      color: T.text,
      fontSize: 12,
      lineHeight: 1.5,
      pointerEvents: 'auto',
      backdropFilter: 'blur(8px)'
    }

    function Row(props) {
      return h(
        'div',
        {
          style: Object.assign(
            { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
            props.style || null
          )
        },
        props.children
      )
    }

    function Label(props) {
      return h('span', { style: { color: T.sub, fontSize: 11 } }, props.children)
    }

    function Btn(props) {
      const [hover, setHover] = useState(false)
      return h(
        'button',
        {
          type: 'button',
          onClick: props.onClick,
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          title: props.title || '',
          style: Object.assign(
            {
              appearance: 'none',
              cursor: 'pointer',
              border: '1px solid ' + (props.active ? T.brand : T.border),
              background: props.active ? T.brandSoft : hover ? T.bgSoft : 'transparent',
              color: props.active ? T.brand : props.tone === 'err' ? T.err : props.tone === 'brand' ? T.brand : T.text,
              borderRadius: 8,
              padding: '4px 9px',
              fontSize: 11,
              lineHeight: 1.4,
              transition: 'background 120ms ease'
            },
            props.style || null
          )
        },
        props.children
      )
    }

    function Toggle(props) {
      const on = !!props.value
      return h(
        'button',
        {
          type: 'button',
          onClick: () => props.onChange(!on),
          style: {
            appearance: 'none',
            cursor: 'pointer',
            width: 34,
            height: 19,
            borderRadius: 999,
            border: '1px solid ' + (on ? T.brand : T.border),
            background: on ? T.brand : 'transparent',
            position: 'relative',
            transition: 'all 140ms ease',
            padding: 0
          }
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: on ? 17 : 2,
            width: 13,
            height: 13,
            borderRadius: 999,
            background: on ? '#fff' : T.sub,
            transition: 'left 140ms ease'
          }
        })
      )
    }

    function Slider(props) {
      return h('input', {
        type: 'range',
        min: props.min,
        max: props.max,
        step: props.step || 0.01,
        value: props.value,
        onChange: (e) => props.onChange(Number(e.target.value)),
        style: { width: 150, accentColor: T.brand, cursor: 'pointer' }
      })
    }

    /* ---------------- 尺寸预览总线 ----------------
       设置页里的「形象大小」是拖动时逐格变化的，但真正落盘要等松手。
       中间这段（外加 4s 轮询的空窗）如果只等 /state 回包，鲸鱼就会先跳回旧尺寸
       再跳到新尺寸。所以设置页拖动时往这条总线上广播一个预览值，
       WhaleDock 订着它先把自己画成目标尺寸，等服务端值追上就撤掉预览。 */
    const scalePreviewListeners = new Set()

    function emitScalePreview(v) {
      for (const fn of Array.from(scalePreviewListeners)) {
        try {
          fn(v)
        } catch {}
      }
    }

    function subscribeScalePreview(fn) {
      scalePreviewListeners.add(fn)
      return () => {
        scalePreviewListeners.delete(fn)
      }
    }

    /**
     * 带本地草稿的 range。
     * 以前滑块把 value 直接绑在服务端回的 state 上：每挪一格就发一次
     * POST /settings，等宿主写完 profile、再回一份整页 state，滑块才前进一格 ——
     * 拇指被一次次拉回去，看着就是一帧一帧地蹦。
     * 现在拖动只改本地草稿（跟手），停手 200ms 或松手才真正落盘。
     */
    function RangeField(props) {
      const { value, min, max, step, onCommit, onPreview, width, suffix, decimals } = props
      const [draft, setDraft] = useState(value)
      const draftRef = useRef(value)
      const lastCommit = useRef(value)
      const timer = useRef(0)
      const dragging = useRef(false)

      const commit = (v) => {
        if (!Number.isFinite(v)) return
        if (v === lastCommit.current) return
        lastCommit.current = v
        if (typeof onCommit === 'function') onCommit(v)
      }

      /* 服务端值变了（别的入口/别的窗口改的）才回写草稿；
         拖动中、或者还有一笔待落盘的防抖，就完全不要动草稿 ——
         4s 轮询回来的是旧值，抢过来会让松手时提交成旧尺寸 */
      useEffect(() => {
        if (dragging.current || timer.current) return
        draftRef.current = value
        lastCommit.current = value
        setDraft(value)
      }, [value])

      useEffect(
        () => () => {
          if (timer.current) window.clearTimeout(timer.current)
        },
        []
      )

      const settle = () => {
        dragging.current = false
        if (timer.current) {
          window.clearTimeout(timer.current)
          timer.current = 0
        }
        commit(draftRef.current)
      }

      const shown = Number.isFinite(Number(draft)) ? Number(draft) : Number(value) || 0

      return h(
        React.Fragment,
        null,
        h('input', {
          type: 'range',
          min,
          max,
          step: step || 0.01,
          value: draft,
          onPointerDown: () => {
            dragging.current = true
          },
          onPointerUp: settle,
          onPointerCancel: settle,
          /* 键盘调：方向键会连发 keydown，松手（keyup）才落盘 */
          onKeyDown: () => {
            dragging.current = true
          },
          onKeyUp: settle,
          onBlur: settle,
          onChange: (e) => {
            const v = Number(e.target.value)
            draftRef.current = v
            setDraft(v)
            if (typeof onPreview === 'function') onPreview(v)
            /* 兜底：指针在滑块外面松开时 pointerup 收不到，停手 200ms 也落一次盘 */
            if (timer.current) window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => {
              timer.current = 0
              commit(draftRef.current)
            }, 200)
          },
          style: { width: width || 150, accentColor: T.brand, cursor: 'pointer' }
        }),
        suffix
          ? h(
              'span',
              { style: { fontSize: 12, color: T.sub, width: 38, textAlign: 'right' } },
              shown.toFixed(decimals == null ? 2 : decimals) + suffix
            )
          : null
      )
    }

    /* ---------------- 主组件 ---------------- */

    function WhaleDock() {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [open, setOpen] = useState(false)
      const [tab, setTab] = useState('home')
      const [pos, setPos] = useState(readDockPos)
      const [bubble, setBubble] = useState(null)
      const [tick, setTick] = useState(0)
      const [busy, setBusy] = useState(false)
      const [view, setView] = useState('summary')
      const [history, setHistory] = useState(null)
      const [query, setQuery] = useState('')
      const [size, setSize] = useState(() => {
        try {
          const raw = window.localStorage.getItem(SIZE_KEY)
          const n = Number(raw)
          if (Number.isFinite(n) && n >= 0.6 && n <= 2) return n
        } catch {}
        return 1
      })
      const dragRef = useRef(null)
      const lastTurnRef = useRef(null)
      const warnedRef = useRef({})
      const bubbleTimer = useRef(null)
      const moodTimer = useRef(null)
      const [mood, setMood] = useState('calm')
      const [hitN, setHitN] = useState(0)
      /* 刷新中：光环 + 转圈 + 角标一起上，让「正在刷新」这件事一眼可见 */
      const [refreshing, setRefreshing] = useState(false)
      /* 角标短提示：{ text, tone }，tone = brand / ok / warn / err */
      const [flash, setFlash] = useState(null)
      /* 右键菜单：{ x, y }，坐标是视口坐标 */
      const [menu, setMenu] = useState(null)
      const [weatherBusy, setWeatherBusy] = useState(false)
      /* 气泡里的城市输入：第一次用天气时直接在这儿填，不用跳设置页 */
      const [cityDraft, setCityDraft] = useState('')
      const [cityBusy, setCityBusy] = useState(false)
      const refreshLock = useRef(false)
      const lastClickAt = useRef(0)
      const flashTimer = useRef(null)
      const greetRef = useRef(false)
      const greetTimer = useRef(null)
      /* 气泡实测高度：鲸鱼被拖到顶部时要靠它决定气泡往上还是往下弹 */
      const bubbleBoxRef = useRef(null)
      const [bubbleH, setBubbleH] = useState(0)
      /* 设置页正在拖「形象大小」时的预览倍数：拖动期间不等 /state 轮询，
         先按预览值画，等服务端值追上来再撤掉（见下面的订阅与清除 effect） */
      const [previewScale, setPreviewScale] = useState(null)
      const previewNext = useRef(null)
      const previewRaf = useRef(0)
      const previewTimer = useRef(0)

      useEffect(() => {
        const off = subscribeScalePreview((v) => {
          previewNext.current = v
          /* 一帧只画一次：高刷鼠标一次拖动能来好几个 input */
          if (!previewRaf.current) {
            previewRaf.current = window.requestAnimationFrame(() => {
              previewRaf.current = 0
              setPreviewScale(previewNext.current)
            })
          }
          if (previewTimer.current) window.clearTimeout(previewTimer.current)
          /* 兜底：写盘失败/被宿主拒了，别让鲸鱼永远卡在预览尺寸上 */
          previewTimer.current = window.setTimeout(() => setPreviewScale(null), 8000)
        })
        return () => {
          off()
          if (previewRaf.current) window.cancelAnimationFrame(previewRaf.current)
          if (previewTimer.current) window.clearTimeout(previewTimer.current)
        }
      }, [])

      /* 被戳一下：立刻换成气鼓鼓的形象 + 抖一下，过一会儿自己消气 */
      const poke = useCallback(() => {
        setHitN((n) => n + 1)
        setMood('angry')
        if (moodTimer.current) window.clearTimeout(moodTimer.current)
        moodTimer.current = window.setTimeout(() => setMood('calm'), HIT_MS)
      }, [])

      useEffect(() => {
        return () => {
          if (moodTimer.current) window.clearTimeout(moodTimer.current)
          if (flashTimer.current) window.clearTimeout(flashTimer.current)
          if (greetTimer.current) window.clearTimeout(greetTimer.current)
        }
      }, [])

      const settings = (data && data.settings) || null
      const savedScale = settings ? Number(settings.scale) : NaN
      /* 拖动预览优先：设置页松手才落盘，等回包/等 4s 轮询都会让鲸鱼先跳回旧值 */
      const scale = previewScale != null ? previewScale : settings ? settings.scale : size
      LANG = resolveLang(settings)

      /* 服务端值追上预览值就撤掉预览（差 0.001 以内视为同一个尺寸） */
      useEffect(() => {
        if (previewScale == null) return
        if (!Number.isFinite(savedScale)) return
        if (Math.abs(savedScale - previewScale) < 0.001) setPreviewScale(null)
      }, [previewScale, savedScale])

      /* ---------------- 位置（贴边模型） ----------------
         pos 是「存档里的理想位置」，docked 是「当前视口下的生效位置」：
         渲染永远只用 docked，所以无论窗口怎么变、存档有多旧，鲸鱼都留在窗口里；
         越界只在渲染层收拢、不往回写，免得开机时「窗口还没恢复尺寸」那一瞬间
         把用户摆好的位置改小。存档只由拖拽/贴边/v1 迁移来写。 */
      const px = Math.round(WHALE_PX * (scale || 1))
      const vp = useViewport()
      const vw = vp.vw
      const vh = vp.vh

      const clampDock = useCallback(
        (p, w, h, tb) => {
          const topSafe = (tb || 0) + Math.max(TOP_GAP, Math.ceil(px * 0.04))
          const maxDx = Math.max(4, w - px - 4)
          const maxRy = Math.max(4, h - px - topSafe)
          const side = p && p.side === 'left' ? 'left' : 'right'
          const dx = Number(p && p.dx)
          const ry = Number(p && p.ry)
          return {
            side,
            dx: Math.min(Math.max(4, Number.isFinite(dx) ? dx : 22), maxDx),
            ry: Math.min(Math.max(4, Number.isFinite(ry) ? ry : 20), maxRy)
          }
        },
        [px]
      )

      /* 视口还没量出来（首帧 0×0、窗口最小化）时直接用存档值，别按 0 尺寸把位置挤到角落 */
      const vpReady = vw >= 320 && vh >= 240
      const docked = vpReady ? clampDock(pos, vw, vh, vp.tb) : pos
      /* 生效左坐标：贴左边就是 dx，贴右边换算成左偏移（渲染用 left 更好算气泡/面板朝向） */
      const effLeft = docked.side === 'left' ? docked.dx : Math.max(0, vw - docked.dx - px)
      const dockedLeft = effLeft + px / 2 < vw / 2
      const dockedRef = useRef(docked)
      dockedRef.current = docked

      React.useLayoutEffect(() => {
        /* 存档自愈只做两件事：把 v1 旧档迁移成 v2（需要真实视口才能判断贴哪边）。
           视口变化导致的越界只影响渲染（docked 已经收进安全区），不往存档里写，
           免得开机时「窗口还没恢复大小」那一瞬间把用户摆好的位置改小。 */
        if (!vpReady || !pos.legacy) return
        const left0 = Math.max(0, vw - pos.dx - px)
        const side = left0 + px / 2 < vw / 2 ? 'left' : 'right'
        const next = clampDock({ side, dx: side === 'left' ? left0 : pos.dx, ry: pos.ry }, vw, vh, vp.tb)
        setPos(next)
        writeDockPos(next)
      }, [pos, vpReady, vw, vh, vp.tb, clampDock, px])

      /* 轮询 */
      useEffect(() => {
        let alive = true
        const pull = async () => {
          try {
            const next = await api('/state', {})
            if (!alive) return
            setData(next)
            setError(null)
          } catch (err) {
            if (alive) setError(String((err && err.message) || err))
          }
        }
        pull()
        const id = window.setInterval(pull, 4000)
        return () => {
          alive = false
          window.clearInterval(id)
        }
      }, [])

      /* 秒针（倒计时） */
      useEffect(() => {
        const id = window.setInterval(() => setTick((n) => n + 1), 1000)
        return () => window.clearInterval(id)
      }, [])

      const popBubble = useCallback(
        (payload) => {
          setBubble(Object.assign({ key: Date.now() }, payload))
          if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
          const closeMs = payload.sticky ? 0 : payload.closeMs || 6000
          if (closeMs > 0) {
            bubbleTimer.current = window.setTimeout(() => setBubble(null), closeMs)
          }
        },
        []
      )

      useEffect(() => {
        return () => {
          if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current)
        }
      }, [])

      /* 量一次气泡真实高度：内容长短差很多（天气那行能到 200px+），
         固定估算值要么留白要么被裁，所以量完再决定往上弹还是往下弹 */
      useEffect(() => {
        const el = bubbleBoxRef.current
        setBubbleH(el ? Math.round(el.getBoundingClientRect().height) : 0)
      }, [bubble, docked.ry, scale])

      /* 每轮消耗泡泡 */
      useEffect(() => {
        if (!data || !settings) return
        const turn = data.lastTurn
        if (!turn || !turn.t) return
        if (lastTurnRef.current === null) {
          lastTurnRef.current = turn.t
          return
        }
        if (turn.t === lastTurnRef.current) return
        lastTurnRef.current = turn.t
        if (!settings.turnPop) return
        popBubble({
          kind: 'turn',
          tone: 'brand',
          title: turnVoice(turn, settings),
          sub:
            `${turn.model || 'deepseek'} · ${tt('入')} ${tokenText(turn.input)} / ${tt('出')} ${tokenText(turn.output)}` +
            (data && data.peak ? ' · ' + peakLabel(data.peak) + tt('价') : ''),
          /* 播报必须由使用者亲手点掉，不自动消失 */
          sticky: true,
          action: tt('知道啦~')
        })
        if (settings.soundOn) beep(settings.soundVolume)
      }, [data, settings, popBubble])

      /* 自检回报：浏览器实际跑的是哪个 build、当前表情是什么（排查「没换图」用） */
      useEffect(() => {
        if (!data) return
        const toneMood = bubble ? (bubble.tone === 'warn' ? 'panic' : 'blush') : 'calm'
        const moodNow = mood === 'angry' ? 'angry' : toneMood
        try {
          fetch(API + '/client-hello', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              build: BUILD,
              mood: moodNow,
              bubble: bubble ? String(bubble.tone || 'brand') : null,
              px: WHALE_PX
            })
          }).catch(() => {})
        } catch {}
      }, [data, mood, bubble && bubble.key])

      /* 余额预警 / 今日预算 */
      useEffect(() => {
        if (!data || !settings) return
        const total = data.balance ? Number(data.balance.total) : null
        if (settings.warnBelow > 0 && total != null && total < settings.warnBelow) {
          if (!warnedRef.current.balance) {
            warnedRef.current.balance = true
            popBubble({
              kind: 'warn',
              tone: 'warn',
              title: warnVoice(total, settings),
              sub:
                tt('当前余额 ¥') +
                money(total) +
                tt(' · 预警线 ¥') +
                money(settings.warnBelow),
              /* 告警也要使用者亲手关掉 */
              sticky: true,
              action: tt('知道啦'),
              link: (data.links && data.links.topUpUrl) || 'https://platform.deepseek.com/top_up',
              linkLabel: tt('去充值')
            })
            if (settings.soundOn) beep(settings.soundVolume)
          }
        } else if (total != null && total >= settings.warnBelow) {
          warnedRef.current.balance = false
        }
        const spent = Number(data.today && data.today.spent) || 0
        if (settings.dailyBudget > 0 && spent >= settings.dailyBudget) {
          if (!warnedRef.current.budget) {
            warnedRef.current.budget = true
            popBubble({
              kind: 'budget',
              tone: 'warn',
              title: budgetVoice(spent, settings),
              sub: tt('今日 ¥') + money(spent) + tt(' · 预算 ¥') + money(settings.dailyBudget),
              sticky: true,
              action: tt('知道啦'),
              link: (data.links && data.links.usageUrl) || 'https://platform.deepseek.com/usage',
              linkLabel: tt('看用量')
            })
          }
        } else if (spent < settings.dailyBudget) {
          warnedRef.current.budget = false
        }
      }, [data, settings, popBubble])

      const patchSettings = useCallback(
        async (patch) => {
          setData((prev) => (prev ? Object.assign({}, prev, { settings: Object.assign({}, prev.settings, patch) }) : prev))
          try {
            const next = await api('/settings', { patch })
            setData(next)
          } catch (err) {
            setError(String((err && err.message) || err))
          }
        },
        []
      )

      /** 角标短提示：1.5 秒后自己消失，不抢正文气泡 */
      const flashBadge = useCallback((text, tone, ms) => {
        if (flashTimer.current) window.clearTimeout(flashTimer.current)
        /* ms 传 0 以外的正数可以延长停留（天气那条链路要串几个外部接口，别只亮 1.5 秒就没了） */
        if (!text) {
          setFlash(null)
          return
        }
        setFlash({ text, tone: tone || 'brand', key: Date.now() })
        const stay = Number(ms) > 0 ? Number(ms) : 1500
        flashTimer.current = window.setTimeout(() => setFlash(null), stay)
      }, [])

      /** 真正去取余额：刷新中屏蔽重入；动效至少亮 REFRESH_MIN_MS，不让它一闪而过 */
      const refreshNow = useCallback(async () => {
        if (refreshLock.current) return false
        refreshLock.current = true
        const startedAt = Date.now()
        setBusy(true)
        setRefreshing(true)
        try {
          const next = await api('/refresh', {})
          setData(next)
          setError(null)
          flashBadge(tt('已更新'), 'ok')
          return true
        } catch (err) {
          setError(String((err && err.message) || err))
          flashBadge(tt('刷新失败'), 'err')
          return false
        } finally {
          const left = Math.max(0, REFRESH_MIN_MS - (Date.now() - startedAt))
          if (left > 0) await new Promise((resolve) => window.setTimeout(resolve, left))
          setRefreshing(false)
          setBusy(false)
          refreshLock.current = false
        }
      }, [flashBadge])

      const loadHistory = useCallback(async (q) => {
        try {
          const res = await api('/history', { query: q || '' })
          setHistory(res)
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }, [])

      const ledger = useCallback(
        async (action) => {
          try {
            const next = await api('/ledger', { action })
            setData(next)
            setHistory(null)
          } catch (err) {
            setError(String((err && err.message) || err))
          }
        },
        []
      )

      /* ---------------- 点击刷新（限频） / 右键菜单 / 开机问候 ---------------- */

      const cooldownMs = Math.max(
        2000,
        Number(settings && settings.clickCooldownMs) || CLICK_COOLDOWN_MS
      )

      /** 点鲸鱼 = 刷一次余额。冷却期内只弹角标，绝不打接口，连点也刷不爆 */
      const clickRefresh = useCallback(() => {
        setMenu(null)
        const now = Date.now()
        const left = cooldownMs - (now - lastClickAt.current)
        if (left > 0) {
          flashBadge(
            (LANG === 'en' ? 'cooling ' : '冷却 ') + Math.ceil(left / 1000) + 's',
            'warn'
          )
          return
        }
        lastClickAt.current = now
        refreshNow()
      }, [cooldownMs, flashBadge, refreshNow])

      /** 第一次用天气（还没填城市）：不猜 IP，直接在气泡里填，省掉「打开设置页找那一栏」 */
      const askForCity = useCallback(() => {
        setMenu(null)
        setCityDraft('')
        setCityBusy(false)
        popBubble({
          kind: 'weather',
          tone: 'brand',
          mood: 'think',
          title: LANG === 'en' ? 'Which city are you in?' : '先告诉我在哪座城市嘛～',
          sub:
            LANG === 'en'
              ? 'Type it right here and hit save — no need to dig into settings. I will check the sky for you.'
              : '在这儿填一下就好，不用去设置页翻。存好我直接帮你看今天的天气。',
          cityPrompt: true,
          sticky: true
        })
      }, [popBubble])

      /** 拉天气。cityOverride 用于「刚存完城市就立刻看」，不必等轮询把 settings 刷新过来 */
      const fetchWeather = useCallback(
        async (cityOverride) => {
          if (weatherBusy) return
          const city = String(
            cityOverride != null ? cityOverride : (settings && settings.weatherCity) || ''
          ).trim()
          if (!city) {
            askForCity()
            return
          }
          setWeatherBusy(true)
          flashBadge(LANG === 'en' ? 'checking sky…' : '正在看天…', 'brand', 60000)
          try {
            const w = await api('/weather', {}, 25000)
            if (w && w.ok === false && (w.needCity || w.error === 'need-city')) {
              askForCity()
            } else if (!w || w.ok === false) {
              const offline = !!(w && w.error === 'geocode-offline')
              popBubble({
                kind: 'weather',
                tone: 'warn',
                mood: 'panic',
                title: offline
                  ? LANG === 'en'
                    ? 'Weather service unreachable…'
                    : '天气服务连不上…'
                  : LANG === 'en'
                    ? 'Weather unavailable…'
                    : '天气没取到…',
                sub: (w && w.message) || '',
                closeMs: 10000,
                action: tt('知道啦~')
              })
            } else {
              popBubble({
                kind: 'weather',
                tone: 'brand',
                mood: 'think',
                title: weatherTitle(w),
                sub: weatherSub(w),
                closeMs: 15000,
                action: tt('知道啦~')
              })
            }
          } catch (err) {
            setError(String((err && err.message) || err))
            popBubble({
              kind: 'weather',
              tone: 'warn',
              mood: 'panic',
              title: LANG === 'en' ? 'Weather service unreachable…' : '天气服务连不上…',
              sub: String((err && err.message) || err),
              closeMs: 10000,
              action: tt('知道啦~')
            })
          } finally {
            setWeatherBusy(false)
            /* 结果已经用气泡说了，角标上的「正在看天…」到这里就收，别一直挂着 */
            flashBadge(null)
          }
        },
        [popBubble, weatherBusy, settings, askForCity, flashBadge]
      )

      /** 右键菜单 → 今日天气。宿主直连公共天气接口，不经过模型，token 消耗为 0 */
      const openWeather = useCallback(async () => {
        setMenu(null)
        await fetchWeather()
      }, [fetchWeather])

      /** 气泡里填完城市 → 存进配置（宿主双写，立刻生效）→ 马上看天气 */
      const submitCity = useCallback(
        async (raw) => {
          const next = String(raw != null ? raw : cityDraft).trim()
          if (!next) {
            flashBadge(LANG === 'en' ? 'type a city first' : '先写个城市名嘛～', 'warn')
            return
          }
          if (cityBusy) return
          setCityBusy(true)
          try {
            const res = await api('/settings', { config: { weatherCity: next } })
            const saved = String((res && res.settings && res.settings.weatherCity) || '').trim()
            /* 存完再对一次账：宿主没写进去就别假装成功，否则用户会一直以为设好了 */
            if (saved !== next) {
              popBubble({
                kind: 'weather',
                tone: 'warn',
                mood: 'panic',
                title: LANG === 'en' ? 'City did not stick…' : '城市没存上…',
                sub:
                  (res && res.error && String(res.error)) ||
                  (LANG === 'en'
                    ? 'The settings write failed. Try the settings page once.'
                    : '设置写入失败，去设置页再填一次试试。'),
                cityPrompt: true,
                sticky: true
              })
              return
            }
            if (res) setData(res)
            setBubble(null)
            await fetchWeather(next)
          } catch (err) {
            setError(String((err && err.message) || err))
            popBubble({
              kind: 'weather',
              tone: 'warn',
              mood: 'panic',
              title: LANG === 'en' ? 'Could not save the city…' : '城市没存上…',
              sub: String((err && err.message) || err),
              cityPrompt: true,
              sticky: true
            })
          } finally {
            setCityBusy(false)
          }
        },
        [cityDraft, cityBusy, fetchWeather, flashBadge, popBubble]
      )

      /** 右键菜单 → 打开 DSH 设置里的小鲸鱼分区 */
      const openWhaleSettings = useCallback(() => {
        setMenu(null)
        setOpen(false)
        const opened = openSettingsPanel(SETTINGS_NS) || clickSettingsEntry()
        if (!opened) {
          popBubble({
            kind: 'tip',
            tone: 'warn',
            mood: 'panic',
            title: LANG === 'en' ? 'Settings seat not found' : '没找到设置入口',
            sub:
              LANG === 'en'
                ? 'Open sidebar settings → Plugins → 小鲸鱼 by hand.'
                : '请手动打开：侧边栏设置 → 插件 → 小鲸鱼。',
            closeMs: 9000,
            action: tt('知道啦~')
          })
        }
      }, [popBubble])

      /** 充值：直接开官网充值页（DSH 账号服务给的 topUpUrl 优先，缺了用固定地址）。
          用临时 <a target="_blank"> 走和气泡「去充值」同一条路径，
          window.open 在部分 webview 里会被拦，<a> 点击不会。 */
      const openTopUp = useCallback(() => {
        const url = (data && data.links && data.links.topUpUrl) || TOPUP_FALLBACK
        const a = document.createElement('a')
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setMenu(null)
      }, [data])

      /** 右键：只开菜单，不触发受击动画（左右键的交互彻底分开） */
      const openMenu = useCallback((e) => {
        if (e) {
          e.preventDefault()
          e.stopPropagation()
        }
        const vw = window.innerWidth
        const vh = window.innerHeight
        /* 菜单也不能钻到标题栏底下 */
        const topEdge = titlebarInset() + 8
        const x = e && Number.isFinite(e.clientX) ? e.clientX : vw - MENU_W - 16
        const y = e && Number.isFinite(e.clientY) ? e.clientY : vh - MENU_H
        setMenu({
          x: Math.max(8, Math.min(x, vw - MENU_W - 8)),
          y: Math.max(topEdge, Math.min(y, vh - MENU_H))
        })
      }, [])

      useEffect(() => {
        if (!menu) return
        const onDown = (e) => {
          if (e.target && e.target.closest && e.target.closest('[data-dsh-ds-whale-menu]')) return
          setMenu(null)
        }
        const onKey = (e) => {
          if (e.key === 'Escape') setMenu(null)
        }
        const onMove = () => setMenu(null)
        window.addEventListener('pointerdown', onDown, true)
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('resize', onMove)
        window.addEventListener('scroll', onMove, true)
        return () => {
          window.removeEventListener('pointerdown', onDown, true)
          window.removeEventListener('keydown', onKey, true)
          window.removeEventListener('resize', onMove)
          window.removeEventListener('scroll', onMove, true)
        }
      }, [menu])

      /* 每次打开 DSH 的问候：等 /state 拿到昵称后再说，只做一次 */
      useEffect(() => {
        if (!data || !settings || greetRef.current) return
        greetRef.current = true
        if (settings.greetOnStart === false) return
        if (greetTimer.current) window.clearTimeout(greetTimer.current)
        greetTimer.current = window.setTimeout(() => {
          popBubble({
            kind: 'greet',
            tone: 'brand',
            mood: 'greet',
            title: greetVoice(settings),
            sub: greetSub(settings, data),
            closeMs: 12000,
            action: tt('知道啦~')
          })
          if (settings.soundOn) beep(settings.soundVolume)
        }, GREET_DELAY_MS)
      }, [data, settings, popBubble])

      /* ---------------- 拖拽 ----------------
         拖的过程中按「绝对左坐标」算（视觉连续、不跳），落下时再折算成「离哪边近就贴哪边」，
         这样窗口变宽时贴左的鲸鱼还是贴左，而不是固定在离右边若干像素的位置漂到中间。 */

      const dockFromLeft = useCallback(
        (left, ry) => {
          const maxLeft = Math.max(4, vw - px - 4)
          const x = Math.min(Math.max(4, left), maxLeft)
          const side = x + px / 2 <= vw / 2 ? 'left' : 'right'
          const dx = side === 'left' ? x : Math.max(4, vw - x - px)
          return clampDock({ side, dx, ry }, vw, vh, vp.tb)
        },
        [clampDock, vw, vh, vp.tb, px]
      )

      const onPointerDown = (e) => {
        if (e.button != null && e.button !== 0) return
        // 一按下去就有反应：不等 pointerup，也不管后面是拖还是点
        poke()
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          left: effLeft,
          ry: docked.ry,
          moved: false,
          pointerId: e.pointerId
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {}
      }

      const onPointerMove = (e) => {
        const d = dragRef.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
        if (!d.moved) return
        setPos(dockFromLeft(d.left + dx, d.ry - dy))
      }

      const onPointerUp = (e) => {
        const d = dragRef.current
        dragRef.current = null
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
        if (!d) return
        if (!d.moved) {
          /* 单击 = 刷一次余额（带冷却），详情面板改由右键菜单打开 */
          clickRefresh()
          return
        }
        const cur = dockedRef.current
        /* 松手贴边：按「中心点离哪边更近」决定贴哪条边，距离固定 22px */
        const next =
          settings && settings.snap
            ? clampDock(
                {
                  side: (cur.side === 'left' ? cur.dx : vw - cur.dx - px) + px / 2 < vw / 2 ? 'left' : 'right',
                  dx: 22,
                  ry: cur.ry
                },
                vw,
                vh,
                vp.tb
              )
            : cur
        setPos(next)
        writeDockPos(next)
      }

      useEffect(() => {
        try {
          window.localStorage.setItem(SIZE_KEY, String(scale))
        } catch {}
      }, [scale])

      /* 详情面板同样会顶出窗口：优先找放得下的一侧（至少 PANEL_MIN_ROOM），
         两边都放不下就选宽敞的那边，并靠 maxHeight 兜住。
         room 是「鲸鱼到窗口某一边」的净空间：鲸鱼底边距底部正好是 docked.ry，
         所以向下只剩 docked.ry - 间隙（之前多减了一个 px，导致下方面板被低估）。 */
      const PANEL_MIN_ROOM = 340
      const PANEL_GAP = 10
      const panelDownRoom = Math.max(0, docked.ry - PANEL_GAP)
      const panelUpRoom = Math.max(0, vh - docked.ry - px - PANEL_GAP)
      const openUp =
        panelUpRoom >= PANEL_MIN_ROOM
          ? true
          : panelDownRoom >= PANEL_MIN_ROOM
            ? false
            : panelUpRoom > panelDownRoom
      const panelMaxH = Math.max(240, (openUp ? panelUpRoom : panelDownRoom) - 8)

      /* ---------------- 常驻说话气泡 ---------------- */

      const FIELD_ORDER = ['balance', 'today', 'estimate', 'turn', 'peak']
      const fieldList = (Array.isArray(settings && settings.miniFields) && settings.miniFields.length
        ? settings.miniFields
        : ['balance', 'today']
      )
        .filter((id) => FIELD_ORDER.indexOf(id) >= 0)
        .slice(0, 3)

      const fieldPair = (id) => {
        if (id === 'balance') {
          const v = balanceOf(data)
          return [tt('余额'), v == null ? '--' : '¥' + money(v)]
        }
        if (id === 'today') return [tt('今日已用'), '¥' + money(todayCostOf(data))]
        if (id === 'estimate') return [tt('本机估算'), '¥' + money(data && data.today ? data.today.estimate : 0)]
        if (id === 'turn') return [tt('本轮消耗'), '¥' + money(data && data.lastTurn ? data.lastTurn.cost : 0)]
        if (id === 'peak') return [tt('峰谷'), data && data.peak ? tt(data.peak.label) + ' ' + dhm(secondsLeftNow(data)) : '--']
        return ['', '--']
      }

      const bubbleBg = T.bg

      /* 峰谷时期要素：常显模块顶上一条状态带 —— 现在是什么时段、按什么价、离切换还有多久。
         只在用户没把「峰谷」当成数字字段时出现，避免同一个东西写两遍。 */
      const peakNow = data && data.peak
      const peakShown = !!(peakNow && (!settings || settings.showPeak !== false))
      const peakTip = tt('工作日 09:00–12:00、14:00–18:00 为高峰（全价），其余时段与周末为空闲（5 折）')
      const peakStrip = (compact) =>
        h(
          'div',
          {
            title: peakTip,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              margin: '0 0 4px',
              padding: compact ? '1px 6px' : '2px 7px',
              borderRadius: 7,
              background: peakNow.isPeak
                ? 'color-mix(in srgb, ' + T.warn + ' 14%, transparent)'
                : 'color-mix(in srgb, ' + T.ok + ' 14%, transparent)',
              color: peakNow.isPeak ? T.warn : T.ok,
              fontSize: compact ? 8.5 : 9,
              fontWeight: 650,
              letterSpacing: 0.15,
              whiteSpace: 'nowrap'
            }
          },
          h('span', {
            style: { width: 5, height: 5, borderRadius: 999, background: 'currentColor', flex: '0 0 auto' }
          }),
          h('span', null, tt(peakNow.label)),
          h('span', { style: { opacity: 0.5 } }, '·'),
          h('span', null, peakNow.rateLabel ? tt(peakNow.rateLabel) : ''),
          h(
            'span',
            {
              style: {
                marginLeft: 'auto',
                color: T.sub,
                fontWeight: 500,
                fontVariantNumeric: 'tabular-nums',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }
            },
            tt('距') + tt(peakNow.nextIsPeak ? '高峰' : '空闲') + ' ' + dhm(secondsLeftNow(data))
          )
        )

      const renderFieldBubble = (tailSide, compact) => {
        const failed = !!(data && data.balanceError)
        return h(
          'div',
          {
            onClick: () => {
              clickRefresh()
            },
            onContextMenu: openMenu,
            title: tt('左键刷新余额 · 右键打开菜单'),
            style: Object.assign(
              {
                pointerEvents: 'auto',
                cursor: 'pointer',
                position: 'relative',
                display: 'grid',
                gridAutoFlow: 'row',
                gap: compact ? 2 : 3,
                padding: compact ? '6px 9px' : '8px 11px',
                minWidth: compact ? 92 : 104,
                borderRadius: 14,
                border: '1px solid ' + (failed ? T.warn : T.border),
                background: bubbleBg,
                color: T.text,
                boxShadow: '0 10px 26px rgba(15,23,42,0.20)',
                whiteSpace: 'nowrap'
              }
            )
          },
          peakShown && fieldList.indexOf('peak') < 0 ? peakStrip(compact) : null,
          fieldList.map((id) => {
            const pair = fieldPair(id)
            return h(
              'div',
              {
                key: id,
                style: {
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 10
                }
              },
              h('span', { style: { fontSize: compact ? 9 : 9.5, color: T.sub, letterSpacing: 0.2 } }, pair[0]),
              h(
                'span',
                {
                  style: {
                    fontSize: compact ? 11.5 : 12.5,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: 0.1
                  }
                },
                pair[1]
              )
            )
          }),
          h('div', {
            style: {
              position: 'absolute',
              [tailSide]: -4,
              bottom: compact ? 10 : 12,
              width: 9,
              height: 9,
              borderRadius: 1,
              background: bubbleBg,
              transform: 'rotate(45deg)'
            }
          })
        )
      }

      const peak = data && data.peak
      const secondsLeft = peak && peak.nextChangeAt ? Math.max(0, Math.round((peak.nextChangeAt - Date.now()) / 1000)) : 0
      const balance = data && data.balance
      const today = (data && data.today) || { spent: 0, estimate: 0, topup: 0, pendingAdjust: 0, count: 0 }

      const tabBtn = (id, text) =>
        h(
          'button',
          {
            type: 'button',
            key: id,
            onClick: () => {
              setTab(id)
              if (id === 'history' && !history) loadHistory('')
            },
            style: {
              appearance: 'none',
              cursor: 'pointer',
              border: 'none',
              background: tab === id ? T.bgSoft : 'transparent',
              color: tab === id ? T.text : T.sub,
              borderRadius: 7,
              padding: '3px 9px',
              fontSize: 11,
              fontWeight: tab === id ? 600 : 400
            }
          },
          text
        )

      const panel = open
        ? h(
            'div',
            {
              style: Object.assign({}, cardStyle, {
                position: 'absolute',
                [dockedLeft ? 'left' : 'right']: 0,
                [openUp ? 'bottom' : 'top']: px + 10,
                maxHeight: panelMaxH
              })
            },
            /* 头部 */
            h(
              Row,
              { style: { marginBottom: 8 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('span', { style: { fontSize: 13, fontWeight: 700, letterSpacing: 0.2 } }, tt('DeepSeek 余额')),
                peak
                  ? h(
                      'span',
                      {
                        style: {
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 999,
                          border: '1px solid ' + (peak.isPeak ? T.warn : T.ok),
                          color: peak.isPeak ? T.warn : T.ok
                        }
                      },
                      tt(peak.label) +
                        ' ' +
                        dhm(secondsLeft) +
                        (peak.rateLabel ? ' · ' + tt(peak.rateLabel) : '')
                    )
                  : null
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 5 } },
                h(Btn, { onClick: refreshNow, title: tt('立即刷新余额'), tone: 'brand' }, busy ? tt('刷新中…') : tt('刷新')),
                h(Btn, { onClick: () => setOpen(false), title: tt('收起面板') }, tt('关闭'))
              )
            ),

            /* 时段总览：一天 24 小时的价档分布 + 此刻的位置，比只看一个标签更清楚 */
            peak
              ? (() => {
                  const bj = new Date(Date.now() + 8 * 3600 * 1000)
                  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes()
                  const segs = peak.weekend
                    ? [{ from: 0, to: 24, peak: false }]
                    : [
                        { from: 0, to: 9, peak: false },
                        { from: 9, to: 12, peak: true },
                        { from: 12, to: 14, peak: false },
                        { from: 14, to: 18, peak: true },
                        { from: 18, to: 24, peak: false }
                      ]
                  return h(
                    'div',
                    { style: { marginBottom: 9 } },
                    h(
                      'div',
                      {
                        title: tt('工作日 09:00–12:00、14:00–18:00 为高峰（全价），其余时段与周末为空闲（5 折）'),
                        style: {
                          position: 'relative',
                          height: 5,
                          borderRadius: 999,
                          background: T.bgSoft,
                          overflow: 'hidden'
                        }
                      },
                      segs.map((s, i) =>
                        h('div', {
                          key: 'pkseg' + i,
                          style: {
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            left: (s.from / 24) * 100 + '%',
                            width: ((s.to - s.from) / 24) * 100 + '%',
                            background: s.peak
                              ? 'color-mix(in srgb, ' + T.warn + ' 62%, transparent)'
                              : 'color-mix(in srgb, ' + T.ok + ' 32%, transparent)'
                          }
                        })
                      ),
                      h('div', {
                        style: {
                          position: 'absolute',
                          top: -1,
                          bottom: -1,
                          left: (mins / 1440) * 100 + '%',
                          width: 2,
                          marginLeft: -1,
                          borderRadius: 2,
                          background: T.text,
                          opacity: 0.72
                        }
                      })
                    ),
                    h(
                      'div',
                      { style: { marginTop: 4, fontSize: 9, color: T.sub, letterSpacing: 0.15 } },
                      tt('工作日 09:00–12:00 · 14:00–18:00 全价，其余时段和周末 5 折') +
                        ' · ' +
                        tt('下一段') +
                        ' ' +
                        (peak.nextWindow || '') +
                        ' ' +
                        tt(peak.nextIsPeak ? '高峰' : '空闲')
                    )
                  )
                })()
              : null,

            error
              ? h(
                  'div',
                  {
                    style: {
                      marginBottom: 8,
                      padding: '5px 8px',
                      borderRadius: 8,
                      background: 'rgba(220,38,38,0.08)',
                      color: T.err,
                      fontSize: 11,
                      wordBreak: 'break-all'
                    }
                  },
                  tt('请求失败：') + error + tt('（每 4 秒自动重试）')
                )
              : null,

            data && data.balanceError
              ? h(
                  'div',
                  {
                    style: {
                      marginBottom: 8,
                      padding: '5px 8px',
                      borderRadius: 8,
                      background: 'rgba(234,88,12,0.09)',
                      color: T.warn,
                      fontSize: 11,
                      wordBreak: 'break-all'
                    }
                  },
                  tt('余额取数失败：') + data.balanceError.message + tt('（自动重试中，') + (data.balance ? tt('下方数字是上次成功的结果') : tt('暂无可用余额')) + '）'
                )
              : null,

            /* Tab 切换 */
            h(
              'div',
              { style: { display: 'flex', gap: 2, marginBottom: 9, background: 'transparent' } },
              tabBtn('home', tt('余额')),
              tabBtn('history', tt('记录'))
            ),

            tab === 'home' ? renderHome() : null,
            tab === 'history' ? renderHistory() : null
          )
        : null

      function renderHome() {
        return h(
          'div',
          null,
          h(
            'div',
            {
              style: {
                borderRadius: 12,
                padding: '10px 11px',
                background: T.bgSoft,
                border: '1px solid ' + T.borderSoft,
                marginBottom: 9
              }
            },
            h(
              Row,
              null,
              h(Label, null, tt('可用余额')),
              balance
                ? h(
                    'span',
                    { style: { fontSize: 10, color: T.sub } },
                    (balance.source === 'account' ? tt('账号登录态') : 'API Key') + ' · ' + clockText(balance.at)
                  )
                : h('span', { style: { fontSize: 10, color: T.sub } }, data ? tt('未取到') : tt('加载中…'))
            ),
            h(
              'div',
              { style: { fontSize: 26, fontWeight: 700, letterSpacing: 0.4, margin: '2px 0 4px' } },
              balance ? '¥' + money(balance.total) : '—'
            ),
            balance
              ? h(
                  Row,
                  { style: { justifyContent: 'flex-start', gap: 14 } },
                  h('span', { style: { fontSize: 10, color: T.sub } }, tt('充值 ¥') + money(balance.topped)),
                  h('span', { style: { fontSize: 10, color: T.sub } }, tt('赠金 ¥') + money(balance.granted)),
                  balance.available === false
                    ? h('span', { style: { fontSize: 10, color: T.err } }, tt('余额不足不可用'))
                    : null
                )
              : null
          ),

          h(
            Row,
            { style: { marginBottom: 2 } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
              h(Label, null, tt('今日已用')),
              h('span', { style: { fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }, '¥' + money(todayCostOf(data))),
              h(
                'span',
                { style: { fontSize: 9, color: T.sub, border: '1px solid ' + T.borderSoft, borderRadius: 999, padding: '0 5px' } },
                todaySourceOf(data) === tt('官网') ? tt('官网口径') : tt('余额差口径')
              )
            ),
            h(
              'span',
              { style: { fontSize: 10, color: T.sub } },
              data && data.settings
                ? tt('预算') + ' ' + (data.settings.dailyBudget > 0 ? '¥' + money(data.settings.dailyBudget) : tt('未设'))
                : ''
            )
          ),
          officialOf(data)
            ? h(
                'div',
                { style: { fontSize: 10, color: T.sub, marginBottom: 2, lineHeight: 1.5 } },
                tt('官网：') +
                  (officialOf(data).requests || 0) +
                  tt(' 次请求 · ') +
                  tokenText(officialOf(data).tokens ? officialOf(data).tokens.total : 0) +
                  ' tokens' +
                  (officialOf(data).models && officialOf(data).models[0]
                    ? ' · ' + officialOf(data).models[0].model
                    : '')
              )
            : null,
          h(
            'div',
            { style: { fontSize: 10, color: T.sub, marginBottom: 2, lineHeight: 1.5 } },
            tt('余额差观测 ¥') + money(today.spent) + ' · ' + today.count + tt(' 轮记账'),
            today.drift ? tt(' · 与本机估算偏差 ') + (today.drift > 0 ? '+' : '') + money(today.drift) : '',
            today.base != null ? tt(' · 起始余额 ¥') + money(today.base) : ''
          ),
          data && data.links && data.links.usageUrl
            ? h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 } },
                h(
                  'a',
                  { href: data.links.usageUrl, target: '_blank', rel: 'noreferrer', style: linkStyle() },
                  tt('对账：官网用量页 ↗')
                ),
                h(
                  'span',
                  { style: { fontSize: 9.5, color: T.sub } },
                  officialOf(data) ? tt('数字取自官网用量接口') : tt('官网接口未通，暂用余额下降口径')
                )
              )
            : null,

          today.topup > 0
            ? h(
                'div',
                {
                  style: {
                    marginTop: 6,
                    fontSize: 10,
                    color: T.warn,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8
                  }
                },
                h('span', null, tt('今日有充值记录 ¥') + money(today.topup) + tt('（待核对余额调整）')),
                h(Btn, { onClick: () => ledger('ack-adjust'), style: { padding: '2px 6px' } }, tt('核对'))
              )
            : null,

          data && data.lastTurn
            ? h(
                'div',
                {
                  style: {
                    marginTop: 8,
                    padding: '6px 9px',
                    borderRadius: 9,
                    border: '1px dashed ' + T.borderSoft,
                    fontSize: 10.5,
                    color: T.sub
                  }
                },
                tt('上一轮 ≈ ¥') +
                  money(data.lastTurn.cost) +
                  ' · ' +
                  (data.lastTurn.model || 'deepseek') +
                  tt(' · 入 ') +
                  tokenText(data.lastTurn.input) +
                  tt(' / 出 ') +
                  tokenText(data.lastTurn.output)
              )
            : null,

          data && data.balanceError
            ? h(
                'div',
                { style: { marginTop: 8, fontSize: 10, color: T.err, wordBreak: 'break-all' } },
                tt('取余额失败：') + (data.balanceError.message || tt('未知'))
              )
            : null,

          h(
            'div',
            { style: { marginTop: 9, display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Btn, { onClick: () => setTab('history') }, tt('用量记录')),
            h(Btn, { onClick: refreshNow }, tt('刷新余额')),
            data && data.price
              ? h(
                  'span',
                  { style: { fontSize: 10, color: T.sub, marginLeft: 'auto', alignSelf: 'center' } },
                  (LANG === 'en'
                    ? (data.price.slot === 'peak' ? 'Peak' : 'Off-peak') +
                      ' pricing · cache ' +
                      data.price.flash.hit +
                      ' / in ' +
                      data.price.flash.miss +
                      ' / out ' +
                      data.price.flash.out
                    : (data.price.slot === 'peak' ? tt('高峰期') : tt('空闲期')) +
                      tt('价：缓存') +
                      data.price.flash.hit +
                      ' / ' +
                      tt('入') +
                      ' ' +
                      data.price.flash.miss +
                      ' / ' +
                      tt('出') +
                      ' ' +
                      data.price.flash.out)
                )
              : null
          ),

          h(
            'div',
            { style: { marginTop: 7, fontSize: 9.5, color: T.sub, lineHeight: 1.5 } },
            tt('昵称、缩放、常驻参数等已移到 DSH 设置 → 插件 → dsh-ds-whale 里改') +
              ' · ' +
              tt('左键刷新余额 · 右键打开菜单')
          )
        )
      }

      function renderHistory() {
        const totals = (data && data.totals) || { spent: 0, topup: 0, estimate: 0, last7Spent: 0, last7Estimate: 0, turns: 0, days: 0 }
        const viewData =
          view === 'today'
            ? { spent: today.spent, estimate: today.estimate, turns: today.count, label: tt('今日') }
            : view === 'week'
            ? { spent: totals.last7Spent, estimate: totals.last7Estimate, turns: null, label: tt('近 7 天') }
            : { spent: totals.spent, estimate: totals.estimate, turns: totals.turns, label: tt('全部') }
        const list = history ? history.entries : data ? data.todayEntries || [] : []
        const models = history ? history.models : (data && data.models) || []
        return h(
          'div',
          null,
          h(
            'div',
            { style: { display: 'flex', gap: 4, marginBottom: 8 } },
            ['today', 'week', 'all'].map((id) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  onClick: () => setView(id),
                  style: {
                    appearance: 'none',
                    cursor: 'pointer',
                    flex: 1,
                    border: '1px solid ' + (view === id ? T.brand : T.border),
                    background: view === id ? 'rgba(37,99,235,0.08)' : 'transparent',
                    color: view === id ? T.brand : T.text,
                    borderRadius: 8,
                    padding: '4px 0',
                    fontSize: 11
                  }
                },
                id === 'today' ? tt('今日') : id === 'week' ? tt('近7天') : tt('全部')
              )
            )
          ),
          h(
            'div',
            {
              style: {
                borderRadius: 10,
                padding: '8px 10px',
                background: T.bgSoft,
                border: '1px solid ' + T.borderSoft,
                marginBottom: 8
              }
            },
            h(Row, null, h(Label, null, viewData.label + tt(' 观测消费')), h('span', { style: { fontWeight: 700 } }, '¥' + money(viewData.spent))),
            h(Row, { style: { marginTop: 2 } }, h(Label, null, viewData.label + tt(' 本机估算')), h('span', null, '¥' + money(viewData.estimate))),
            viewData.turns != null
              ? h(Row, { style: { marginTop: 2 } }, h(Label, null, tt('轮次')), h('span', null, String(viewData.turns)))
              : null,
            h(Row, { style: { marginTop: 2 } }, h(Label, null, tt('累计充值')), h('span', null, '¥' + money(totals.topup)))
          ),

          models.length
            ? h(
                'div',
                { style: { marginBottom: 8 } },
                h(Label, null, tt('模型占比')),
                h(
                  'div',
                  { style: { marginTop: 3 } },
                  models.slice(0, 5).map((m) => {
                    const max = models[0].cost || 1
                    return h(
                      'div',
                      { key: m.model, style: { marginBottom: 3 } },
                      h(
                        Row,
                        { style: { fontSize: 10 } },
                        h('span', { style: { color: T.text } }, m.model),
                        h('span', { style: { color: T.sub } }, '¥' + money(m.cost) + ' · ' + m.count + tt(' 轮'))
                      ),
                      h('div', {
                        style: {
                          height: 3,
                          borderRadius: 2,
                          background: T.borderSoft,
                          overflow: 'hidden',
                          marginTop: 2
                        }
                      }, h('div', {
                        style: {
                          height: 3,
                          width: Math.max(2, Math.round((m.cost / max) * 100)) + '%',
                          background: T.brand
                        }
                      }))
                    )
                  })
                )
              )
            : null,

          h(
            'div',
            { style: { display: 'flex', gap: 5, marginBottom: 6 } },
            h('input', {
              value: query,
              placeholder: tt('按模型名 / 日期搜索'),
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') loadHistory(query)
              },
              style: {
                flex: 1,
                minWidth: 0,
                border: '1px solid ' + T.border,
                background: 'transparent',
                color: T.text,
                borderRadius: 8,
                padding: '4px 8px',
                fontSize: 11,
                outline: 'none'
              }
            }),
            h(Btn, { onClick: () => loadHistory(query) }, tt('搜索')),
            history ? h(Btn, { onClick: () => { setHistory(null); setQuery('') } }, tt('还原')) : null
          ),

          h(
            'div',
            { style: { maxHeight: 190, overflow: 'auto' } },
            list.length
              ? list.map((e, i) =>
                  h(
                    Row,
                    {
                      key: (e.t || i) + ':' + i,
                      style: { padding: '3px 0', borderBottom: '1px solid ' + T.borderSoft }
                    },
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
                      h(
                        'span',
                        { style: { fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        e.model || 'deepseek'
                      ),
                      h(
                        'span',
                        { style: { fontSize: 9.5, color: T.sub } },
                        (e.date || '') + ' ' + clockText(e.t) + tt(' · 入 ') + tokenText(e.input) + tt(' 出 ') + tokenText(e.output)
                      )
                    ),
                    h('span', { style: { fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' } }, '¥' + money(e.cost))
                  )
                )
              : h('div', { style: { fontSize: 10.5, color: T.sub, padding: '8px 0' } }, tt('暂无记录'))
          ),

          h(
            'div',
            { style: { display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' } },
            h(Btn, { onClick: () => ledger('clear-today'), title: tt('只清今日账本') }, tt('清空今日')),
            h(Btn, { onClick: () => ledger('clear-all'), title: tt('清空全部历史') }, tt('清空全部')),
            h(Btn, { onClick: () => ledger('rebaseline'), title: tt('充值后重置基线，避免被算成消费') }, tt('重置基线'))
          )
        )
      }

      /* ---------------- 鲸鱼本体 ---------------- */

      /* 形象表情：被戳 → 气鼓鼓；问候 → 挥手打招呼；看天气 → 托腮思考；其余播报 → 脸红说话；余额告警 → 慌张；平时 → 平静 */
      const bubbleMood = bubble
        ? bubble.tone === 'warn'
          ? 'panic'
          : bubble.mood || 'blush'
        : 'calm'
      const showMood = mood === 'angry' ? 'angry' : bubbleMood
      /* 被戳 → 受击抖动；打招呼 → 慢慢晃；思考 → 更慢地浮；说话 → 轻微上下浮动；告警 → 更急的浮动；平时 → 静止 */
      const whaleAnim =
        mood === 'angry'
          ? 'dsh-ds-whale-hit-' + (hitN % 2 ? 'a' : 'b') + ' 560ms cubic-bezier(.36,.07,.19,.97)'
          : showMood === 'greet'
            ? 'dsh-ds-whale-talk 1.35s ease-in-out 2'
            : showMood === 'think'
              ? 'dsh-ds-whale-talk 2.3s ease-in-out infinite'
              : showMood === 'blush'
                ? 'dsh-ds-whale-talk 1.7s ease-in-out infinite'
                : showMood === 'panic'
                  ? 'dsh-ds-whale-talk 0.85s ease-in-out infinite'
                  : 'none'
      const moodImg = (src, key, alt) =>
        h('img', {
          key,
          src,
          alt,
          draggable: false,
          className: 'dsh-ds-whale-mood',
          style: {
            /* 行内也写一份定位，不依赖注入的 <style> 是否生效 */
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            opacity: showMood === key ? 1 : 0,
            transform: showMood === key ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(6px)'
          }
        })

      /* 刷新中的视觉层：光环 + conic-gradient 转圈环（和受击抖动完全分开） */
      const refreshLayers = refreshing
        ? [
            h('div', {
              key: 'refresh-glow',
              className: 'dsh-ds-whale-glow',
              style: {
                position: 'absolute',
                inset: -8,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(59,130,246,0.55) 0%, rgba(59,130,246,0.10) 58%, rgba(59,130,246,0) 72%)',
                pointerEvents: 'none'
              }
            }),
            h('div', {
              key: 'refresh-ring',
              className: 'dsh-ds-whale-spin',
              style: {
                position: 'absolute',
                inset: Math.round(px * 0.05),
                borderRadius: '50%',
                background:
                  'conic-gradient(from 0deg, rgba(56,189,248,0) 0deg, rgba(56,189,248,0.18) 130deg, #38bdf8 300deg, #818cf8 360deg)',
                WebkitMask:
                  'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))',
                mask: 'radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))',
                pointerEvents: 'none'
              }
            })
          ]
        : []

      const badgeTone = refreshing
        ? T.brand
        : flash
          ? flash.tone === 'err'
            ? T.err
            : flash.tone === 'warn'
              ? T.warn
              : flash.tone === 'ok'
                ? T.ok
                : T.brand
          : T.brand
      const badgeText = refreshing ? tt('刷新中…') : flash ? flash.text : ''
      const badge = badgeText
        ? h(
            'div',
            {
              key: 'badge-' + (refreshing ? 'r' : String(flash && flash.key)),
              className: 'dsh-ds-whale-badge',
              style: {
                position: 'absolute',
                top: '-4%',
                right: '-8%',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 999,
                border: '1px solid ' + badgeTone,
                background: T.bg,
                color: badgeTone,
                fontSize: 10.5,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                boxShadow: '0 8px 18px rgba(15,23,42,0.22)',
                pointerEvents: 'none'
              }
            },
            h('span', { key: 't' }, badgeText),
            refreshing
              ? h(
                  'span',
                  { key: 'd', className: 'dsh-ds-whale-dots', style: { display: 'inline-flex', gap: 2 } },
                  [0, 1, 2].map((i) =>
                    h('span', {
                      key: i,
                      style: {
                        display: 'block',
                        width: 3,
                        height: 3,
                        borderRadius: 2,
                        background: badgeTone
                      }
                    })
                  )
                )
              : null
          )
        : null

      const whale = h(
        'button',
        {
          type: 'button',
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          onContextMenu: openMenu,
          'data-mood': showMood,
          'data-build': BUILD,
          'data-refreshing': refreshing ? '1' : '0',
          title: balance ? tt('DeepSeek 余额 ¥') + money(balance.total) + tt(' · 今日 ¥') + money(today.spent) : tt('DeepSeek 余额'),
          style: {
            position: 'absolute',
            width: px,
            height: px,
            right: 0,
            bottom: 0,
            borderRadius: Math.round(px * 0.24),
            border: 'none',
            cursor: refreshing ? 'progress' : 'grab',
            padding: 0,
            touchAction: 'none',
            pointerEvents: 'auto',
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            filter: 'drop-shadow(0 10px 22px rgba(17,45,120,0.36))',
            animation: whaleAnim,
            transition: 'transform 160ms cubic-bezier(.34,1.56,.64,1)',
            transform: refreshing ? 'scale(1.04)' : 'scale(1)'
          }
        },
        moodImg(AVATAR_BIG, 'calm', tt('DeepSeek 小鲸鱼')),
        moodImg(AVATAR_ANGRY, 'angry', tt('DeepSeek 小鲸鱼（气鼓鼓）')),
        moodImg(AVATAR_BLUSH, 'blush', tt('DeepSeek 小鲸鱼（脸红说话）')),
        moodImg(AVATAR_PANIC, 'panic', tt('DeepSeek 小鲸鱼（慌张）')),
        moodImg(AVATAR_GREET, 'greet', tt('DeepSeek 小鲸鱼（打招呼）')),
        moodImg(AVATAR_THINK, 'think', tt('DeepSeek 小鲸鱼（托腮思考）')),
        ...refreshLayers,
        badge
      )

      /* 右键菜单：左键刷余额、右键出菜单，两套交互互不干扰 */
      const menuItem = (key, label, icon, onClick) =>
        h(
          'button',
          { key, type: 'button', className: 'dsh-ds-whale-menu-item', onClick },
          h('span', { className: 'dsh-ds-whale-menu-icon' }, icon),
          h('span', null, label)
        )
      const menuNode = menu
        ? h(
            'div',
            {
              key: 'dsh-ds-whale-menu',
              'data-dsh-ds-whale-menu': '1',
              className: 'dsh-ds-whale-menu',
              onContextMenu: (e) => e.preventDefault(),
              style: {
                position: 'fixed',
                left: Math.round(menu.x),
                top: Math.round(menu.y),
                zIndex: 71,
                width: MENU_W,
                padding: 6,
                borderRadius: 13,
                border: '1px solid ' + T.border,
                background: T.bg,
                color: T.text,
                boxShadow: '0 20px 48px rgba(15,23,42,0.28)',
                pointerEvents: 'auto',
                userSelect: 'none'
              }
            },
            menuItem('refresh', tt('立即刷新余额'), '🔄', () => {
              setMenu(null)
              clickRefresh()
            }),
            menuItem('detail', tt('查看余额详情'), '📊', () => {
              setMenu(null)
              setOpen(true)
              setTab('home')
            }),
            /* 充值入口：一键开官网充值页，省掉「去面板 / 点气泡链接」两步 */
            menuItem('topup', tt('去充值'), '💳', openTopUp),
            menuItem('weather', tt('今日天气'), '🌤', openWeather),
            menuItem('settings', tt('打开小鲸鱼设置'), '⚙️', openWhaleSettings),
            h(
              'div',
              {
                key: 'hint',
                style: {
                  marginTop: 4,
                  padding: '5px 8px 2px',
                  borderTop: '1px solid ' + T.borderSoft,
                  fontSize: 10,
                  color: T.sub,
                  whiteSpace: 'nowrap'
                }
              },
              tt('左键刷新余额 · 右键打开菜单')
            )
          )
        : null

      const bubbleToneColor = bubble && bubble.tone === 'warn' ? T.warn : T.brand
      /* 气泡默认在鲸鱼上方；鲸鱼被拖到贴顶时上方装不下（播报会顶出窗口被裁），
         这时翻到下方。roomAbove = 鲸鱼顶边到窗口顶，roomBelow = 鲸鱼底边到窗口底。 */
      const roomAbove = vh - docked.ry - px
      const roomBelow = docked.ry - 8
      const needBubbleH = (bubbleH || 210) + 14
      /* 两边都不够时选宽敞的那边，再靠 maxHeight 兜住 */
      const bubbleBelow = !!bubble && roomAbove < needBubbleH && roomBelow > roomAbove
      /* 限高只看气泡实际所在那一侧的空间；两边都不够时才会滚起来 */
      const bubbleMaxH = Math.max(140, (bubbleBelow ? roomBelow : roomAbove) - 6)
      const huddle = h(
        'div',
        {
          style: Object.assign(
            {
              position: 'absolute',
              display: 'flex',
              pointerEvents: 'none',
              ...(bubbleBelow ? { top: px + 10 } : { bottom: px + 10 })
            },
            /* 贴左边时气泡要往右展开，否则 296px 的卡片会顶出视口左侧被裁掉 */
            dockedLeft
              ? { left: 0, justifyContent: 'flex-start' }
              : { right: 0, justifyContent: 'flex-end' }
          )
        },
        bubble
          ? h(
              'div',
              {
                key: bubble.key,
                ref: bubbleBoxRef,
                className: 'dsh-ds-whale-bubble',
                style: {
                  position: 'relative',
                  pointerEvents: 'auto',
                  width: 'min(296px, calc(100vw - 32px))',
                  maxWidth: 'min(296px, calc(100vw - 32px))',
                  /* 窗口很矮时上下都放不下，就限高 + 内部滚动，别被窗口裁掉 */
                  maxHeight: bubbleMaxH,
                  overflowY: 'auto',
                  padding: '14px 16px 12px',
                  borderRadius: 20,
                  border: '1px solid ' + bubbleToneColor,
                  background: T.bg,
                  color: T.text,
                  boxShadow: '0 18px 44px rgba(15,23,42,0.26)',
                  fontSize: 13,
                  lineHeight: 1.55
                }
              },
              /* 指向头像的小尾巴：气泡翻到下方时尾巴跟着翻到顶上 */
              h('div', {
                style: Object.assign(
                  {
                    position: 'absolute',
                    ...(bubbleBelow ? { top: -6, borderTop: '1px solid ' + bubbleToneColor } : { bottom: -6, borderBottom: '1px solid ' + bubbleToneColor }),
                    width: 12,
                    height: 12,
                    background: T.bg,
                    transform: 'rotate(45deg)'
                  },
                  dockedLeft
                    ? { left: 44, borderLeft: '1px solid ' + bubbleToneColor }
                    : { right: 44, borderRight: '1px solid ' + bubbleToneColor }
                )
              }),
              h(
                'div',
                {
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '.4px',
                    color: bubbleToneColor,
                    marginBottom: 6,
                    textTransform: 'uppercase'
                  }
                },
                bubbleHeadline(bubble)
              ),
              h('div', { style: { fontSize: 14, fontWeight: 700, lineHeight: 1.5, marginBottom: 4 } }, bubble.title),
              bubble.sub ? h('div', { style: { color: T.sub, fontSize: 11.5, lineHeight: 1.5 } }, bubble.sub) : null,
              /* 第一次用天气：输入框直接长在气泡里，填完按保存就走，不用去设置页翻 */
              bubble.cityPrompt
                ? h(
                    'div',
                    { style: { marginTop: 10, display: 'flex', gap: 6 } },
                    h('input', {
                      key: 'city-input',
                      type: 'text',
                      value: cityDraft,
                      autoFocus: true,
                      placeholder: LANG === 'en' ? 'e.g. Shanghai / Tokyo' : '例如 上海 / 东京',
                      onChange: (e) => setCityDraft(e.target.value),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          submitCity()
                        }
                      },
                      style: {
                        flex: 1,
                        minWidth: 0,
                        padding: '7px 10px',
                        borderRadius: 9,
                        border: '1px solid ' + T.borderSoft,
                        background: T.bgSoft,
                        color: T.text,
                        fontSize: 12.5,
                        outline: 'none'
                      }
                    }),
                    h(
                      'button',
                      {
                        key: 'city-save',
                        type: 'button',
                        className: 'dsh-ds-whale-btn dsh-ds-whale-btn-primary',
                        disabled: cityBusy,
                        onClick: (e) => {
                          e.stopPropagation()
                          submitCity()
                        }
                      },
                      cityBusy ? tt('保存中…') : tt('保存并看天气')
                    )
                  )
                : null,
              h(
                'div',
                { style: { marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' } },
                bubble.link
                  ? h(
                      'a',
                      {
                        href: bubble.link,
                        target: '_blank',
                        rel: 'noreferrer',
                        className: 'dsh-ds-whale-btn dsh-ds-whale-btn-primary',
                        style: { textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
                        onClick: (e) => {
                          e.stopPropagation()
                        }
                      },
                      bubble.linkLabel || tt('去充值')
                    )
                  : null,
                /* 填城市时给一条退路：想用设置页的人也点得到 */
                bubble.cityPrompt
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-ds-whale-btn dsh-ds-whale-btn-ghost',
                        onClick: (e) => {
                          e.stopPropagation()
                          setBubble(null)
                          openWhaleSettings()
                        }
                      },
                      LANG === 'en' ? 'Open settings' : '打开设置'
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        className:
                          'dsh-ds-whale-btn ' +
                          (bubble.link ? 'dsh-ds-whale-btn-ghost' : 'dsh-ds-whale-btn-primary'),
                        onClick: (e) => {
                          e.stopPropagation()
                          setBubble(null)
                          if (typeof bubble.onAction === 'function') bubble.onAction()
                        }
                      },
                      bubble.action || tt('知道啦~')
                    )
              )
            )
          : null
      )

      const fieldBalloon =
        fieldList.length && !open && !bubble
          ? h(
              'div',
              {
                style: Object.assign(
                  {
                    /* 垂直居中在鲸鱼身上：原来固定贴底，鲸鱼拖到顶部时这块会顶出窗口 */
                    position: 'absolute',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    pointerEvents: 'none',
                    /* 加了峰谷状态带之后气泡变宽，得限一下，别从窗口另一边漏出去 */
                    maxWidth: Math.max(110, vw - px - 24)
                  },
                  dockedLeft ? { left: px + 10 } : { right: px + 10 }
                )
              },
              renderFieldBubble(dockedLeft ? 'left' : 'right', false)
            )
          : null

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            /* 用 left 而不是 right 定位：位置模型是「贴哪边 + 距那边多远」，
               贴左边时窗口变宽，鲸鱼跟着左边走，不会往中间漂 */
            left: Math.round(effLeft),
            bottom: Math.round(docked.ry),
            width: px,
            height: px,
            zIndex: 60,
            pointerEvents: 'none'
          }
        },
        h('style', { key: 'dsh-ds-whale-hit-css' }, HIT_CSS + MOOD_CSS + REFRESH_CSS),
        huddle,
        fieldBalloon,
        whale,
        panel,
        menuNode
      )
    }

    /* ---------------- DSH 设置页里的「小鲸鱼」分区 ---------------- */

    const SETTINGS_NS = 'dsh-ds-whale'

    /* ---------------- 打开 DSH 设置面板（直达小鲸鱼分区） ----------------
       shell 没给「打开设置」的 service，能用的官方通路是 sidebar.settings 那个
       单例 store 句柄：settings-general 把 create() 覆写成永远返回同一个实例，
       所以我们先 slots.entries('sidebar.settings') 拿到句柄，再 create() 就等于
       拿到面板正在用的 store，直接 openSection(分区 id) 即可。 */
    let CLIENT_CTX = null

    function settingsShellStore() {
      const slots = softService(CLIENT_CTX, 'slots')
      if (!slots || typeof slots.entries !== 'function') return null
      let list = []
      try {
        list = slots.entries('sidebar.settings') || []
      } catch {
        return null
      }
      for (const entry of list) {
        const store = entry && (entry.store || entry.handle)
        if (store && typeof store.create === 'function') return store
      }
      return null
    }

    function openSettingsPanel(sectionId) {
      const store = settingsShellStore()
      if (!store) return false
      try {
        const instance = store.create()
        const actions = (instance && instance.actions) || {}
        const openSection =
          (typeof actions.openSection === 'function' && actions.openSection) ||
          (typeof instance.openSection === 'function' && instance.openSection)
        const open =
          (typeof actions.open === 'function' && actions.open) ||
          (typeof instance.open === 'function' && instance.open)
        if (sectionId && openSection) {
          openSection.call(actions && actions.openSection ? actions : instance, sectionId)
          return true
        }
        if (open) {
          open.call(actions && actions.open ? actions : instance)
          return true
        }
      } catch {}
      return false
    }

    /** 兜底：拿不到 store 时，去点侧栏那颗设置齿轮 */
    function clickSettingsEntry() {
      if (typeof document === 'undefined') return false
      const words = ['设置', '設定', 'settings', 'preferences']
      let pool = []
      try {
        pool = Array.prototype.slice.call(document.querySelectorAll('aside button, nav button, [role="button"]'))
      } catch {
        pool = []
      }
      for (const el of pool) {
        const raw =
          ((el.getAttribute && el.getAttribute('aria-label')) || '') + ' ' + (el.textContent || '')
        const text = raw.toLowerCase()
        if (words.some((w) => text.indexOf(w) >= 0)) {
          try {
            el.click()
            return true
          } catch {}
        }
      }
      return false
    }

    function SetRow(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 18,
            padding: '12px 2px',
            borderBottom: '1px solid ' + T.borderSoft
          }
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 13.5, fontWeight: 600, color: T.text } }, props.label),
          props.hint
            ? h('div', { style: { fontSize: 11.5, color: T.sub, marginTop: 3, lineHeight: 1.55 } }, props.hint)
            : null
        ),
        h(
          'div',
          { style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 } },
          props.children
        )
      )
    }

    function NumInput(props) {
      return h('input', {
        type: 'number',
        value: props.value,
        min: props.min,
        max: props.max,
        step: props.step,
        onChange: (e) => props.onChange(Number(e.target.value)),
        style: {
          width: 92,
          padding: '5px 8px',
          borderRadius: 8,
          border: '1px solid ' + T.border,
          background: T.bgSoft,
          color: T.text,
          fontSize: 12.5,
          textAlign: 'right'
        }
      })
    }

    function SettingsSection(props) {
      const [state, setState] = useState(null)
      const [err, setErr] = useState(null)
      const [nick, setNick] = useState('')
      const [city, setCity] = useState('')
      /* 城市存好之后给一句「再去点一次天气」的回执，存的是已保存的城市名 */
      const [cityTip, setCityTip] = useState('')
      const cityTipTimer = useRef(0)
      /* 城市输入防抖存盘：不能只靠 blur——设置页是 SPA，切分区/关窗口时 blur 不一定来 */
      const citySaveTimer = useRef(0)
      /* 设置写入的请求序号：只认最后一次发出的请求回包（见 set1） */
      const saveSeq = useRef(0)

      const pull = useCallback(async () => {
        try {
          const next = await api('/state', {})
          setState(next)
          setNick(((next && next.settings) || {}).nickname || '')
          setCity(((next && next.settings) || {}).weatherCity || '')
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [])

      useEffect(() => {
        pull()
      }, [pull])

      useEffect(
        () => () => {
          if (cityTipTimer.current) window.clearTimeout(cityTipTimer.current)
          if (citySaveTimer.current) window.clearTimeout(citySaveTimer.current)
        },
        []
      )

      const s = (state && state.settings) || {}
      const links = (state && state.links) || null
      LANG = resolveLang(s)
      const lang = s.language === 'zh' || s.language === 'en' ? s.language : 'auto'

      const set1 = useCallback(
        async (key, value) => {
          const seq = ++saveSeq.current
          try {
            const next = await api('/settings', { config: { [key]: value } })
            /* 连着改同一项时，早发出、晚回来的响应会把刚拖好的值写回旧值（滑块回跳），丢掉 */
            if (seq !== saveSeq.current) return next
            setState(next)
            /* 宿主现在会把写失败的原因带回来（以前只有 HTTP 200 + 静默）；
               拿到 error 就别假装存好了，直接把原因摆在页面上 */
            if (next && next.error) {
              setErr(tt('没写进配置：') + String(next.error) + tt('（已存在本机，重启后可能丢）'))
            } else {
              setErr(null)
            }
            return next
          } catch (e) {
            setErr(String((e && e.message) || e))
            return null
          }
        },
        []
      )

      /** 城市存完先对一次账，再给回执：让用户知道下一步是「再点一次天气」 */
      const saveCity = useCallback(
        async (raw) => {
          const next = String(raw != null ? raw : city).trim()
          setCity(next)
          const res = await set1('weatherCity', next)
          const saved = String(((res && res.settings) || {}).weatherCity || '').trim()
          if (res && saved === next) {
            setCityTip(next)
            if (cityTipTimer.current) window.clearTimeout(cityTipTimer.current)
            cityTipTimer.current = window.setTimeout(() => setCityTip(''), 15000)
          } else {
            setCityTip('')
            if (res && !res.error) setErr(tt('城市没能写进去，再点一次「存一下」试试'))
          }
        },
        [city, set1]
      )

      const toggleField = (id) => {
        const now = Array.isArray(s.miniFields) ? s.miniFields.slice() : []
        const at = now.indexOf(id)
        if (at >= 0) now.splice(at, 1)
        else {
          if (now.length >= 3) now.splice(0, 1)
          now.push(id)
        }
        set1('miniFields', now)
      }

      const miniFields = Array.isArray(s.miniFields) ? s.miniFields : []

      return h(
        'div',
        { style: { padding: '4px 0 10px', maxWidth: 760 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } },
          h('img', {
            src: API + '/avatar.png?size=128&v=5',
            alt: tt('小鲸鱼'),
            style: { width: 40, height: 40, objectFit: 'contain' }
          }),
          h(
            'div',
            null,
            h('div', { style: { fontSize: 14, fontWeight: 700, color: T.text } }, tt('小鲸鱼余额挂件')),
            h(
              'div',
              { style: { fontSize: 11.5, color: T.sub } },
              tt('版本 ') + ((state && state.version) || '—') + tt(' · 数据只存在本机')
            )
          ),
          h('div', { style: { flex: 1 } }),
          links && links.usageUrl
            ? h(
                'a',
                {
                  href: links.usageUrl,
                  target: '_blank',
                  rel: 'noreferrer',
                  style: { fontSize: 12, color: T.brand, textDecoration: 'none' }
                },
                tt('官网用量页 ↗')
              )
            : null
        ),

        err ? h('div', { style: { fontSize: 12, color: T.err, marginBottom: 8 } }, tt('保存失败：') + err) : null,

        h(
          SetRow,
          { label: tt('界面语言'), hint: tt('跟随系统区域自动选择') },
          h(
            'select',
            {
              value: lang,
              onChange: (e) => set1('language', e.target.value),
              style: {
                padding: '5px 8px',
                borderRadius: 8,
                border: '1px solid ' + T.border,
                background: T.bgSoft,
                color: T.text,
                fontSize: 12.5
              }
            },
            h('option', { value: 'auto' }, tt('跟随系统')),
            h('option', { value: 'zh' }, tt('中文')),
            h('option', { value: 'en' }, 'English')
          )
        ),

        h(
          SetRow,
          { label: tt('你的昵称'), hint: tt('播报里会这样喊你，留空就不喊名字（最多 16 字）') },
          h('input', {
            type: 'text',
            value: nick,
            maxLength: 16,
            placeholder: tt('比如：小蓝'),
            onChange: (e) => setNick(e.target.value),
            onBlur: () => set1('nickname', nick),
            onKeyDown: (e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            },
            style: {
              width: 180,
              padding: '5px 9px',
              borderRadius: 8,
              border: '1px solid ' + T.border,
              background: T.bgSoft,
              color: T.text,
              fontSize: 12.5
            }
          })
        ),

        h(
          SetRow,
          { label: tt('形象大小'), hint: tt('头像的基准尺寸倍数，拖拽时也会按它算边界') },
          h(RangeField, {
            value: Number(s.scale) || 1,
            min: 0.6,
            max: 2,
            step: 0.01,
            width: 160,
            suffix: '×',
            decimals: 2,
            /* 拖动时先把鲸鱼变成目标尺寸，松手才落盘 */
            onPreview: emitScalePreview,
            onCommit: (v) => set1('scale', v)
          })
        ),

        h(
          SetRow,
          { label: tt('常驻气泡参数'), hint: tt('头像旁边始终显示的小气泡内容，最多 3 项（') + miniFields.length + '/3）' },
          h(
            'div',
            { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } },
            FIELD_OPTIONS.map((opt) =>
              h(
                Btn,
                { key: opt.id, active: miniFields.indexOf(opt.id) >= 0, onClick: () => toggleField(opt.id) },
                opt.label
              )
            )
          )
        ),

        h(
          SetRow,
          { label: tt('每轮消耗播报'), hint: tt('每轮对话结束后弹拟人播报，需要点「知道啦~」才关闭') },
          h(Toggle, { value: s.turnPop !== false, onChange: (v) => set1('turnPop', v) })
        ),

        h(
          SetRow,
          { label: tt('余额预警线（元）'), hint: tt('低于这个数会换成慌张表情并提醒充值；0 = 关闭') },
          h(NumInput, { value: Number(s.warnBelow) || 0, min: 0, step: 1, onChange: (v) => set1('warnBelow', v) })
        ),

        h(
          SetRow,
          { label: tt('今日预算（元）'), hint: tt('今日消费超过它时提醒一次；0 = 不限') },
          h(NumInput, { value: Number(s.dailyBudget) || 0, min: 0, step: 1, onChange: (v) => set1('dailyBudget', v) })
        ),

        h(
          SetRow,
          { label: tt('刷新间隔'), hint: tt('余额自动刷新周期，也影响账单新鲜度') },
          h(
            'select',
            {
              value: String(Number(s.refreshMs) || 60000),
              onChange: (e) => set1('refreshMs', Number(e.target.value)),
              style: {
                padding: '5px 8px',
                borderRadius: 8,
                border: '1px solid ' + T.border,
                background: T.bgSoft,
                color: T.text,
                fontSize: 12.5
              }
            },
            [15000, 30000, 60000, 120000, 300000].map((ms) =>
              h('option', { key: ms, value: String(ms) }, ms / 1000 + tt(' 秒'))
            )
          )
        ),

        h(
          SetRow,
          { label: tt('点击刷新最小间隔（毫秒）'), hint: tt('防止连点把余额接口刷爆，2000 ~ 120000') },
          h(NumInput, {
            value: Number(s.clickCooldownMs) || 6000,
            min: 2000,
            max: 120000,
            step: 1000,
            onChange: (v) => set1('clickCooldownMs', v)
          })
        ),

        h(
          SetRow,
          { label: tt('打开 DSH 时打招呼'), hint: tt('按昵称问好，和每轮播报用同一套形象') },
          h(Toggle, { value: s.greetOnStart !== false, onChange: (v) => set1('greetOnStart', v) })
        ),

        h(
          SetRow,
          {
            label: tt('天气城市'),
            hint:
              cityTip && cityTip === city.trim()
                ? tt('记好啦～再右键小鲸鱼点一次「今日天气」试试')
                : tt('必填：例如 上海 / Tokyo。没填时点天气会先请你去填')
          },
          h('input', {
            type: 'text',
            value: city,
            maxLength: 40,
            placeholder: tt('例如 上海'),
            onChange: (e) => {
              const v = e.target.value
              setCity(v)
              if (cityTip) setCityTip('')
              /* 边打边存（防抖 800ms）：以前只在 blur 时存，输完直接切走就白填了 */
              if (citySaveTimer.current) window.clearTimeout(citySaveTimer.current)
              citySaveTimer.current = window.setTimeout(() => saveCity(v), 800)
            },
            onBlur: () => {
              if (citySaveTimer.current) window.clearTimeout(citySaveTimer.current)
              if (city.trim() !== cityTip) saveCity()
            },
            onKeyDown: (e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            },
            style: {
              width: 180,
              padding: '5px 9px',
              borderRadius: 8,
              border: '1px solid ' + T.border,
              background: T.bgSoft,
              color: T.text,
              fontSize: 12.5
            }
          })
        ),

        h(
          SetRow,
          { label: tt('提示音'), hint: tt('每轮播报和告警时轻轻响一声') },
          h(Toggle, { value: s.soundOn !== false, onChange: (v) => set1('soundOn', v) }),
          h(RangeField, {
            value: Number(s.soundVolume) || 0,
            min: 0,
            max: 1,
            step: 0.05,
            width: 110,
            onCommit: (v) => set1('soundVolume', v)
          })
        ),

        h(
          SetRow,
          { label: tt('拖拽到中间自动贴边'), hint: tt('按页面中线判断，左半边贴左、右半边贴右') },
          h(Toggle, { value: s.snap !== false, onChange: (v) => set1('snap', v) })
        ),

        h(
          SetRow,
          { label: tt('显示峰谷时段'), hint: tt('常显气泡顶上那条：当前是高峰还是空闲、按全价还是 5 折计费、离下次切换还有多久') },
          h(Toggle, { value: s.showPeak !== false, onChange: (v) => set1('showPeak', v) })
        ),

        h('div', { style: { fontSize: 11.5, color: T.sub, marginTop: 12, lineHeight: 1.6 } },
          tt('版本') + ' ' + BUILD + ' · ',
          h(
            'a',
            {
              href: 'https://github.com/Iceseas/dsh-ds-whale/releases',
              target: '_blank',
              rel: 'noopener noreferrer',
              style: { color: T.text, textDecoration: 'underline' }
            },
            tt('查看新版')
          ),
          tt(' · ') + tt('数据文件：') + ((state && state.dataFile) || '—') + tt(' · 今日已用取官网用量接口（唯一权威口径），本机 token 估算只作对照'))
      )
    }


    /* ---------------- 注册 ---------------- */

    /** 取客户端服务（没有就返回 undefined，别抛） */
    function softService(ctx, name) {
      try {
        if (ctx && typeof ctx.get === 'function') return ctx.get(name)
      } catch {}
      try {
        return ctx ? ctx[name] : undefined
      } catch {
        return undefined
      }
    }

    /**
     * 在 DSH 设置左侧导航挂一个「小鲸鱼」分区（和「喵记忆」并列）。
     * scope 优先用 settingsScope.bind({namespace})，退路是 configForms.get(ns)。
     */
    function mountSettingsSection(ctx) {
      let disposer = null
      let timer = null
      let attempts = 0

      const resolveScope = () => {
        const ss = softService(ctx, 'settingsScope')
        if (ss && typeof ss.bind === 'function') {
          try {
            return ss.bind({ namespace: SETTINGS_NS })
          } catch {}
        }
        const cf = softService(ctx, 'configForms')
        if (cf && typeof cf.get === 'function') {
          try {
            return cf.get(SETTINGS_NS)
          } catch {}
        }
        return null
      }

      const register = () => {
        if (disposer) return
        const scope = resolveScope()
        if (!scope) return
        try {
          disposer = ctx.slots.register(
            {
              name: 'settings.section',
              id: SETTINGS_NS,
              order: 36,
              label: () => tt('小鲸鱼'),
              inject: () => ({ scope })
            },
            SettingsSection
          )
        } catch (err) {
          console.warn(tt('[dsh-ds-whale] settings section 注册失败：'), err)
        }
      }

      let disposeInject = null
      try {
        disposeInject = ctx.slots.inject('settings.section', register)
      } catch {}
      register()
      if (!disposer) {
        timer = window.setInterval(() => {
          attempts += 1
          register()
          if (disposer || attempts > 40) {
            window.clearInterval(timer)
            timer = null
          }
        }, 500)
      }

      return () => {
        if (timer) window.clearInterval(timer)
        try {
          if (disposeInject) disposeInject()
        } catch {}
        try {
          if (disposer) disposer()
        } catch {}
      }
    }

    function apply(ctx) {
      CLIENT_CTX = ctx
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'dsh-ds-whale', order: 90 }, WhaleDock)
      )
      ctx.effect(() => mountSettingsSection(ctx), 'dsh-ds-whale: settings section')
    }

    exports.name = 'dsh-ds-whale'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  }
})

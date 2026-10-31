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
    const SIZE_KEY = 'dsh-ds-whale:size'
    const SEEN_KEY = 'dsh-ds-whale:lastTurn'
    const WHALE_PX = 124
    const AVATAR_BIG = API + '/avatar.png?size=512&v=5'
    const AVATAR_ANGRY = API + '/avatar.png?size=512&v=5&mood=angry'
    const AVATAR_BLUSH = API + '/avatar.png?size=512&v=5&mood=blush'
    const AVATAR_PANIC = API + '/avatar.png?size=512&v=5&mood=panic'
    const HIT_MS = 1500
    const BUILD = 'v0.9.2'

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
      "显示峰谷倒计时": "Show peak/off-peak countdown",
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
      "中文": "中文"
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

    function hms(sec) {
      const s = Math.max(0, Math.round(Number(sec) || 0))
      const hh = Math.floor(s / 3600)
      const mm = Math.floor((s % 3600) / 60)
      const ss = s % 60
      const p = (n) => (n < 10 ? '0' + n : String(n))
      if (hh > 0) return `${hh}:${p(mm)}:${p(ss)}`
      return `${p(mm)}:${p(ss)}`
    }

    function clockText(ts) {
      if (!ts) return ''
      try {
        return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
      } catch {
        return ''
      }
    }

    async function api(path, body) {
      const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {})
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
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

    /* ---------------- 主组件 ---------------- */

    function WhaleDock() {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [open, setOpen] = useState(false)
      const [tab, setTab] = useState('home')
      const [pos, setPos] = useState(() => {
        try {
          const raw = window.localStorage.getItem(POS_KEY)
          if (raw) {
            const p = JSON.parse(raw)
            if (p && Number.isFinite(p.rx) && Number.isFinite(p.ry)) return { rx: p.rx, ry: p.ry }
          }
        } catch {}
        return { rx: 22, ry: 20 }
      })
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
        }
      }, [])

      const settings = (data && data.settings) || null
      const scale = settings ? settings.scale : size
      LANG = resolveLang(settings)

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

      const refreshNow = useCallback(async () => {
        setBusy(true)
        try {
          const next = await api('/refresh', {})
          setData(next)
          setError(null)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }, [])

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

      /* ---------------- 拖拽 ---------------- */

      const px = Math.round(WHALE_PX * (scale || 1))

      const clampPos = useCallback(
        (rx, ry) => {
          const maxRx = Math.max(6, window.innerWidth - px - 6)
          const maxRy = Math.max(6, window.innerHeight - px - 6)
          return {
            rx: Math.min(Math.max(6, rx), maxRx),
            ry: Math.min(Math.max(6, ry), maxRy)
          }
        },
        [px]
      )

      const onPointerDown = (e) => {
        if (e.button != null && e.button !== 0) return
        // 一按下去就有反应：不等 pointerup，也不管后面是拖还是点
        poke()
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          rx: pos.rx,
          ry: pos.ry,
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
        const next = clampPos(d.rx - dx, d.ry - dy)
        setPos(next)
      }

      const onPointerUp = (e) => {
        const d = dragRef.current
        dragRef.current = null
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {}
        if (!d) return
        if (!d.moved) {
          setOpen((v) => !v)
          return
        }
        let next = clampPos(pos.rx, pos.ry)
        if (settings && settings.snap) {
          // pos.rx 是「距右边」的偏移，先换算成中心点再和页面中线比
          const centerX = window.innerWidth - next.rx - px / 2
          next = { rx: centerX < window.innerWidth / 2 ? Math.max(22, window.innerWidth - px - 22) : 22, ry: next.ry }
          next = clampPos(next.rx, next.ry)
        }
        setPos(next)
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(next))
        } catch {}
      }

      useEffect(() => {
        try {
          window.localStorage.setItem(SIZE_KEY, String(scale))
        } catch {}
      }, [scale])

      const dockedLeft = window.innerWidth - pos.rx - px / 2 < window.innerWidth / 2
      const openUp = pos.ry < window.innerHeight / 2 + 40

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
        if (id === 'peak') return [tt('峰谷'), data && data.peak ? data.peak.label + ' ' + hms(secondsLeftNow(data)) : '--']
        return ['', '--']
      }

      const bubbleBg = T.bg
      const renderFieldBubble = (tailSide, compact) => {
        const failed = !!(data && data.balanceError)
        return h(
          'div',
          {
            onClick: () => {
              setOpen(true)
            },
            title: tt('DeepSeek 账本'),
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
                [openUp ? 'bottom' : 'top']: px + 10
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
                      peak.label + ' ' + hms(secondsLeft)
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
            tt('昵称、缩放、常驻参数等已移到 DSH 设置 → 插件 → dsh-ds-whale 里改')
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

      /* 形象表情：被戳 → 气鼓鼓；有播报 → 脸红说话；余额告警 → 慌张；平时 → 平静 */
      const bubbleMood = bubble ? (bubble.tone === 'warn' ? 'panic' : 'blush') : 'calm'
      const showMood = mood === 'angry' ? 'angry' : bubbleMood
      /* 被戳 → 受击抖动；说话 → 轻微上下浮动；告警 → 更急的浮动；平时 → 静止 */
      const whaleAnim =
        mood === 'angry'
          ? 'dsh-ds-whale-hit-' + (hitN % 2 ? 'a' : 'b') + ' 560ms cubic-bezier(.36,.07,.19,.97)'
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

      const whale = h(
        'button',
        {
          type: 'button',
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
          'data-mood': showMood,
          'data-build': BUILD,
          title: balance ? tt('DeepSeek 余额 ¥') + money(balance.total) + tt(' · 今日 ¥') + money(today.spent) : tt('DeepSeek 余额'),
          style: {
            position: 'absolute',
            width: px,
            height: px,
            right: 0,
            bottom: 0,
            borderRadius: Math.round(px * 0.24),
            border: 'none',
            cursor: 'grab',
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
            transform: 'scale(1)'
          }
        },
        moodImg(AVATAR_BIG, 'calm', tt('DeepSeek 小鲸鱼')),
        moodImg(AVATAR_ANGRY, 'angry', tt('DeepSeek 小鲸鱼（气鼓鼓）')),
        moodImg(AVATAR_BLUSH, 'blush', tt('DeepSeek 小鲸鱼（脸红说话）')),
        moodImg(AVATAR_PANIC, 'panic', tt('DeepSeek 小鲸鱼（慌张）'))
      )

      const bubbleToneColor = bubble && bubble.tone === 'warn' ? T.warn : T.brand
      const huddle = h(
        'div',
        {
          style: Object.assign(
            { position: 'absolute', bottom: px + 10, display: 'flex', pointerEvents: 'none' },
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
                className: 'dsh-ds-whale-bubble',
                style: {
                  position: 'relative',
                  pointerEvents: 'auto',
                  width: 'min(296px, calc(100vw - 32px))',
                  maxWidth: 'min(296px, calc(100vw - 32px))',
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
              /* 指向头像的小尾巴 */
              h('div', {
                style: Object.assign(
                  {
                    position: 'absolute',
                    bottom: -6,
                    width: 12,
                    height: 12,
                    background: T.bg,
                    borderBottom: '1px solid ' + bubbleToneColor,
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
                bubble.tone === 'warn' ? tt('余额提醒') : tt('本轮小结')
              ),
              h('div', { style: { fontSize: 14, fontWeight: 700, lineHeight: 1.5, marginBottom: 4 } }, bubble.title),
              bubble.sub ? h('div', { style: { color: T.sub, fontSize: 11.5, lineHeight: 1.5 } }, bubble.sub) : null,
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
                h(
                  'button',
                  {
                    type: 'button',
                    className:
                      'dsh-ds-whale-btn ' +
                      (bubble.link ? 'dsh-ds-whale-btn-ghost' : 'dsh-ds-whale-btn-primary'),
                    onClick: (e) => {
                      e.stopPropagation()
                      setBubble(null)
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
                  { position: 'absolute', bottom: Math.round(px * 0.12), pointerEvents: 'none' },
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
            right: Math.round(pos.rx),
            bottom: Math.round(pos.ry),
            width: px,
            height: px,
            zIndex: 60,
            pointerEvents: 'none'
          }
        },
        h('style', { key: 'dsh-ds-whale-hit-css' }, HIT_CSS + MOOD_CSS),
        huddle,
        fieldBalloon,
        whale,
        panel
      )
    }

    /* ---------------- DSH 设置页里的「小鲸鱼」分区 ---------------- */

    const SETTINGS_NS = 'dsh-ds-whale'

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

      const pull = useCallback(async () => {
        try {
          const next = await api('/state', {})
          setState(next)
          setNick(((next && next.settings) || {}).nickname || '')
          setErr(null)
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [])

      useEffect(() => {
        pull()
      }, [pull])

      const s = (state && state.settings) || {}
      const links = (state && state.links) || null
      LANG = resolveLang(s)
      const lang = s.language === 'zh' || s.language === 'en' ? s.language : 'auto'

      const set1 = useCallback(
        async (key, value) => {
          try {
            const next = await api('/settings', { config: { [key]: value } })
            setState(next)
            setErr(null)
          } catch (e) {
            setErr(String((e && e.message) || e))
          }
        },
        []
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
          h('input', {
            type: 'range',
            min: 0.6,
            max: 2,
            step: 0.05,
            value: Number(s.scale) || 1,
            onChange: (e) => set1('scale', Number(e.target.value)),
            style: { width: 160 }
          }),
          h('span', { style: { fontSize: 12, color: T.sub, width: 38, textAlign: 'right' } }, (Number(s.scale) || 1).toFixed(2) + '×')
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
          { label: tt('提示音'), hint: tt('每轮播报和告警时轻轻响一声') },
          h(Toggle, { value: s.soundOn !== false, onChange: (v) => set1('soundOn', v) }),
          h('input', {
            type: 'range',
            min: 0,
            max: 1,
            step: 0.05,
            value: Number(s.soundVolume) || 0,
            onChange: (e) => set1('soundVolume', Number(e.target.value)),
            style: { width: 110 }
          })
        ),

        h(
          SetRow,
          { label: tt('拖拽到中间自动贴边'), hint: tt('按页面中线判断，左半边贴左、右半边贴右') },
          h(Toggle, { value: s.snap !== false, onChange: (v) => set1('snap', v) })
        ),

        h(
          SetRow,
          { label: tt('显示峰谷倒计时'), hint: tt('空闲价是高峰价的一半，倒计时告诉你下一次切换还有多久') },
          h(Toggle, { value: s.showPeak !== false, onChange: (v) => set1('showPeak', v) })
        ),

        h('div', { style: { fontSize: 11.5, color: T.sub, marginTop: 12, lineHeight: 1.6 } },
          tt('数据文件：') + ((state && state.dataFile) || '—') + tt(' · 今日已用取官网用量接口（唯一权威口径），本机 token 估算只作对照'))
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

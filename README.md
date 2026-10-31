<div align="center">

<img src="assets/whale.png" width="220" alt="dsh-ds-whale" />

# 🐳 dsh-ds-whale

**DeepSeek 余额 / 用量小鲸鱼挂件** · DSH Web UI 插件
**Whale balance & usage widget for DeepSeek — a DSH Web UI plugin**

右下角常驻一只会说话的小鲸鱼：余额、官网口径的今日用量、每轮花掉多少钱、峰谷倒计时，全都用拟人语气告诉你。
A tiny whale docked in the bottom-right corner: balance, today's official spend, per-turn cost, peak/off-peak countdown — all narrated in character.

[![version](https://img.shields.io/badge/version-0.9.0-blue)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-DSH%20Web%20UI-purple)](https://github.com/Iceseas)

</div>

---

> **English TL;DR** — Install the bundle into your DSH profile, reload, and a whale appears in the bottom-right corner. It reads your balance from the DSH credential `DEEPSEEK_API_KEY` (or your DSH DeepSeek sign-in), pulls **today's real spend from the official usage API** (the same numbers as `platform.deepseek.com/usage`), narrates every turn's cost in a cute voice, and switches between four hand-drawn expressions. Everything is stored locally in `$DSH_HOME/.dsh-ds-whale.json`. UI is available in **中文 / English**, auto-selected from your system locale.

## ✨ 它做什么 / What it does

| | 能力 | 说明 |
| --- | --- | --- |
| 💰 | **余额** | 可用余额（总额 / 充值 / 赠金），60s 自动刷新，点一下立刻拉取。宿主刚启动时凭据服务还没就绪导致的失败会自动退避重试（4s→60s，最多 8 次），不会一直挂红字 |
| 📊 | **今日已用（官网口径）** | 直接调 DeepSeek 官网用量接口 `/api/v0/usage/by_api_key/{amount,cost}`，金额 / 请求数 / tokens 与 `platform.deepseek.com/usage` 页面**同源同数字**；接口不通时自动退回「余额下降」口径并在标签上标明 |
| 🗣️ | **拟人播报** | 每轮对话结束，用小鲸鱼的口吻把本轮花了多少钱说出来（按金额分 5 档台词），副行给模型与入/出 token；**必须点「知道啦~」才关闭**，不会自己消失 |
| 🎭 | **四种状态立绘** | 平静 / 气鼓鼓（点击受击）/ 脸红（说话中）/ 慌张（余额告警），全部 320ms 交叉淡入，各带专属小动作 |
| 💬 | **常驻气泡** | 头像旁常驻一个纵向小气泡，显示你勾选的 1–3 个参数（余额 / 今日已用 / 本机估算 / 本轮消耗 / 峰谷倒计时） |
| ⏰ | **峰谷定价** | 工作日 9:00–12:00、14:00–18:00 为高峰，空闲价是高峰价一半；周末全天谷价，面板上有实时倒计时 |
| 🚨 | **余额 / 预算告警** | 低于预警线或超出今日预算时换慌张脸，拟人播报 + 「去充值」/「看用量」+「知道啦」双按钮 |
| 📒 | **用量记录** | 今日 / 近 7 天 / 全部、模型占比、按模型名或日期搜索；可清空今日、清空全部、重置基线 |
| ⚙️ | **设置页** | 在 **DSH 设置 → 左侧导航** 里有独立一页「小鲸鱼 / Whale」（就在「喵记忆」下方）；同时也在 **DSH 设置 → 插件 → dsh-ds-whale** 由宿主按 schema 自动生成表单 |
| 🖱️ | **手感** | 拖拽移动 + 位置记忆、以**页面中线**判定左右吸附、大小滑块、任务结束提示音（WebAudio 合成，无外部音频文件）、形象始终完整不裁切 |

<div align="center">
<img src="assets/whale-blush.png" width="130" alt="blushing" />
<img src="assets/whale-angry.png" width="130" alt="pouting" />
<img src="assets/whale-panic.png" width="130" alt="panicking" />
</div>

## 🚀 安装 / Install

前置：DSH 桌面端或 `dsh web`，Node ≥ 20。

**方式一：从 GitHub 装（推荐）**

```bash
# 把整个仓库装进当前 profile 的插件目录
dsh plugin add github:Iceseas/dsh-ds-whale
```

装完重启 DSH（或重载插件），右下角出现小鲸鱼。若你的 DSH 版本没有 `plugin add`，用一次性的本地安装：

```bash
git clone https://github.com/Iceseas/dsh-ds-whale.git
# 然后在 DSH 里执行 plugin_manager action=install_bundle，target 填上面这个目录的绝对路径
```

**方式二：手动放进去**

1. 把仓库复制到 `<DSH_PROFILE_DIR>/node_modules/dsh-ds-whale`（`DSH_PROFILE_DIR` 一般是 `~/.dsh/profiles/desktop`）；
2. 在该 profile 的 `package.json` 的 `dsh.profile.bundles` 里加 `"dsh-ds-whale"`；
3. 重启 DSH。

**安装即用的前提**：DSH 里已经配好 DeepSeek 凭据（`DEEPSEEK_API_KEY`）**或**已经登录 DeepSeek 账号。两者都没有时挂件仍会出现，只是余额一栏会提示需要凭据。

## 🔐 数据与隐私 / Privacy

- 唯一数据文件：`$DSH_HOME/.dsh-ds-whale.json`（Windows 默认 `C:\Users\<你>\.dsh\.dsh-ds-whale.json`），**只存在本机**。
- 只保存：余额观测、官网用量缓存、每日汇总、每轮金额。**不保存任何对话内容**，不上传任何数据。
- 外部请求只有两条，都用你本机已有的凭据：
  1. `GET https://api.deepseek.com/user/balance`（Bearer `DEEPSEEK_API_KEY`）
  2. 官网用量 `GET https://platform.deepseek.com/api/v0/usage/by_api_key/{amount,cost}`（带 DSH 登录态的 `x-dsh-auth-token`）
- 代码里没有任何硬编码密钥；仓库不含 `.env` / 凭据 / 个人路径。
- 记录页底部「清空今日 / 清空全部 / 重置基线」可随时抹掉账本。

## ⚙️ 设置项 / Settings

| 字段 | 说明 |
| --- | --- |
| 界面语言 `language` | `auto` 跟随系统区域 / `zh` 中文 / `en` English，英文下界面与播报全英文 |
| 昵称 `nickname` | 播报里怎么称呼你（最多 16 字，留空则不喊名字） |
| 形象大小 `scale` | 0.6–2 倍 |
| 常驻气泡参数 `miniFields` | `balance` / `today` / `estimate` / `turn` / `peak`，最多 3 个 |
| 每轮消耗播报 `turnPop` | 关掉就不弹播报 |
| 余额预警线 `warnBelow` | 低于该值换慌张脸提醒，0 = 关闭 |
| 今日预算 `dailyBudget` | 超出时提醒一次，0 = 不限 |
| 刷新间隔 `refreshMs` | 余额自动刷新周期（15s–1h） |
| 提示音 `soundOn` / `soundVolume` | 轮末提示音与音量 |
| 中线吸附 `snap` | 拖拽结束后贴到最近一侧（按页面中线判定） |
| 峰谷倒计时 `showPeak` | 是否显示峰谷状态与倒计时 |
| 缓存口径 `cacheInInput` | `inputTokens` 是否已含缓存命中，DeepSeek 不含，保持关闭 |

## 🧮 定价与算法 / Pricing

元 / 百万 tokens，格式 `[空闲, 高峰]`：

| 模型族 | 缓存命中 | 未命中输入 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash`（含 v4-flash 系列） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro`（含 pro / reasoner / r1） | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

`金额 = (缓存命中 × 命中价 + 未命中输入 × 输入价 + 输出 × 输出价) / 1e6`

DeepSeek 的 usage 里 `totalTokens = inputTokens + outputTokens + cacheReadTokens`，即 `inputTokens` **不含**缓存命中，所以「未命中输入」直接取 `inputTokens`；只有当某个 provider 把缓存算进 `inputTokens` 时，才需要打开 `cacheInInput`。

**三种口径的关系**：官网用量（权威，主数字）→ 余额差观测（旁证）→ 本机 token 估算（对照）。面板把三者的差写成「偏差」，用来发现价格表漂移。

## 🧩 路由 / Routes

前缀 `/api/dsh-ds-whale`，同源 `POST`（仅本机浏览器可用）：

| 路由 | 作用 |
| --- | --- |
| `/state` | 余额 + 今日（含官网用量）+ 峰谷 + 设置 + 最近记录（自动补刷过期数据） |
| `/refresh` | 强制刷新余额与官网用量 |
| `/settings` | 写设置：`{"patch":{...}}` 改运行时，`{"config":{...}}` 写进 profile 的 `cordis.patch.yml` |
| `/ledger` | `clear-today` / `clear-all` / `ack-adjust` / `rebaseline` |
| `/history` | 按模型名或日期检索历史 |
| `/client-hello` | 前端自检回报（build / 当前情绪），用于排查 |
| `GET /avatar.png` | 形象 PNG，支持 `?size=128`、`&mood=angry\|blush\|panic`，带 ETag |

## 🛠️ 开发 / Development

```
dsh-ds-whale/
├── lib/index.js      # Host 半：取余额、官网用量、记账、HTTP 路由、Config schema
├── lib/client.js     # Client 半：挂件 UI、情绪动画、播报、设置页组件
├── assets/           # 四状态立绘 + 小尺寸
├── locale/           # meta.title / meta.description
├── tools/make-avatar.py  # 把贴纸原图去白底并裁切导出
├── cordis.patch.yml  # 插件行声明
└── package.json
```

- 改 `lib/client.js`：DSH 的 client-hmr 会热重载（必要时 Ctrl+Shift+R 硬刷新一次，避免旧模块实例叠在新实例下面）。
- 改 `lib/index.js`：需要重载 Host 半（插件管理器里关/开一次该插件）。
- 立绘：把原图丢给 `tools/make-avatar.py <原图> <输出目录>`，会做边缘泛洪去白底 + 裁 bbox + 导出 512/128/64，然后覆盖 `assets/`。

## 📄 License

[MIT](LICENSE) © 2026 Iceseas

> 非官方项目。DeepSeek、DeepSeek Harness 相关名称与商标归其各自所有者。

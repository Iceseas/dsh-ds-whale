<div align="center">

<img src="assets/whale.png" width="220" alt="dsh-ds-whale" />

# 🐳 dsh-ds-whale

**DeepSeek 余额 / 用量小鲸鱼挂件** · DSH Web UI 插件

**简体中文** · [English](README.en.md)

[![version](https://img.shields.io/badge/version-0.9.13-blue)](CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![platform](https://img.shields.io/badge/platform-DSH%20Web%20UI-purple)](https://github.com/Iceseas)

</div>

---

右下角常驻一只会说话的小鲸鱼：余额、官网口径的今日用量、每轮花掉多少钱、峰谷倒计时，全都用拟人语气告诉你。

装进 DSH profile、重启一次，它就会出现在右下角：开机按昵称打招呼；左键点一下立刻刷新余额（默认 6s 冷却）；右键菜单能看余额详情、今日天气、打开设置；余额读 DSH 凭据 `DEEPSEEK_API_KEY`（或 DSH 里的 DeepSeek 登录态）；今日花费直接取官网用量接口，和 `platform.deepseek.com/usage` **同源同数字**；每轮结束用可爱语气播报这轮花了多少；六张手绘立绘随场景切换。天气由宿主进程直连 Open-Meteo，**零 token**，永远不经过模型。所有数据只存在本机 `$DSH_HOME/.dsh-ds-whale.json`。界面支持**中文 / English**，默认跟随系统语言。

## ✨ 它做什么

| | 能力 | 说明 |
| --- | --- | --- |
| 💰 | **余额** | 可用余额（总额 / 充值 / 赠金），默认 60s 自动刷新；**左键点一下立刻刷新**（默认 6s 冷却，连点也不会打爆接口），刷新中有光环 + 转圈进度环 + 「刷新中…」角标。宿主刚启动时凭据服务还没就绪导致的失败会自动退避重试（4s→60s，最多 8 次） |
| 📊 | **今日已用（官网口径）** | 直接调 DeepSeek 官网用量接口 `/api/v0/usage/by_api_key/{amount,cost}`，金额 / 请求数 / tokens 与 `platform.deepseek.com/usage` 页面**同源同数字**；接口不通时自动退回「余额下降」口径并在标签上标明 |
| 🗣️ | **拟人播报** | 每轮对话结束，用小鲸鱼的口吻把本轮花了多少钱说出来（按金额分 5 档台词），副行给模型与入/出 token；**必须点「知道啦~」才关闭**，不会自己消失 |
| 🎭 | **六种状态立绘** | 平静 / 气鼓鼓（点击受击）/ 脸红（说话中）/ 慌张（余额告警）/ **挥手打招呼（开机问候）** / **托腮思考（在看天气）** |
| 🖱️ | **左键刷新 · 右键菜单** | 右键（不触发受击抖动）弹出菜单：立即刷新余额 / 查看余额详情 / 去充值 / 今日天气 / 打开小鲸鱼设置；「去充值」一键开官网充值页（优先用 DSH 账号服务给的 `topUpUrl`，取不到就落到 `platform.deepseek.com/top_up`），不用先开面板再点气泡链接；菜单项有明显的悬停高亮与过渡动画 |
| 🌤️ | **今日天气** | 右键菜单里的「今日天气」：**零 token**；给当前温度、今日区间、降雨概率、接下来三小时的走向，外加一句该带伞还是该补水。第一次用**直接在气泡里填城市**（输入框就在鲸鱼旁边，存好立刻出天气，不用去设置页翻）；城市名换经纬度有三路兜底（内置常用城市表 → photon → Open-Meteo），失败时区分「城市没找到」和「网络连不上」 |
| 👋 | **开机问候** | 每次打开 DSH，按你设定的昵称用同一套可爱语气问好（按时段分六档台词），配挥手立绘与提示音 |
| 💬 | **常驻气泡** | 头像旁常驻一个纵向小气泡，顶上一条**峰谷状态带**（圆点 + 高峰/空闲 + 全价/5 折 + 距下次切换的倒计时），下面是你勾选的 1–3 个参数（余额 / 今日已用 / 本机估算 / 本轮消耗 / 峰谷倒计时） |
| ⏰ | **峰谷定价** | 工作日 9:00–12:00、14:00–18:00 为高峰（全价），其余时段与周末空闲（5 折）：常驻气泡有状态带，详情面板有 **24 小时价档条** 与此刻游标、当前窗口、下一段的时段名，周末倒计时按「天:时」显示 |
| 🚨 | **余额 / 预算告警** | 低于预警线或超出今日预算时换慌张脸，拟人播报 + 「去充值」/「看用量」+「知道啦」双按钮 |
| 📒 | **用量记录** | 今日 / 近 7 天 / 全部、模型占比、按模型名或日期搜索；可清空今日、清空全部、重置基线 |
| ⚙️ | **设置页** | 在 **DSH 设置 → 左侧导航** 里有独立一页「小鲸鱼 / Whale」（就在「喵记忆」下方）；同时也在 **DSH 设置 → 插件 → dsh-ds-whale** 由宿主按 schema 自动生成表单。右键菜单里的「打开小鲸鱼设置」会直接跳到这一页 |
| 🖱️ | **手感** | 拖拽移动 + 位置记忆（存「贴哪一边 + 距那条边多远」，窗口拉大拉小都跟边不跟距离走）、以**页面中线**判定左右吸附、大小滑块；鲸鱼可以拖到窗口最上面，此时播报气泡与详情面板会自动翻到下方（按实测高度判断），常驻小气泡垂直居中跟随，都不会被窗口边缘裁掉 |

<div align="center">
<img src="assets/whale-blush.png" width="110" alt="脸红" />
<img src="assets/whale-angry.png" width="110" alt="气鼓鼓" />
<img src="assets/whale-panic.png" width="110" alt="慌张" />
<img src="assets/whale-greet.png" width="110" alt="挥手打招呼" />
<img src="assets/whale-think.png" width="110" alt="托腮思考" />
</div>

## 👋 三种新动作

| 什么时候 | 立绘 | 台词（节选） |
| --- | --- | --- |
| 打开 DSH | 挥手打招呼 | 「小蓝，早上好呀！余额我盯好了，随时可以开工。」 |
| 点「今日天气」 | 托腮思考 | 「北京 · 7°C 晴」/ 今天 4~16°C · 大致晴朗 · 降雨 0% |
| 还没填城市就点天气 | 托腮思考 | 「先告诉我在哪座城市嘛～」→ 气泡里直接出现输入框，填完按「保存并看天气」立刻出结果 |

<div align="center">
<img src="assets/shot-dock.png" width="300" alt="常驻气泡：峰谷状态带 + 三项参数" />
<img src="assets/shot-dock-cooldown.png" width="300" alt="点击后的冷却提示" />
<br />
<img src="assets/shot-greet.png" width="286" alt="开机问候：挥手立绘 + 拟人播报" />
<img src="assets/shot-summary.png" width="286" alt="本轮小结：用了多少钱、值不值" />
</div>

## 🚀 安装

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

## ⬆️ 更新

看当前版本：小鲸鱼面板 → 设置，最底部那行有 `版本 vX.Y.Z` 和「查看新版」（直通 Releases 列表）。最新版看 [Releases](https://github.com/Iceseas/dsh-ds-whale/releases)（0.x 阶段都按 Pre-release 发，仓库首页的 Releases 卡片不显示，`/releases/latest` 也不指向它——**这只影响展示，不影响安装和更新**）。

**装的时候没写版本号**（`github:Iceseas/dsh-ds-whale`）——跟默认分支最新，一条命令：

```bash
dsh plugin update dsh-ds-whale
```

**装的时候锁了 tag**（`.../dsh-ds-whale#v0.9.8`）——`update` 不会跨版本，要显式换 tag：

```bash
# 把 vX.Y.Z 换成目标版本的 tag（在 Releases 里挑最新那个）
dsh plugin add github:Iceseas/dsh-ds-whale#vX.Y.Z
```

**手工 zip / 手放目录安装的**：下载新的 `dsh-ds-whale-x.y.z.zip`，整份覆盖 `<DSH_PROFILE_DIR>/node_modules/dsh-ds-whale/`，再重启。

更新完都要**重启 DSH**——插件有宿主侧代码（`lib/index.js` 的路由与状态），热重载只换前端。

> 多 profile 的环境（`desktop` / `web` 并存）记得带 `--profile`，例如 `dsh plugin update dsh-ds-whale --profile web`。

## 🔐 数据与隐私

- 唯一数据文件：`$DSH_HOME/.dsh-ds-whale.json`（Windows 默认 `C:\Users\<你>\.dsh\.dsh-ds-whale.json`），**只存在本机**。
- 只保存：余额观测、官网用量缓存、每日汇总、每轮金额。**不保存任何对话内容**，不上传任何数据。
- 外部请求只有三条，都用你本机已有的凭据（第三条不带任何凭据）：
  1. `GET https://api.deepseek.com/user/balance`（Bearer `DEEPSEEK_API_KEY`）
  2. 官网用量 `GET https://platform.deepseek.com/api/v0/usage/by_api_key/{amount,cost}`（带 DSH 登录态的 `x-dsh-auth-token`）
  3. 天气（仅当你点「今日天气」时）：先把城市名换成经纬度，再取预报。**不带凭据、不带 token、不带你填的城市以外的任何信息**，结果在宿主进程内缓存 10 分钟。换经纬度是「三路兜底」：内置常用城市坐标表（命中就完全不联网）→ `photon.komoot.io` → `geocoding-api.open-meteo.com`；取预报只走 `api.open-meteo.com`
- 代码里没有任何硬编码密钥；仓库不含 `.env` / 凭据 / 个人路径。
- 记录页底部「清空今日 / 清空全部 / 重置基线」可随时抹掉账本。

## ⚙️ 设置项

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
| 峰谷时段 `showPeak` | 常驻气泡顶上是否显示时段状态带（高峰/空闲、全价/5 折、切换倒计时）；关掉后气泡只剩你选的数字 |
| 点击刷新间隔 `clickCooldownMs` | 左键点鲸鱼刷新的最小间隔（2000–120000ms，默认 6000），防止连点打爆余额接口 |
| 开机打招呼 `greetOnStart` | 每次打开 DSH 是否按昵称问好 |
| 天气城市 `weatherCity` | 天气用的城市名（例如 `上海` / `Tokyo`）。**必填**：没填时点「今日天气」会直接在气泡里问，填完立刻出天气；设置页里这一栏也支持边打边存（800ms 防抖，不依赖失焦） |
| 缓存口径 `cacheInInput` | `inputTokens` 是否已含缓存命中，DeepSeek 不含，保持关闭 |

## 🧮 定价与算法

元 / 百万 tokens，格式 `[空闲, 高峰]`：

| 模型族 | 缓存命中 | 未命中输入 | 输出 |
| --- | --- | --- | --- |
| `deepseek-flash`（含 v4-flash 系列） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro`（含 pro / reasoner / r1） | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

`金额 = (缓存命中 × 命中价 + 未命中输入 × 输入价 + 输出 × 输出价) / 1e6`

DeepSeek 的 usage 里 `totalTokens = inputTokens + outputTokens + cacheReadTokens`，即 `inputTokens` **不含**缓存命中，所以「未命中输入」直接取 `inputTokens`；只有当某个 provider 把缓存算进 `inputTokens` 时，才需要打开 `cacheInInput`。

**三种口径的关系**：官网用量（权威，主数字）→ 余额差观测（旁证）→ 本机 token 估算（对照）。面板把三者的差写成「偏差」，用来发现价格表漂移。

## 🧩 路由

前缀 `/api/dsh-ds-whale`，同源 `POST`（仅本机浏览器可用）：

| 路由 | 作用 |
| --- | --- |
| `/state` | 余额 + 今日（含官网用量）+ 峰谷 + 设置 + 最近记录（自动补刷过期数据） |
| `/refresh` | 强制刷新余额与官网用量 |
| `/weather` | 今日天气（`{force?, city?}`）：零 token；设置里没城市时返回 `{ok:false, error:"need-city"}`，查不到城市是 `geocode-failed`，联网失败是 `geocode-offline`（两种提示语不同） |
| `/settings` | 写设置：`{"patch":{...}}` 改运行时，`{"config":{...}}` 写进 profile 的 `cordis.patch.yml` |
| `/ledger` | `clear-today` / `clear-all` / `ack-adjust` / `rebaseline` |
| `/history` | 按模型名或日期检索历史 |
| `/client-hello` | 前端自检回报（build / 当前情绪），用于排查 |
| `GET /avatar.png` | 形象 PNG，支持 `?size=128`、`&mood=angry\|blush\|panic\|greet\|think`，带 ETag |

## 🛠️ 开发

```
dsh-ds-whale/
├── lib/index.js      # Host 半：取余额、官网用量、记账、HTTP 路由、Config schema
├── lib/client.js     # Client 半：挂件 UI、情绪动画、播报、设置页组件
├── assets/           # 六种状态立绘 + 小尺寸
├── locale/           # meta.title / meta.description
├── scripts/gen-avatars.mjs  # 调本机 Agnes 批量生成立绘（六种 mood）
├── scripts/cut-bg.ps1       # 白底转透明（四边泛洪 + 边缘羽化）
├── scripts/build-avatar.ps1 # 裁 bbox + 缩 512/128/64
├── scripts/finalize-avatars.ps1 # 串起上面两步
├── cordis.patch.yml  # 插件行声明
└── package.json
```

- 改 `lib/client.js`：DSH 的 client-hmr 会热重载（必要时 Ctrl+Shift+R 硬刷新一次，避免旧模块实例叠在新实例下面）。
- 改 `lib/index.js`：需要重载 Host 半（插件管理器里关/开一次该插件）。
- 立绘：`node scripts/gen-avatars.mjs`（需要 DSH 在跑 + 已装 `dsh-agnes-studio` 且配好 `AGNES_API_KEY`）会按 `CHARACTER` + `POSES` 生成六张到 `avatar-out/`；再 `& scripts\finalize-avatars.ps1 -SrcDir avatar-out -OutDir avatar-out\final -Pad 0.02` 做去白底、裁 bbox、导出 512/128/64；最后覆盖 `assets/`。文件前缀固定为 `whale` / `whale-angry` / `whale-blush` / `whale-panic` / `whale-greet` / `whale-think`，宿主按 `MOOD_FILES` 直接发图（`mood=greet` / `mood=think`）。想换成自己的图，放到 `~/.dsh/dsh-ds-whale-assets/` 同名覆盖即可，不用改仓库。

## 📄 License

[MIT](LICENSE) © 2026 Iceseas

> 非官方项目。DeepSeek、DeepSeek Harness 相关名称与商标归其各自所有者。

# 立绘上传链路自测

改过 `lib/client.js` 里 `avatarMatte` / `avatarSquare` 或宿主 `avatar/*` 路由后，跑一遍：

```bash
python tools/avatar-selftest/selftest.py                 # 全部三段
python tools/avatar-selftest/selftest.py --no-browser    # 只跑像素 + 宿主路由
python tools/avatar-selftest/selftest.py <图片目录>      # 换一组测试图
```

三段分别验证：

1. **像素管线**：Pillow 把真图解成 RGBA，直接执行 `lib/client.js` 里
   `avatar-pipeline:begin/end` 之间那段（不是另抄一份），输出 512/128 并算指标：
   四角 alpha、白边像素数、内容占比。会额外造 jpg 白底、浅灰底、米白底、小图、
   1600×900 非正方形、蓝 / 粉 / 深灰 / 绿幕纯色底、白甲贴蓝底、浅蓝渐变「照片底」
   （不该抠）等坑。
2. **浏览器端到端**：起本地 HTTP 服务 + 无头 Chrome，测试页用
   `createImageBitmap` 解码、canvas 编码 PNG，再把 base64 POST 回来 ——
   跑的就是用户上传时走的那条链路。需要本机装有 Chrome。
3. **宿主路由**：直接 import `lib/index.js`，用假 req/res 打
   `/avatar/upload`、`/avatar.png`、`/avatar/reset`，覆盖尺寸/格式校验、
   状态白名单、恢复默认和回环栅栏。`DSH_HOME` 指向临时目录，不碰真实立绘。

产物在 `work/`（已 gitignore）：

- `work/outputs/contact-512.png` —— 像素管线结果的棋盘格对比图
- `work/browser/outputs/contact-512.png` —— 浏览器端结果对比图
- `work/outputs/metrics.json` / `work/browser/outputs/metrics.json` —— 指标表

判读：`white_ring = 0`（输出四周没有残留的白色不透明边）、`corners = [0,0,0,0]`、
角色没有被抠掉一块；`photo_like_*` 的 `matted` 必须是 `false`。

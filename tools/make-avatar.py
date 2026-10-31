"""把贴纸图去白底并导出插件用的头像资源。

输入：附件里的原始 webp（白底贴纸）。
输出：assets/whale.png（512px 透明底）、assets/whale-128.png（小球用）。
做法：从四边做泛洪，把与边界连通的近白像素变透明，贴纸内部的白围裙不会被吃掉。
"""
import sys
from collections import deque

from PIL import Image

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]

img = Image.open(SRC).convert("RGBA")
w, h = img.size
px = img.load()

WHITE = 236  # 与边界连通的判定阈值：三通道都 >= 该值视为背景


def is_bg(p):
    r, g, b, a = p
    if a < 8:
        return True
    return r >= WHITE and g >= WHITE and b >= WHITE


seen = bytearray(w * h)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if is_bg(px[x, y]):
            q.append((x, y))
            seen[y * w + x] = 1
for y in range(h):
    for x in (0, w - 1):
        if is_bg(px[x, y]):
            q.append((x, y))
            seen[y * w + x] = 1

while q:
    x, y = q.popleft()
    px[x, y] = (255, 255, 255, 0)
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < w and 0 <= ny < h:
            i = ny * w + nx
            if not seen[i] and is_bg(px[nx, ny]):
                seen[i] = 1
                q.append((nx, ny))

# 轻量羽化：把紧邻透明区的半透明白边压一点，减少锯齿
for y in range(1, h - 1):
    for x in range(1, w - 1):
        r, g, b, a = px[x, y]
        if a == 0:
            continue
        if r >= 250 and g >= 250 and b >= 250:
            near = 0
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if px[nx, ny][3] == 0:
                    near += 1
            if near:
                px[x, y] = (r, g, b, 120)

box = img.getbbox()
if box:
    img = img.crop(box)

import os

os.makedirs(OUT_DIR, exist_ok=True)
for size, name in ((512, "whale.png"), (128, "whale-128.png"), (64, "whale-64.png")):
    out = img.copy()
    out.thumbnail((size, size), Image.LANCZOS)
    path = os.path.join(OUT_DIR, name)
    out.save(path, "PNG", optimize=True)
    print(name, out.size, os.path.getsize(path))

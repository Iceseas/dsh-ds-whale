# -*- coding: utf-8 -*-
r"""立绘上传链路自测：真图 -> 浏览器端算法 -> 512/128 PNG -> 指标 + 对比图。

用法：
    python tools/avatar-selftest/selftest.py [源目录] [--no-browser]

阶段 1：Pillow 解出原始 RGBA，直接跑 lib/client.js 里 avatar-pipeline 那段（快、纯像素）。
阶段 2：真起一个无头 Chrome，走 createImageBitmap -> 去白边 -> canvas 编码 PNG -> 回传，
        验证浏览器里真正跑的那条链路（上传时用的就是它）。
默认拿 D:\dsh_wsp_001\avatar-test\final 里的六张图，再补几种常见的坑：
jpg 白底、浅灰底、米白底、非正方形、小图、风景照渐变底（不该抠）、关掉自动抠图。
输出落在 tools/avatar-selftest/work/：contact-512.png / browser/contact-512.png 是棋盘格对比图。
"""
import io
import json
import os
import shutil
import subprocess
import sys
import time

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.join(HERE, "work")
IN_DIR = os.path.join(WORK, "inputs")
OUT_DIR = os.path.join(WORK, "outputs")
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
FLAGS = [a for a in sys.argv[1:] if a.startswith("--")]
SRC_DIR = ARGS[0] if ARGS else r"D:\dsh_wsp_001\avatar-test\final"
SIZES_MAIN = [512, 128, 64]
SIZES_OTHER = [512, 128]


def on_bg(im, color):
    bg = Image.new("RGBA", im.size, color + (255,))
    return Image.alpha_composite(bg, im.convert("RGBA"))


def via_jpeg(im, quality=82):
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=quality)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def gradient(size, top, bottom):
    im = Image.new("RGBA", size)
    px = im.load()
    for y in range(size[1]):
        t = y / max(1, size[1] - 1)
        c = tuple(int(round(top[i] + (bottom[i] - top[i]) * t)) for i in range(3)) + (255,)
        for x in range(size[0]):
            px[x, y] = c
    return im


def wide_canvas(src_im, bg=(255, 255, 255)):
    wide = Image.new("RGBA", (1600, 900), bg + (255,))
    fit = src_im.copy()
    fit.thumbnail((760, 760), Image.LANCZOS)
    wide.alpha_composite(fit, ((wide.width - fit.width) // 2, (wide.height - fit.height) // 2))
    return wide


def photo_canvas(src_im):
    photo = gradient((900, 900), (206, 224, 242), (240, 246, 252))
    fit = src_im.copy()
    fit.thumbnail((620, 620), Image.LANCZOS)
    photo.alpha_composite(fit, ((photo.width - fit.width) // 2, (photo.height - fit.height) // 2))
    return photo


def load_sources():
    out = {}
    for mood in ("calm", "angry", "blush", "panic", "greet", "think"):
        path = os.path.join(SRC_DIR, mood + ".png")
        if not os.path.exists(path):
            raise SystemExit("缺少测试图：" + path)
        out[mood] = Image.open(path).convert("RGBA")
    return out


def measure(im):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
    alpha_px = 0
    white_ring = 0
    soft_ring = 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a > 0:
                alpha_px += 1
            if a >= 250 and min(r, g, b) >= 236:
                if px[x - 1, y][3] == 0 or px[x + 1, y][3] == 0 or px[x, y - 1][3] == 0 or px[x, y + 1][3] == 0:
                    white_ring += 1
            if 0 < a < 250 and min(r, g, b) >= 236:
                soft_ring += 1
    return {
        "size": (w, h),
        "corners": corners,
        "bbox": im.getbbox(),
        "fill": round(alpha_px / float(w * h), 3),
        "white_ring": white_ring,
        "soft_ring": soft_ring,
    }


def tile_of(im, label):
    tile = Image.new("RGBA", (256, 286), (255, 255, 255, 255))
    checker = Image.new("RGBA", (256, 256))
    cp = checker.load()
    for y in range(256):
        for x in range(256):
            cp[x, y] = (222, 226, 232, 255) if ((x // 16) + (y // 16)) % 2 else (248, 249, 251, 255)
    tile.alpha_composite(checker)
    tile.alpha_composite(im.convert("RGBA").resize((256, 256), Image.LANCZOS))
    ImageDraw.Draw(tile).text((6, 262), label, fill=(15, 23, 42))
    return tile


def save_contact(tiles, path):
    if not tiles:
        return
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * 266, rows * 296), (255, 255, 255, 255))
    for i, tile in enumerate(tiles):
        sheet.alpha_composite(tile, ((i % cols) * 266, (i // cols) * 296))
    sheet.save(path)


def print_table(rows):
    print("%-24s %-6s %-8s %-5s %-5s %-9s %-10s" % ("case", "matted", "removed", "ms", "fill", "white_ring", "corners"))
    for row in rows:
        print(
            "%-24s %-6s %-8s %-5s %-5s %-9s %-10s"
            % (
                row.get("case"),
                row.get("matted"),
                row.get("removed"),
                row.get("ms"),
                row.get("fill"),
                row.get("white_ring"),
                row.get("corners"),
            )
        )


def phase_one(src):
    for name in os.listdir(OUT_DIR) if os.path.isdir(OUT_DIR) else []:
        os.remove(os.path.join(OUT_DIR, name))
    os.makedirs(IN_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    cases = []

    def add(name, im, pad=0.05, matte=True, sizes=None):
        im = im.convert("RGBA")
        with open(os.path.join(IN_DIR, name + ".rgba"), "wb") as fh:
            fh.write(im.tobytes())
        cases.append(
            {"name": name, "w": im.width, "h": im.height, "pad": pad, "matte": matte, "sizes": sizes or SIZES_OTHER}
        )

    for mood, im in src.items():
        add("orig_" + mood, im, sizes=SIZES_MAIN if mood == "calm" else SIZES_OTHER)

    add("jpg_white_angry", via_jpeg(on_bg(src["angry"], (255, 255, 255))))
    add("jpg_white_calm", via_jpeg(on_bg(src["calm"], (255, 255, 255))), sizes=SIZES_MAIN)
    add("gray_bg_blush", on_bg(src["blush"], (242, 242, 242)))
    add("cream_bg_greet", on_bg(src["greet"], (250, 244, 232)))

    # 3b) 任意纯色背景：蓝 / 粉 / 深灰 / 绿幕；纯色四边一致，应该自动抠
    add("blue_bg_angry", on_bg(src["angry"], (47, 111, 237)))
    add("pink_bg_greet", on_bg(src["greet"], (247, 214, 224)))
    add("dark_bg_blush", on_bg(src["blush"], (34, 40, 49)))
    add("green_bg_think", on_bg(src["think"], (0, 177, 64)))

    # 3c) 白色主体 + 纯蓝底：只抠蓝，白甲不能被吃掉
    armor = Image.new("RGBA", (900, 900), (47, 111, 237, 255))
    draw = ImageDraw.Draw(armor)
    draw.rounded_rectangle((260, 200, 640, 760), radius=70, fill=(240, 240, 240, 255), outline=(20, 20, 20, 255), width=8)
    draw.rounded_rectangle((330, 330, 570, 500), radius=40, fill=(255, 255, 255, 255), outline=(20, 20, 20, 255), width=6)
    add("white_armor_blue", armor)

    small = src["calm"].resize((180, 180), Image.LANCZOS)
    add("small_white_panic", via_jpeg(on_bg(small, (255, 255, 255))))
    add("wide_white_think", via_jpeg(wide_canvas(src["think"])))
    add("photo_like_angry", photo_canvas(src["angry"]))
    add("pad_big_angry", src["angry"], pad=0.15)
    add("matte_off_angry", src["angry"], matte=False)
    add("matte_off_calm", on_bg(src["calm"], (255, 255, 255)), matte=False)

    manifest = {
        "inDir": IN_DIR,
        "outDir": OUT_DIR,
        "clientPath": os.path.join(ROOT, "lib", "client.js"),
        "cases": cases,
    }
    manifest_path = os.path.join(WORK, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)

    print("[1/3] 跑像素管线 …")
    subprocess.run(["node", os.path.join(HERE, "run-pipeline.mjs"), manifest_path], check=True, cwd=ROOT)

    with open(os.path.join(OUT_DIR, "report.json"), encoding="utf-8") as fh:
        report = json.load(fh)
    by_name = {r["name"]: r for r in report}

    print("[2/3] 编码 PNG + 算指标 …")
    rows = []
    tiles = []
    for case in cases:
        name = case["name"]
        rep = by_name[name]
        for size in case["sizes"]:
            raw_path = os.path.join(OUT_DIR, "%s-%d.rgba" % (name, size))
            if not os.path.exists(raw_path):
                continue
            with open(raw_path, "rb") as fh:
                raw = fh.read()
            im = Image.frombytes("RGBA", (size, size), raw)
            im.save(os.path.join(OUT_DIR, "%s-%d.png" % (name, size)))
            if size == 512:
                m = measure(im)
                m.update({"case": name, "matted": rep["matted"], "removed": round(rep["removed"], 3), "ms": rep["ms"]})
                rows.append(m)
                tiles.append(tile_of(im, name))

    save_contact(tiles, os.path.join(OUT_DIR, "contact-512.png"))
    print("[3/3] 结果")
    print_table(rows)
    with open(os.path.join(OUT_DIR, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    print("\n输出目录：", OUT_DIR)


def find_chrome():
    for p in (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ):
        if os.path.exists(p):
            return p
    return None


def phase_two(src):
    chrome = find_chrome()
    if not chrome:
        print("[browser] 没找到 Chrome，跳过浏览器端自测")
        return
    bdir = os.path.join(WORK, "browser")
    in_dir = os.path.join(bdir, "inputs")
    out_dir = os.path.join(bdir, "outputs")
    shutil.rmtree(in_dir, ignore_errors=True)
    shutil.rmtree(out_dir, ignore_errors=True)
    shutil.rmtree(os.path.join(bdir, "chrome-profile"), ignore_errors=True)
    os.makedirs(in_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)

    cases = []

    def add(name, im, ext, mime, matte=True, pad=0.05, sizes=None):
        path = os.path.join(in_dir, name + ext)
        if ext == ".jpg":
            im.convert("RGB").save(path, "JPEG", quality=82)
        else:
            im.save(path)
        cases.append(
            {
                "name": name,
                "file": name + ext,
                "mime": mime,
                "matte": matte,
                "pad": pad,
                "sizes": sizes or SIZES_OTHER,
            }
        )

    for mood, im in src.items():
        add("b_" + mood, im, ".png", "image/png", sizes=SIZES_MAIN if mood == "calm" else SIZES_OTHER)
    add("b_jpg_white_angry", on_bg(src["angry"], (255, 255, 255)), ".jpg", "image/jpeg")
    add("b_jpg_white_calm", on_bg(src["calm"], (255, 255, 255)), ".jpg", "image/jpeg", sizes=SIZES_MAIN)
    add("b_gray_bg_blush", on_bg(src["blush"], (242, 242, 242)), ".png", "image/png")
    add("b_blue_bg_angry", on_bg(src["angry"], (47, 111, 237)), ".jpg", "image/jpeg")
    add("b_pink_bg_greet", on_bg(src["greet"], (247, 214, 224)), ".png", "image/png")
    add("b_dark_bg_blush", on_bg(src["blush"], (34, 40, 49)), ".png", "image/png")
    add("b_wide_white_think", wide_canvas(src["think"]), ".jpg", "image/jpeg")
    add("b_photo_like_angry", photo_canvas(src["angry"]), ".png", "image/png")
    add("b_small_calm", on_bg(src["calm"].resize((180, 180), Image.LANCZOS), (255, 255, 255)), ".jpg", "image/jpeg")

    with open(os.path.join(in_dir, "cases.json"), "w", encoding="utf-8") as fh:
        json.dump(cases, fh)

    print("\n[browser] 起本地服务和头部无头 Chrome …")
    proc = subprocess.Popen(
        ["node", os.path.join(HERE, "browser-harness.mjs"), out_dir, in_dir],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=ROOT,
    )
    port = None
    start = time.time()
    while time.time() - start < 30:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.1)
            if proc.poll() is not None:
                break
            continue
        if line.startswith("PORT="):
            port = int(line.strip().split("=")[1])
            break
    if not port:
        try:
            proc.kill()
        except Exception:
            pass
        print("[browser] 服务没起来：", (proc.stderr.read() or "")[:800])
        return

    profile = os.path.join(bdir, "chrome-profile")
    cproc = subprocess.Popen(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=" + profile,
            "--window-size=900,700",
            "http://127.0.0.1:%d/" % port,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    report_path = os.path.join(out_dir, "report.json")
    deadline = time.time() + 180
    while time.time() < deadline and not os.path.exists(report_path):
        time.sleep(0.5)
    for p in (cproc, proc):
        try:
            p.kill()
        except Exception:
            pass
    if not os.path.exists(report_path):
        err_path = os.path.join(out_dir, "browser-error.txt")
        detail = open(err_path, encoding="utf-8").read() if os.path.exists(err_path) else "超时（180s）"
        print("[browser] 失败：", detail[:1200])
        return

    with open(report_path, encoding="utf-8") as fh:
        report = json.load(fh)
    rows = []
    tiles = []
    for r in report:
        path = os.path.join(out_dir, r["name"] + "-512.png")
        if not os.path.exists(path):
            continue
        im = Image.open(path).convert("RGBA")
        m = measure(im)
        m.update({"case": r["name"], "matted": r["matted"], "removed": round(r["removed"], 3), "ms": r["ms"]})
        rows.append(m)
        tiles.append(tile_of(im, r["name"]))
    save_contact(tiles, os.path.join(out_dir, "contact-512.png"))
    print_table(rows)
    with open(os.path.join(out_dir, "metrics.json"), "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    print("\n浏览器输出：", out_dir)


def phase_three():
    fix_dir = os.path.join(WORK, "host", "fixtures")
    shutil.rmtree(fix_dir, ignore_errors=True)
    os.makedirs(fix_dir, exist_ok=True)
    calm = Image.open(os.path.join(SRC_DIR, "calm.png")).convert("RGBA")
    for size in (512, 128, 64):
        src_path = os.path.join(WORK, "browser", "outputs", "b_calm-%d.png" % size)
        if os.path.exists(src_path):
            im = Image.open(src_path).convert("RGBA")
        else:
            im = calm.resize((size, size), Image.LANCZOS)
        im.save(os.path.join(fix_dir, "%d.png" % size))
    print("\n[host] 跑宿主路由校验 …")
    subprocess.run(["node", os.path.join(HERE, "host-test.mjs"), fix_dir], check=True, cwd=ROOT)


def main():
    src = load_sources()
    phase_one(src)
    if "--no-browser" not in FLAGS:
        phase_two(src)
    phase_three()
    print("\n完成。")
    print("像素对比图：", os.path.join(OUT_DIR, "contact-512.png"))
    print("浏览器对比图：", os.path.join(WORK, "browser", "outputs", "contact-512.png"))


if __name__ == "__main__":
    main()

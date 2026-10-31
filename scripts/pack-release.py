#!/usr/bin/env python3
"""把插件目录打成可直接分发的 zip。

为什么不用 PowerShell 的 Compress-Archive 或 shell 的 zip：
  - Compress-Archive 写出的 entry 名是反斜杠（lib\\index.js），Linux/macOS 解压会得到怪文件名；
  - 这里统一用正斜杠，且 package.json 必须在 zip 根层（套一层目录会让 dsh plugin add 找不到入口）。

进包内容以 package.json 的 files 为准（外加 package.json 自己与 tools/），
这样仓库里存在的图片、草稿、杂物不会误进发布包。

用法：
  python3 scripts/pack-release.py 0.9.1
  python scripts/pack-release.py 0.9.1 --out-dir dist
"""
import argparse
import json
import os
import zipfile

# 目录内要跳过的子目录
SKIP_DIRS = {".git", ".github", "node_modules", "assets-src", "__pycache__", "dist"}


def collect_items(src: str) -> list:
    pkg_path = os.path.join(src, "package.json")
    with open(pkg_path, encoding="utf-8") as fh:
        pkg = json.load(fh)
    items = [str(x) for x in (pkg.get("files") or [])]
    for extra in ("package.json", "tools"):
        if extra not in items:
            items.append(extra)
    return items


def build(src: str, version: str, out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"dsh-ds-whale-{version}.zip")
    if os.path.exists(out):
        os.remove(out)

    count = 0
    missing = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for item in collect_items(src):
            path = os.path.join(src, item)
            if os.path.isfile(path):
                z.write(path, item.replace("\\", "/"))
                count += 1
            elif os.path.isdir(path):
                for root, dirs, files in os.walk(path):
                    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                    for name in files:
                        full = os.path.join(root, name)
                        rel = os.path.relpath(full, src).replace("\\", "/")
                        z.write(full, rel)
                        count += 1
            else:
                missing.append(item)

    with zipfile.ZipFile(out) as z:
        names = z.namelist()
    assert "package.json" in names, "package.json 不在 zip 根层"
    assert not [n for n in names if "\\" in n], "zip 里出现了反斜杠路径"
    assert "lib/index.js" in names and "lib/client.js" in names, "核心文件缺失"
    assert "cordis.patch.yml" in names, "cordis.patch.yml 缺失"

    for item in missing:
        print(f"warn: 跳过不存在的 {item}")
    print(f"files={count} entries={len(names)} size={os.path.getsize(out)}")
    print(f"out={out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("version")
    ap.add_argument("--src", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--out-dir", default=".")
    args = ap.parse_args()
    build(os.path.abspath(args.src), args.version, args.out_dir)


if __name__ == "__main__":
    main()

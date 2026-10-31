#!/usr/bin/env python3
"""生成 GitHub Release 的说明文字。

从 CHANGELOG.md 里摘出本版本那一段，再附上「上一个 tag 到本 tag」的提交列表和安装说明。
纯 python，不依赖 awk/grep，Windows 与 ubuntu 上行为一致，可以本地先跑一遍看效果。

用法：
  python3 scripts/make-notes.py 0.9.1 --out notes.md
  python3 scripts/make-notes.py 0.9.1            # 直接打到 stdout
"""
import argparse
import io
import subprocess
import sys


def sh(*args: str) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, encoding="utf-8").stdout.strip()
    except Exception:
        return ""


def changelog_section(path: str, version: str) -> str:
    try:
        lines = io.open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return ""
    out, grabbing = [], False
    prefix = f"## {version}"
    for line in lines:
        if line.startswith(prefix):
            grabbing = True
            out.append(line)
            continue
        if grabbing and line.startswith("## "):
            break
        if grabbing:
            out.append(line)
    return "\n".join(out).strip()


def previous_tag(version: str) -> str:
    tags = [t for t in sh("git", "tag", "--sort=-v:refname").splitlines() if t and t != f"v{version}"]
    return tags[0] if tags else ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("version")
    ap.add_argument("--out", default="")
    ap.add_argument("--repo", default="Iceseas/dsh-ds-whale")
    args = ap.parse_args()

    v = args.version
    section = changelog_section("CHANGELOG.md", v) or f"## {v}\n\n（CHANGELOG 里没有这个版本，检查是否漏写）"

    prev = previous_tag(v)
    rng = f"{prev}..v{v}" if prev else f"v{v}"
    commits = sh("git", "log", rng, "--no-merges", "--pretty=- %s (%h)")
    commit_lines = "\n".join(commits.splitlines()[:40]) or "- （无提交记录）"

    body = f"""{section}

### 变更提交

{commit_lines}

### 安装

```bash
dsh plugin add github:{args.repo}#v{v}
```

免 git 安装：下载下方 `dsh-ds-whale-{v}.zip`，把整份内容合并进
`<DSH_HOME>/profiles/<profile>/node_modules/dsh-ds-whale/`，重启 DSH 即可。
"""

    if args.out:
        io.open(args.out, "w", encoding="utf-8", newline="\n").write(body)
        print(f"notes written: {args.out} ({len(body)} chars, range={rng})")
    else:
        sys.stdout.write(body)


if __name__ == "__main__":
    main()

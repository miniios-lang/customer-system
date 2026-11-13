#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包 static 站点到 dist/，供 Cloudflare Pages / GitHub Pages / 任意静态托管使用。

    python pack_deploy.py            # 生成 dist/
    python pack_deploy.py --zip      # 额外生成 dist.zip

做的事：
  1. 只拷贝「纯静态」白名单文件，server.py 这类后端脚本永远不会进 dist
  2. 写入 Cloudflare Pages 专用的 _headers / _redirects
  3. 打印产物清单与体积

注意：_headers 和 _redirects 只有 Cloudflare Pages 认；发布到 GitHub Pages 时
这两个文件会被忽略（无害），但里面的 /login、/orders 美化路由在 Pages 上不生效。
"""

import argparse
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")

# 允许进 dist 的文件/目录（白名单，防止误传后端脚本）
FILES = ["index.html", "app.html", "robots.txt", ".nojekyll"]
DIRS = ["assets"]
# 明确禁止：出现就报错
FORBIDDEN = ["server.py", "pack_deploy.py", ".git", "__pycache__", ".env"]

HEADERS = """# Cloudflare Pages 的 _headers：路径段 + 缩进的两个空格，注释用 #
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

/assets/*
  Cache-Control: public, max-age=3600, must-revalidate

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/app.html
  Cache-Control: public, max-age=0, must-revalidate
"""

REDIRECTS = """# 注意：Cloudflare Pages 会先把 /app.html 308 成 /app（自动去掉 .html）。
# 所以千万不要写 "/app  /app.html  301" —— 两条规则互相踢，
# 浏览器直接 ERR_TOO_MANY_REDIRECTS，表现就是「登录页能开、点登录之后那页打不开」。
# 下面只保留 Pages 自己不会处理的别名：
/login    /                 301
/orders   /app?view=orders  301
/stock    /app?view=stock   301
"""


def human(n):
    for unit in ("B", "KB", "MB"):
        if n < 1024:
            return "%.0f%s" % (n, unit)
        n /= 1024
    return "%.1fGB" % n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", action="store_true", help="额外生成 dist.zip")
    args = ap.parse_args()

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    copied, total = [], 0

    for name in FILES:
        src = os.path.join(ROOT, name)
        if not os.path.isfile(src):
            print("  跳过（不存在）：%s" % name)
            continue
        dst = os.path.join(DIST, name)
        shutil.copy2(src, dst)
        size = os.path.getsize(dst)
        copied.append((name, size))
        total += size

    for d in DIRS:
        src = os.path.join(ROOT, d)
        if not os.path.isdir(src):
            continue
        for cur, _, files in os.walk(src):
            for f in files:
                sp = os.path.join(cur, f)
                rel = os.path.relpath(sp, ROOT)
                dp = os.path.join(DIST, rel)
                os.makedirs(os.path.dirname(dp), exist_ok=True)
                shutil.copy2(sp, dp)
                size = os.path.getsize(dp)
                copied.append((rel.replace("\\", "/"), size))
                total += size

    for name, text in (("_headers", HEADERS), ("_redirects", REDIRECTS)):
        with open(os.path.join(DIST, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        copied.append((name, len(text.encode("utf-8"))))
        total += len(text.encode("utf-8"))

    # 产物体检：后端脚本或缓存目录一旦混进 dist 就报错
    leaked = []
    for cur, dirs, files in os.walk(DIST):
        for name in list(dirs) + files:
            if name in FORBIDDEN:
                leaked.append(os.path.relpath(os.path.join(cur, name), DIST))
    if leaked:
        sys.exit("拒绝收工：dist 里出现了不该发布的文件 %s" % leaked)

    print("dist/ 产物：")
    for name, size in sorted(copied):
        print("  %-28s %8s" % (name, human(size)))
    print("  %-28s %8s" % ("合计 %d 个文件" % len(copied), human(total)))

    if args.zip:
        zpath = os.path.join(ROOT, "dist.zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for cur, _, files in os.walk(DIST):
                for f in files:
                    fp = os.path.join(cur, f)
                    z.write(fp, os.path.relpath(fp, DIST))
        print("已生成 dist.zip（%s）" % human(os.path.getsize(zpath)))

    print("\n下一步：")
    print("  Cloudflare Pages：npx wrangler pages deploy dist")
    print("  GitHub Pages   ：把 dist/ 内容推到仓库 main 分支根目录")
    print("  本地预览       ：python server.py --open  （带接口，推荐）")


if __name__ == "__main__":
    main()

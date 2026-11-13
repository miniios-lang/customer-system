#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
customer-system 本地服务
=========================
给 UiBot RPA 认证练习用的「生产管理系统」本地副本，提供三类能力：

1. 静态托管      index.html / app.html / assets/*
2. 接口仿真      /api/ping、/api/virtual_account_valid_code、/api/login、/api/saveas
3. 真实感细节    验证码与会话绑定（Cookie）、登录失败分支、Win32 原生「另存为」对话框

启动：
    python server.py                 # 默认 http://127.0.0.1:8000
    python server.py --port 8080
    python server.py --open          # 启动后自动开浏览器

前端契约（与 index.html / assets/app.js 对齐，改动接口请同步改这两处）：
    GET  /api/ping                          -> {"server":"cs","time":...}
                                              前端据此把验证码从 canvas 切成服务端出图
    GET  /api/virtual_account_valid_code    -> image/png（会话内绑定正确答案）
    POST /api/login   {username,password,code}
                                            -> {"ok":true}
                                             | {"ok":false,"reason":"account"}
                                             | {"ok":false,"reason":"code"}
    POST /api/saveas  {name,ext,data:B64}   -> {"ok":true,"path":"D:\\..."}
                                             | {"ok":false,"canceled":true}
                                             | 501（非 Windows，前端自动降级）

依赖：Python 3.9+，Pillow（画验证码）。没装 Pillow 时手写 PNG 编码兜底，功能不受影响。
"""

import argparse
import base64
import io
import json
import os
import random
import secrets
import struct
import sys
import threading
import time
import webbrowser
import zlib
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, quote

ROOT = os.path.dirname(os.path.abspath(__file__))

# ----------------------------------------------------------------------------
# 账号：与登录页提示保持一致（页面底部那行「用户名：UiBot 密码：Pass_123」）
# ----------------------------------------------------------------------------
ACCOUNTS = {
    "UiBot": "Pass_123",
}
COOKIE_NAME = "cs_sid"
SESSION_TTL = 1800          # 会话 30 分钟

# ----------------------------------------------------------------------------
# 验证码视觉规格：对齐 sim-academy 真站
#   80×40 纯白底 / 4 字符 / 大小写字母+数字 / 逐字纯色 / Arial Bold 约 24px
#   基线 ±2px、倾角 ±5° / 背景只有稀疏浅灰噪点 / 无干扰线、无扭曲
# ----------------------------------------------------------------------------
CAP_W, CAP_H = 80, 40
CAP_POOL = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
CAP_COLORS = [
    (17, 17, 17), (0, 0, 139), (139, 0, 0), (0, 100, 0),
    (0, 107, 107), (75, 0, 130), (26, 63, 143),
]
NOISE_COLORS = [(200, 200, 200), (176, 176, 192), (216, 192, 200),
                (207, 202, 187), (192, 204, 216)]
CAP_SLOTS = [11, 30, 49, 68]

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

_sessions = {}
_sessions_lock = threading.Lock()


# ----------------------------------------------------------------------------
# 验证码绘制
# ----------------------------------------------------------------------------
def _load_font(size):
    try:
        from PIL import ImageFont
    except ImportError:
        return None
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


def render_captcha(code):
    """返回 PNG 字节流。优先 Pillow；缺失时用纯 zlib 兜底画块状字形。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return _fallback_png(code)

    img = Image.new("RGB", (CAP_W, CAP_H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # 背景噪点：稀疏单像素
    for _ in range(110):
        draw.point((random.randrange(CAP_W), random.randrange(CAP_H)),
                   fill=random.choice(NOISE_COLORS))

    # 逐字独立贴图 + 轻微旋转，模拟真站的字间重叠与倾斜
    for i, ch in enumerate(code):
        size = random.randint(23, 26)
        font = _load_font(size)
        layer = Image.new("RGBA", (CAP_W, CAP_H), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        color = random.choice(CAP_COLORS) + (255,)
        x = CAP_SLOTS[i] + random.uniform(-1.5, 1.5)
        y = 30 + random.uniform(-2, 2)
        try:
            d.text((x, y), ch, font=font, fill=color, anchor="ms")
        except TypeError:                    # 老版本 Pillow 不支持 anchor
            d.text((x - 6, y - size * 0.8), ch, font=font, fill=color)
        angle = random.uniform(-5, 5)
        layer = layer.rotate(angle, resample=Image.BICUBIC, center=(x, y - 8))
        img.paste(layer, (0, 0), layer)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# --- 极简 PNG 编码兜底（未装 Pillow 时用，字形是 5×7 点阵，够 OCR 认） ---
_GLYPHS = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "11110", "10001", "10001", "10001", "11110"),
    "C": ("01111", "10000", "10000", "10000", "10000", "10000", "01111"),
    "D": ("11110", "10001", "10001", "10001", "10001", "10001", "11110"),
    "E": ("11111", "10000", "11110", "10000", "10000", "10000", "11111"),
    "F": ("11111", "10000", "11110", "10000", "10000", "10000", "10000"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01111"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "J": ("00111", "00010", "00010", "00010", "00010", "10010", "01100"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "M": ("10001", "11011", "10101", "10101", "10001", "10001", "10001"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "P": ("11110", "10001", "10001", "11110", "10000", "10000", "10000"),
    "Q": ("01110", "10001", "10001", "10001", "10101", "10010", "01101"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "V": ("10001", "10001", "10001", "10001", "10001", "01010", "00100"),
    "W": ("10001", "10001", "10001", "10101", "10101", "11011", "10001"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
    "2": ("01110", "10001", "00001", "00110", "01000", "10000", "11111"),
    "3": ("11110", "00001", "00001", "01110", "00001", "00001", "11110"),
    "4": ("00010", "00110", "01010", "10010", "11111", "00010", "00010"),
    "5": ("11111", "10000", "11110", "00001", "00001", "10001", "01110"),
    "6": ("01110", "10000", "11110", "10001", "10001", "10001", "01110"),
    "7": ("11111", "00001", "00010", "00100", "01000", "01000", "01000"),
    "8": ("01110", "10001", "10001", "01110", "10001", "10001", "01110"),
    "9": ("01110", "10001", "10001", "01111", "00001", "00001", "01110"),
    "a": ("00000", "00000", "01110", "00001", "01111", "10001", "01111"),
    "b": ("10000", "10000", "11110", "10001", "10001", "10001", "11110"),
    "c": ("00000", "00000", "01111", "10000", "10000", "10000", "01111"),
    "d": ("00001", "00001", "01111", "10001", "10001", "10001", "01111"),
    "e": ("00000", "00000", "01110", "10001", "11111", "10000", "01110"),
    "f": ("00110", "01000", "11100", "01000", "01000", "01000", "01000"),
    "g": ("00000", "01111", "10001", "10001", "01111", "00001", "01110"),
    "h": ("10000", "10000", "11110", "10001", "10001", "10001", "10001"),
    "i": ("00100", "00000", "01100", "00100", "00100", "00100", "01110"),
    "j": ("00010", "00000", "00110", "00010", "00010", "10010", "01100"),
    "k": ("10000", "10000", "10010", "10100", "11000", "10100", "10010"),
    "m": ("00000", "00000", "11010", "10101", "10101", "10101", "10101"),
    "n": ("00000", "00000", "11110", "10001", "10001", "10001", "10001"),
    "p": ("00000", "00000", "11110", "10001", "11110", "10000", "10000"),
    "q": ("00000", "00000", "01111", "10001", "01111", "00001", "00001"),
    "r": ("00000", "00000", "10110", "11001", "10000", "10000", "10000"),
    "s": ("00000", "00000", "01111", "10000", "01110", "00001", "11110"),
    "t": ("01000", "01000", "11100", "01000", "01000", "01001", "00110"),
    "u": ("00000", "00000", "10001", "10001", "10001", "10011", "01101"),
    "v": ("00000", "00000", "10001", "10001", "10001", "01010", "00100"),
    "w": ("00000", "00000", "10001", "10001", "10101", "10101", "01010"),
    "x": ("00000", "00000", "10001", "01010", "00100", "01010", "10001"),
    "y": ("00000", "10001", "10001", "01111", "00001", "00001", "01110"),
    "z": ("00000", "00000", "11111", "00010", "00100", "01000", "11111"),
}


def _fallback_png(code):
    """未装 Pillow 时的纯 zlib PNG：白底 + 稀疏噪点 + 5×7 点阵字。"""
    px = [[(255, 255, 255)] * CAP_W for _ in range(CAP_H)]
    for _ in range(110):
        x, y = random.randrange(CAP_W), random.randrange(CAP_H)
        px[y][x] = random.choice(NOISE_COLORS)
    for i, ch in enumerate(code):
        glyph = _GLYPHS.get(ch)
        if not glyph:
            continue
        color = random.choice(CAP_COLORS)
        ox, oy = CAP_SLOTS[i] - 3, 12
        for r, row in enumerate(glyph):
            for c, bit in enumerate(row):
                if bit == "1":
                    for dy in range(4):        # 每个点阵像素放大成 4×4
                        for dx in range(4):
                            X, Y = ox + c * 4 + dx, oy + r * 4 + dy
                            if 0 <= X < CAP_W and 0 <= Y < CAP_H:
                                px[Y][X] = color

    raw = b"".join(b"\x00" + b"".join(struct.pack("3B", *p) for p in row) for row in px)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", CAP_W, CAP_H, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


# ----------------------------------------------------------------------------
# 会话
# ----------------------------------------------------------------------------
def session_new(code):
    sid = secrets.token_urlsafe(18)
    with _sessions_lock:
        _sessions[sid] = {"code": code, "at": time.time(), "tries": 0}
        _gc_sessions()
    return sid


def session_get(sid):
    if not sid:
        return None
    with _sessions_lock:
        s = _sessions.get(sid)
        if s and time.time() - s["at"] < SESSION_TTL:
            return s
        _sessions.pop(sid, None)
        return None


def session_drop_code(sid):
    """验证码一次性：任何一次校验尝试后立即作废，下次必须换新图。"""
    with _sessions_lock:
        s = _sessions.get(sid)
        if s:
            s["code"] = None


def _gc_sessions():
    now = time.time()
    for k in [k for k, v in _sessions.items() if now - v["at"] > SESSION_TTL]:
        _sessions.pop(k, None)


# ----------------------------------------------------------------------------
# Win32 保存对话框
# ----------------------------------------------------------------------------
def save_with_dialog(default_name, ext, data):
    """弹 comdlg32!GetSaveFileNameW，用户选完路径由本进程落盘。"""
    if sys.platform != "win32":
        return None                                    # 前端收到 501 会降级
    try:
        import ctypes
        from ctypes import wintypes
    except Exception:
        return None

    class OPENFILENAMEW(ctypes.Structure):
        _fields_ = [
            ("lStructSize", wintypes.DWORD), ("hwndOwner", wintypes.HWND),
            ("hInstance", wintypes.HINSTANCE), ("lpstrFilter", wintypes.LPCWSTR),
            ("lpstrCustomFilter", wintypes.LPWSTR), ("nMaxCustFilter", wintypes.DWORD),
            ("nFilterIndex", wintypes.DWORD), ("lpstrFile", wintypes.LPWSTR),
            ("nMaxFile", wintypes.DWORD), ("lpstrFileTitle", wintypes.LPWSTR),
            ("nMaxFileTitle", wintypes.DWORD), ("lpstrInitialDir", wintypes.LPCWSTR),
            ("lpstrTitle", wintypes.LPCWSTR), ("Flags", wintypes.DWORD),
            ("nFileOffset", wintypes.WORD), ("nFileExtension", wintypes.WORD),
            ("lpstrDefExt", wintypes.LPCWSTR), ("lCustData", wintypes.LPARAM),
            ("lpfnHook", wintypes.LPVOID), ("lpTemplateName", wintypes.LPCWSTR),
            ("pvReserved", wintypes.LPVOID), ("dwReserved", wintypes.DWORD),
            ("FlagsEx", wintypes.DWORD),
        ]

    ext = (ext or "txt").lstrip(".")
    filters = {
        "xlsx": "Excel 工作簿\0*.xlsx\0所有文件\0*.*\0\0",
        "csv": "CSV 文本\0*.csv\0所有文件\0*.*\0\0",
    }.get(ext, "所有文件\0*.*\0\0")

    buf = ctypes.create_unicode_buffer(1024)
    buf.value = default_name
    ofn = OPENFILENAMEW()
    ofn.lStructSize = ctypes.sizeof(OPENFILENAMEW)
    ofn.lpstrFilter = filters
    ofn.lpstrFile = ctypes.cast(buf, wintypes.LPWSTR)
    ofn.nMaxFile = 1024
    ofn.lpstrTitle = "另存为"
    ofn.lpstrDefExt = ext
    ofn.Flags = 0x00000002 | 0x00000008 | 0x00080000   # OVERWRITEPROMPT|NOCHANGEDIR|FORCEFILESYSTEM

    try:
        ok = ctypes.windll.comdlg32.GetSaveFileNameW(ctypes.byref(ofn))
    except Exception:
        return None
    if not ok:
        return {"ok": False, "canceled": True}
    path = buf.value
    if not path:
        return {"ok": False, "canceled": True}
    if not os.path.splitext(path)[1]:
        path += "." + ext
    with open(path, "wb") as f:
        f.write(data)
    return {"ok": True, "path": path}


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}

ROUTES = {
    "/": "index.html",
    "/login": "index.html",
    "/index.html": "index.html",
    "/app": "app.html",
    "/app.html": "app.html",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "customer-system/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- 工具 ----------
    def _sid(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            c = SimpleCookie(raw)
            return c[COOKIE_NAME].value if COOKIE_NAME in c else None
        except Exception:
            return None

    def _json(self, obj, status=200, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, data, ctype, status=200, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return {}
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _cookie_header(self, sid):
        return (f"{COOKIE_NAME}={sid}; Path=/; Max-Age={SESSION_TTL}; "
                f"HttpOnly; SameSite=Lax")

    def log_message(self, fmt, *args):
        path = (args[0] if args else "")
        if "/assets/" in str(path):
            return                                   # 静态资源不刷屏
        sys.stderr.write("  %s  %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- GET ----------
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/ping":
            return self._json({"server": "cs", "time": int(time.time() * 1000),
                               "captcha": "png", "accounts": list(ACCOUNTS)})

        if path == "/api/virtual_account_valid_code":
            code = "".join(random.choice(CAP_POOL) for _ in range(4))
            sid = session_new(code)
            png = render_captcha(code)
            return self._bytes(png, "image/png", extra_headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
                "Set-Cookie": self._cookie_header(sid),
            })

        if path in ("/orders", "/stock"):
            view = path.lstrip("/")
            self.send_response(302)
            self.send_header("Location", f"/app?view={view}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        if path == "/api/saveas":
            return self._json({"ok": False, "error": "use POST"}, status=405)

        return self._static(path)

    def _static(self, path):
        rel = ROUTES.get(path)
        if rel is None:
            rel = path.lstrip("/")
        full = os.path.realpath(os.path.join(ROOT, rel))
        if not full.startswith(os.path.realpath(ROOT)) or not os.path.isfile(full):
            body = "<!doctype html><meta charset=utf-8><h1>404</h1><p>没有这个文件：" + \
                   quote(path) + "</p>"
            return self._bytes(body.encode("utf-8"), "text/html; charset=utf-8", 404)

        with open(full, "rb") as f:
            data = f.read()
        ctype = MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        cache = ("no-cache, must-revalidate" if ctype.startswith("text/html")
                 else "public, max-age=3600, must-revalidate")
        self._bytes(data, ctype, extra_headers={"Cache-Control": cache})

    # ---------- POST ----------
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            return self._login()
        if path == "/api/saveas":
            return self._saveas()
        self._json({"ok": False, "error": "unknown endpoint"}, status=404)

    def _login(self):
        data = self._body()
        user = (data.get("username") or "").strip()
        pwd = data.get("password") or ""
        code = (data.get("code") or "").strip()

        sid = self._sid()
        sess = session_get(sid)

        if not user or not pwd or not code:
            return self._json({"ok": False, "reason": "empty"})

        # 1) 账号先判：密码错时不消耗验证码（真站也是这个顺序）
        if ACCOUNTS.get(user) != pwd:
            return self._json({"ok": False, "reason": "account"})

        # 2) 再判验证码，比对后立即作废
        if not sess or not sess.get("code"):
            return self._json({"ok": False, "reason": "code",
                               "detail": "会话已过期，请点验证码换一张"})
        expect = sess["code"]
        session_drop_code(sid)
        if code.upper() != expect.upper():
            return self._json({"ok": False, "reason": "code"})

        return self._json({"ok": True, "user": user})

    def _saveas(self):
        data = self._body()
        name = os.path.basename((data.get("name") or "export.xlsx").strip())
        ext = (data.get("ext") or os.path.splitext(name)[1].lstrip(".") or "bin").lower()
        try:
            raw = base64.b64decode(data.get("data") or "")
        except Exception:
            return self._json({"ok": False, "error": "bad base64"}, status=400)

        result = save_with_dialog(name, ext, raw)
        if result is None:
            return self._json({"ok": False, "error": "dialog unavailable"}, status=501)
        return self._json(result)


def main():
    ap = argparse.ArgumentParser(description="customer-system 本地服务")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--open", action="store_true", help="启动后自动打开浏览器")
    args = ap.parse_args()

    try:
        import PIL  # noqa: F401
        cap_mode = "Pillow PNG（与真站同款）"
    except ImportError:
        cap_mode = "内置点阵 PNG（建议 pip install pillow 换成真站字体）"

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = f"http://{args.host}:{args.port}/"
    banner = "\n".join([
        "=" * 58,
        "  customer-system 本地服务已启动",
        f"  地址      {url}",
        f"  登录账号  {list(ACCOUNTS.items())[0][0]} / {list(ACCOUNTS.values())[0]}",
        f"  验证码    {cap_mode}",
        f"  账号数    {len(ACCOUNTS)}",
        "  Ctrl+C 停止",
        "=" * 58,
    ])
    print(banner, flush=True)
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()

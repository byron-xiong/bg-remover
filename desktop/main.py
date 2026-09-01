"""抠图工具桌面版：pywebview 原生窗口 + 内置 HTTP 服务。

打包：PyInstaller --onefile --windowed --add-data 静态文件
同事机器要求：Windows 10/11（含 WebView2 运行时）+ 联网（首次需从 CDN 下载模型）。
"""

import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import webview


def static_dir() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller 打包后
        return Path(sys._MEIPASS) / "static"
    return Path(__file__).resolve().parent.parent  # 开发时指向 bg-remover 目录


def main():
    directory = static_dir()
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)  # 端口 0 = 自动分配空闲端口
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()

    webview.create_window(
        "纯前端 AI 抠图",
        f"http://127.0.0.1:{port}/",
        width=1200,
        height=860,
        min_size=(860, 600),
    )
    webview.start()
    server.shutdown()


if __name__ == "__main__":
    main()
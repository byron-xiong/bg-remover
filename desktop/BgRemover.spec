# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

PROJECT_ROOT = Path(SPEC).resolve().parent.parent
STATIC_FILES = [
    'index.html',
    'style.css',
    'app.js',
    'sw.js',
    'manifest.webmanifest',
]
datas = [(str(PROJECT_ROOT / name), 'static') for name in STATIC_FILES]
datas += [
    (str(PROJECT_ROOT / 'icons' / 'icon-192.png'), 'static/icons'),
    (str(PROJECT_ROOT / 'icons' / 'icon-512.png'), 'static/icons'),
    (str(PROJECT_ROOT / 'src' / 'utils.js'), 'static/src'),
    (str(PROJECT_ROOT / 'src' / 'queue.js'), 'static/src'),
]
binaries = []
hiddenimports = []
tmp_ret = collect_all('webview')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('pythonnet')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
tmp_ret = collect_all('clr_loader')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    [str(PROJECT_ROOT / 'desktop' / 'main.py')],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='BgRemover',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

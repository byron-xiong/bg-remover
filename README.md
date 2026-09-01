# ✂️ 纯前端 AI 抠图工具

**浏览器本地完成图片背景移除** — 零后端、零 GPU 服务器、图片不出本机。

> 一张图上传到云端、隐私告警——这类烦恼再也不需要。基于 `@imgly/background-removal` 的 ONNX 模型在浏览器内推理，所有处理都在你的设备上完成。

---

## ✨ 核心特性

| 功能 | 说明 |
|------|------|
| 🚀 **零上传** | 图片全程不出本机，模型走 CDN 首次加载后由 SW + 浏览器缓存 |
| ⚡ **自动加速** | 检测到 WebGPU 自动启用显卡；否则 WebGL/WASM CPU |
| 📦 **批量处理** | 多文件入队 → 顺序处理 → 一键 zip 打包下载，单张失败不阻塞 |
| 🎨 **手动修整** | 软边笔刷「恢复/擦除」+ Ctrl+Z 撤销 + Ctrl+Shift+Z 重做（**命令模式**，与图像大小无关，4K 图也轻量） |
| 🌈 **背景替换** | 纯色 / 渐变 / 自定义图片三种底色，导出时合成 |
| 🖼️ **预设尺寸** | 一寸/二寸证件照、Instagram 方形、电商主图等一键导出 |
| ✂️ **贴纸效果** | 主体描边 + 投影，实时预览、随导出生效 |
| 🤖 **多模型** | 内置 ISNet FP16/Quint8 + 自定义 ONNX URL（支持 RMBG-2.0、BiRefNet 等）+ 缓存管理（预下载 / 状态查看 / 一键清理） |
| 📲 **PWA** | 可安装为本地应用，断网仍可用 |
| ⌨️ **键盘快捷键** | `Ctrl+Z` 撤销 / `Ctrl+Shift+Z` 重做 / `1`/`2` 切换工具 / `+`/`-` 笔刷 |

---

## 🚀 快速开始

```bash
cd bg-remover
python -m http.server 8765
```

或双击 `start.bat`，浏览器访问 <http://localhost:8765>

也可以：

```bash
npm start       # 同上
npm test        # 跑单元测试（Node ≥ 18，无需 npm install）
npm run lint    # 语法 lint
```

---

## 📖 使用说明

### 单图模式

1. **导入图片**：点击 / 拖拽 / `Ctrl+V` 粘贴
2. **选模型**：默认 `isnet_fp16`（高精度 80MB）；快速场景切到 `isnet_quint8`（40MB）
3. **开始抠图**：自动四阶段进度（下载模型 → 加载 → 推理 → 后处理）
4. **手动修整**：结果区涂抹调整边缘，恢复 = 还原原像素，擦除 = 变透明
5. **选背景**：勾选「换底色」→ 选「纯色 / 渐变 / 图片」
6. **选预设尺寸**：一键切到证件照、头像、电商主图等
7. **下载**：`PNG`（保透明）/ `JPEG`（无透明）/ `WebP`（小体积）

### 批量模式

切换到「批量」标签：
- 一次拖入多张 / 多选 / 多次粘贴（自动过滤非图片）
- 点「开始批量」→ 顺序处理（避免大图并发 OOM）
- 单张失败不阻塞其他，错误展示在队列行
- 点「↻ 重试」单张重跑；点「✕」删除单条
- 处理完成点「下载 zip」打包所有成功项，同名文件自动追加 `(1)` `(2)`

### 快捷键

| 按键 | 作用 |
|------|------|
| `Ctrl+Z` | 撤销 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 |
| `1` / `B` | 切换恢复工具 |
| `2` / `E` | 切换擦除工具 |
| `+` / `=` | 笔刷大小 +5 |
| `-` / `_` | 笔刷大小 -5 |

> 表单元素内的按键不会触发快捷键，输入框正常使用不受影响。

---

## 🤖 模型选择

### 内置模型

| 取值 | 来源 | 体积 | 说明 |
|------|------|------|------|
| `isnet_fp16` | 库默认 | ~80MB | 高精度，默认推荐 |
| `isnet_quint8` | 库默认 | ~40MB | 快速，老机器友好 |
| `isnet` | 库默认 | ~80MB | 原始精度 |
| `medium` | 库默认 | — | 库内置 medium 模型 |
| `small` | 库默认 | — | 库内置 small 模型 |

### 自定义模型（（高级））

库本身只内置 ISNet 系列。如果你想用更强的模型（RMBG-2.0、BiRefNet、u2net 等），可以：

1. 选择「**自定义 ONNX URL**」
2. 填入模型 URL（必须以 `.onnx` 结尾）
3. 点「检测」按钮预检 URL 可达性 + CORS 友好（避免扣图时才报错）
4. 处理时库会从该 URL 下载并缓存

**常用推荐模型**：

| 模型 | 用途 | 备注 |
|------|------|------|
| RMBG-2.0 | 头发/复杂边缘 | Hugging Face `briaai/RMBG-2.0` |
| BiRefNet | 通用高精度 | `ZhengPeng7/BiRefNet` |
| u2netp | 轻量替代 | `danielgatis/rembg-u2netp.onnx` 等 |

> ⚠️ 自定义模型**完全在浏览器内加载运行**，仍遵循零上传原则。但模型 URL 必须能从浏览器访问（CORS 允许）。

---

## 🧪 测试与质量

```bash
npm test         # 50 个单元测试
npm run lint     # 5 个 JS 文件语法检查
```

CI：`.github/workflows/ci.yml` 在 push / PR 时自动跑 lint + test，Node 矩阵 18 / 20 / 22。

---

## 📂 项目结构

```
bg-remover/
├── index.html             # 页面结构
├── style.css              # 样式
├── app.js                 # 主逻辑（UI / 抠图 / 笔刷 / 批量 / 快捷键）
├── sw.js                  # Service Worker（壳子 + 模型二级缓存）
├── manifest.webmanifest   # PWA 元数据
├── icons/                 # PWA 图标
├── src/
│   ├── utils.js           # 纯工具（格式化、paintBackground、文件名等）
│   └── queue.js           # 批量队列状态机
├── tests/
│   ├── utils.test.js      # 单元测试
│   └── queue.test.js      # 单元测试
├── scripts/lint.mjs       # 语法 lint
├── .github/workflows/ci.yml
├── package.json           # npm test / lint 脚本
├── start.bat              # Windows 一键启动
└── README.md
```

---

## 🖥️ 桌面版（`desktop/`）

PyInstaller 打包的 Windows 桌面应用：

```bash
cd desktop
pyinstaller BgRemover.spec
# 产物在 desktop/dist/BgRemover.exe
```

---

## ⚠️ 已知问题

- 首次使用会从 CDN 下载 40–80MB 模型；之后由 Service Worker + 浏览器双重缓存，秒开。模型下载后可手动预下载/清理：参数区下方「模型缓存管理」展开面板
- **下载路径不可选择**（浏览器安全模型限制）：模型存于「浏览器磁盘缓存 + Service Worker Cache Storage」，存储路径由浏览器决定。如需清理，可在面板点「清理模型缓存」或 DevTools → Application → Storage
- 批量模式默认**顺序**处理（避免大图并发 OOM）；如需并发可手动改造为 worker 池
- 自定义模型 URL 必须能被浏览器访问（CORS 友好）。UI 提供「检测」按钮预检可达性，提示是否返回 CORS 头

---

## 📜 License

MIT

---

**🤝 隐私优先 · 零上传 · 本地推理 · 开源**
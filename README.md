# 🛡️ Scrubshot · 截图脱敏工具

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/strugglesky/scrubshot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/strugglesky/scrubshot/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg)](https://vite.dev/)
[![RapidOCR](https://img.shields.io/badge/OCR-RapidOCR%20·%20PP--OCRv5-2E7D32.svg)](#-技术架构)
[![Local First](https://img.shields.io/badge/100%25-本地处理-success.svg)](#为什么不直接打码)

粘贴一张截图，自动找出手机号、身份证、银行卡、Token、地址，一键涂掉。
**图片全程留在浏览器里 —— 不上传、不联网、可断网使用。**

[🛡️ 在线试用](http://121.40.98.30:8080) · [🧪 评测数据](./test-data) · [🐛 问题反馈](https://github.com/strugglesky/scrubshot/issues)

![demo](docs/demo.gif)

> **30 张真实截图、157 个敏感项：召回 98.7%，误报 0。**

---

## ✨ 主要特性

- 🔍 **自动识别**：手机号、身份证、银行卡、邮箱、地址、座机、JWT、API Key、私钥、带 token 的 URL、内网 IP、长单号
- 🚦 **三色分级**：🔴 高风险自动打码 · 🟡 中风险标记核对 · ⚪ 低风险仅提示
- 🧾 **可审查清单**：每条命中都能看到标签和原文片段，逐条开关；还能展开看**OCR 读到的全部文字**
- 🔗 **跨行拼接**：聊天框把身份证折成两行时，合并成一个框，不会只遮一半
- 🔄 **镜像识别**：镜像截图置信度低时自动翻转重试
- 📦 **批量处理**：一次拖入多张，左侧队列切换，单张导出或整包 zip
- ↩️ **每图独立撤销栈**：切图后 Ctrl+Z 不会撤到上一张
- 🔒 **完全本地**：没有后端，没有上传接口，模型加载后可用 DevTools 验证 0 请求

### 为什么不直接打码

大多数工具默认给你高斯模糊。但模糊和像素化过的文字，在特定条件下**可以被还原**。

所以 Scrubshot 默认用**不透明色块**覆盖；你选择模糊时会收到一次警告。

---

## 🚀 快速开始

### 直接试用

**[http://121.40.98.30:8080](http://121.40.98.30:8080)**

截图后直接 `Ctrl+V` 粘贴，检查右侧清单，`Enter` 导出。

> 演示实例是裸 IP + HTTP，无需注册。首次识别需加载约 58MB 资源（OCR 引擎 + 模型 + ONNX 运行时），
> 之后完全离线可用——可以断网再识别一张验证。

### 本地运行

```bash
git clone https://github.com/strugglesky/scrubshot.git
cd scrubshot
pnpm install
pnpm dev
```

打开 **http://localhost:5173**。

---

## 📊 实测表现

| 引擎 | 召回 | 精确 | 说明 |
|------|------|------|------|
| Tesseract 5（最好配置） | 120/150 = 80% | 97.6% | 版面分析会整块跳过表单 |
| **RapidOCR · PP-OCRv5 mobile** | **155/157 = 98.7%** | 96.9% | 默认引擎 |

> 精确率那一列的 5 处「多报」，逐条核对后**全是标注遗漏**（2 个邮箱 + 3 个地址），
> 补进标注后真实误报为 0。漏掉的 2 条都是 10 位纯数字，和 Unix 时间戳形态相同，刻意不识别。

📖 数据集与复现步骤见 [test-data/](./test-data)

---

## 🏗️ 技术架构

| 层 | 技术 |
|------|------|
| **OCR 引擎** | RapidOCR（PP-OCRv5 mobile，ONNX Runtime）+ Tesseract 兜底 |
| **检测** | 14 条正则规则 + 校验位算法（Luhn / 身份证）+ 上下文推断 |
| **前端** | React 18 + TypeScript 5.6 + Vite 6 |
| **渲染** | Canvas 2D（打码与导出） |
| **批处理** | Web Worker 队列 + fflate（zip） |
| **部署** | 纯静态，无后端、无数据库 |

---

## 📖 工作流程

1. 深色主题截图先反色，否则浅字深底读不出来
2. 检测网络框出每一行文字，识别网络输出文本与置信度
3. 每行跑规则引擎；有词级坐标就框到词，没有就按字符宽度比例切
4. 校验位不通过**不丢弃**，降级为「疑似」——校验位判断可信度，不决定要不要让你看见
5. 长号码被折行时，上下两行拼接后重新匹配
6. 置信度偏低时自动水平翻转，判定镜像后把坐标换算回原图

---

## 🧪 评测

应用内置评测模式，用真实截图算召回率与多报数。标注只写**敏感字符串**，不用画框：

```json
{
  "shop.png": ["18967676767", "342622200206082951"],
  "admin.png": ["admin@example.com", "sk-abc123def456ghi789"],
  "code.png": []
}
```

- 值写**内容本身**，不是类型（写 `18967676767`，不要写 `手机号`）
- 没有敏感信息的图也要写 `[]`，别省略
- 空格、短横、全角半角不用管，匹配前会归一化

**复现仓库里的数字：**

1. 打开评测页 → 「添加截图」→ 选 `test-data/images/` 全部 30 张
2. 「导入 labels.json」→ 选 `test-data/labels.json`
3. 引擎选 RapidOCR → 「开始评测」

数据集覆盖 10 类场景 × 3 张：聊天记录、快递单、登记表、身份证、表格、便签、订单、医疗单、小票。
全部为虚构数据，不含真实个人信息。

---

## 📦 部署

`dist/` 是纯静态产物，扔给任何静态服务器即可。

| 方式 | 复杂度 | 说明 |
|------|--------|------|
| 本地预览 | ⭐ | `pnpm build && pnpm preview` |
| Vercel / Netlify | ⭐ | 连仓库，构建 `pnpm build`，输出 `dist` |
| 云服务器 + nginx | ⭐⭐ | 推荐，无单文件大小限制 |

> ⚠️ Cloudflare Pages 单文件上限 25MB，而 ONNX Runtime 的 wasm 有 28MB，会被拒。

当前演示实例：Ubuntu + nginx，监听 8080，`gzip_static` 预压缩，站点根目录 `/opt/scrubshot/dist`。
裸 IP 走 8080 是为了绕开国内 80 端口的备案拦截。

### 首次加载的资源

| 资源 | 大小 | 时机 |
|------|------|------|
| 应用壳 | ~630KB | 打开页面 |
| OCR 引擎（含 OpenCV） | ~10MB | 第一次识别，懒加载 |
| PP-OCR 模型 | ~20MB | 第一次识别 |
| ONNX 运行时 wasm | ~28MB | 第一次识别 |

合计约 58MB（gzip 后约 21MB），之后全部走浏览器缓存。

---

## 📋 项目结构

```
scrubshot/
├── src/
│   ├── components/        # 画布编辑器、侧栏、队列、评测界面
│   ├── core/              # 几何计算、打码渲染、导出、图片加载
│   ├── detectors/         # 规则引擎、校验位、分级、跨行拼接
│   ├── ocr/               # 引擎抽象 + RapidOCR / Tesseract 实现
│   └── hooks/             # 撤销/重做
├── test-data/             # 评测数据集（30 张 + 标注）
├── docs/demo.gif          # 演示动图
├── public/models/         # 构建时复制，不入库
├── .github/workflows/     # CI
└── vite.config.ts         # 模型复制与构建配置
```

---

## 🛠️ 本地开发

```bash
pnpm dev        # 开发服务器
pnpm test       # 单元测试
pnpm typecheck  # 类型检查
pnpm build      # 生产构建
```

**环境要求**

- **Node 20+**
- **pnpm 11+**：依赖的安装脚本默认被拦截，放行配置在 `pnpm-workspace.yaml` 的 `allowBuilds`

> 遇到装不上、起不来，先看 [CONTRIBUTING.md](./CONTRIBUTING.md) —— 那里记着三个会卡住人的坑。

---

## ⚠️ 已知限制

- **10–11 位纯数字不识别**：病历号与 Unix 时间戳形态相同，无法区分
- **只处理水平镜像**；180° 倒置、90° 侧转不支持
- **跨行拼接**只覆盖 11 / 16–19 位（手机、银行卡、身份证）
- 识别粒度是「一行一个框」，同一行里的多个敏感词会合成一个框
- 首次使用需下载约 48MB 资源

---

## 🤝 贡献指南

1. Fork 项目
2. 创建分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

**最有价值的贡献是「失败的样本」** —— 一张让当前版本漏检或误报的截图，比任何 issue 描述都有用。

---

## 📄 许可证

本项目采用 **MIT** 许可证，详见 [LICENSE](LICENSE)。

### 第三方资源

| 组件 | 用途 | 许可 |
|------|------|------|
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-OCRv5 模型 | 文字检测与识别 | Apache-2.0 |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | 浏览器内推理 | MIT |
| [@sanduc/ocr-browser](https://github.com/sandu-c/ocr) | PaddleOCR 浏览器封装 | MIT |
| [tesseract.js](https://github.com/naptha/tesseract.js) | 兜底识别引擎 | Apache-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | zip 打包 | MIT |

---

## 🆘 获取帮助

- 📖 **贡献与本地开发**：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 🧪 **评测数据集**：[test-data/](./test-data)
- 🐛 **问题报告**：[GitHub Issues](https://github.com/strugglesky/scrubshot/issues)

---

**Scrubshot** —— 发截图之前，先过一遍。 🛡️

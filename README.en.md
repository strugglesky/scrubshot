# 🛡️ Scrubshot · Screenshot Redaction

**English** | [简体中文](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/strugglesky/scrubshot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/strugglesky/scrubshot/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178C6.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF.svg)](https://vite.dev/)
[![Local Processing](https://img.shields.io/badge/Processing-In%20Your%20Browser-success.svg)](#-privacy)

**Paste a screenshot. Find sensitive information. Review the results. Export a redacted image.**

Scrubshot detects phone numbers, ID numbers, bank card numbers, tokens, email addresses, and other sensitive text. OCR and image processing run locally in your browser; screenshots are not uploaded to an OCR service.

[🛡️ Live Demo](http://121.40.98.30:8080) · [🧪 Test Data](./test-data) · [🐛 Report an Issue](https://github.com/strugglesky/scrubshot/issues)

![Scrubshot: paste, review, and redact a screenshot](./docs/demo.gif)

> **98.7% text-detection recall on 157 labeled sensitive values across 30 synthetic screenshots.** See the benchmark notes for scope and limitations.

---

## ✨ Features

- 🔍 **Sensitive-text detection**: Chinese mobile numbers, ID numbers, bank card numbers, landlines, email addresses, JWTs, common API key formats, private-key headers, tokenized URLs, IP addresses, and long numeric identifiers.
- 🚦 **Risk levels**: high-risk findings are enabled automatically; other findings are flagged for review according to risk and OCR confidence.
- 🧾 **Reviewable results**: inspect matched text, toggle individual regions, and expand the complete OCR text list to spot omissions.
- ✏️ **Manual editing**: draw, move, resize, and delete redaction regions.
- 🔗 **Cross-line stitching**: join supported identifiers split across adjacent text lines.
- 📦 **Batch processing**: switch between images in the queue and export individual files or a ZIP archive.
- ↩️ **Per-image undo and redo**: editing one image does not change another image's history.
- 🖼️ **PNG, JPEG, and WebP export**: re-encode the image rather than copying its original EXIF metadata or embedded thumbnail.

### Why solid blocks instead of blur?

Blurred or pixelated text can sometimes be reconstructed. Scrubshot defaults to opaque blocks and warns when you select blur or pixelation.

**Always review the output before sharing. Detection and automatic box placement can miss information or cover the wrong region.**

---

## 🚀 Quick Start

### Try the demo

Open **[http://121.40.98.30:8080](http://121.40.98.30:8080)**.

1. Paste a screenshot with `Ctrl+V`, drag in an image, or use the file picker.
2. Review the findings and disable regions you want to keep visible.
3. Add or adjust regions manually where needed.
4. Preview the result and use the export button.

> The demo currently uses HTTP. OCR runs locally, but HTTP does not protect application downloads against network tampering. For sensitive work, use a trusted local installation or an HTTPS deployment.
>
> Initial OCR resources are approximately 58 MB uncompressed. Transfer size depends on server compression and browser caching.

### Run locally

```bash
git clone https://github.com/strugglesky/scrubshot.git
cd scrubshot
pnpm install
pnpm dev
```

Open **http://localhost:5173**.

---

## 📊 Benchmark Results

| Engine | Labeled values | Recall | Precision against supplied labels |
|---|---:|---:|---:|
| Tesseract 5, tested configuration | 150 | 120/150 = 80% | 97.6% |
| **RapidOCR · PP-OCRv5 mobile** | 157 | **155/157 = 98.7%** | 96.9% |

The RapidOCR run produced five additional findings. Manual review identified two email addresses and three physical addresses omitted from the supplied labels. These were real sensitive values rather than confirmed false positives.

The two missed labels were 10-digit medical identifiers, a format not covered by the current general numeric recognizers.

**Benchmark scope:** these results describe a small synthetic dataset, not a guarantee for arbitrary screenshots. The engines were evaluated against different label revisions. The current evaluator uses normalized text matching and can accept partial matches; it does **not** measure whether redaction boxes fully cover the sensitive pixels.

📖 Dataset: [test-data/](./test-data).

---

## 🏗️ Architecture

| Layer | Technology |
|---|---|
| **OCR** | PP-OCRv5 mobile detection and recognition through `@sanduc/ocr-browser`; Tesseract fallback |
| **Inference** | ONNX Runtime Web |
| **Sensitive-data recognition** | Regex patterns, Luhn and Chinese ID checksum validation, context hints |
| **Frontend** | React 18, TypeScript 5.6, Vite 6 |
| **Rendering** | Canvas 2D |
| **Batch export** | Sequential processing queue and fflate ZIP packaging |
| **Deployment** | Static files; no application backend or database |

### Recognition pipeline

1. Detect text regions and recognize their contents.
2. Normalize supported OCR variations, including full-width characters.
3. Run sensitive-data rules and context checks on recognized text.
4. Map character ranges to word boxes when available. Otherwise, estimate sub-line regions using character-width weights.
5. Stitch supported numbers split across nearby lines.
6. Review the regions and render them onto a newly encoded image.

Tesseract also provides experimental page-segmentation modes, mirrored-image retries, and tiled recognition. Mirror handling and geometry depend on the selected engine; validate these cases before relying on them.

---

## 🔒 Privacy

- Screenshots are processed in your browser.
- There is no image-upload endpoint or account requirement.
- Default OCR models and runtime are served with the static application.
- Initial loading still requires network requests. Browser caching is not guaranteed persistent storage or a complete offline-installation mechanism.
- The Tesseract fallback may load its own runtime and language resources externally.

Inspect requests in your browser's Network panel. Self-host when you need control over application downloads.

---

## 🧪 Evaluation

The evaluation page compares detected text with a JSON label file. Label sensitive **values**, rather than category names or coordinates:

```json
{
  "shop.png": ["18967676767", "342622200206082951"],
  "admin.png": ["admin@example.com", "sk-abc123def456ghi789"],
  "code.png": []
}
```

- Use the actual value, such as `18967676767`, rather than `phone number`.
- Include an empty array for screenshots with no expected findings.
- Include every sensitive value you want evaluated. Missing labels can make correct detections appear as extras.
- Inspect missed values and additional findings individually; aggregate percentages do not explain every error.

### Reproduce a run

1. Open the evaluation view using **评测**.
2. Choose **添加截图** and select the 30 images under [test-data/images/](./test-data/images/).
3. Choose **导入 labels.json** and select [test-data/labels.json](./test-data/labels.json).
4. Select RapidOCR and choose **开始评测**.
5. Export the CSV and detailed JSON reports.

The dataset contains fictional examples across ten scenarios: chats, shipping labels, registration forms, ID cards, spreadsheets, memos, orders, medical records, notes, and transaction slips. Preserve original images when comparing runs: resizing or recompressing them changes the benchmark.

---

## 📦 Deployment

```bash
pnpm build
pnpm preview
```

Publish the generated `dist/` directory with a static web server.

| Method | Setup | Notes |
|---|---|---|
| Local preview | ⭐ | Validate the production build with `pnpm preview` |
| Static hosting | ⭐ | Build: `pnpm build`; output: `dist` |
| VPS + nginx | ⭐⭐ | Supports large assets; configure MIME types, caching, and compression |

The current demo runs on Ubuntu and nginx on port `8080` with precompressed assets served through `gzip_static`.

### Deployment checklist

- Keep generated model files in the deployed output. They are excluded from Git but copied during the build.
- Serve `.wasm` files as `application/wasm`.
- Check hosting per-file limits: the runtime WASM file is approximately 28 MB.
- Use HTTPS for public deployments.
- Recognition uses a single WASM thread; COOP/COEP headers are not required for that configuration.

### Approximate resource sizes

| Resource | Uncompressed size | When needed |
|---|---:|---|
| Application bundle | ~630 KB | Page load |
| OCR engine, including OpenCV | ~10 MB | First OCR initialization |
| PP-OCR models | ~20 MB | First OCR initialization |
| ONNX Runtime WASM | ~28 MB | First OCR initialization |

These figures come from a tested build and may change with dependencies. Actual transfer sizes depend on compression and caching.

---

## 📋 Project Structure

```text
scrubshot/
├── src/
│   ├── components/        # Editor, sidebar, queue, evaluation UI
│   ├── core/              # Geometry, rendering, export, image loading
│   ├── detectors/         # Rules, validators, localization, stitching
│   ├── benchmark/         # Text-matching evaluation
│   ├── ocr/               # OCR engines and coordinate mapping
│   └── hooks/             # History helpers
├── test-data/             # Synthetic screenshots and labels
├── docs/demo.gif          # Demo animation
├── public/models/         # Generated assets; not committed
├── .github/workflows/     # CI
└── vite.config.ts         # Model copying and build configuration
```

---

## 🛠️ Development

```bash
pnpm dev        # Start the development server
pnpm test       # Run unit tests
pnpm typecheck  # Check TypeScript types
pnpm build      # Build for production
```

The current setup uses pnpm 11. Check your selected Node.js and pnpm versions' compatibility requirements when configuring the environment.

Dependency build-script approvals are recorded in `pnpm-workspace.yaml`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for installation notes.

---

## ⚠️ Known Limitations

- Rules are primarily tuned for Chinese screenshot scenarios, not universal multilingual PII detection.
- Some short numeric identifiers, including two 10-digit medical IDs in the benchmark, are not detected.
- Cross-line stitching is heuristic and currently targets lengths of 11 and 16–19 characters.
- Rotation and mirror support vary by engine; do not assume every orientation is covered.
- Sub-line boxes without word coordinates are estimates. Unusual fonts, perspective, or OCR errors may affect coverage.
- Text-based benchmark matches do not certify complete pixel coverage.
- First recognition requires large runtime and model downloads.

---

## 🤝 Contributing

1. Fork the repository.
2. Create a branch: `git checkout -b feature/amazing-feature`.
3. Make changes and run the checks.
4. Push the branch and open a Pull Request.

Reproducible failure cases are particularly useful. Use fictional or properly sanitized data when submitting screenshots; avoid real credentials or personal information.

📖 Read [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 📄 License and Acknowledgments

Scrubshot is distributed under the **MIT License**. See [LICENSE](./LICENSE).

| Component | Purpose | License |
|---|---|---|
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) models | Text detection and recognition | Apache-2.0 |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) | In-browser inference | MIT |
| [@sanduc/ocr-browser](https://github.com/sandu-c/ocr) | Browser OCR integration | MIT |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | Fallback OCR engine | Apache-2.0 |
| [fflate](https://github.com/101arrowz/fflate) | ZIP export | MIT |

---

## 🆘 Help

- 📖 [Development and contribution guide](./CONTRIBUTING.md)
- 🧪 [Benchmark dataset](./test-data)
- 🐛 [GitHub Issues](https://github.com/strugglesky/scrubshot/issues)

---

**Scrubshot — review your screenshot before you share it.** 🛡️

# Contributing

## 本地运行

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test
pnpm typecheck
```

需要 Node 20+、pnpm 11+。

## 这个项目有三个"看起来应该没事、实际会卡住"的地方

如果你 clone 下来跑不起来，大概率是下面之一：

**1. pnpm 11 默认拦截依赖的安装脚本**

报错长这样：`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: ...`

放行配置在 `pnpm-workspace.yaml` 的 `allowBuilds`，已经提交。**不要**去关全局防护，
也不要写进 `package.json` 的 `pnpm` 字段——pnpm 11 已经不读那里了。

**2. `@sanduc/ocr-models` 必须写在 `dependencies` 里**

它是 `@sanduc/ocr-browser` 的传递依赖，但 pnpm 不会把传递依赖链接到根 `node_modules/`，
而 OCR 的 Vite 插件是按根路径找模型的。所以它必须同时出现在 `dependencies` 里。

**3. 模型文件是构建时复制的，不在仓库里**

`vite.config.ts` 在启动时把 `.onnx` 和字典复制到 `public/models/`（已在 .gitignore）。
首次 `pnpm dev` / `pnpm build` 会自动完成，不需要手动操作。

## 改检测规则

规则在 `src/detectors/rules.ts`，纯函数、零 DOM 依赖。

加规则时注意三件事：

1. **顺序有意义**：靠前的规则优先，18 位身份证要排在"16-19 位数字"前面
2. **校验位只影响可信度，不影响是否上报**：不过校验时用 `soft` 降级，不要直接丢弃
3. **一定要补测试**：`pnpm test` 里现有的反例（校验位不对的身份证、Luhn 不过的卡号）
   就是防止"为了精确率牺牲召回"的护栏

## 提交前

- `pnpm typecheck` 和 `pnpm test` 必须过
- 改了识别逻辑的话，用评测页跑一遍 `test-data/`，把召回/多报数字写进 PR 描述
- 不要把 `public/models/` 或 `node_modules` 提交上来

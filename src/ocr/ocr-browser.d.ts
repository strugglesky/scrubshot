/**
 * @sanduc/ocr-browser 的导出结构不在它的 package.json 里声明 types，
 * 这里给一个最小声明，避免 typecheck 因为找不到类型而失败。
 * 真正的结构在 src/ocr/rapid.ts 里做运行时探测。
 */
declare module '@sanduc/ocr-browser'
declare module '@sanduc/ocr-browser/vite'

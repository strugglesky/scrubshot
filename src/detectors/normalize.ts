/**
 * OCR 文本归一化。
 *
 * 实测下来，中文模型经常把数字吐成全角，或者把校验位 X 认成 × / ✕。
 * 这些都不影响人眼阅读，但会让正则直接失效。
 */
export function normalizeOcrText(input: string): string {
  return input
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\uFF21-\uFF3A\uFF41-\uFF5A]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/[×✕✖]/g, 'x')
    .replace(/\u00A0/g, ' ')
}

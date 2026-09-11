export const HISTORY_LIMIT = 50

/**
 * 撤销栈现在是每张图各带一份（BatchItem.past / future），
 * 因为批量模式下"全局撤销"会让用户分不清自己在撤销哪张图的操作。
 */
export function pushPast<T>(past: T[], current: T): T[] {
  return [...past, current].slice(-HISTORY_LIMIT)
}

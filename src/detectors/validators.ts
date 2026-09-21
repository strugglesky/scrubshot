/** Luhn 校验（银行卡号）。 */
export function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

/** 中国大陆 18 位身份证号校验位验证。 */
export function cnIdCard(value: string): boolean {
  const id = value.toUpperCase()
  if (!/^\d{17}[\dX]$/.test(id)) return false
  let sum = 0
  for (let i = 0; i < 17; i += 1) {
    sum += (id.charCodeAt(i) - 48) * ID_WEIGHTS[i]
  }
  return ID_CHECK[sum % 11] === id[17]
}

export function isValidIpv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    return Number(part) <= 255
  })
}

export function isPrivateIp(value: string): boolean {
  const parts = value.split('.').map(Number)
  const [a, b] = parts
  if (parts.length !== 4) return false
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  return false
}

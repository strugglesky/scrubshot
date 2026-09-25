import { describe, expect, it } from 'vitest'
import { scanText } from './rules'
import { cnIdCard, isPrivateIp, luhn } from './validators'

const ids = (text: string) => scanText(text).map((m) => m.ruleId)

describe('validators', () => {
  it('validates card numbers with Luhn', () => {
    expect(luhn('4111111111111111')).toBe(true)
    expect(luhn('1234567890123456')).toBe(false)
  })

  it('validates CN ID checksum', () => {
    expect(cnIdCard('11010519491231002X')).toBe(true)
    expect(cnIdCard('110105194912310021')).toBe(false)
  })

  it('classifies private IPs', () => {
    expect(isPrivateIp('192.168.1.7')).toBe(true)
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })
})

describe('scanText', () => {
  it('detects a CN mobile number', () => {
    expect(ids('联系我：13812345678')).toContain('cn-mobile')
  })

  it('detects a mobile number split by spaces', () => {
    expect(ids('电话 138 1234 5678')).toContain('cn-mobile')
  })

  it('detects a mobile number split between every digit', () => {
    expect(ids('1 8 9 6 7 6 7 6 7 6 7')).toContain('cn-mobile')
  })

  it('detects an email', () => {
    expect(ids('hi@example.com')).toContain('email')
  })

  it('detects a valid ID card', () => {
    expect(ids('身份证 11010519491231002X')).toContain('cn-id')
  })

  it('detects an ID card split by spaces', () => {
    expect(ids('身份证号：110105 19491231 002X')).toContain('cn-id')
  })

  it('detects an ID card split into irregular groups', () => {
    expect(ids('1101 0519 4912 3100 2X')).toContain('cn-id')
  })

  it('detects full-width digits', () => {
    expect(ids('１１０１０５１９４９１２３１００２Ｘ')).toContain('cn-id')
  })

  it('still reports an ID card whose checksum fails', () => {
    const matches = scanText('编号 110105194912310021')
    const match = matches.find((m) => m.ruleId === 'cn-id')
    expect(match).toBeDefined()
    expect(match?.label).toContain('疑似')
  })

  it('detects a card number that passes Luhn', () => {
    expect(ids('卡号 4111111111111111')).toContain('bank-card')
  })

  it('still reports a card number whose Luhn fails, with a 疑似 label', () => {
    const match = scanText('卡号 6013 3577 4371 9980').find((m) => m.ruleId === 'bank-card')
    expect(match).toBeDefined()
    expect(match?.label).toContain('疑似')
  })

  it('detects a landline number', () => {
    expect(ids('家庭电话 076-42104304')).toContain('landline')
  })

  it('detects a long waybill-style number', () => {
    expect(ids('运单号 826882478582350')).toContain('long-number')
  })

  it('detects a card number written in groups of four', () => {
    expect(ids('卡号 4111 1111 1111 1111')).toContain('bank-card')
  })

  it('detects a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(ids(`Authorization: Bearer ${jwt}`)).toContain('jwt')
  })

  it('detects an API key', () => {
    expect(ids('sk-abcdefghijklmnopqrstuvwx')).toContain('api-key')
  })

  it('detects a token inside a URL', () => {
    const matches = scanText('https://x.com/cb?token=abc123&x=1')
    expect(
      matches.some((m) => m.ruleId === 'url-token' && m.value.includes('token=abc123')),
    ).toBe(true)
  })

  it('grades private and public IPs differently', () => {
    expect(scanText('192.168.1.7')[0]).toMatchObject({ ruleId: 'ipv4', risk: 'medium' })
    expect(scanText('8.8.8.8')[0]).toMatchObject({ ruleId: 'ipv4', risk: 'low' })
  })

  it('returns nothing for plain prose', () => {
    expect(scanText('今天的会议在 3 点')).toEqual([])
  })
})

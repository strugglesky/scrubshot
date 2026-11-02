import { describe, expect, it } from 'vitest'
import { scanText } from './rules'
import { cnIdCard, isPrivateIp, luhn } from './validators'

// 测试数据全部为占位值：手机号用文档通用示例号，证件号用「全 0 + 校验位」，
// 卡号用 Visa 官方测试卡号。都不对应任何真实个人信息。

const ids = (text: string) => scanText(text).map((m) => m.ruleId)

describe('validators', () => {
  it('validates card numbers with Luhn', () => {
    expect(luhn('4111111111111111')).toBe(true)
    expect(luhn('1234567890123456')).toBe(false)
  })

  it('validates CN ID checksum', () => {
    // 占位证件号：17 个 0 + 校验位，格式合法但不对应任何真实身份
    expect(cnIdCard('000000000000000001')).toBe(true)
    expect(cnIdCard('000000000000000002')).toBe(false)
  })

  it('classifies private IPs', () => {
    expect(isPrivateIp('192.168.1.7')).toBe(true)
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })
})

describe('scanText', () => {
  it('detects a CN mobile number', () => {
    expect(ids('联系我：13800138000')).toContain('cn-mobile')
  })

  it('detects a mobile number split by spaces', () => {
    expect(ids('电话 138 0013 8000')).toContain('cn-mobile')
  })

  it('detects a mobile number split between every digit', () => {
    expect(ids('1 3 8 0 0 1 3 8 0 0 0')).toContain('cn-mobile')
  })

  it('detects an email', () => {
    expect(ids('hi@example.com')).toContain('email')
  })

  it('detects a valid ID card', () => {
    expect(ids('身份证 000000000000000001')).toContain('cn-id')
  })

  it('detects an ID card split by spaces', () => {
    expect(ids('身份证号：000000 00000000 0001')).toContain('cn-id')
  })

  it('detects an ID card split into irregular groups', () => {
    expect(ids('0000 0000 0000 0000 01')).toContain('cn-id')
  })

  it('detects full-width digits', () => {
    const fullWidth = '０'.repeat(17) + '１'
    expect(ids(`身份证 ${fullWidth}`)).toContain('cn-id')
  })

  it('still reports an ID card whose checksum fails', () => {
    const matches = scanText('编号 000000000000000002')
    const match = matches.find((m) => m.ruleId === 'cn-id')
    expect(match).toBeDefined()
    expect(match?.label).toContain('疑似')
  })

  it('detects a card number that passes Luhn', () => {
    expect(ids('卡号 4111111111111111')).toContain('bank-card')
  })

  it('still reports a card number whose Luhn fails, with a 疑似 label', () => {
    const match = scanText('卡号 6013 0000 0000 0000').find((m) => m.ruleId === 'bank-card')
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

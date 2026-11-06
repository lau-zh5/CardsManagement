export const CARD_COLORS = [
  '#1B2A4A', '#0071E3', '#0F6E56', '#7D4BC4',
  '#C2410C', '#3F4A5A', '#1D6E8C', '#B03060'
];

const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

export const CARD_TYPES = [
  {
    key: 'credit', name: '信用卡', glyph: '信', color: '#1B2A4A',
    fields: [
      f('bank', '发卡行', 'text', { required: true, placeholder: '如 招商银行' }),
      f('network', '卡组织', 'select', { options: ['Visa', 'Mastercard', '银联', 'JCB', 'American Express', '其他'] }),
      f('number', '完整卡号', 'text', { sensitive: true, placeholder: '仅加密保存在本机', inputmode: 'numeric' }),
      f('expiry', '有效期', 'month', { remind: 90, placeholder: '卡片到期月份' }),
      f('statementDay', '账单日', 'day', { placeholder: '每月几号，如 5' }),
      f('dueDay', '还款日', 'day', { remind: 3, placeholder: '每月几号，如 23' }),
      f('limit', '信用额度', 'money', { placeholder: '如 50000' }),
      f('annualFee', '年费规则', 'text', { placeholder: '如 刷 6 次免年费' }),
      f('phone', '银行客服电话', 'text'),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'debit', name: '储蓄卡', glyph: '蓄', color: '#0F6E56',
    fields: [
      f('bank', '发卡行', 'text', { required: true }),
      f('network', '卡组织', 'select', { options: ['银联', 'Visa', 'Mastercard', '其他'] }),
      f('number', '完整卡号', 'text', { sensitive: true, placeholder: '仅加密保存在本机', inputmode: 'numeric' }),
      f('expiry', '有效期', 'month', { remind: 90 }),
      f('branch', '开户行', 'text'),
      f('phone', '银行客服电话', 'text'),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'transit', name: '交通卡', glyph: '通', color: '#0071E3',
    fields: [
      f('city', '城市', 'text', { required: true, placeholder: '如 深圳' }),
      f('cardNo', '卡号', 'text'),
      f('balance', '当前余额', 'money'),
      f('deposit', '押金', 'money'),
      f('union', '交通联合', 'select', { options: ['支持', '不支持', '不清楚'] }),
      f('recharge', '充值渠道', 'text', { placeholder: '如 深圳通 App / 微信' }),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'membership', name: '会员卡', glyph: '会', color: '#7D4BC4',
    fields: [
      f('merchant', '商户', 'text', { required: true }),
      f('memberNo', '会员号 / 条码值', 'text'),
      f('level', '会员等级', 'text'),
      f('points', '当前积分', 'number'),
      f('expiry', '等级 / 会员到期', 'date', { remind: 30 }),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'gift', name: '礼品卡', glyph: '礼', color: '#C2410C',
    fields: [
      f('merchant', '商户', 'text', { required: true }),
      f('faceValue', '面值', 'money'),
      f('balance', '剩余余额', 'money'),
      f('code', '卡密', 'text', { sensitive: true, placeholder: '仅加密保存在本机' }),
      f('expiry', '有效期至', 'date', { remind: 14 }),
      f('rule', '使用限制', 'textarea'),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'idcard', name: '证件', glyph: '证', color: '#3F4A5A',
    fields: [
      f('idType', '证件类型', 'select', { options: ['身份证', '护照', '港澳通行证', '驾驶证', '其他'] }),
      f('idNumber', '证件号码', 'text', { sensitive: true, placeholder: '仅加密保存在本机' }),
      f('authority', '签发机关', 'text'),
      f('expiry', '到期 / 换证日', 'date', { remind: 90 }),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'access', name: '门禁卡', glyph: '门', color: '#1D6E8C',
    fields: [
      f('place', '小区 / 楼栋', 'text', { required: true }),
      f('scope', '权限范围', 'text'),
      f('uid', 'NFC UID', 'text'),
      f('deposit', '押金', 'money'),
      f('note', '备注', 'textarea')
    ]
  },
  {
    key: 'subscription', name: '订阅卡', glyph: '订', color: '#B03060',
    fields: [
      f('service', '服务名称', 'text', { required: true }),
      f('account', '绑定账号', 'text'),
      f('renewDate', '下次续费日', 'date', { remind: 7 }),
      f('amount', '金额', 'money'),
      f('cycle', '周期', 'select', { options: ['月付', '季付', '年付', '一次性'] }),
      f('note', '备注', 'textarea')
    ]
  }
];

export function getType(key) {
  return CARD_TYPES.find((t) => t.key === key) || CARD_TYPES[0];
}

export function sensitiveFields(typeKey) {
  return getType(typeKey).fields.filter((f) => f.sensitive);
}

export function remindFields(typeKey) {
  return getType(typeKey).fields.filter((f) => f.remind);
}

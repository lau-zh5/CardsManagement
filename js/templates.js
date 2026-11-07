export const CARD_COLORS = [
  '#1B2A4A', '#0071E3', '#0F6E56', '#7D4BC4',
  '#C2410C', '#3F4A5A', '#1D6E8C', '#B03060'
];

const ico = (body) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// 卡类型图标：纯矢量线性图标，不依赖字体与图片资源
export const TYPE_ICONS = {
  credit: ico('<rect x="2.5" y="6.5" width="27" height="19" rx="3.5"/><path d="M2.5 12.5h27"/><rect x="6" y="17" width="7" height="5" rx="1.2"/><path d="M18 20.5h8"/>'),
  debit:  ico('<rect x="2.5" y="7" width="27" height="18" rx="3.5"/><path d="M2.5 13h27"/><path d="M16 16.5v6M12.5 19h7M12.5 22h7"/>'),
  transit: ico('<rect x="6" y="3.5" width="20" height="23" rx="5"/><path d="M6 15.5h20"/><path d="M11 8.5h10"/><circle cx="11" cy="20.5" r="1.4"/><circle cx="21" cy="20.5" r="1.4"/><path d="M11 26.5l-2 2M21 26.5l2 2"/>'),
  membership: ico('<path d="M16 3.5l3.9 8 8.8 1.3-6.4 6.2 1.5 8.8L16 23.6l-7.8 4.2 1.5-8.8-6.4-6.2 8.8-1.3z"/>'),
  gift: ico('<rect x="4.5" y="13" width="23" height="15" rx="2"/><path d="M2.5 8.5h27v4.5h-27z"/><path d="M16 8.5v19.5"/><path d="M16 8.5c-5.5 0-8.5-1-8.5-3.4 0-2 2.4-3.1 4.3-1.6 1.5 1.2 4.2 5 4.2 5z"/><path d="M16 8.5c5.5 0 8.5-1 8.5-3.4 0-2-2.4-3.1-4.3-1.6-1.5 1.2-4.2 5-4.2 5z"/>'),
  idcard: ico('<rect x="2.5" y="5.5" width="27" height="21" rx="3.5"/><circle cx="11" cy="14" r="3.2"/><path d="M5.5 22.5c.8-2.9 2.8-4.4 5.5-4.4s4.7 1.5 5.5 4.4"/><path d="M20 12h6M20 16.5h6M20 21h4"/>'),
  access: ico('<rect x="2.5" y="7" width="15.5" height="18" rx="3"/><path d="M6.5 13h7.5M6.5 17.5h5.5"/><path d="M22 11.5a7 7 0 0 1 0 9M26 8.5a11.5 11.5 0 0 1 0 15"/>'),
  subscription: ico('<path d="M26.5 11.5A11 11 0 1 0 27 19"/><path d="M26.5 5.5v6.2h-6.2"/><path d="M16 10.5v6l4.2 2.2"/>')
};

const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

export const CARD_TYPES = [
  {
    key: 'credit', name: '信用卡', glyph: '信', color: '#1B2A4A',
    fields: [
      f('bank', '发卡行', 'bank', { required: true }),
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
      f('bank', '发卡行', 'bank', { required: true }),
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

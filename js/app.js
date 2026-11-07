import {
  $, $$, esc, uid, todayISO, daysUntil, nextOccurrence, fmtDate,
  toast, download, ICONS, isStandalone, isIOS, isSecureContext
} from './utils.js';
import { CARD_TYPES, CARD_COLORS, TYPE_ICONS, getType, remindFields } from './templates.js';
import { BANK_FACES, BANK_OPTIONS, canonicalBankName, TYPE_DEFAULT_FACES, faceInfoFor } from './cardfaces.js';
import { encryptText, decryptText, encryptBackup, decryptBackup } from './crypto.js';
import * as DB from './db.js';
import * as auth from './auth.js';

// ---- 版本信息 ----
// 正式版从 1.0 起，后续按 1.1 / 1.2 … 递增；每次发版只改 APP_VERSION，
// 版本号后面的说明文字固定保留，显示在创建 / 解锁主密码界面的最下方。
// 注意：发版时还要同步修改 sw.js 的 VERSION（离线缓存名），否则旧缓存不会更新。
const APP_VERSION = '1.0';
const VERSION_LINE = `version${APP_VERSION} 由iCloud提供服务（2026©）`;

const root = document.getElementById('app');
const overlay = document.getElementById('overlay-root');
const OTHER_BANK = '__other__'; // 「发卡行」下拉里「其他 · 手动输入」的哨兵值
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const state = {
  tab: 'wallet',
  detailId: null,
  filter: 'all',
  query: '',
  cards: [],
  revealed: new Map(),
  formColor: null,
  pendingBackup: null
};

let wasUnlocked = false;
let loadFailed = false;

function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
}

function renderLoading() {
  // 模块已成功启动，撤销 index.html 里的白屏守卫（避免加载慢时误报）
  window.__cardsappBooted = true;
  document.getElementById('boot-guard')?.remove();
  root.innerHTML = '<div class="gate"><img class="logo" src="./icons/icon-180.png" alt="卡包"><h1>卡包</h1><p>正在打开本地保险库…</p></div>';
}

async function boot() {
  // 本机 localhost 调试时跳过 Service Worker，避免 cache-first 旧缓存挡住刚改的代码；
  // 部署到 HTTPS 域名后离线缓存照常启用，行为不变。
  const localDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (localDev) {
    // 早期版本曾在 localhost 注册过 SW。只跳过注册是不够的：已注册的 SW 仍会控制页面，
    // 可能把旧模块和刚改过的新模块混在一起导致 ES module 导入失败、整页白屏。
    // 因此本机调试时静默注销残留 SW 并清掉本应用的离线缓存（不影响 IndexedDB 里的卡片数据）。
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((rs) => Promise.all(rs.map((r) => r.unregister()))).catch(() => {});
    }
    if (window.caches) {
      // 注销不会中止正在跑的 install/activate，SW 可能又把资源写回缓存，所以稍后再清一次。
      const clearLocalCaches = () => caches.keys()
        .then((ks) => Promise.all(ks.filter((k) => k.startsWith('cardsapp-')).map((k) => caches.delete(k))))
        .catch(() => {});
      clearLocalCaches();
      setTimeout(clearLocalCaches, 800);
    }
  } else if ('serviceWorker' in navigator && isSecureContext()) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  renderLoading();
  try {
    await Promise.race([
      auth.loadConfig(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('load timeout')), 3000))
    ]);
    loadFailed = false;
  } catch (_) {
    loadFailed = true;
  }
  render();
}

function render(note) {
  if (note) toast(note);
  if (!auth.session.unlocked) return renderGate();
  wasUnlocked = true;
  renderMain();
}

auth.onChange(() => {
  if (!auth.session.unlocked && wasUnlocked) {
    wasUnlocked = false;
    state.revealed.clear();
    closeSheet();
    renderGate();
    toast('已自动锁定');
  }
});

function httpsNotice() {
  if (isSecureContext()) return '';
  return '<div class="notice warn"><strong>需要 HTTPS</strong>加密与生物识别只在安全上下文可用。请把本目录部署到 HTTPS 静态托管，或用 localhost 打开。</div>';
}

function installNotice() {
  if (!isIOS() || isStandalone()) return '';
  return '<div class="notice warn"><strong>先添加到主屏幕，再录入卡片</strong>iOS 上「主屏 Web App」与 Safari 的数据分开存放：在 Safari 里录的卡，主屏图标打开时看不到。'
    + '<ol><li>点 Safari 底部的分享按钮</li><li>选「添加到主屏幕」</li><li>从主屏图标打开本应用，再录入</li></ol></div>';
}

function renderGate() {
  if (loadFailed) {
    root.innerHTML = `
      <div class="gate">
        <img class="logo" src="./icons/icon-180.png" alt="卡包">
        <h1>无法读取本地数据</h1>
        <p>浏览器数据库打开超时。请关闭其他打开本应用的标签页、确认没有禁用网站数据，然后重试。</p>
        <div class="gate-box"><button class="btn" data-action="retry-boot">重试</button></div>
        <div style="width:100%;max-width:360px;margin-top:26px;text-align:left">${httpsNotice()}</div>
        <p class="hint">不会自动创建新保险库，以免覆盖已有数据</p>
        <p class="app-version">${VERSION_LINE}</p>
      </div>`;
    return;
  }
  const cfg = auth.session.config;
  const creating = !cfg;
  const biometrics = !creating && auth.session.hasPasskey;

  const body = creating ? `
    <p>第一次使用，先设置一个主密码。它会派生加密密钥，用来保护完整卡号。忘记主密码无法恢复，请务必定期导出加密备份。</p>
    <div class="gate-box">
      <div class="field"><label>主密码（至少 8 位）</label><input type="password" id="vault-password" autocomplete="new-password"></div>
      <div class="field"><label>确认主密码</label><input type="password" id="vault-confirm" autocomplete="new-password"></div>
      <button class="btn" data-action="create-vault">创建保险库</button>
    </div>` : `
    <p>保险库已锁定。完整卡号以密文保存，解锁后密钥只存在于内存中。</p>
    <div class="gate-box">
      ${biometrics ? `<button class="btn" data-action="unlock-passkey">${ICONS.face} 使用 Face ID 解锁</button>
        <div style="text-align:center;color:var(--text-3);font-size:13px;margin:14px 0">或使用主密码</div>` : ''}
      <div class="field"><label>主密码</label><input type="password" id="unlock-password" autocomplete="current-password"></div>
      <button class="btn" data-action="unlock">解锁</button>
    </div>`;

  root.innerHTML = `
    <div class="gate">
      <img class="logo" src="./icons/icon-180.png" alt="卡包">
      <h1>卡包</h1>
      ${body}
      <div style="width:100%;max-width:360px;margin-top:26px;text-align:left">
        ${httpsNotice()}
        ${installNotice()}
      </div>
      <p class="hint">纯本地 · 无账号 · 无云同步 · 无后端</p>
      <p class="app-version">${VERSION_LINE}</p>
    </div>`;
}

async function handleCreate() {
  const p = ($('#vault-password', root)?.value || '').trim();
  const p2 = ($('#vault-confirm', root)?.value || '').trim();
  if (p.length < 8) return toast('主密码至少 8 位');
  if (p !== p2) return toast('两次输入不一致');
  toast('正在创建加密保险库…');
  await auth.createVault(p);
  await refreshCards();
  render();
  toast('已创建，可在「设置」里启用 Face ID');
}

async function handleUnlock() {
  const p = ($('#unlock-password', root)?.value || '').trim();
  if (!p) return toast('请输入主密码');
  await auth.unlockWithPassword(p);
  await refreshCards();
  render();
}

async function handlePasskeyUnlock() {
  await auth.unlockWithPasskey();
  await refreshCards();
  render();
}

async function refreshCards() {
  const list = await DB.Cards.all();
  state.cards = list.sort((a, b) =>
    (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) ||
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );
}

function renderMain() {
  let body;
  if (state.tab === 'wallet') body = state.detailId ? detailHTML() : walletHTML();
  else if (state.tab === 'reminders') body = remindersHTML();
  else body = settingsHTML();
  root.innerHTML = `<div class="page">${body}</div>${tabbarHTML()}`;
  if (state.tab === 'wallet' && !state.detailId) initStack();
}

function tabbarHTML() {
  const items = [
    ['wallet', '卡包', ICONS.wallet],
    ['reminders', '提醒', ICONS.bell],
    ['settings', '设置', ICONS.gear]
  ];
  return `<nav class="tabbar">${items.map(([key, label, svg]) =>
    `<button data-action="tab" data-tab="${key}" class="${state.tab === key ? 'active' : ''}">${svg}<span>${label}</span></button>`
  ).join('')}</nav>`;
}

function filteredCards() {
  const q = state.query.trim().toLowerCase();
  return state.cards.filter((c) => {
    if (state.filter !== 'all' && c.typeKey !== state.filter) return false;
    if (!q) return true;
    const hay = [c.nickname, c.issuer, c.holder, (c.tags || []).join(' '), c.last4, getType(c.typeKey).name]
      .join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function hasUrgent(card) {
  if (card.status && card.status !== '正常') return true;
  return remindFields(card.typeKey).some((f) => {
    const date = nextOccurrence(f, card.values?.[f.key]);
    if (!date) return false;
    const d = daysUntil(date);
    return d !== null && d <= 30;
  });
}

function cardTile(card, index, active) {
  const t = getType(card.typeKey);
  const color = safeColor(card.color, t.color);
  const info = faceInfoFor(card);
  const faceStyle = info
    ? `background-image:url('${esc(info.image)}')`
    : `background:${color}`;
  const num = card.last4 ? '•••• ' + esc(card.last4) : '· · · ·';
  // 卡面（含真实卡面图）只叠加打码卡号，不再叠加发卡机构名称：
  // 真实卡面顶部本身就有银行名 / logo，避免文字重复遮挡画面。
  const inner = info
    ? `<div class="cf-top"><span></span><span class="cf-dot ${hasUrgent(card) ? 'warn' : ''}"></span></div>
       <div class="cf-photo-foot">
         <div class="cf-num">${num}</div>
       </div>`
    : `<div class="cf-top">
        <span class="cf-kind">${esc(t.name)}</span>
        <span class="cf-dot ${hasUrgent(card) ? 'warn' : ''}"></span>
      </div>
      <div>
        <div class="cf-num">${num}</div>
      </div>`;
  return `<button class="card${active ? ' is-active' : ''}" data-action="open" data-id="${esc(card.id)}" data-index="${index}" aria-label="${esc(card.nickname)}">
    <div class="card-face${info ? ' has-photo' : ''}" style="${faceStyle}">${inner}</div>
  </button>`;
}

function gridHTML(list) {
  if (!list.length) {
    return `<div class="empty">
      <div class="empty-icon">▤</div>
      <h3>${state.cards.length ? '没有匹配的卡片' : '还没有卡片'}</h3>
      <p>${state.cards.length ? '换个关键词或筛选条件试试' : '添加第一张卡，开始整理你的卡包'}</p>
      <button class="btn small secondary" data-action="add">添加卡片</button>
    </div>`;
  }
  const step = stackStep(list.length);
  const hint = list.length > 1
    ? `卡片叠放在一起，每张卡<b>上方露出的约 ${step}px 区域</b>都可以点击，轻点直接进入该卡详情查看发卡机构等信息`
    : '轻点卡片即可查看详细信息';
  return `<div class="wallet-stage">
    <div class="wallet-stack" role="list" aria-label="卡片堆叠" data-total="${list.length}">
      ${list.map((c, i) => cardTile(c, i, i === 0)).join('')}
    </div>
    <div class="wallet-hint"><span class="wh-mark" aria-hidden="true">↑</span><span>${hint}</span></div>
  </div>`;
}

// ---- iPhone 钱包：卡片固定堆叠，上方露出的边缘就是可点击范围 ----
// 不做展开/收起：后面的卡依次向上错开 step 像素，主卡（第一张）在最下层位置且层级最高，
// 盖住后面卡的下半部分，每张卡顶部露出的那一条正好是它的点击热区；
// 真实卡面图顶部自带银行名 / logo，点击热区进入详情可看到「发行机构」。
const STACK_STEP = 36;       // 每张卡顶部露出的可点击高度
const STACK_MAX_THICK = 300; // 卡片很多时限制堆叠总厚度

function stackStep(n) {
  if (n <= 1) return 0;
  return Math.min(STACK_STEP, Math.max(12, Math.floor(STACK_MAX_THICK / (n - 1))));
}

function walletStack() {
  return $('#cards-grid .wallet-stack', root);
}
function walletItems() {
  const stack = walletStack();
  return stack ? $$('.card', stack) : [];
}

function layoutStack() {
  const stack = walletStack();
  if (!stack) return;
  const items = walletItems();
  const n = items.length;
  if (!n) return;
  const step = stackStep(n);
  const H = items[0].querySelector('.card-face')?.offsetHeight || 200;
  items.forEach((it, i) => {
    // 后面的卡向上错开：第 i 张的顶部 = (n-1-i) * step，因此每张卡在主卡上方露出一条边
    it.style.transform = `translateX(-50%) translateY(${(n - 1 - i) * step}px)`;
    // 卡片层级必须低于 #overlay-root，否则会盖住添加卡片的类型选择器 / 表单
    it.style.zIndex = String(Math.max(1, 30 - i));
    it.style.opacity = '1';
    it.style.pointerEvents = '';
  });
  stack.style.height = `${Math.round(H + (n - 1) * step + 4)}px`;
}

function initStack() {
  const stack = walletStack();
  if (!stack) return;
  stack.classList.add('no-anim'); // 首次布局直接就位，避免卡片从散开状态跳变
  layoutStack();
  requestAnimationFrame(() => requestAnimationFrame(() => stack.classList.remove('no-anim')));
}

function walletHTML() {
  const chips = [{ key: 'all', name: '全部' }, ...CARD_TYPES.map((t) => ({ key: t.key, name: t.name }))];
  return `
    <div class="topbar">
      <div><h1>卡包</h1><p class="subtitle">${state.cards.length} 张卡 · 全部数据仅存本机</p></div>
      <button class="icon-btn" data-action="add" aria-label="添加卡片">${ICONS.plus}</button>
    </div>
    ${httpsNotice()}
    ${installNotice()}
    <div class="searchbar">${ICONS.search}<input data-input="search" type="search" placeholder="搜索名称、机构、标签" value="${esc(state.query)}"></div>
    <div class="chip-row">${chips.map((c) =>
      `<button class="chip ${state.filter === c.key ? 'active' : ''}" data-action="filter" data-key="${c.key}">${esc(c.name)}</button>`
    ).join('')}</div>
    <div id="cards-grid">${gridHTML(filteredCards())}</div>`;
}

function fieldRowHTML(card, field) {
  const value = card.values?.[field.key];
  if (field.sensitive) {
    const key = `${card.id}:${field.key}`;
    const plain = state.revealed.get(key);
    const content = plain !== undefined
      ? `<strong style="word-break:break-all">${esc(plain)}</strong><button class="btn small subtle" data-action="copy" data-key="${esc(field.key)}">复制</button><button class="btn small secondary" data-action="conceal" data-key="${esc(field.key)}">隐藏</button>`
      : `<span class="masked">••••••••</span><button class="btn small secondary" data-action="reveal" data-key="${esc(field.key)}">显示</button>`;
    return `<div class="kv"><span class="k">${esc(field.label)}<span class="sensitive-mark">加密</span></span><span class="v with-action">${content}</span></div>`;
  }
  if (value === undefined || value === '') return '';
  let shown = value;
  if (field.type === 'money') shown = '¥ ' + value;
  else if (field.type === 'date' || field.type === 'month') shown = fmtDate(value);
  else if (field.type === 'day') shown = '每月 ' + value + ' 日';
  return `<div class="kv"><span class="k">${esc(field.label)}</span><span class="v">${esc(shown)}</span></div>`;
}

function detailHTML() {
  const card = state.cards.find((c) => c.id === state.detailId);
  if (!card) { state.detailId = null; return walletHTML(); }
  const t = getType(card.typeKey);
  const color = safeColor(card.color, t.color);
  const info = faceInfoFor(card);
  const heroStyle = info
    ? `background-image:url('${esc(info.image)}')`
    : `background:${color}`;
  const basics = [
    ['名称', card.nickname], ['类型', t.name], ['发行机构', card.issuer],
    ['归属人', card.holder], ['状态', card.status || '正常'],
    ['标签', (card.tags || []).join('、')],
    ['卡面素材', info ? `${info.bank} · ${info.cardName}` : null],
    ['图片来源', info?.credit || null]
  ].filter(([, v]) => v);

  const metaTop = `${esc(t.name)}${card.status && card.status !== '正常' ? ' · ' + esc(card.status) : ''}`;
  // 卡面上只显示卡号；没有后四位时用纯打码占位，不再回退显示发卡机构名称
  const numLine = card.last4 ? '•••• •••• •••• ' + esc(card.last4) : '•••• •••• •••• ••••';
  const hero = info
    ? `<button type="button" class="detail-hero has-photo" style="${heroStyle}" data-action="zoom-face" data-src="${esc(info.image)}" aria-label="放大查看卡面">
         <span class="dh-overlay-num">${numLine}</span>
       </button>
       <div class="detail-caption">
         <div class="dc-top">${metaTop}</div>
         <div class="dc-name">${esc(card.nickname)}</div>
         <div class="dc-hint">轻点卡面可放大查看完整图片</div>
       </div>`
    : `<div class="detail-hero" style="${heroStyle}">
         <div class="dh-top">${metaTop}</div>
         <div>
           <div class="dh-name">${esc(card.nickname)}</div>
           <div class="dh-num">${numLine}</div>
         </div>
       </div>`;

  return `
    <div class="topbar">
      <button class="icon-btn detail-close" data-action="back" aria-label="关闭，返回堆叠卡包">${ICON_CLOSE}</button>
      <div style="display:flex;gap:8px">
        <button class="btn small secondary" data-action="edit">编辑</button>
        <button class="btn small danger" data-action="delete">删除</button>
      </div>
    </div>
    ${hero}
    <div class="section-title" style="margin-top:0">基本信息</div>
    <div class="list">${basics.map(([k, v]) =>
      `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`
    ).join('')}</div>
    <div class="section-title">${esc(t.name)}信息</div>
    <div class="list">${t.fields.map((f) => fieldRowHTML(card, f)).join('') || '<div class="kv"><span class="k">暂无填写内容</span></div>'}</div>
    <div class="notice">显示加密字段需要再次通过 ${auth.session.hasPasskey ? 'Face ID' : '主密码'} 验证，15 秒后自动打码。</div>`;
}

function buildReminders() {
  const out = [];
  state.cards.forEach((card) => {
    remindFields(card.typeKey).forEach((field) => {
      const date = nextOccurrence(field, card.values?.[field.key]);
      if (!date) return;
      const days = daysUntil(date);
      if (days === null) return;
      out.push({ cardId: card.id, cardName: card.nickname, label: field.label, date, days });
    });
  });
  return out.sort((a, b) => a.days - b.days);
}

function remindersHTML() {
  const items = buildReminders();
  const rows = items.length ? `<div class="list">${items.map((r) => {
    const level = r.days <= 7 ? 'urgent' : r.days <= 30 ? 'soon' : '';
    const main = r.days < 0 ? '过期' : r.days === 0 ? '今天' : String(r.days);
    return `<button class="list-item reminder" data-action="open" data-id="${esc(r.cardId)}">
      <span class="days ${level}">${main}<small>${r.days > 0 ? '天后' : ''}</small></span>
      <span class="li-body"><span class="li-title">${esc(r.cardName)} · ${esc(r.label)}</span><span class="li-desc">${esc(fmtDate(r.date))}</span></span>
      <span class="li-chev">›</span>
    </button>`;
  }).join('')}</div>` : `<div class="empty"><div class="empty-icon">◷</div><h3>暂无提醒</h3><p>给卡片填上有效期、还款日或续费日，这里会自动列出</p></div>`;

  return `<div class="topbar"><div><h1>提醒</h1><p class="subtitle">按最近到期时间排序</p></div></div>
    <div class="notice">提醒数据来自卡片字段本身，不需要联网或推送权限。打开应用即可查看。</div>
    ${rows}`;
}

function settingsHTML() {
  const passkey = auth.session.hasPasskey;
  const standalone = isStandalone();
  return `
    <div class="topbar"><div><h1>设置</h1><p class="subtitle">本地加密 · 无云端同步</p></div></div>
    <div class="notice"><strong>数据只在这台设备上</strong>主屏 Web App 与 Safari 的数据互相隔离；系统存储空间紧张时浏览器数据仍可能被清除，请定期导出加密备份。</div>

    <div class="section-title">安全</div>
    <div class="list">
      <button class="list-item" data-action="lock"><span class="li-icon">${ICONS.lock}</span><span class="li-body"><span class="li-title">立即锁定</span><span class="li-desc">清除内存中的密钥</span></span><span class="li-chev">›</span></button>
      <button class="list-item" data-action="toggle-passkey"><span class="li-icon">${ICONS.face}</span><span class="li-body"><span class="li-title">${passkey ? '关闭 Face ID 解锁' : '启用 Face ID 解锁'}</span><span class="li-desc">${passkey ? '已启用，通过 Passkey 派生密钥' : 'iOS 16+ / Safari 18+ 需支持 PRF'}</span></span><span class="li-value">${passkey ? '已启用' : '未启用'}</span></button>
      <button class="list-item" data-action="change-password"><span class="li-icon">⌘</span><span class="li-body"><span class="li-title">修改主密码</span><span class="li-desc">不会重新加密已有卡片</span></span><span class="li-chev">›</span></button>
    </div>

    <div class="section-title">数据</div>
    <div class="list">
      <button class="list-item" data-action="export-backup"><span class="li-icon">↓</span><span class="li-body"><span class="li-title">导出加密备份</span><span class="li-desc">生成 .cardsapp 文件，存到「文件」App</span></span><span class="li-chev">›</span></button>
      <button class="list-item" data-action="import-backup"><span class="li-icon">↑</span><span class="li-body"><span class="li-title">导入备份</span><span class="li-desc">覆盖当前全部卡片</span></span><span class="li-chev">›</span></button>
      <button class="list-item" data-action="export-csv"><span class="li-icon danger">!</span><span class="li-body"><span class="li-title">导出明文 CSV</span><span class="li-desc">含完整卡号，谨慎使用</span></span><span class="li-chev">›</span></button>
    </div>

    <div class="section-title">运行环境</div>
    <div class="list">
      <div class="kv"><span class="k">加密上下文</span><span class="v">${isSecureContext() ? 'HTTPS / 可用' : '非安全上下文'}</span></div>
      <div class="kv"><span class="k">运行方式</span><span class="v">${standalone ? '主屏 Web App' : (isIOS() ? 'Safari 标签页' : '浏览器')}</span></div>
      <div class="kv"><span class="k">WebAuthn PRF</span><span class="v">${auth.prfSupported() ? '接口可用' : '不可用'}</span></div>
      <div class="kv"><span class="k">真实卡面图库</span><span class="v">${Object.keys(BANK_FACES).length} 家 / ${Object.values(BANK_FACES).reduce((n, b) => n + b.images.length, 0)} 张</span></div>
      <div class="kv"><span class="k">默认卡面</span><span class="v">交通卡 ${Object.keys(TYPE_DEFAULT_FACES).length} 张 · CC BY-SA 4.0</span></div>
      <div class="kv"><span class="k">卡片数量</span><span class="v">${state.cards.length} 张</span></div>
    </div>

    <div class="section-title">危险操作</div>
    <div class="list">
      <button class="list-item" data-action="wipe"><span class="li-icon danger">×</span><span class="li-body"><span class="li-title">清除全部数据</span><span class="li-desc">删除保险库与所有卡片，不可恢复</span></span><span class="li-chev">›</span></button>
    </div>`;
}

function openSheet(title, body) {
  overlay.innerHTML = `<div class="backdrop" data-action="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head"><div class="grabber"></div><h2>${esc(title)}</h2><button data-action="sheet-close">关闭</button></div>
      <div class="sheet-body">${body}</div>
    </div>`;
}

function closeSheet() { overlay.innerHTML = ''; }
function sheetVal(sel) { const el = $(sel, overlay); return el ? el.value.trim() : ''; }

function openTypePicker() {
  const tiles = CARD_TYPES.map((t) => `
    <button class="type-tile" data-action="choose-type" data-key="${t.key}" aria-label="${esc(t.name)}">
      <span class="type-icon" style="color:${esc(t.color)};background:${esc(t.color)}1A">${TYPE_ICONS[t.key] || TYPE_ICONS.credit}</span>
      <span class="type-label">${esc(t.name)}</span>
    </button>`).join('');
  openSheet('选择卡类型', `<p class="hint-global">卡种由字段模板驱动，不同卡会显示不同的填写项。</p><div class="type-grid">${tiles}</div>`);
}

function fieldHTML(field, value, editSensitive) {
  const v = value ?? '';
  const label = `${esc(field.label)}${field.required ? ' <span class="req">*</span>' : ''}${field.sensitive ? '<span class="sensitive-mark">加密</span>' : ''}`;
  const attrs = `data-field="${esc(field.key)}"${field.placeholder && !field.sensitive ? ` placeholder="${esc(field.placeholder)}"` : ''}`;
  let input;
  if (field.sensitive) {
    input = `<input type="password" ${attrs} value="" autocomplete="off" placeholder="${editSensitive ? '留空表示不修改' : esc(field.placeholder || '仅加密保存在本机')}">`;
  } else if (field.type === 'bank') {
    // 发卡行只允许从「有真实卡面」的银行里挑；选「其他」才展开手动输入。
    const canonical = canonicalBankName(v);
    const known = canonical || (BANK_OPTIONS.some((b) => b.name === v) ? v : '');
    const isOther = !!v && !known;
    const options = [
      `<option value=""${!v ? ' selected' : ''}>请选择发卡行</option>`,
      ...BANK_OPTIONS.map((b) =>
        `<option value="${esc(b.name)}"${b.name === known ? ' selected' : ''}>${esc(b.name)} · ${esc(b.short)}</option>`),
      `<option value="${OTHER_BANK}"${isOther ? ' selected' : ''}>其他 · 手动输入</option>`
    ];
    input = `<select ${attrs}>${options.join('')}</select>
      <div class="sub-field" data-other-for="${esc(field.key)}"${isOther ? '' : ' hidden'}>
        <input type="text" data-field="${esc(field.key)}Other" value="${isOther ? esc(v) : ''}" placeholder="输入发卡银行名称">
        <div class="help">手动填写的机构若不在图库中，卡面会自动使用纯色</div>
      </div>
      <div class="help">下拉中的 ${BANK_OPTIONS.length} 家银行均有内置真实卡面；列表里没有请选「其他」</div>`;
  } else if (field.type === 'select') {
    const opts = field.options.includes(v) ? field.options : [v, ...field.options].filter(Boolean);
    input = `<select ${attrs}>${opts.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  } else if (field.type === 'textarea') {
    input = `<textarea ${attrs}>${esc(v)}</textarea>`;
  } else if (field.type === 'date') {
    input = `<input type="date" ${attrs} value="${esc(v)}">`;
  } else if (field.type === 'month') {
    input = `<input type="month" ${attrs} value="${esc(v)}">`;
  } else if (field.type === 'day') {
    input = `<input type="number" min="1" max="31" ${attrs} value="${esc(v)}">`;
  } else if (field.type === 'money' || field.type === 'number') {
    input = `<input type="number" inputmode="decimal" ${attrs} value="${esc(v)}">`;
  } else {
    input = `<input type="text" ${attrs} value="${esc(v)}"${field.inputmode ? ` inputmode="${field.inputmode}"` : ''}>`;
  }
  return `<div class="field"><label>${label}</label>${input}${field.remind ? `<div class="help">到期前 ${field.remind} 天进入提醒列表</div>` : ''}</div>`;
}

function openCardForm(typeKey, editing) {
  const t = getType(typeKey);
  const card = editing ? state.cards.find((c) => c.id === state.detailId) : null;
  state.formColor = card?.color || t.color;
  state.formFaceStyle = card?.faceStyle || 'brand';

  const basics = `
    <div class="field"><label>名称 <span class="req">*</span></label><input data-field="nickname" value="${esc(card?.nickname || '')}" placeholder="给这张卡起个名字"></div>
    <div class="field"><label>归属人</label><input data-field="holder" value="${esc(card?.holder || '')}" placeholder="如 本人 / 家人"></div>
    <div class="field"><label>状态</label><select data-field="status">${['正常', '挂失', '已过期', '已注销'].map((s) =>
      `<option value="${s}"${s === (card?.status || '正常') ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>标签</label><input data-field="tags" value="${esc((card?.tags || []).join('、'))}" placeholder="用顿号分隔"></div>
    <div class="field"><label>卡面样式</label><select data-field="faceStyle">
      <option value="brand"${state.formFaceStyle === 'brand' ? ' selected' : ''}>自动 · 真实银行卡面</option>
      <option value="solid"${state.formFaceStyle === 'solid' ? ' selected' : ''}>自定义纯色</option>
    </select><div class="help">按「发卡行 / 发行机构」自动匹配官方真实卡面，同银行不同卡会轮换；未收录的机构回退为纯色</div></div>
    <div class="field" id="face-color-field"${state.formFaceStyle === 'solid' ? '' : ' hidden'}>
      <label>卡面颜色</label>
      <div class="chip-row" style="margin-bottom:0">${CARD_COLORS.map((c) =>
        `<button class="chip color-chip${state.formColor === c ? ' active' : ''}" data-action="pick-color" data-color="${c}" style="width:34px;height:34px;padding:0;background:${c};border:2px solid ${state.formColor === c ? '#1D1D1F' : 'transparent'}"></button>`
      ).join('')}</div>
      <div class="help">仅「自定义纯色」下可选；切回自动卡面时会保留你选过的颜色</div>
    </div>`;

  const specifics = t.fields.map((f) => fieldHTML(f, card?.values?.[f.key], editing && f.sensitive)).join('');
  openSheet(editing ? '编辑卡片' : `添加${t.name}`, `
    <div class="section-title" style="margin-top:0">基本信息</div>${basics}
    <div class="section-title">${esc(t.name)}信息</div>${specifics}
    <div class="btn-row"><button class="btn" data-action="save-card" data-key="${t.key}" data-edit="${editing ? '1' : '0'}">保存</button></div>
    <p class="hint-global">标注「加密」的字段只以密文保存在本机，查看需再次验证身份。</p>`);
}

async function saveCard(typeKey, editing) {
  const t = getType(typeKey);
  const read = (k) => {
    const el = $(`[data-field="${k}"]`, overlay);
    if (!el) return '';
    // 「其他」时下拉本身是哨兵值，真正要存的是手动输入的银行名
    if (el.value === OTHER_BANK) return ($(`[data-field="${k}Other"]`, overlay)?.value || '').trim();
    return el.value.trim();
  };
  const nickname = read('nickname');
  if (!nickname) return toast('请填写名称');
  for (const f of t.fields) {
    if (f.required && !read(f.key)) return toast('请填写' + f.label);
  }

  const id = editing ? state.detailId : uid();
  const prev = editing ? state.cards.find((c) => c.id === id) : null;
  const values = { ...(prev?.values || {}) };
  const secrets = {};
  t.fields.forEach((f) => {
    const v = read(f.key);
    if (f.sensitive) { if (v) secrets[f.key] = v; }
    else if (v !== '') values[f.key] = v;
  });

  const issuer = values.bank || values.merchant || values.city || values.place || values.service || nickname;
  const digits = (secrets.number || '').replace(/\D/g, '');
  // 交通卡等卡种没有加密卡号字段，用明文库里的卡号末四位做同样的打码展示
  const fallbackDigits = String(values.cardNo || '').replace(/\D/g, '');
  const card = {
    id,
    typeKey,
    nickname,
    holder: read('holder'),
    status: read('status') || '正常',
    tags: read('tags').split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
    color: state.formColor || t.color,
    faceStyle: read('faceStyle') || 'brand',
    issuer,
    last4: digits ? digits.slice(-4) : (fallbackDigits ? fallbackDigits.slice(-4) : (prev?.last4 || '')),
    values,
    createdAt: prev?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const oldSecrets = editing ? await DB.Secrets.forCard(id) : [];
  const records = [];
  for (const f of t.fields.filter((x) => x.sensitive)) {
    if (secrets[f.key]) {
      const enc = await encryptText(auth.session.dek, secrets[f.key]);
      records.push({ id: `${id}:${f.key}`, cardId: id, fieldKey: f.key, ...enc });
    } else if (editing) {
      const old = oldSecrets.find((s) => s.fieldKey === f.key);
      if (old) records.push(old);
    }
  }

  await DB.saveCardBundle(card, records);
  closeSheet();
  await refreshCards();
  if (editing) state.detailId = id;
  renderMain();
  toast(editing ? '已保存' : '已添加');
}

async function reveal(cardId, fieldKey) {
  if (!auth.session.unlocked) return render('请先解锁保险库');
  if (auth.session.hasPasskey) {
    const ok = await auth.reverifyWithPasskey();
    if (!ok) return toast('验证失败');
    await showPlain(cardId, fieldKey);
  } else {
    openSheet('验证主密码', `
      <div class="notice">显示完整卡号前需要再次验证身份。</div>
      <div class="field"><label>主密码</label><input type="password" id="verify-pwd" autocomplete="off"></div>
      <button class="btn" data-action="do-reveal" data-id="${esc(cardId)}" data-key="${esc(fieldKey)}">验证并显示 15 秒</button>`);
    setTimeout(() => $('#verify-pwd', overlay)?.focus(), 120);
  }
}

async function doRevealWithPassword(cardId, fieldKey) {
  const p = sheetVal('#verify-pwd');
  if (!p) return toast('请输入主密码');
  const ok = await auth.verifyPassword(p);
  if (!ok) return toast('主密码不正确');
  closeSheet();
  await showPlain(cardId, fieldKey);
}

async function showPlain(cardId, fieldKey) {
  const recs = await DB.Secrets.forCard(cardId);
  const rec = recs.find((r) => r.fieldKey === fieldKey);
  if (!rec) return toast('该字段没有保存内容');
  const plain = await decryptText(auth.session.dek, rec);
  const key = `${cardId}:${fieldKey}`;
  state.revealed.set(key, plain);
  renderMain();
  setTimeout(() => {
    if (!state.revealed.has(key)) return;
    state.revealed.delete(key);
    if (auth.session.unlocked && state.tab === 'wallet' && state.detailId === cardId) renderMain();
  }, 15000);
}

async function copyPlain(cardId, fieldKey) {
  const plain = state.revealed.get(`${cardId}:${fieldKey}`);
  if (!plain) return;
  try {
    await navigator.clipboard.writeText(plain);
    toast('已复制，30 秒后清空剪贴板');
    setTimeout(async () => { try { await navigator.clipboard.writeText(''); } catch (_) {} }, 30000);
  } catch (_) { toast('复制失败，请手动选择文本'); }
}

function confirmDelete() {
  openSheet('删除卡片', `
    <div class="notice warn"><strong>确认删除？</strong>这张卡及其加密字段会一并删除，无法恢复。</div>
    <button class="btn danger" data-action="do-delete">确认删除</button>
    <button class="btn secondary" style="margin-top:10px" data-action="sheet-close">取消</button>`);
}

function openPasskeyIntro() {
  openSheet('启用 Face ID 解锁', `
    <div class="notice"><strong>需要连续验证两次</strong>第一次创建本机 Passkey，第二次确认设备支持 PRF 密钥派生。完成后可用 Face ID 直接解锁和查看完整卡号；主密码始终保留为备用方式。</div>
    <button class="btn" data-action="do-enable-passkey">开始验证</button>
    <p class="hint-global">若设备或浏览器不支持 PRF，会自动回退到主密码，数据不会受影响。</p>`);
}

function openPasswordSheet() {
  openSheet('修改主密码', `
    <div class="field"><label>原主密码</label><input type="password" id="old-pwd" autocomplete="current-password"></div>
    <div class="field"><label>新主密码（至少 8 位）</label><input type="password" id="new-pwd" autocomplete="new-password"></div>
    <div class="field"><label>确认新密码</label><input type="password" id="new-pwd2" autocomplete="new-password"></div>
    <button class="btn" data-action="do-change-password">保存新密码</button>`);
}

function openExportSheet() {
  openSheet('导出加密备份', `
    <div class="notice"><strong>请设置备份密码</strong>备份包含完整卡号，但会用此密码整体加密。密码丢失将无法恢复备份，请单独记牢。</div>
    <div class="field"><label>备份密码（至少 8 位）</label><input type="password" id="backup-pwd" autocomplete="new-password"></div>
    <div class="field"><label>确认密码</label><input type="password" id="backup-pwd2" autocomplete="new-password"></div>
    <button class="btn" data-action="do-export">生成备份文件</button>`);
}

async function doExport() {
  const p = sheetVal('#backup-pwd');
  const p2 = sheetVal('#backup-pwd2');
  if (p.length < 8) return toast('备份密码至少 8 位');
  if (p !== p2) return toast('两次输入不一致');
  const { cards, secrets } = await DB.exportRaw();
  const plainSecrets = [];
  for (const s of secrets) {
    try { plainSecrets.push({ cardId: s.cardId, fieldKey: s.fieldKey, value: await decryptText(auth.session.dek, s) }); }
    catch (_) {}
  }
  const payload = { app: 'cardsapp', version: 1, exportedAt: new Date().toISOString(), cards, secrets: plainSecrets };
  const blob = await encryptBackup(payload, p);
  download(`卡包备份-${todayISO()}.cardsapp`, JSON.stringify(blob));
  closeSheet();
  toast('备份文件已生成');
}

function openImportSheet() {
  state.pendingBackup = null;
  openSheet('导入备份', `
    <div class="notice warn"><strong>会覆盖当前所有卡片</strong>建议先导出一份当前数据。导入前保险库必须处于解锁状态。</div>
    <div class="field"><label>备份文件（.cardsapp）</label><input type="file" id="backup-file" accept=".cardsapp,.json,application/json"></div>
    <div class="field"><label>备份密码</label><input type="password" id="import-pwd"></div>
    <button class="btn" data-action="do-import">解密并覆盖导入</button>`);
}

async function doImport() {
  if (!state.pendingBackup) return toast('请先选择备份文件');
  const p = sheetVal('#import-pwd');
  const payload = await decryptBackup(state.pendingBackup, p);
  if (payload.app !== 'cardsapp' || !Array.isArray(payload.cards)) throw new Error('不是有效的卡包备份');
  const records = [];
  for (const s of (payload.secrets || [])) {
    const enc = await encryptText(auth.session.dek, s.value);
    records.push({ id: `${s.cardId}:${s.fieldKey}`, cardId: s.cardId, fieldKey: s.fieldKey, ...enc });
  }
  await DB.replaceAll(payload.cards, records);
  state.pendingBackup = null;
  closeSheet();
  await refreshCards();
  renderMain();
  toast(`已导入 ${payload.cards.length} 张卡`);
}

function openCsvSheet() {
  openSheet('导出明文 CSV', `
    <div class="notice warn"><strong>这个文件是明文</strong>包含完整卡号、卡密和证件号。请立即转移到安全位置，并删除下载目录中的原件。</div>
    <button class="btn danger" data-action="do-export-csv">我了解风险，导出明文</button>`);
}

async function doExportCsv() {
  const { cards, secrets } = await DB.exportRaw();
  const map = new Map();
  for (const s of secrets) {
    try { map.set(`${s.cardId}:${s.fieldKey}`, await decryptText(auth.session.dek, s)); } catch (_) {}
  }
  const header = ['名称', '类型', '发行机构', '归属人', '状态', '标签', '完整卡号', '卡密/证件号', '备注'];
  const rows = cards.map((c) => [
    c.nickname, getType(c.typeKey).name, c.issuer || '', c.holder || '', c.status || '',
    (c.tags || []).join('、'),
    map.get(`${c.id}:number`) || map.get(`${c.id}:idNumber`) || '',
    map.get(`${c.id}:code`) || '', c.values?.note || ''
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`卡包明文-${todayISO()}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  closeSheet();
  toast('已导出');
}

function confirmWipe() {
  openSheet('清除全部数据', `
    <div class="notice warn"><strong>此操作不可恢复</strong>保险库、主密码、Passkey 与所有卡片都会被删除。建议先导出加密备份。</div>
    <button class="btn danger" data-action="do-wipe">确认清除全部数据</button>
    <button class="btn secondary" style="margin-top:10px" data-action="sheet-close">取消</button>`);
}

async function handle(action, el) {
  try {
    switch (action) {
      case 'sheet-close': closeSheet(); break;
      case 'retry-boot': loadFailed = false; boot(); break;
      case 'create-vault': await handleCreate(); break;
      case 'unlock': await handleUnlock(); break;
      case 'unlock-passkey': await handlePasskeyUnlock(); break;
      case 'tab': state.tab = el.dataset.tab; state.detailId = null; state.revealed.clear(); renderMain(); break;
      case 'add': openTypePicker(); break;
      case 'choose-type': openCardForm(el.dataset.key, false); break;
      case 'pick-color': {
        state.formColor = el.dataset.color;
        const faceSel = $('[data-field="faceStyle"]', overlay);
        if (faceSel) faceSel.value = 'solid';
        $$('.color-chip', overlay).forEach((b) => {
          const on = b.dataset.color === state.formColor;
          b.classList.toggle('active', on);
          b.style.borderColor = on ? '#1D1D1F' : 'transparent';
        });
        break;
      }
      case 'save-card': await saveCard(el.dataset.key, el.dataset.edit === '1'); break;
      case 'filter': state.filter = el.dataset.key; renderMain(); break;
      case 'open': {
        state.detailId = el.dataset.id; state.tab = 'wallet'; state.revealed.clear(); renderMain();
        break;
      }
      case 'zoom-face': {
        overlay.innerHTML = `<div class="face-viewer" data-action="close-face-viewer">
          <img src="${esc(el.dataset.src || '')}" alt="卡面大图">
          <span class="face-viewer-hint">轻点任意位置关闭</span>
        </div>`;
        break;
      }
      case 'close-face-viewer': closeSheet(); break;
      case 'back': state.detailId = null; state.revealed.clear(); renderMain(); break;
      case 'edit': openCardForm(state.cards.find((c) => c.id === state.detailId)?.typeKey || 'credit', true); break;
      case 'reveal': await reveal(state.detailId, el.dataset.key); break;
      case 'copy': await copyPlain(state.detailId, el.dataset.key); break;
      case 'conceal': state.revealed.delete(`${state.detailId}:${el.dataset.key || ''}`); renderMain(); break;
      case 'do-reveal': await doRevealWithPassword(el.dataset.id, el.dataset.key); break;
      case 'delete': confirmDelete(); break;
      case 'do-delete': {
        const id = state.detailId;
        await DB.removeCardBundle(id);
        state.detailId = null;
        closeSheet();
        await refreshCards();
        renderMain();
        toast('已删除');
        break;
      }
      case 'lock': auth.lock(); break;
      case 'toggle-passkey': {
        if (auth.session.hasPasskey) {
          await auth.removePasskey();
          renderMain();
          toast('已关闭生物识别解锁');
        } else openPasskeyIntro();
        break;
      }
      case 'do-enable-passkey':
        await auth.registerPasskey();
        closeSheet();
        renderMain();
        toast('Face ID 解锁已启用');
        break;
      case 'change-password': openPasswordSheet(); break;
      case 'do-change-password': {
        const old = sheetVal('#old-pwd');
        const next = sheetVal('#new-pwd');
        const next2 = sheetVal('#new-pwd2');
        if (next.length < 8) return toast('新密码至少 8 位');
        if (next !== next2) return toast('两次输入不一致');
        await auth.changePassword(old, next);
        closeSheet();
        toast('主密码已修改');
        break;
      }
      case 'export-backup': openExportSheet(); break;
      case 'do-export': await doExport(); break;
      case 'import-backup': openImportSheet(); break;
      case 'do-import': await doImport(); break;
      case 'export-csv': openCsvSheet(); break;
      case 'do-export-csv': await doExportCsv(); break;
      case 'wipe': confirmWipe(); break;
      case 'do-wipe':
        await auth.wipeAll();
        state.cards = [];
        state.detailId = null;
        state.tab = 'wallet';
        state.filter = 'all';
        state.query = '';
        state.revealed.clear();
        closeSheet();
        render('已清除全部数据');
        break;
      default: break;
    }
  } catch (e) {
    toast(e?.message || '操作失败，请重试');
  }
}

function onClick(evt) {
  const el = evt.target.closest?.('[data-action]');
  if (el) handle(el.dataset.action, el);
}

function onInput(evt) {
  const el = evt.target;
  if (el.dataset?.input === 'search') {
    state.query = el.value;
    const grid = $('#cards-grid', root);
    if (grid) { grid.innerHTML = gridHTML(filteredCards()); initStack(); }
  }
}

function onKeydown(evt) {
  if (evt.key === 'Escape' && $('.face-viewer', overlay)) { closeSheet(); return; }
  // 详情页按 Esc 等同于点右上角 ×，退回堆叠卡包
  if (evt.key === 'Escape' && state.detailId) {
    state.detailId = null; state.revealed.clear(); renderMain();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(evt.target?.tagName || '');
  if (typing) return;
  if (evt.key !== 'Enter') return;
  const el = evt.target;
  if (el.id === 'unlock-password') handle('unlock', el);
  else if (el.id === 'vault-password' || el.id === 'vault-confirm') handle('create-vault', el);
  else if (el.id === 'verify-pwd') {
    const btn = $('[data-action="do-reveal"]', overlay);
    if (btn) handle('do-reveal', btn);
  }
}

async function onChange(evt) {
  const el = evt.target;
  if (el.dataset?.field === 'faceStyle') {
    const box = $('#face-color-field', overlay);
    if (box) box.hidden = el.value !== 'solid';
    return;
  }
  if (el.dataset?.field === 'bank') {
    const box = $('[data-other-for="bank"]', overlay);
    if (box) box.hidden = el.value !== OTHER_BANK;
    return;
  }
  if (el.id !== 'backup-file') return;
  const file = el.files?.[0];
  if (!file) return;
  try {
    state.pendingBackup = JSON.parse(await file.text());
    toast('备份文件已读取');
  } catch (_) { toast('文件无法解析'); }
}

root.addEventListener('click', onClick);
overlay.addEventListener('click', onClick);
root.addEventListener('input', onInput);
overlay.addEventListener('input', onInput);
root.addEventListener('keydown', onKeydown);
overlay.addEventListener('keydown', onKeydown);
overlay.addEventListener('change', onChange);
window.addEventListener('resize', () => { if (walletStack()) layoutStack(); });

boot();

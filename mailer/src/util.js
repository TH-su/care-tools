// 表示ユーティリティ

export const cx = (...args) => args.filter(Boolean).join(' ');

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ACCOUNT_COLORS = [
  '#0A84FF', '#BF5AF2', '#FF9F0A', '#30D158',
  '#FF375F', '#64D2FF', '#FF6482', '#AC8E68',
];

// 一覧用の日付: 今日→時刻 / 昨日 / 同年→8月12日 / それ以前→2025/12/01
export function formatListDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return '昨日';
  if (diffDays < 7) return d.toLocaleDateString('ja-JP', { weekday: 'long' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatFullDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} ${d.toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 差出人アバターの頭文字（日本語は先頭1文字、ローマ字は2文字）
export function initialsOf(name, address) {
  const src = (name || address || '?').trim();
  if (/^[\x00-\x7F]/.test(src)) {
    const words = src.replace(/["']/g, '').split(/[\s._@-]+/).filter(Boolean);
    return words.slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  }
  return src[0];
}

// 差出人ごとに安定した色相のアバター色
export function colorForString(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 52%)`;
}

export function rowKey(r) {
  return `${r.accountId}|${r.mailbox}|${r.uid}`;
}

export function displayFrom(from) {
  return from?.name || from?.address || '（差出人不明）';
}

export function addressListText(list, self) {
  return (list || [])
    .map(a => (self && a.address === self ? '自分' : (a.name || a.address)))
    .join('、');
}

// Re:/Fwd: の重複を避けた件名
export function replySubject(s) {
  return /^re:/i.test((s || '').trim()) ? s : `Re: ${s || ''}`;
}
export function forwardSubject(s) {
  return /^fwd?:/i.test((s || '').trim()) ? s : `Fwd: ${s || ''}`;
}

// 返信の引用本文
export function quoteBody(message) {
  const d = new Date(message.date);
  const when = `${d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })} ${d.toLocaleTimeString('ja-JP', { hour: 'numeric', minute: '2-digit' })}`;
  const who = message.from?.name ? `${message.from.name} <${message.from.address}>` : message.from?.address || '';
  const quoted = (message.text || '').split('\n').map(l => `> ${l}`).join('\n');
  return `\n\n${when}、${who} のメール:\n${quoted}`;
}

export function forwardBody(message) {
  const to = (message.to || []).map(a => (a.name ? `${a.name} <${a.address}>` : a.address)).join('、');
  return [
    '',
    '',
    '---------- 転送されたメッセージ ----------',
    `差出人: ${message.from?.name || ''} <${message.from?.address || ''}>`,
    `日時: ${formatFullDate(message.date)}`,
    `件名: ${message.subject || ''}`,
    `宛先: ${to}`,
    '',
    message.text || '',
  ].join('\n');
}

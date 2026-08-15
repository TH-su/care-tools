// HTMLメールのサニタイズ
// 多層防御の一層目。最終的な表示は sandbox 付き iframe + CSP（クライアント側）で
// 隔離されるため、ここでは スクリプト系の除去・危険URLの無効化・リモート画像の
// 差し替えを行う。cid: 参照のインライン画像は data URI に置換する。

const BLOCKED_TAGS = /<\s*\/?\s*(script|iframe|object|embed|frame|frameset|base|applet|form|input|button|select|textarea|meta|link)\b[^>]*>/gi;
const EVENT_ATTRS = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URLS = /\b(href|src|action|formaction|background|poster)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi;
const CSS_DANGEROUS = /(expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:)/gi;
const SRCSET_ATTR = /\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

const MAX_INLINE_IMAGE = 2 * 1024 * 1024;   // cid画像1枚あたり上限
const MAX_INLINE_TOTAL = 10 * 1024 * 1024;  // cid画像合計の上限

export function sanitizeHtml(html, { attachments = [], blockRemote = true } = {}) {
  if (!html) return { html: '', hadRemoteImages: false };

  let out = String(html);

  // コメント除去（条件付きコメント内のscript等を含めて落とす）
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // scriptは中身ごと除去
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  // 危険タグ除去（開始・終了タグとも）
  out = out.replace(BLOCKED_TAGS, '');
  // イベントハンドラ属性除去
  out = out.replace(EVENT_ATTRS, '');
  // javascript: URL無効化
  out = out.replace(JS_URLS, '$1="#"');
  // style中の危険構文除去
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (m, attrs, css) => `<style>${css.replace(CSS_DANGEROUS, '/*removed*/')}</style>`);
  out = out.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi,
    m => m.replace(CSS_DANGEROUS, ''));

  // cid: 参照を添付のインライン画像（data URI）へ置換
  let inlineTotal = 0;
  const cidMap = new Map();
  for (const att of attachments) {
    const cid = (att.cid || att.contentId || '').replace(/[<>]/g, '');
    if (!cid || !att.content) continue;
    if (att.content.length > MAX_INLINE_IMAGE) continue;
    if (inlineTotal + att.content.length > MAX_INLINE_TOTAL) continue;
    inlineTotal += att.content.length;
    const mime = att.contentType || 'application/octet-stream';
    cidMap.set(cid, `data:${mime};base64,${att.content.toString('base64')}`);
  }
  out = out.replace(/(src|background)\s*=\s*("cid:([^"]+)"|'cid:([^']+)'|cid:([^\s>]+))/gi,
    (m, attr, _q, c1, c2, c3) => {
      const cid = (c1 || c2 || c3 || '').replace(/[<>]/g, '');
      const data = cidMap.get(cid);
      return data ? `${attr}="${data}"` : `${attr}=""`;
    });
  // CSS内の url(cid:...) も置換
  out = out.replace(/url\(\s*(['"]?)cid:([^)'"]+)\1\s*\)/gi, (m, q, cid) => {
    const data = cidMap.get(cid.replace(/[<>]/g, ''));
    return data ? `url(${data})` : 'none';
  });

  // リモート画像の検出とブロック
  // srcset は許可時もパスが複雑なため常に除去（src側で表示される）
  out = out.replace(SRCSET_ATTR, '');
  const remoteRe = /(src|background)\s*=\s*("https?:\/\/[^"]*"|'https?:\/\/[^']*'|https?:\/\/[^\s>]+)/gi;
  const cssRemoteRe = /url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/gi;
  const hadRemoteImages = remoteRe.test(out) || cssRemoteRe.test(out);
  remoteRe.lastIndex = 0; cssRemoteRe.lastIndex = 0;

  if (blockRemote && hadRemoteImages) {
    out = out.replace(remoteRe, (m, attr, url) => {
      const clean = url.replace(/^["']|["']$/g, '');
      return `data-blocked-${attr}="${clean.replace(/"/g, '&quot;')}" ${attr}=""`;
    });
    out = out.replace(cssRemoteRe, 'none');
  }

  return { html: out, hadRemoteImages };
}

// プレーンテキスト → 表示用HTML（リンク自動検出・引用の着色）
export function textToHtml(text) {
  if (!text) return '';
  const esc = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(
    /(https?:\/\/[^\s<>"')\]]+)/g,
    '<a href="$1">$1</a>');
  const lines = linked.split('\n').map(line => {
    const m = line.match(/^((&gt;\s*)+)/);
    if (m) {
      const depth = (m[1].match(/&gt;/g) || []).length;
      return `<span class="q q${Math.min(depth, 3)}">${line}</span>`;
    }
    return line;
  });
  return `<div class="plain">${lines.join('\n')}</div>`;
}

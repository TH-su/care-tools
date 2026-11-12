/* check/score-calc.mjs — 画面ごとの「商用の点」を出す採点の純関数（2026-11-12 新設・代表者の決定 2026-11-12 案1 の第1段）
 *
 *   import { scorePage } from './score-calc.mjs';
 *   scorePage(name, html, { css: { 'su-theme.css': '…' }, sizes: { 'chart.js': 123456 }, scripts: { 'menu-settings.js': '…' }, dynamic: { overflowPx, pageErrors, loadMs } })
 *
 * ・純関数だけ。ファイル・通信・時計に触れない（入口は check/score.mjs・試験は check/unit/score_calc_test.js）
 * ・画面の HTML は読むだけ。採点は「知らせ」であって門ではない（PR の必須チェックにしない）
 * ・返す detail は件数・割合だけ。画面のソースの断片・エラーの文面は入れない（公開の成果物に出るため）
 *
 * ── 点の付け方（すべて仮置き・2026-11-12）──
 * ・5つの軸 × 各20点 = 100点。軸の中の項目は等分（項目ごとに 0〜1 の割合 frac を出し、軸の点 = 20 × 課した項目の frac の平均）
 * ・項目の状態は 合格（frac=1）／一部（0<frac<1）／不合格（frac=0）／対象外／未測定
 * ・「対象外」と「未測定」は満点扱いにも0点にもしない。その項目を軸から外し、課した項目だけで比例で出す。
 *   軸の項目が全部外れた時は軸ごと外し、合計 = 課した軸の点の和 ÷（20 × 課した軸の数）× 100 で 100点満点に直す
 * ・動的の値（dynamic）が無い・null の項目は「未測定」
 *
 * ── 項目（仮置き）──
 * 迷わない（導線）
 *   menu   メニュー（index.html）へ戻るリンク（href="index.html"・"./index.html"・"./"、または location を index.html へ）。index.html 自身は対象外
 *   hop    su-resident-hop.js を読む。課すのは HOP_PAGES だけ（入居者を開く画面）。
 *          入居者マスタは「この方を各アプリで開く」を別タブのまま（CLAUDE.md・本人指示 2026-10-25）なので課さない
 *   help   help.html へのリンク。index.html 以外は直のリンクがあれば合格、無い時は menu の項目で数えるので対象外（同じ欠けを2回数えない）
 * 失わない（守り）
 *   net    su-net.js を読む、または画面が online／offline（navigator.onLine）を自分で扱う
 *   errors su-errors.js を読む
 *   leave  beforeunload か、confirm( の文言に「保存」「破棄」「変更」「閉じ」「消え」がある。
 *          入力欄（input・select・textarea・contenteditable）が静的にも JS の文字にも無い画面は対象外
 *          画面の中のスクリプトに加えて、画面が <script src> で読む同じサイトの「その画面のための部品」（isOwnScript: ファイル名が
 *          画面名と同じか「画面名-」で始まる .js。例 menu-settings.html → menu-settings.js、app-access.html → app-access-devices.js）の中の
 *          beforeunload も見る（2026-11-12 直し）。confirm の語の決め方は画面の中のスクリプトだけに当て、部品の中の confirm では「あり」にしない
 *          （部品の書き出し・消す処理の confirm の「保存」「消え」に当たるため・代表者の決定 2026-11-12 推奨1・仮置き）。共通部品の su-*.js・ほかの画面の部品（ats.html が借りる staff-master-calc.js など）・外の部品の同梱物は見ない
 *          （共通部品に確かめがあると、読むだけのどの画面も「あり」になるため）。入力欄の有無の判定は今までどおり画面の中だけで見る
 *   engmsg 英語の例外文を画面にそのまま出す形の数（同じ文の中に「出す先」textContent・innerHTML・innerText・alert(・confirm( と、
 *          「出す元」e.message・err.message・error.message・String(e) か 'Failed to fetch'・'Load failed'・NetworkError の直書きがあるもの）。
 *          0件=1・1〜2件=2/3・3〜5件=1/3・6件以上=0（誤検出を減らすための段階点）
 *          出す元のうち次の2つは数えない（2026-11-12 直し・どちらも画面の中身から機械で確かめられる時だけ）:
 *          (1) === ・!== ・== ・!= で比べているだけの出現（String((e&&e.message)||'')==='…' のような包み方も含む）
 *          (2) V.印 ? … V.message … : （条件は V.印 か V && V.印 だけ）の真の側にだけある出現で、その印の代入がスクリプト全体ですべて
 *              「new Error('日本語の直書き') で作った同じ変数への = true」であり、印を {印: …}・['印'] の形で付ける所が無い時
 *          受け口・通信の応答を入れた Error の message（印が受け口の答えで決まるものを含む）は日本語か確かめられないので数えたまま
 *   pgerr  動的: 開いた時の画面のエラー（pageerror）0件=1・1件=1/2・2件以上=0
 * 読める（見た目・アクセシビリティ）
 *   theme  <html data-su-theme> が付く。THEME_EXEMPT（CLAUDE.md で型を当てないと決めた6画面）は対象外
 *   tap44  @media の max-width が 899px 以下の塊の中に 44px の指定がある（画面の <style> と、読み込んでいる同じサイトの CSS）。PC の幅では測らない。
 *          min-width も print も含まない塊（どの幅でも効く素の指定）の 44px も数える（hasNarrow44 の説明）。
 *          数えるのは押す所の大きさの宣言（min-height・height・min-width・block-size と、名前に tap を含む色の名前の定義）だけ（width: 44px などは数えない）
 *   label  入力欄（hidden・submit・button・reset・image を除く input・select・textarea）のうち、label（for か包む形）・aria-label・
 *          aria-labelledby・title のある割合（静的な HTML だけ。JS で作る欄は数えない）。欄が0の画面は対象外
 *   ovf375 動的: 幅375px で横はみ出し 0px=1・それ以外=0
 * 速い
 *   load   動的: 開いてから load まで ≤1000ms=1・≤2000ms=2/3・≤4000ms=1/3・それより遅い=0
 *   size   HTML の大きさ ≤150KB=1・≤400KB=2/3・≤800KB=1/3・それより大きい=0
 *   sync   defer・async・type=module の無い <script src> のうち、大きい部品（SYNC_BIG_BYTES 以上・sizes が無い時は全部）の数 0=1・1=2/3・2=1/3・3以上=0
 * そろっている（共通部品）
 *   report su-report.js を読む。REPORT_EXEMPT（CLAUDE.md で除くと決めた画面＝ログイン・使える人の管理・動作記録・写しの見比べ）は対象外
 *   hdr    見出しが class="hdr"（topbar 型も可）
 *   hex    16進色の直書きの数（画面の CSS と style 属性。色の名前の定義 --名前: #… は数えない。JS は色の指定の形と '#rrggbb' の文字だけ）
 *          ≤20=1・≤80=2/3・≤200=1/3・それより多い=0
 *   dialog 止めて知らせる窓 alert(・confirm(・prompt( の数 ≤5=1・≤20=2/3・≤50=1/3・それより多い=0
 */

export const AXES = [
  { id: 'nav', label: '迷わない（導線）' },
  { id: 'safe', label: '失わない（守り）' },
  { id: 'read', label: '読める（見た目・アクセシビリティ）' },
  { id: 'fast', label: '速い' },
  { id: 'uni', label: 'そろっている（共通部品）' },
];
export const AXIS_POINTS = 20;

/* 入居者を開く画面（su-resident-hop.js の行き先のうち、このリポジトリにあって帯を出す画面）。入居者マスタは除く（上の説明） */
export const HOP_PAGES = ['facesheet.html', 'genogram.html', 'care-schedule.html', 'weight-record.html',
  'moushiokuri-viewer.html', 'training-plan.html', 'care-meeting.html'];
/* 見た目の共通の型を当てないと決めた画面（CLAUDE.md §3） */
export const THEME_EXEMPT = ['index.html', 'care-meeting.html', 'moushiokuri-viewer.html', 'shift-app.html', 'work-schedule.html', 'kotowaza-jiten.html'];
/* 「不具合を報告」ボタンを置かないと決めた画面（CLAUDE.md §3: ログイン・使える人の管理・動作記録・写しの見比べ）。端末の登録（enroll）は決まりに無いので課す */
export const REPORT_EXEMPT = ['login.html', 'accounts.html', 'perf-report.html', 'shadow-check.html'];
export const MENU_PAGE = 'index.html';
export const SYNC_BIG_BYTES = 64 * 1024;   // 大きい部品の境目（仮置き・共通部品 su-*.js はいちばん大きいものでも 50KB 未満なので数えず、外の部品の同梱物（200KB 前後）を数える）

const ITEM_DEFS = [
  ['nav', 'menu', 'メニューへ戻るリンク'],
  ['nav', 'hop', '入居者の行き来の帯（su-resident-hop.js）'],
  ['nav', 'help', '使い方へ届く'],
  ['safe', 'net', '通信の切れ目を扱う（su-net.js か online/offline）'],
  ['safe', 'errors', 'エラーの記録（su-errors.js）'],
  ['safe', 'leave', '閉じる前の確かめ（beforeunload か保存の confirm）'],
  ['safe', 'engmsg', '英語の例外文をそのまま出さない'],
  ['safe', 'pgerr', '開いた時の画面のエラー 0件（動的）'],
  ['read', 'theme', '見た目の共通の型（data-su-theme）'],
  ['read', 'tap44', '狭い幅で押す所 44px'],
  ['read', 'label', '入力欄の名前（label・aria-label）'],
  ['read', 'ovf375', '幅375pxで横はみ出し 0（動的）'],
  ['fast', 'load', '読み込みの時間（動的）'],
  ['fast', 'size', 'HTML の大きさ'],
  ['fast', 'sync', '同期で読む大きい部品の数'],
  ['uni', 'report', '不具合を報告（su-report.js）'],
  ['uni', 'hdr', '見出しの型（hdr・topbar）'],
  ['uni', 'hex', '16進色の直書きの数'],
  ['uni', 'dialog', '止めて知らせる窓の数'],
];
export const ITEMS = ITEM_DEFS.map(([axis, id, label]) => ({ axis, id, label }));

/* ── HTML を「マークアップ」「スクリプト」「スタイル」に分ける（読むだけ・実行しない）── */
export function splitHtml(html) {
  const src = String(html == null ? '' : html);
  const noComments = src.replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [];   // { attrs, body }
  const styles = [];
  let markup = noComments.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, attrs, body) => { scripts.push({ attrs: attrs || '', body: body || '' }); return ' '; });
  markup = markup.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (m, body) => { styles.push(body || ''); return ' '; });
  return { markup, scripts, styles, bytes: byteLength(src) };
}

function byteLength(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}

export function parseAttrs(s) {
  const out = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] != null ? m[5] : '';
  }
  return out;
}

/* JS のコメントを大まかに外す（/* … *\/ と、行の頭の //）。文字の中の // は残す */
export function stripJsComments(js) {
  return String(js || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, '');
}
function stripCssComments(css) { return String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' '); }

function scriptText(parts) {
  return parts.scripts.filter((s) => {
    const a = parseAttrs(s.attrs);
    if (a.src != null) return false;
    const t = (a.type || '').toLowerCase();
    return !t || /javascript|module/.test(t);
  }).map((s) => stripJsComments(s.body)).join('\n;\n');
}
function scriptSrcs(parts) {
  return parts.scripts.map((s) => parseAttrs(s.attrs)).filter((a) => a.src != null);
}
function baseName(src) { return String(src || '').split(/[?#]/)[0].split('/').pop(); }
function loadsPart(parts, js, file) {
  if (scriptSrcs(parts).some((a) => baseName(a.src) === file)) return true;
  return js.indexOf(file) >= 0;   // 画面が後から読み込む形（文字として名前がある）
}

/* 狭い幅で効く 44px があるか。44px の指定のうち、包む @media が
   (1) max-width ≤ 899px を含む、または (2) min-width も print も含まない（＝どの幅でも効く・画面の素の指定）ものを数える。
   PC の幅だけの塊（min-width）・印刷だけの塊の 44px は数えない（仮置き: (2) は依頼の「899px 以下の塊」を、
   どの幅でも効く素の指定にも広げた。メニューのように素の指定で 44px を取っている画面を落とさないため） */
export function hasNarrow44(cssText) {
  const css = stripCssComments(cssText);
  const stack = [];   // 包む塊の @media の条件（@media でない塊は null）
  let i = 0, selStart = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const pre = css.slice(selStart, i);
      const mm = pre.match(/@media\b([^{]*)$/i);
      stack.push(mm ? mm[1] : null);
      selStart = i + 1;
    } else if (ch === '}') {
      stack.pop();
      selStart = i + 1;
    } else if (ch === ';') {
      selStart = i + 1;
    } else if (ch === '4' && css.startsWith('44px', i) && !/[\d.]/.test(css[i - 1] || '') && !/[\w-]/.test(css[i + 4] || '') && stack.length
      && /(?:^|[\s;{])(min-height|height|min-width|min-block-size|block-size|--[\w-]*tap[\w-]*)\s*:[^:;{}]*$/i.test(css.slice(selStart, i))) {
      const media = stack.filter((x) => x != null);
      const narrow = media.some((p) => [...p.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].some((x) => Number(x[1]) > 0 && Number(x[1]) <= 899));
      const anyWidth = media.every((p) => !/min-width/i.test(p) && !/\bprint\b/i.test(p));
      if (narrow || anyWidth) return true;
    }
    i++;
  }
  return false;
}

/* 入力欄に名前があるか（静的な HTML だけ） */
export function labelStats(markup) {
  const forIds = new Set();
  const tags = [...String(markup || '').matchAll(/<(\/?)(label|input|select|textarea)\b([^>]*)>/gi)];
  for (const t of tags) if (!t[1] && t[2].toLowerCase() === 'label') { const a = parseAttrs(t[3]); if (a.for) forIds.add(a.for); }
  let depth = 0, total = 0, named = 0;
  const SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  for (const t of tags) {
    const name = t[2].toLowerCase();
    if (name === 'label') { depth = t[1] ? Math.max(0, depth - 1) : depth + 1; continue; }
    if (t[1]) continue;
    const a = parseAttrs(t[3]);
    if (name === 'input' && SKIP.has(String(a.type || '').toLowerCase())) continue;
    total++;
    const ok = depth > 0 || (a['aria-label'] || '').trim() || (a['aria-labelledby'] || '').trim() || (a.title || '').trim() || (a.id && forIds.has(a.id));
    if (ok) named++;
  }
  return { total, named };
}

/* 英語の例外文を画面にそのまま出す形の数（文を ; と改行で切り、同じ文の中に出す先と、数えない出現（上の説明の (1)(2)）を除いた出す元がある数） */
const ENG_SINK = /\.(textContent|innerHTML|innerText)\s*(\+?=)|\b(alert|confirm)\s*\(/;
const ENG_SOURCE = /\b(e|err|error|ex|er|e2|err2)\.message\b|\bString\(\s*(e|err|error|ex)\s*\)|['"`](Failed to fetch|Load failed)['"`]|NetworkError/g;
const JA_CHAR = /[\u3040-\u30ff\u3400-\u9fff]/;
export function countEnglishErrorExposure(js) {
  const all = String(js || '');
  const marks = japaneseErrorMarks(all);
  let n = 0;
  for (const st of all.split(/;|\n/)) {
    if (!ENG_SINK.test(st)) continue;
    let shown = false;
    for (const m of st.matchAll(ENG_SOURCE)) {
      const v = (m[0].match(/^([\w$]+)\.message$/) || [])[1] || '';
      if (onlyCompared(st, m.index, m.index + m[0].length, v)) continue;
      if (guardedByJapaneseMark(st, m, marks)) continue;
      shown = true; break;
    }
    if (shown) n++;
  }
  return n;
}
/* 出す元の出現が === ・!== ・== ・!= で比べられているだけか。
   出す元を包む形（「(」「String(」と、開き括弧のすぐ後の「同じ変数 &&」）だけを前から外し、後ろは外した「(」の数までの「)」と ||'' だけを飛ばす。
   出す先の alert(・confirm( の括弧や、別の比較の右辺の「名前 &&」は飛ばさない */
function onlyCompared(st, from, to, v) {
  let before = st.slice(0, from), opens = 0;
  const amp = v ? new RegExp('\\(\\s*' + v.replace(/\$/g, '\\$') + '\\s*&&\\s*$') : null;
  for (;;) {
    const b = before.replace(/\s+$/, '');
    if (amp && amp.test(b)) { before = b.replace(/[\w$]+\s*&&\s*$/, ''); continue; }   // 「(V &&」の V && を外す（「(」は次で数える）
    if (/String\($/.test(b)) { before = b.slice(0, -7); opens++; continue; }
    if (/\($/.test(b) && !/[\w$\]]\s*\($/.test(b)) { before = b.slice(0, -1); opens++; continue; }   // 呼び出しの括弧（alert( など）は包む形ではない
    before = b; break;
  }
  let after = st.slice(to), closes = 0;
  for (;;) {
    const a = after.replace(/^\s+/, '');
    const e = a.match(/^\|\|\s*(?:''|""|``)/);
    if (e) { after = a.slice(e[0].length); continue; }
    if (a[0] === ')' && closes < opens) { after = a.slice(1); closes++; continue; }
    after = a; break;
  }
  if (/^(?:===|!==|==|!=)(?!=)/.test(after)) return true;
  return closes === opens && /(?:===|!==|==|!=)$/.test(before);
}
/* 日本語の直書きの Error にだけ付く印の名前の集まり（上の説明の (2)）。1つでも当てはまらない代入・付け方があれば、その印は入れない */
function japaneseErrorMarks(js) {
  const ok = new Map();   // 印 → すべて日本語の Error への = true か
  for (const m of js.matchAll(/\b([\w$]+)\.([\w$]+)\s*=(?!=)\s*([^;\n]*)/g)) {
    const v = m[1], p = m[2];
    if (p === 'message' || /^(textContent|innerHTML|innerText|value|href|className|hidden|disabled|onclick)$/.test(p)) continue;
    const before = js.slice(Math.max(0, m.index - 300), m.index);
    const decl = before.match(new RegExp('(?:var|let|const)\\s+' + v.replace(/\$/g, '\\$') + '\\s*=\\s*new\\s+Error\\(\\s*([\'"])([^\'"\\\\]*)\\1\\s*\\)\\s*[;,]?\\s*$'));
    const good = /^true\b/.test(m[3].trim()) && !!decl && JA_CHAR.test(decl[2]) && !/[A-Za-z]/.test(decl[2]);
    ok.set(p, ok.has(p) ? ok.get(p) && good : good);
  }
  const marks = new Set();
  for (const [p, good] of ok) {
    if (!good) continue;
    const q = p.replace(/\$/g, '\\$');
    /* ほかの付け方（{印: …}・{印}・['印']・関数(物, '印', …)）があれば、受け口の答えで付くこともあるので入れない */
    const other = [
      '[{,]\\s*[\'"`]?' + q + '[\'"`]?\\s*:', '[{,]\\s*' + q + '\\s*[,}]',
      '\\[\\s*[\'"`]' + q + '[\'"`]\\s*\\]', '\\(\\s*[\\w$.]+\\s*,\\s*[\'"`]' + q + '[\'"`]',
    ];
    if (other.some((re) => new RegExp(re).test(js))) continue;
    marks.add(p);
  }
  return marks;
}
/* 出す元 V.message が「V.印 ?」の真の側（? の後から次の : まで）にだけあるか。
   条件は「V.印」そのものか「V && V.印」だけ（!V.印・x || V.印・'a' + V.印 のように条件が印そのものでない形は外さない）。
   条件の前に来てよいのは、文の頭・( ・, ・: ・? ・代入の = ・return だけ */
function guardedByJapaneseMark(st, m, marks) {
  const v = (m[0].match(/^([\w$]+)\.message$/) || [])[1];
  if (!v || !marks.size) return false;
  const before = st.slice(0, m.index);
  const g = before.match(/(?:^|[(,:?]|[^=!<>]=|\breturn)\s*(?:([\w$]+)\s*&&\s*)?([\w$]+)\.([\w$]+)\s*\?([^?:]*)$/);
  return !!g && g[2] === v && (g[1] == null || g[1] === v) && marks.has(g[3]);
}

export function countDialogs(js) {
  const s = String(js || '');
  const a = (s.match(/(?<![.\w$])(alert|confirm|prompt)\s*\(/g) || []).length;
  const b = (s.match(/\bwindow\.(alert|confirm|prompt)\s*\(/g) || []).length;
  const defs = (s.match(/\bfunction\s+(alert|confirm|prompt)\s*\(/g) || []).length;
  return Math.max(0, a + b - defs);
}

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
export function countHexColors(cssText, styleAttrs, js) {
  const strip = (s) => stripCssComments(s).replace(/--[\w-]+\s*:[^;}]*/g, ' ');
  let n = (strip(cssText).match(HEX) || []).length;
  for (const v of styleAttrs || []) n += (strip(v).match(HEX) || []).length;
  const j = String(js || '');
  const seen = new Set();   // 同じ # を2回数えない（色の指定の形と '#rrggbb' の文字の両方に当たる時）
  for (const m of j.matchAll(/(?:color|background|border[\w-]*|fill|stroke)\s*[:=]\s*['"]?\s*(#)(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/gi)) seen.add(m.index + m[0].lastIndexOf('#'));
  for (const m of j.matchAll(/['"`]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})['"`]/g)) seen.add(m.index + 1);
  n += seen.size;
  return n;
}

function step(n, limits, fracs) { for (let i = 0; i < limits.length; i++) if (n <= limits[i]) return fracs[i]; return 0; }
const STEP3 = [1, 2 / 3, 1 / 3];
function bool(ok, detail) { return { frac: ok ? 1 : 0, detail }; }
const NA = (detail) => ({ status: '対象外', detail });
const UNMEASURED = { status: '未測定', detail: '測れなかった' };
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/* その画面のための部品か（ファイル名が「画面名.js」か「画面名-」で始まる .js。共通部品 su-*.js は画面名が su- で始まっても入れない）。
   「-」の境目を求めるのは、名前の頭がたまたま同じ別の部品（例 login.html に対する loginx.js のような形）を入れないため。
   ほかの画面の部品を借りる形（ats.html・admission-flow.html が読む staff-master-calc.js）は、借りた画面の部品として数えない */
export function isOwnScript(page, file) {
  const stem = String(page || '').replace(/\.html$/i, '');
  const f = baseName(file);
  if (!stem || !/\.js$/i.test(f) || /^su-/i.test(f)) return false;
  return f === stem + '.js' || f.startsWith(stem + '-');
}

/* 1画面を採点する。opts.css: 読み込んでいる同じサイトの CSS（名前→中身）・opts.sizes: 部品の大きさ（名前→バイト）・
   opts.scripts: 画面が読む同じサイトのスクリプト（名前→中身・使うのはその画面のための部品だけ＝isOwnScript）・opts.dynamic: 動的に測った値 */
export function scorePage(name, html, opts = {}) {
  const page = String(name || '');
  const parts = splitHtml(html);
  const js = scriptText(parts);
  const raw = String(html == null ? '' : html).replace(/<!--[\s\S]*?-->/g, '');
  const dyn = (opts && opts.dynamic) || {};
  const linkedCss = (opts && opts.css && typeof opts.css === 'object') ? Object.values(opts.css).map(String).join('\n') : '';
  const sizes = (opts && opts.sizes && typeof opts.sizes === 'object') ? opts.sizes : null;
  const styleAttrs = [...parts.markup.matchAll(/\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] != null ? m[2] : m[3]);

  const hasMenuLink = /href\s*=\s*\\?["'](?:\.\/index\.html|index\.html|\.\/)(?:[?#][^"'\\]*)?\\?["']/i.test(raw)
    || /location(?:\.href)?\s*=\s*['"`](?:\.\/)?index\.html/i.test(js) || /location\.(?:assign|replace)\(\s*['"`](?:\.\/)?index\.html/i.test(js);
  const hasHelpLink = /help\.html/i.test(raw);
  const r = {};

  /* 迷わない */
  r.menu = page === MENU_PAGE ? NA('メニューそのもの') : bool(hasMenuLink, hasMenuLink ? 'あり' : 'なし');
  r.hop = HOP_PAGES.includes(page) ? bool(loadsPart(parts, js, 'su-resident-hop.js'), '') : NA('入居者を開く画面ではない');
  if (page === MENU_PAGE) r.help = bool(hasHelpLink, hasHelpLink ? '使い方へのリンクあり' : 'なし');
  /* メニュー以外は、使い方への直のリンクがあれば合格。無い時はメニューへ戻る道（menu の項目）で数えるので、ここでは対象外にする（同じ欠けを2回数えない） */
  else r.help = hasHelpLink ? bool(true, '使い方へのリンクあり') : NA('メニューへ戻る道で数える');

  /* 失わない */
  const ownNet = /addEventListener\(\s*['"`](online|offline)['"`]|navigator\.onLine|\bon(online|offline)\s*=/.test(js);
  r.net = bool(loadsPart(parts, js, 'su-net.js') || ownNet, loadsPart(parts, js, 'su-net.js') ? 'su-net.js' : ownNet ? '画面が自分で扱う' : 'なし');
  r.errors = bool(loadsPart(parts, js, 'su-errors.js'), '');
  const editable = labelStats(parts.markup).total > 0 || /contenteditable/i.test(parts.markup)
    || /<(input|textarea|select)\b|createElement\(\s*['"`](input|textarea|select)['"`]|contentEditable/i.test(js);
  if (!editable) r.leave = NA('入力欄が無い');
  else {
    /* その画面のための部品（isOwnScript）は beforeunload だけを見る。confirm の語の決め方は画面の中のスクリプトだけに当てる
       （部品の書き出し・消す処理の confirm の「保存」「消え」で「あり」にしない・代表者の決定 2026-11-12 推奨1・仮置き）。共通部品・借りた部品は見ない */
    const own = opts && opts.scripts && typeof opts.scripts === 'object'
      ? Object.keys(opts.scripts).filter((k) => isOwnScript(page, k)).map((k) => stripJsComments(opts.scripts[k])).join('\n;\n') : '';
    const ok = /beforeunload/i.test(js) || /beforeunload/i.test(own) || /onbeforeunload/i.test(parts.markup)
      || /\bconfirm\s*\([^)]{0,200}?(保存|破棄|変更|閉じ|消え)/.test(js);
    r.leave = bool(ok, ok ? 'あり' : 'なし');
  }
  const eng = countEnglishErrorExposure(js);
  r.engmsg = { frac: step(eng, [0, 2, 5], STEP3), detail: eng + '件' };
  const pe = num(dyn.pageErrors);
  r.pgerr = pe == null ? UNMEASURED : { frac: pe === 0 ? 1 : pe === 1 ? 0.5 : 0, detail: pe + '件' };

  /* 読める */
  r.theme = THEME_EXEMPT.includes(page) ? NA('型を当てないと決めた画面')
    : bool(/<html\b[^>]*\sdata-su-theme\b/i.test(parts.markup), '');
  const t44 = hasNarrow44(parts.styles.join('\n') + '\n' + linkedCss);
  r.tap44 = bool(t44, t44 ? 'あり' : 'なし');
  const ls = labelStats(parts.markup);
  r.label = ls.total === 0 ? NA('静的な入力欄が無い') : { frac: ls.named / ls.total, detail: ls.named + '/' + ls.total };
  const ov = num(dyn.overflowPx);
  r.ovf375 = ov == null ? UNMEASURED : bool(ov <= 0, ov + 'px');

  /* 速い */
  const lm = num(dyn.loadMs);
  r.load = lm == null ? UNMEASURED : { frac: step(lm, [1000, 2000, 4000], STEP3), detail: Math.round(lm) + 'ms' };
  const kb = parts.bytes / 1024;
  r.size = { frac: step(kb, [150, 400, 800], STEP3), detail: Math.round(kb) + 'KB' };
  const sync = scriptSrcs(parts).filter((a) => a.defer == null && a.async == null && String(a.type || '').toLowerCase() !== 'module');
  const big = sizes ? sync.filter((a) => (Number(sizes[baseName(a.src)]) || 0) >= SYNC_BIG_BYTES) : sync;
  r.sync = { frac: step(big.length, [0, 1, 2], STEP3), detail: big.length + '本' };

  /* そろっている */
  r.report = REPORT_EXEMPT.includes(page) ? NA('ボタンを置かないと決めた画面') : bool(loadsPart(parts, js, 'su-report.js'), '');
  const hdr = [...parts.markup.matchAll(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/gi)]
    .some((m) => String(m[2] != null ? m[2] : m[3]).split(/\s+/).some((c) => c === 'hdr' || c === 'topbar'));
  r.hdr = bool(hdr, '');
  const hex = countHexColors(parts.styles.join('\n'), styleAttrs, js);
  r.hex = { frac: step(hex, [20, 80, 200], STEP3), detail: hex + '件' };
  const dl = countDialogs(js);
  r.dialog = { frac: step(dl, [5, 20, 50], STEP3), detail: dl + '件' };

  return summarize(page, r);
}

/* まとめ（項目ごとの結果 r から軸の点と合計を出す。対象外・未測定の項目は数えず、課した項目だけで比例で出す） */
export function summarize(page, r) {
  const axes = {};
  let sum = 0, applied = 0;
  for (const ax of AXES) {
    const items = ITEMS.filter((it) => it.axis === ax.id).map((it) => {
      const v = r[it.id] || { status: '未測定' };
      if (v.status) return { id: it.id, label: it.label, status: v.status, frac: null, detail: v.detail || '' };
      const f = Math.max(0, Math.min(1, Number(v.frac) || 0));
      return { id: it.id, label: it.label, status: f >= 1 ? '合格' : f <= 0 ? '不合格' : '一部', frac: round(f, 3), detail: v.detail || '' };
    });
    const used = items.filter((it) => it.frac != null);
    const score = used.length ? round(AXIS_POINTS * used.reduce((a, it) => a + it.frac, 0) / used.length, 1) : null;
    axes[ax.id] = { label: ax.label, score, items };
    if (score != null) { sum += score; applied++; }
  }
  const total = applied ? round(sum / (AXIS_POINTS * applied) * 100, 1) : null;
  return { page, total, axes, measuredAxes: applied };
}

function round(v, d) { const k = Math.pow(10, d); return Math.round(v * k) / k; }

/* 同じサイトの部品の名前の一覧（score.mjs が CSS・大きさを読むため）。外の住所は返さない */
export function localAssets(html) {
  const parts = splitHtml(html);
  const local = (u) => u && !/^([a-z]+:)?\/\//i.test(u) && !/^data:/i.test(u);
  const scripts = scriptSrcs(parts).map((a) => a.src.split(/[?#]/)[0]).filter(local);
  const css = [...parts.markup.matchAll(/<link\b([^>]*)>/gi)].map((m) => parseAttrs(m[1]))
    .filter((a) => /stylesheet/i.test(a.rel || '') && a.href).map((a) => a.href.split(/[?#]/)[0]).filter(local);
  return { scripts: [...new Set(scripts)], css: [...new Set(css)] };
}

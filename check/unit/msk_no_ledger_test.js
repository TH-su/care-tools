/* 申送ビューア 出来事（events）を「AI 要約を返さない」指定（noLedger）で読む試験（2026-10-28 新設）
   実行: node check/unit/msk_no_ledger_test.js
   対象を差し替える: MSK_HTML=/tmp/変異版.html node check/unit/msk_no_ledger_test.js（変異試験用）

   守ること:
     1. 要約を出さない間（SHOW_AI_SUMMARY=false）は、出来事を読む2か所（期間の読み込み・日付別）が本文に noLedger:'1' を付ける
     2. 送る形（text/plain の POST・redirect:'follow'・合言葉は本文）は今までと同じで、足すのは noLedger の1項目だけ
     3. 新しい GAS（要約の欄が無い応答）でも古い GAS（知らない引数を無視して要約入りで返す）でも、画面が受け取る出来事は同じで要約は空
     4. 要約を出す設定に戻した時（SHOW_AI_SUMMARY=true）は noLedger を付けない（要約が届かなくなるのを防ぐ）
     5. 入居者マスタの「薬の変更候補」は同じ GAS の events の要約を使うので、そちらの読み取りには noLedger を付けない
   ★このファイルは公開リポジトリの check/unit にある。氏名・接続先・合言葉は架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html'), 'utf8');
const MASTER = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}

function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(src, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return src.slice(start, end + 1);
}
function grabVar(name) {
  const m = SRC.match(new RegExp('\\nvar ' + name + ' = [^;]+;'));
  if (!m) throw new Error('定数が見つかりません: ' + name);
  return m[0];
}
/* 日付・時刻の整え（z2〜normRows のひと続き。間の定数 RE_ISO_UTC なども一緒に取る） */
function grabNorm() {
  const a = SRC.indexOf('\nfunction z2(');
  const b = SRC.indexOf('\nfunction normRows(');
  if (a < 0 || b < a) throw new Error('日付の整えの範囲が見つかりません');
  return SRC.slice(a, b) + grabFn(SRC, 'normRows');
}
/* SHOW_AI_SUMMARY は値を差し替えられるように var の行だけ置き換える */
function grabShow(v) { return v === undefined ? grabVar('SHOW_AI_SUMMARY') : '\nvar SHOW_AI_SUMMARY = ' + v + ';'; }

/* 架空の GAS。old=true は noLedger を知らない（要約入りで返す）、false は noLedger:'1' の時だけ ledger の欄を外す */
const EVENTS = [
  { key: 'k1', date: '2026-10-12', facility: 'F', shift: 'day', row: 3, name: '架空 一郎', kind: 'resident', time: '09:30', body: '朝食全量', reporter: '記A' },
  { key: 'k2', date: '2026-10-13', facility: 'F', shift: 'night', row: 7, name: '架空 花子', kind: 'resident', time: '22:00', body: '入眠良好', reporter: '記B' }
];
const LEDGER = [{ key: 'L1', date: '2026-10-12', facility: 'F', name: '架空 一郎', categories: ['meal'], time: '09:30', summary: '架空の要約', reporter: '記A' }];
function gasAnswer(old, body) {
  const o = { ok: true, from: body.from || '2026-10-01', to: body.to || '2026-10-14', events: EVENTS, ledger: LEDGER,
    ingestedDates: ['2026-10-12', '2026-10-13'], lastTick: '2026-10-14T00:00:00Z', lastFails: '' };
  if (!old && body.noLedger === '1') delete o.ledger;
  return o;
}

function box(old, show) {
  const sent = [];
  const sb = {
    console, JSON, String, Object, Date, Error, Promise, setTimeout, clearTimeout, Math, Number, RegExp, isFinite,
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    loadCfg: () => ({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', token: 'tok-example' }),
    fetch: (url, opt) => {
      sent.push({ url, opt, body: JSON.parse(opt.body) });
      return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(gasAnswer(old, JSON.parse(opt.body)))) });
    }
  };
  vm.createContext(sb);
  vm.runInContext([grabVar('API_GET_RETRY'), grabShow(show), grabFn(SRC, 'ledgerRows'), grabFn(SRC, 'evParams'),
    grabNorm(),
    grabFn(SRC, 'fetchTO'), grabFn(SRC, 'parseJson'), grabFn(SRC, 'apiGet'), grabFn(SRC, 'apiGetOnce')].join('\n'), sb);
  return { sb, sent };
}
/* 画面が応答を受け取った後の扱い（load と日付別の両方が normRows(res.events)・ledgerRows(res.ledger) を使う） */
const take = (b, res) => ({ events: JSON.stringify(b.sb.normRows(res.events)), ledger: JSON.stringify(b.sb.ledgerRows(res.ledger)) });
/* 画面の2か所と同じ呼び方。呼び方の文が変わったら下の 1 の照合で落ちる */
const CALL_RANGE = "apiGet('events', evParams({ from:r.from, to:r.to }))";
const CALL_DAY = "apiGet('events', evParams({ from:d, to:d }))";
const callRange = (b) => b.sb.apiGet('events', b.sb.evParams({ from: '2026-10-01', to: '2026-10-14' }));
const callDay = (b) => b.sb.apiGet('events', b.sb.evParams({ from: '2026-10-12', to: '2026-10-12' }));

(async () => {
  console.log('— 1. 出来事を読む所は全部 evParams を通す');
  {
    const all = SRC.match(/apiGet\('events'[^;\n]*/g) || [];
    t('出来事を読む所は2か所', all.length === 2, all);
    t('期間の読み込みは evParams を通す', SRC.indexOf(CALL_RANGE) >= 0);
    t('日付別は evParams を通す', SRC.indexOf(CALL_DAY) >= 0);
    t('画面の既定は要約を出さない（SHOW_AI_SUMMARY=false）', /\nvar SHOW_AI_SUMMARY = false;/.test(SRC));
  }

  console.log('\n— 2. 送る本文と形');
  for (const [name, call, want] of [['期間の読み込み', callRange, { action: 'events', from: '2026-10-01', to: '2026-10-14', noLedger: '1', token: 'tok-example' }],
    ['日付別', callDay, { action: 'events', from: '2026-10-12', to: '2026-10-12', noLedger: '1', token: 'tok-example' }]]) {
    const b = box(false);
    await call(b);
    const s = b.sent[0];
    t(name + ': 本文は action・期間・noLedger:\'1\'・合言葉だけ', JSON.stringify(s.body) === JSON.stringify(want), s.body);
    t(name + ': text/plain の POST・redirect:follow（形は今までどおり）', s.opt.method === 'POST' && s.opt.redirect === 'follow'
      && JSON.stringify(s.opt.headers) === JSON.stringify({ 'Content-Type': 'text/plain;charset=utf-8' }), s.opt);
    t(name + ': URL に合言葉・引数を載せない', s.url === 'https://script.google.com/macros/s/EXAMPLE/exec', s.url);
  }
  {
    const b = box(false);
    await b.sb.apiGet('measures', { from: '2026-10-01', to: '2026-10-14' });
    t('バイタル（measures）には noLedger を付けない', !('noLedger' in b.sent[0].body), b.sent[0].body);
  }

  console.log('\n— 3. 新しい GAS でも古い GAS でも画面が受け取るものは同じ');
  for (const [name, call] of [['期間の読み込み', callRange], ['日付別', callDay]]) {
    const bn = box(false), bo = box(true);
    const rn = await call(bn), ro = await call(bo);
    t(name + ': 新しい GAS は要約の欄を返さない', !('ledger' in rn), Object.keys(rn));
    t(name + ': 古い GAS は要約入りで返す（知らない引数を無視）', Array.isArray(ro.ledger) && ro.ledger.length === 1);
    const tn = take(bn, rn), to = take(bo, ro);
    t(name + ': 出来事は新旧で同じ・2件', tn.events === to.events && JSON.parse(tn.events).length === 2, [tn.events, to.events]);
    t(name + ': 要約は新旧とも空', tn.ledger === '[]' && to.ledger === '[]', [tn.ledger, to.ledger]);
  }

  console.log('\n— 4. 要約を出す設定に戻した時は noLedger を付けない');
  {
    const b = box(false, 'true');
    const r = await callRange(b);
    t('SHOW_AI_SUMMARY=true: 本文に noLedger が無い', !('noLedger' in b.sent[0].body), b.sent[0].body);
    t('SHOW_AI_SUMMARY=true: 要約が届いて画面に渡る', JSON.parse(take(b, r).ledger).length === 1);
  }

  console.log('\n— 5. 入居者マスタの薬の変更候補は要約入りで読む');
  {
    const fn = grabFn(MASTER, 'mcMskEvents_');
    t('入居者マスタの events の読み取りに noLedger が無い', fn.indexOf("action:'events'") >= 0 && fn.indexOf('noLedger') < 0);
    t('入居者マスタは要約（ledger）が無い応答を失敗とみなす（だから付けてはいけない）', /Array\.isArray\(d\.ledger\)/.test(fn));
  }

  console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ✗ 例外: ' + (e && e.stack || e)); process.exit(1); });

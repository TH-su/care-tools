/* デイ利用表・接続設定：画面だけ文字を1段大きくした分（2026-11-08 商用化の点検）が、印刷の CSS に入っていないことを確かめる。
   実物の HTML の <style> を読み、@media screen / @media print のかたまりを切り出して比べる。
   - 上げた文字（0.8125rem）は @media screen の中だけにある。@media print の中には無い
   - デイ利用表の上書きは全部 body:not(.su-printing) 付き（su-print の採寸窓では screen の規則が外れないため、
     付けないと採寸の時だけ文字が大きくなり紙の文字サイズ・枚数が変わる）
   - 基の値（印刷の既定値・JS の基準と一致させる契約）はそのまま残っている
   対象 HTML は環境変数 DAYCARE_ROSTER_HTML / CONNECTION_SETTINGS_HTML で差し替えられる（直す前の版で落ちることを確かめるため）。 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DCR = process.env.DAYCARE_ROSTER_HTML || path.join(ROOT, 'daycare-roster.html');
const CS = process.env.CONNECTION_SETTINGS_HTML || path.join(ROOT, 'connection-settings.html');

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

/* 最初の <style>…</style> の中身（コメントは消す） */
function styleOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('<style>'), b = src.indexOf('</style>', a);
  return { src: src, css: src.slice(a + 7, b).replace(/\/\*[\s\S]*?\*\//g, '') };
}
/* @media <条件> { … } のかたまりを全部切り出す（入れ子の { } を数える） */
function mediaBlocks(css) {
  const out = [];
  const re = /@media\s*([^{]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    let i = re.lastIndex, depth = 1;
    for (; i < css.length && depth; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1), start: m.index, end: i });
    re.lastIndex = i;
  }
  return out;
}
/* @media のかたまりを除いた外側（基の規則） */
function outside(css, blocks) {
  let s = '', p = 0;
  blocks.forEach(function (b) { s += css.slice(p, b.start); p = b.end; });
  return s + css.slice(p);
}
/* かたまりの中の「セレクタ { 宣言 }」を並べる */
function rulesOf(body) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) out.push({ sel: m[1].trim(), decl: m[2].trim() });
  return out;
}

/* ── 1. デイ利用表 ── */
console.log('■ デイ利用表（daycare-roster.html）');
{
  const { src, css } = styleOf(DCR);
  const blocks = mediaBlocks(css);
  const screens = blocks.filter(function (b) { return b.cond === 'screen'; });
  const prints = blocks.filter(function (b) { return /(^|,)\s*print/.test(b.cond); });
  t('1-1 @media screen のかたまりが1つある', screens.length === 1, screens.length);
  const sc = screens[0] ? screens[0].body : '';
  const rules = rulesOf(sc);
  const sels = [];
  rules.forEach(function (r) { r.sel.split(',').forEach(function (s) { sels.push(s.trim()); }); });
  t('1-2 上書きのセレクタは全部 body:not(.su-printing) で始まる（採寸窓・印刷では効かない）',
    sels.length > 0 && sels.every(function (s) { return s.indexOf('body:not(.su-printing) ') === 0; }),
    sels.filter(function (s) { return s.indexOf('body:not(.su-printing) ') !== 0; }));
  /* 上げた値は 13px（0.8125rem）以上。var() で表の変数に連動させるものは許す */
  const sizes = [];
  rules.forEach(function (r) {
    r.decl.split(';').forEach(function (d) {
      const kv = d.split(':');
      if (kv.length < 2) return;
      const k = kv[0].trim(), v = kv.slice(1).join(':').trim();
      if (k === 'font-size' || k === '--sh-fs' || k === '--sh-tm' || k === '--ro-fs') sizes.push(k + ':' + v);
    });
  });
  const small = sizes.filter(function (kv) {
    const v = kv.slice(kv.indexOf(':') + 1);
    if (/^var\(--(sh-fs|ro-fs)\)$/.test(v)) return false;
    const m = /^([\d.]+)rem$/.exec(v);
    return !m || parseFloat(m[1]) < 0.8125;
  });
  t('1-3 上書きの文字は全部 0.8125rem 以上（または表の変数に連動）', sizes.length >= 10 && small.length === 0, small);
  ['table.roster { --ro-fs: 0.8125rem; }', 'table.sheet { --sh-fs: 0.8125rem; --sh-tm: 0.8125rem; }',
   '.legend { font-size: 0.8125rem; }', '.note-below { font-size: 0.8125rem; }', '.hosp-box { font-size: 0.8125rem; }']
    .forEach(function (want, i) { t('1-4.' + (i + 1) + ' 画面だけの上書きがある: ' + want, sc.indexOf('body:not(.su-printing) ' + want) >= 0); });
  t('1-5 @media print の中に su-printing・上げた値（0.8125rem）が無い',
    prints.length > 0 && prints.every(function (b) { return b.body.indexOf('su-printing') < 0 && b.body.indexOf('0.8125rem') < 0; }));
  const base = outside(css, blocks);
  t('1-6 外側に body:not(.su-printing) が無い（素の規則は大きくしていない）', base.indexOf('su-printing') < 0);
  t('1-7 帳票の表の基の値（--sh-fs:11px・--sh-tm:10px）が残る', /table\.sheet\s*\{\s*--sh-fs:\s*11px;\s*--sh-tm:\s*10px;\s*\}/.test(base));
  t('1-8 利用表の基の値（--ro-fs:0.75rem）が残る', /--ro-fs:\s*0\.75rem;/.test(base));
  t('1-9 JS の基準（SHEET_FS_BASE=11・SHEET_TM_BASE=10・ROSTER_FS_BASE=12）が基の CSS と一致したまま',
    src.indexOf('const SHEET_FS_BASE = 11, SHEET_TM_BASE = 10;') >= 0 && src.indexOf('const ROSTER_FS_BASE = 12,') >= 0);
  [['.legend', '0.6875rem'], ['.note-below', '0.6875rem'], ['.hosp-box', '0.75rem'], ['.star', '0.6875rem']]
    .forEach(function (p, i) {
      const r = rulesOf(base).filter(function (x) { return x.sel === p[0]; });
      t('1-10.' + (i + 1) + ' 基の ' + p[0] + ' は ' + p[1] + ' のまま（紙の文字は変えない）',
        r.length > 0 && r.some(function (x) { return x.decl.indexOf('font-size: ' + p[1]) >= 0; }));
    });
  const sp = fs.readFileSync(path.join(ROOT, 'su-print.js'), 'utf8');
  t('1-11 su-print は採寸の前に body へ su-printing を付ける（ガードが効く前提）',
    /document\.body\.classList\.add\('su-printing'/.test(sp) && sp.indexOf('printRulesOn();') > sp.indexOf("document.body.classList.add('su-printing'"));
}

/* ── 2. 接続設定 ── */
console.log('■ 接続設定（connection-settings.html）');
{
  const { css } = styleOf(CS);
  const blocks = mediaBlocks(css);
  const screens = blocks.filter(function (b) { return b.cond === 'screen'; });
  t('2-1 @media screen のかたまりが1つある', screens.length === 1, screens.length);
  const sc = screens[0] ? screens[0].body : '';
  ['.cd .apps', '.badge', '.fld label', '.wb', '.foot'].forEach(function (s, i) {
    t('2-2.' + (i + 1) + ' 画面だけ ' + s + ' を 0.8125rem にする', sc.indexOf(s + ' { font-size: 0.8125rem; }') >= 0);
  });
  const prints = blocks.filter(function (b) { return /(^|,)\s*print/.test(b.cond); });
  t('2-3 @media print の中に 0.8125rem が無い', prints.every(function (b) { return b.body.indexOf('0.8125rem') < 0; }));
  const base = rulesOf(outside(css, blocks));
  [['.cd .apps', '0.75rem'], ['.badge', '0.71875rem'], ['.fld label', '0.78125rem'], ['.wb', '0.75rem'], ['.foot', '0.71875rem']]
    .forEach(function (p, i) {
      t('2-4.' + (i + 1) + ' 基の ' + p[0] + ' は ' + p[1] + ' のまま',
        base.some(function (x) { return x.sel === p[0] && x.decl.indexOf('font-size: ' + p[1]) >= 0; }));
    });
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);

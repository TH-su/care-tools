/* 貼り薬カレンダー（patch-calendar.html）の職員に見える文の試験（2026-11-02 新設・品質改善 第3期 便6）
   実行: node check/unit/patch_staff_words_test.js
   対象を差し替える: PATCH_HTML=/tmp/変異版.html node check/unit/patch_staff_words_test.js（変異試験用）

   守ること:
     1. 名簿がこの端末に無い時は、次にすることの案内を出す（事務所PCは接続設定へのリンクと欄の名前・現場の端末は頼みもリンクも出さず、手入力で使えることだけ）
     2. 名簿がある時は案内を出さない。案内は外からの値を入れず、リンクは createElement で作る（innerHTML を使わない）
     3. 案内と画面だけの目印の説明は紙に出さない（.ctl noprint の中・#sheet の外）
     4. 画面だけの目印（今日の日付の枠）に説明がある
     5. 職員に見える文（HTML の本文・画面に出す文字の代入）に技術用語が無い
     6. サーバーに届かない時の帯の文（本人指示 2026-10-25 の文）は変えていない
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.PATCH_HTML || path.join(ROOT, 'patch-calendar.html'), 'utf8');
const CS = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) return '';
  return SRC.slice(start, scanBlock(SRC, start) + 1);
}
const JARGON = /GAS|Supabase|JSON|\bKV\b|トークン|token|\bAPI\b|localStorage|HTTP|CORS|RLS|fetch|null|undefined|Web ?App|\/exec|スクリプトプロパティ|doGet|e\.message/i;

/* 小さな偽の画面（rshint だけを持つ） */
function fakeDom() {
  function node(tag) {
    return {
      tagName: tag, children: [], hidden: false, href: '', _t: '',
      appendChild(c) { this.children.push(c); return c; },
      set textContent(v) { this._t = String(v); this.children = []; },
      get textContent() { return this._t + this.children.map(c => c.textContent).join(''); }
    };
  }
  const h = node('p'); h.hidden = false;   /* 隠すのは関数の役目（前の状態に頼らない） */
  return {
    h,
    document: {
      getElementById: id => (id === 'rshint' ? h : null),
      createElement: tag => node(tag),
      createTextNode: s => ({ textContent: String(s), nodeType: 3 })
    }
  };
}
function runHint(role, rosterLen) {
  const d = fakeDom();
  const box = {
    document: d.document,
    localStorage: { getItem: k => (k === 'su_device_role' ? role : null) },
    roster: new Array(rosterLen).fill({ id: 'r', name: 'x' })
  };
  vm.createContext(box);
  vm.runInContext(grabFn('pcIsField') + '\n' + grabFn('rosterHint'), box);
  vm.runInContext('rosterHint()', box);
  return d.h;
}

console.log('\n— 1・2. 名簿が無い時の案内 —');
{
  const fn = grabFn('rosterHint');
  t('★案内を出す関数がある（rosterHint）', !!fn);
  t('名簿を描き直すたびに案内を取り直す（fillRoster から呼ぶ）', /function fillRoster\(\)[\s\S]*?rosterHint\(\);\s*\n\}/.test(SRC));
  if (fn) {
    const off = runHint('office', 0);
    const link = off.children.find(c => c.tagName === 'a');
    t('★事務所PC: 案内が出る', off.hidden === false);
    t('★事務所PC: 接続設定へのリンク', !!link && link.href === 'connection-settings.html' && link.textContent === '接続設定');
    t('★事務所PC: 何が足りないか・次にすること（ログインが先）を書く', /入居者の名簿がありません/.test(off.textContent) && /事務所のアカウントでログインして、この端末で入居者マスタを開くと/.test(off.textContent) && /URL と合言葉を入れてください/.test(off.textContent));
    t('★事務所PC: 欄の名前は接続設定の見出しと同じ「入居者マスタ・フェイスシート」', off.textContent.indexOf('「入居者マスタ・フェイスシート」の欄') >= 0 && /title:\s*['"]入居者マスタ・フェイスシート['"]/.test(CS));
    t('事務所PC（用途の記録なし）でもリンクを出す', !!runHint(null, 0).children.find(c => c.tagName === 'a'));
    const fld = runHint('field', 0);
    t('★現場の端末: 案内が出る・手入力で使えることだけを書く', fld.hidden === false && fld.textContent === 'この端末では名簿を使いません。入居者名を手で入れて使えます。');
    t('★現場の端末: 果たせない頼み（知らせる・開く・入れる）を書かない', !/知らせ|ログイン|入居者マスタを開|入れてください/.test(fld.textContent));
    t('★現場の端末: 接続設定へのリンクを出さない', !fld.children.find(c => c.tagName === 'a') && fld.textContent.indexOf('接続設定') < 0);
    t('名簿がある時は案内を隠す（事務所PC・現場とも）', runHint('office', 3).hidden === true && runHint('field', 2).hidden === true && runHint('office', 3).textContent === '');
    t('案内に技術用語が無い', !JARGON.test(off.textContent) && !JARGON.test(fld.textContent));
    t('innerHTML を使わない', fn.indexOf('innerHTML') < 0);
  }
}

console.log('\n— 3・4. 紙に出さない・目印の説明 —');
{
  const ctl = SRC.slice(SRC.indexOf('<div class="ctl noprint">'), SRC.indexOf('<div class="wrap">'));
  t('★案内の欄は .ctl noprint の中・紙（#sheet）の外', ctl.indexOf('<p class="hint" id="rshint" role="status" hidden></p>') > 0 && SRC.indexOf('id="rshint"') < SRC.indexOf('id="sheet"'));
  t('★今日の日付の枠の説明が画面だけにある', ctl.indexOf('今日の日付のますを<b>青い枠</b>で囲んでいます（紙には出ません）') > 0);
  t('紙の中に目印の説明を入れていない', SRC.slice(SRC.indexOf('<div class="sheet" id="sheet">')).indexOf('青い枠') < 0);
  t('今日の枠は今も画面だけ（印刷で消す）', /@media print \{[\s\S]*?\.cell\.today \{ box-shadow: none; \}/.test(SRC));
}

console.log('\n— 5. 職員に見える文に技術用語が無い —');
{
  const body = SRC.slice(SRC.indexOf('<body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
  const hit = (body.match(JARGON) || [])[0];
  t('HTML の本文（タグ・属性・コメントを除く）に技術用語が無い', !hit, hit);
  /* 画面に出す文字の代入（textContent・ioShow・confirm・createTextNode）の文字列 */
  const sinks = [];
  const re = /(?:textContent\s*=|ioShow\(|confirm\(|createTextNode\(|why:\s*)([^;\n]*)/g;
  let m;
  while ((m = re.exec(SRC))) {
    (m[1].match(/'(?:[^'\\]|\\.)*'/g) || []).forEach(s => sinks.push(s));
  }
  const bad = sinks.filter(s => JARGON.test(s));
  t('画面に出す文字の代入に技術用語が無い（' + sinks.length + '件を確認）', sinks.length > 20 && bad.length === 0, bad);
}

console.log('\n— 6. 帯の文は変えない —');
{
  t('★サーバーに届かない時の帯の文はそのまま（本人指示 2026-10-25）', /<p class="hint warn svband noprint" id="svband" role="status" hidden>サーバーに届かないため、この端末の控えを表示しています<\/p>/.test(SRC));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);

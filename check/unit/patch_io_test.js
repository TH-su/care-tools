/* 貼り薬カレンダー（patch-calendar.html）の「端末を替える時の書き出し・読み込み」の試験（2026-10-11 新設・監査10月版 第2版 貼り薬カレンダー）
   実行: node check/unit/patch_io_test.js
   対象を差し替える: PATCH_HTML=/tmp/変異版.html node check/unit/patch_io_test.js（変異試験用）

   守ること:
     ①書き出すのは開始日・場所・前日の場所・設定した人と時刻・入居者ID だけ（氏名は入れない）。形の違う設定は書き出さない
     ②読み込みは中身を確かめる（別の画面のファイル・形の違う行は読まない）
     ③同じ方の設定が両方にある時は、設定した時刻が新しい方を採る（この端末の方が新しい設定は上書きしない）
     ④読み込む前に件数を見せ、押した時だけ書く。押した時点で取り直して判断する
     ⑤この端末の保存が読めない時は書かない（他の方の設定を空で消さない）
     ⑥欄は紙に出さない（.ctl の中）
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.PATCH_HTML || path.join(ROOT, 'patch-calendar.html'), 'utf8');

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
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  return SRC.slice(start, scanBlock(SRC, start) + 1);
}

/* 純粋な部分を動かす（日付・番号・設定した人の検証は本物を使う） */
const box = { Date, JSON, Object, String, Number, isNaN, Math };
vm.createContext(box);
/* 貼る場所は8か所（SITES の中身は使わない＝数だけ。CYCLE は本物の式のまま） */
vm.runInContext("var IO_APP = 'patch-calendar', IO_VER = 1, IO_MAX_BYTES = 1024 * 1024; var SITES = new Array(8);\n" + (SRC.match(/\nvar CYCLE[^\n]*/) || [''])[0] + '\n' +
  ['utcNoon', 'parseISODate', 'parseNo', 'pcSetByOf', 'ioEntry', 'ioExportObj', 'ioParse', 'ioNewer', 'ioPlan'].map(grabFn).join('\n'), box);
const J = JSON.stringify;
const PD = (iso) => box.parseISODate(iso);

console.log('\n— ① 書き出し —');
{
  const all = {
    r1: { start: '2026-10-01', no: 2, prev: 1, by: '事務所PC', at: '2026-10-01T09:00:00.000Z', name: '見本 甲', nm: '見本 甲' },   /* 余分な欄（氏名など）が混ざっていても書き出さない */
    r2: { start: 'こわれた', no: 2, prev: 0 },
    r3: { start: '2026-09-15', no: 1, prev: 0 }
  };
  const legacy = { start: PD('2026-08-01'), no: 3, prev: 2, by: '現場の端末', at: '2026-08-01T00:00:00.000Z' };
  const o = box.ioExportObj(all, legacy, 'r1');
  t('画面の名前と版を付ける', o.app === 'patch-calendar' && o.v === 1 && !isNaN(Date.parse(o.exportedAt)));
  t('形の正しい設定だけ書き出す（壊れた r2 は入れない）', J(Object.keys(o.res).sort()) === J(['r1', 'r3']));
  t('中身は開始日・場所・前日の場所・設定した人と時刻だけ', J(o.res.r1) === J({ start: '2026-10-01', no: 2, prev: 1, by: '事務所PC', at: '2026-10-01T09:00:00.000Z' }) && J(o.res.r3) === J({ start: '2026-09-15', no: 1, prev: 0 }));
  t('手入力の設定も入る', J(o.manual) === J({ start: '2026-08-01', no: 3, prev: 2, by: '現場の端末', at: '2026-08-01T00:00:00.000Z' }));
  t('手入力の設定が無ければ null', box.ioExportObj(all, null).manual === null);
  t('★移し済みの印（手入力の設定を移した方の ID）も持っていく・形の違う印は空', o.moved === 'r1' && box.ioExportObj(all, null, '<x>').moved === '' && box.ioExportObj(all, null, '').moved === '');
  t('★氏名の欄は無い（混ざっていても書き出さない）', !/name|氏名|"nm"|見本/.test(J(o)));
}

console.log('\n— ② 読み込む中身の確認 —');
{
  t('別の画面のファイルは読まない', box.ioParse({ app: 'other', v: 1, res: {} }).ok === false && box.ioParse(null).ok === false && box.ioParse({ app: 'patch-calendar', v: 2, res: {} }).ok === false);
  t('res が無い・配列は読まない', box.ioParse({ app: 'patch-calendar', v: 1 }).ok === false && box.ioParse({ app: 'patch-calendar', v: 1, res: [] }).ok === false);
  const p = box.ioParse({ app: 'patch-calendar', v: 1, res: { r1: { start: '2026-10-01', no: 2, prev: 0 }, r2: { start: 'x', no: 1 }, 'bad id<>': { start: '2026-10-01', no: 1, prev: 0 }, r4: { start: '2026-10-01', no: 99, prev: 0 } }, manual: { start: 'x' } });
  t('移し済みの印を読む（形が違えば空）', box.ioParse({ app: 'patch-calendar', v: 1, res: {}, moved: 'r9' }).moved === 'r9' && box.ioParse({ app: 'patch-calendar', v: 1, res: {}, moved: 'x y' }).moved === '' && box.ioParse({ app: 'patch-calendar', v: 1, res: {} }).moved === '');
  t('形の違う行（日付・場所の番号・ID・手入力）は読まずに数える', p.ok && J(Object.keys(p.res)) === J(['r1']) && p.bad === 4 && p.manual === null, p);
}

console.log('\n— ③ 合わせ方（時刻が新しい方） —');
{
  const dev = {
    a: { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: '2026-10-05T00:00:00.000Z' },   /* この端末の方が新しい */
    b: { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: '2026-10-01T00:00:00.000Z' },   /* ファイルの方が新しい */
    c: { start: '2026-10-01', no: 1, prev: 0 },                                             /* 時刻が無い＝古い扱い */
    d: { start: '2026-10-01', no: 1, prev: 0, by: 'x', at: '2026-10-01T00:00:00.000Z' }    /* 同じ中身 */
  };
  const imp = box.ioParse({ app: 'patch-calendar', v: 1, res: {
    a: { start: '2026-09-01', no: 2, prev: 0, by: 'y', at: '2026-10-03T00:00:00.000Z' },
    b: { start: '2026-09-01', no: 2, prev: 0, by: 'y', at: '2026-10-03T00:00:00.000Z' },
    c: { start: '2026-09-01', no: 3, prev: 0, by: 'y', at: '2026-10-03T00:00:00.000Z' },
    d: { start: '2026-10-01', no: 1, prev: 0, by: 'y', at: '2026-10-09T00:00:00.000Z' },
    e: { start: '2026-09-01', no: 4, prev: 0 } }, manual: null });
  const pl = box.ioPlan(dev, null, imp);
  t('件数: 追加1・置き換え2・残す1・同じ1', pl.add === 1 && pl.replace === 2 && pl.keep === 1 && pl.same === 1, pl);
  t('★この端末の方が新しい設定（a）は上書きしない', pl.merged.a.start === '2026-10-01' && pl.merged.a.no === 1);
  t('ファイルの方が新しい設定（b）・時刻が無い設定（c）は置き換える', pl.merged.b.no === 2 && pl.merged.c.no === 3);
  t('この端末に無い方（e）は足す・ファイルに無い方は消さない', pl.merged.e.no === 4 && Object.keys(pl.merged).length === 5);
  t('合わせても元の設定の入れ物は書き換えない（純粋関数）', dev.a.no === 1 && dev.b.no === 1);
  const lg = { start: PD('2026-10-01'), no: 1, prev: 0, at: '2026-10-05T00:00:00.000Z' };
  const mk = (m) => box.ioParse({ app: 'patch-calendar', v: 1, res: {}, manual: m });
  t('手入力の設定: 無ければ追加・同じ・新しければ置き換え・古ければ残す',
    box.ioPlan({}, null, mk({ start: '2026-09-01', no: 2, prev: 0 })).manual === 'add'
    && box.ioPlan({}, lg, mk({ start: '2026-10-01', no: 1, prev: 0 })).manual === 'same'
    && box.ioPlan({}, lg, mk({ start: '2026-09-01', no: 2, prev: 0, by: 'y', at: '2026-10-06T00:00:00.000Z' })).manual === 'replace'
    && box.ioPlan({}, lg, mk({ start: '2026-09-01', no: 2, prev: 0, by: 'y', at: '2026-10-04T00:00:00.000Z' })).manual === 'keep'
    && box.ioPlan({}, lg, mk(null)).manual === null);
}

console.log('\n— ④⑤ 書く時の守り（形を見る）—');
{
  const onFile = grabFn('ioOnFile'), apply = grabFn('ioApply'), exp = grabFn('ioDoExport');
  t('★読み込む前に件数を見せ、押した時だけ書く（ファイルを読んだ時点では書かない）', !/localStorage\.setItem/.test(onFile) && /ioConfirm'\)\.hidden = false/.test(onFile));
  t('★押した時点で取り直して判断する', /var all = readByRes\(\);[\s\S]*var plan = ioPlan\(all, legacySetting\(\), ioPending\.imp\)/.test(apply));
  t('★この端末の保存が読めない時は書かない（読む時も押す時も）', /if \(all === null\) \{ ioShow\(/.test(onFile) && /if \(all === null\) \{ ioShow\(/.test(apply) && /if \(all === null\) \{ ioShow\(/.test(exp));
  t('大きすぎるファイルは読まない', /file\.size > IO_MAX_BYTES/.test(onFile));
  t('手入力の設定を書く時は、先に前の「設定した人」を消す（新しい値と前の人の組み合わせを残さない）', apply.indexOf("localStorage.removeItem(LS_SETBY)") < apply.indexOf('localStorage.setItem(LS_START'));
  t('書き込めなかった時は知らせて止める', /catch \(e\) \{ ioShow\('この端末に書き込めませんでした/.test(apply));
  t('★移し済みの印は、この端末にまだ無い時だけ入れる（ある時はこの端末の印のまま）', /if \(imp\.moved && !movedTo\(\)\) localStorage\.setItem\(LS_MOVED, imp\.moved\);/.test(apply));
  t('書き出しに移し済みの印を渡す', /ioExportObj\(all, legacySetting\(\), movedTo\(\)\)/.test(exp));
  t('読み込んだ後は表示を取り直す', /if \(state\.rid\) selectResident\(state\.rid\);\s*else \{ loadState\(\); render\(\); \}/.test(apply));
}

console.log('\n— ⑥ 画面のつなぎ —');
{
  const ctl = SRC.slice(SRC.indexOf('<div class="ctl noprint">'), SRC.indexOf('<div class="wrap">'));
  t('★欄は紙に出さない（.ctl noprint の中）', ctl.indexOf('id="ioBox"') > 0 && ctl.indexOf('id="ioExport"') > 0 && ctl.indexOf('id="ioFile"') > 0);
  t('「設定を読み込む」は本物のボタン（キーボードで押せる）でファイル選択を開く', /<button class="btn" id="ioPick" type="button">設定を読み込む<\/button>/.test(SRC) && /getElementById\('ioPick'\)\.addEventListener\('click', function \(\) \{ document\.getElementById\('ioFile'\)\.click\(\); \}\)/.test(SRC) && !/<label class="btn" for="ioFile">/.test(SRC));
  t('ボタンをつないでいる', /getElementById\('ioExport'\)\.addEventListener\('click', ioDoExport\)/.test(SRC) && /getElementById\('ioApply'\)\.addEventListener\('click', ioApply\)/.test(SRC));
  t('隠した欄は本当に隠れる（.row の display:flex に負けない）', /\.io \[hidden\] \{ display: none !important; \}/.test(SRC));
  t('知らせは読み上げられる（role=status）', /<p class="msg" id="ioMsg" role="status" hidden><\/p>/.test(SRC));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);

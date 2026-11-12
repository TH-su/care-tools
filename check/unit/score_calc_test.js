/* 画面ごとの商用の点の採点（check/score-calc.mjs）の試験（2026-11-12 新設・代表者の決定 2026-11-12 案1）
   実行: node check/unit/score_calc_test.js
   守ること: 項目ごとの合否（合格・一部・不合格・対象外・未測定）・対象外と未測定は点から外して比例で直す・
            段階点の境目・危ない値（<script> 混じりの文字・閉じていない札・巨大な文字）でも例外を出さない
   ★実画面の点やしきい値はここで確かめない（採点は知らせであって門ではない）。HTML はすべて架空の小さい見本。出力に console を使わない。 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const say = (m) => process.stdout.write(m + '\n');
function t(name, ok, info) {
  if (ok) { pass++; say('  ✓ ' + name); }
  else { fail++; say('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function group(n) { say('\n— ' + n + ' —'); }

/* 架空の画面の見本 */
const GOOD = [
  '<!doctype html><html lang="ja" data-su-theme><head>',
  '<script src="su-errors.js?v=2026-01-01"></script>',
  '<style>:root{--a:#123456;--b:#abcdef}@media (max-width:700px){button{min-height:44px}}</style>',
  '</head><body><header class="hdr"><a href="index.html">メニューへ戻る</a></header>',
  '<label for="kakuu1">架空の欄</label><input id="kakuu1"><input aria-label="架空の欄2"><label>架空<select></select></label>',
  '<script src="su-net.js" defer></script><script src="su-report.js" defer></script><script src="su-resident-hop.js" defer></script>',
  '<script>window.addEventListener("beforeunload",function(){});</script>',
  '</body></html>',
].join('\n');

const BAD = [
  '<!doctype html><html lang="ja"><head><style>.x{color:#111}.y{color:#222}</style></head><body>',
  '<div class="title">架空</div><input id="kakuu2"><textarea></textarea>',
  '<script src="big-kakuu.js"></script>',
  '<script>',
  'try{}catch(e){ el.textContent = e.message; }',
  'try{}catch(err){ box.innerHTML = "失敗:" + err.message; }',
  'alert("架空1"); alert("架空2"); confirm("架空3"); prompt("架空4"); window.alert("架空5"); alert("架空6");',
  '</script></body></html>',
].join('\n');

function item(r, id) {
  for (const ax of Object.values(r.axes)) { const x = ax.items.find((y) => y.id === id); if (x) return x; }
  return null;
}

async function main() {
  const C = await import(pathToFileURL(path.join(__dirname, '..', 'score-calc.mjs')).href);
  const DYN_OK = { overflowPx: 0, pageErrors: 0, loadMs: 300 };

  group('1. よい架空の画面は全項目合格・100点');
  {
    const r = C.scorePage('kakuu-good.html', GOOD, { dynamic: DYN_OK, sizes: {} });
    const bad = C.ITEMS.map((it) => [it.id, item(r, it.id).status]).filter(([id, s]) => s !== '合格' && s !== '対象外');
    t('合格か対象外だけ', bad.length === 0, bad);
    t('合計 100', r.total === 100, r.total);
    t('5つの軸がそろう', C.AXES.every((a) => r.axes[a.id] && r.axes[a.id].score === 20));
    t('入居者の行き来の帯は入居者を開く画面にだけ課す（ほかは対象外）', item(r, 'hop').status === '対象外');
    const r2 = C.scorePage('facesheet.html', GOOD, { dynamic: DYN_OK });
    t('入居者を開く画面で su-resident-hop.js を読めば合格', item(r2, 'hop').status === '合格');
    t('入居者マスタには課さない（別タブのまま）', item(C.scorePage('resident-master.html', GOOD), 'hop').status === '対象外');
    t('label: for・aria-label・包む形を数える（3/3）', item(r, 'label').detail === '3/3');
  }

  group('2. よくない架空の画面');
  {
    const r = C.scorePage('kakuu-bad.html', BAD, { dynamic: { overflowPx: 12, pageErrors: 3, loadMs: 9000 } });
    t('help: メニュー以外で使い方への直のリンクが無い時は対象外（メニューへ戻る道と2回数えない）', item(r, 'help').status === '対象外', item(r, 'help'));
    for (const id of ['menu', 'net', 'errors', 'leave', 'theme', 'tap44', 'label', 'report', 'hdr', 'pgerr', 'ovf375', 'load'])
      t(id + ' は不合格', item(r, id).status === '不合格', item(r, id));
    t('英語の例外文 2件 → 一部（2/3）', item(r, 'engmsg').detail === '2件' && item(r, 'engmsg').frac === 0.667, item(r, 'engmsg'));
    t('止めて知らせる窓 6件 → 一部', item(r, 'dialog').detail === '6件' && item(r, 'dialog').status === '一部', item(r, 'dialog'));
    t('部品の大きさを渡さない時は同期の部品を全部数える（1本）', item(r, 'sync').detail === '1本');
    t('大きさが境目より小さい同期の部品は数えない', item(C.scorePage('x.html', BAD, { sizes: { 'big-kakuu.js': 1000 } }), 'sync').detail === '0本');
    t('大きさが境目以上の同期の部品は数える', item(C.scorePage('x.html', BAD, { sizes: { 'big-kakuu.js': C.SYNC_BIG_BYTES } }), 'sync').detail === '1本');
    t('合計は 0〜100 の間', r.total >= 0 && r.total < 50, r.total);
  }

  group('3. 対象外・未測定は点から外して比例で直す');
  {
    const r = C.scorePage('kakuu-good.html', GOOD, { sizes: {} });   // 動的なし
    t('動的の3項目は未測定', ['pgerr', 'ovf375', 'load'].every((id) => item(r, id).status === '未測定' && item(r, id).frac === null));
    t('未測定でも満点のまま（0点にしない）', r.total === 100, r.total);
    const half = C.scorePage('kakuu-good.html', GOOD, { sizes: {}, dynamic: { overflowPx: 0, pageErrors: 0, loadMs: 99999 } });
    t('速い: 読み込みが遅い時は (0+1+1)/3 × 20', Math.abs(half.axes.fast.score - 13.3) < 0.05, half.axes.fast.score);
    t('型を当てないと決めた画面は対象外', item(C.scorePage('work-schedule.html', BAD), 'theme').status === '対象外');
    t('不具合を報告を置かないと決めた画面は対象外', item(C.scorePage('login.html', BAD), 'report').status === '対象外');
    t('メニューそのものは「戻る」が対象外・使い方へのリンクを課す', item(C.scorePage('index.html', BAD), 'menu').status === '対象外'
      && item(C.scorePage('index.html', BAD), 'help').status === '不合格'
      && item(C.scorePage('index.html', BAD + '<a href="help.html">使い方</a>'), 'help').status === '合格');
    const noInput = '<html><body><p>架空の読むだけの画面</p></body></html>';
    t('入力欄が無い画面は閉じる前の確かめ・入力欄の名前が対象外', item(C.scorePage('k.html', noInput), 'leave').status === '対象外' && item(C.scorePage('k.html', noInput), 'label').status === '対象外');
    t('軸の項目が全部外れても合計は数になる', typeof C.scorePage('k.html', noInput).total === 'number');
    {
      /* 1つの軸の項目を全部「対象外」にした結果を直接まとめる（軸の点は null・合計は残りの軸だけで比例） */
      const rr = {};
      for (const it of C.ITEMS) rr[it.id] = it.axis === C.AXES[0].id ? { status: '対象外', detail: '' } : { frac: 1, detail: '' };
      const s = C.summarize('k.html', rr);
      t('軸ごと外れた軸は点が null・数えた軸は4つ・合計100', s.axes[C.AXES[0].id].score === null && s.measuredAxes === C.AXES.length - 1 && s.total === 100, s);
      const all = {};
      for (const it of C.ITEMS) all[it.id] = { status: '対象外', detail: '' };
      t('全部の軸が外れた時は合計 null（0点にしない）', C.summarize('k.html', all).total === null);
      const half = {};
      for (const it of C.ITEMS) half[it.id] = it.axis === C.AXES[0].id ? { status: '未測定', detail: '' } : { frac: 0.5, detail: '' };
      t('未測定の軸を除いて比例で出す（残り全部半分→50）', C.summarize('k.html', half).total === 50);
    }
    t('端末の登録の画面には不具合を報告のボタンを課す', item(C.scorePage('enroll.html', BAD), 'report').status === '不合格');
  }

  group('4. 段階点の境目');
  {
    t('英語の例外文: 0件=1・2件=2/3・5件=1/3・6件=0', [0, 2, 5, 6].map((n) => {
      const js = Array.from({ length: n }, () => 'x.textContent = e.message;').join('\n');
      return item(C.scorePage('k.html', '<script>' + js + '</script>'), 'engmsg').frac;
    }).join(',') === '1,0.667,0.333,0');
    t('英語の直書き（Failed to fetch）を画面へ出す形も数える', C.countEnglishErrorExposure("el.innerHTML = 'Failed to fetch';") === 1);
    t('記録に回すだけ（出す先が無い）は数えない', C.countEnglishErrorExposure('note(e.message);') === 0);
    t('16進色: 色の名前の定義は数えない', C.countHexColors(':root{--a:#fff;--b:#000000}.x{color:var(--a)}', [], '') === 0);
    t('16進色: 直書きと style 属性と JS の色の指定を数える', C.countHexColors('.x{color:#fff}', ['background:#000'], 'el.style.color = "#123456";') === 3);
    t('16進色: JS の id の文字（"#kakuu"）は数えない', C.countHexColors('', [], 'document.querySelector("#kakuu")') === 0);
    t('窓: 自前の関数 confirm( の定義と SU.confirm( は数えない', C.countDialogs('function confirm(m){} SU.confirm("x"); confirm("y");') === 1);
    t('44px: 狭い幅の塊の中なら合格', C.hasNarrow44('@media screen and (max-width: 899px){.b{min-height:44px}}'));
    t('44px: PC の幅だけの塊は不合格', !C.hasNarrow44('@media (min-width: 900px){.b{min-height:44px}}'));
    t('44px: 印刷だけの塊は不合格', !C.hasNarrow44('@media print{.b{min-height:44px}}'));
    t('44px: どの幅でも効く素の指定は合格', C.hasNarrow44('.b{min-height:44px}'));
    t('44px: 144px・44pxx は数えない', !C.hasNarrow44('.b{min-height:144px}') && !C.hasNarrow44('.b{width:44pxx}'));
    t('44px: 入れ子の塊（screen の中の max-width）', C.hasNarrow44('@media screen{@media (max-width:600px){.b{height:44px}}}'));
    t('44px: コメントの中は数えない', !C.hasNarrow44('/* .b{min-height:44px} */'));
    t('44px: 押す所の大きさでない宣言（width・padding）は数えない', !C.hasNarrow44('.c{width:44px}') && !C.hasNarrow44('@media (max-width:600px){.c{padding:0 44px}}'));
    t('44px: 押す所の大きさの名前の定義（--tap-min）は数える', C.hasNarrow44(':root{--tap-min: 44px}'));
    t('HTML の大きさ: 151KB は一部', item(C.scorePage('k.html', 'a'.repeat(151 * 1024)), 'size').status === '一部');
  }

  group('5. 危ない値でも落ちない');
  {
    const nasty = [
      '<script>var s = "<\\/script><script>alert(1)<\\/script>"; el.innerHTML = "<img src=x onerror=alert(1)>";</script>',
      '<input value="</label><label>" aria-label="">', '<div class="hdr', '<style>@media (max-width:1px){{{{', '<!-- 閉じていない',
      '<script>/* 閉じていない', '\u0000￿\uD800', '<a href="index.html', '<html data-su-theme="<script>">',
    ];
    let threw = null;
    for (const h of nasty) { try { const r = C.scorePage('<b>架空</b>.html', h, { dynamic: { overflowPx: 'x', pageErrors: NaN, loadMs: -1 } }); if (r.total != null && !(r.total >= 0 && r.total <= 100)) threw = 'range'; } catch (e) { threw = String(e && e.message); } }
    t('危ない値の HTML でも例外を出さず点は 0〜100', threw === null, threw);
    for (const v of [null, undefined, 123, {}, []]) { try { C.scorePage(v, v, v); } catch (e) { threw = String(e && e.message); } }
    t('null・undefined・数・オブジェクトでも例外を出さない', threw === null, threw);
    t('数でない動的の値は未測定', item(C.scorePage('k.html', GOOD, { dynamic: { overflowPx: 'x', loadMs: NaN } }), 'ovf375').status === '未測定');
    const big = '<div>' + '<input>'.repeat(20000) + '</div>' + '<script>' + 'x.textContent=e.message;'.repeat(20000) + '</script>';
    const t0 = Date.now(); const rb = C.scorePage('k.html', big); const ms = Date.now() - t0;
    t('大きな画面でも数秒で終わる', ms < 5000 && rb.total != null, ms);
    const r = C.scorePage('k.html', '<script>throw new Error("架空")</script><div>' + '<'.repeat(1000) + '</div>');
    t('detail に画面のソースの断片を入れない（件数・割合・決まった語だけ）', JSON.stringify(r).indexOf('架空') < 0);
  }

  group('6. 同じサイトの部品の一覧');
  {
    const a = C.localAssets('<link rel="stylesheet" href="su-theme.css?v=1"><link rel="icon" href="x.png"><script src="su-errors.js?v=2"></script><script src="https://example.invalid/x.js"></script>');
    t('CSS と JS の名前だけ・外の住所は除く', a.css.join() === 'su-theme.css' && a.scripts.join() === 'su-errors.js', a);
    t('読み込む CSS の 44px も数える', item(C.scorePage('k.html', '<html><body></body></html>', { css: { 'su-theme.css': '@media (max-width:899px){a{min-height:44px}}' } }), 'tap44').status === '合格');
  }

  say('\n' + (fail ? '✗' : '✓') + ' 採点の物差し: 成功 ' + pass + '／失敗 ' + fail);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { say('✗ 試験が止まった: ' + String(e && e.message || e)); process.exit(1); });

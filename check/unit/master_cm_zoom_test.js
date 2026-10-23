/* 入居者マスタ：CM表（ケアマネ一覧）の大きさを画面で変える（2026-10-23 本人指示・ボタンとピンチの両方）
   実行: node check/unit/master_cm_zoom_test.js
   守ること:
     1. 倍率は端末に数ひとつだけ覚える（rmaster_cm_zoom）。数で 0.5〜3 の時だけ使い、ほか（範囲外・文字・NaN）は 1
     2. 「−」「＋」は1回で1割。端（50%・300%）では押せない。読み上げの名前と、倍率の読み上げ（role="status"）
     3. 画面の文字＝採寸の px × 倍率。紙の採寸（fitCmSheet(m)）では倍率を掛けない・画面の採寸の値を上書きしない
     4. 倍率 1 の時は今までと同じ大きさ（式も同じ）。印刷の後は画面の大きさへ戻る
     5. ピンチ（Ctrl＋ホイール・Safari のジェスチャー・2本指）は CM表を開いていて表の上の時だけ扱う。
        ほかの画面・表の外・Ctrl なしのホイール・1本指ではページの動きを止めない
   実物のソースから関数を切り出して vm で動かす（写経しない）。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(path.join(ROOT, 'resident-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
}
const line = (src, re) => { const m = re.exec(src); if (!m) throw new Error('行が見つかりません: ' + re); return m[0]; };

/* ── 偽の画面（DOM の必要なところだけ）── */
function classList(arr) {
  const s = new Set(arr || []);
  return { contains: (c) => s.has(c), add: (c) => s.add(c), remove: (c) => s.delete(c) };
}
function makeEnv(store) {
  const rafQ = [];
  const els = {};
  /* CM表のシート。表の文字の大きさで高さ・幅が決まる（33行＋見出し）＝本物の shFit_ で採寸できる */
  const tbl = { style: { fontSize: '' }, get offsetWidth() { return Math.round(parseFloat(this.style.fontSize || '13') * 58); },
                get scrollWidth() { return this.offsetWidth; } };
  const cell = { id: 'cell' };
  const sheet = {
    id: 'cmSheet', offsetParent: {}, vars: {},
    style: { setProperty(k, v) { sheet.vars[k] = v; } },
    get scrollHeight() { return Math.round(parseFloat(tbl.style.fontSize || '13') * 1.15 * 36 + 40); },
    get scrollWidth() { return tbl.offsetWidth; },
    querySelector(sel) { return (sel === '.cmtbl' || sel === 'table') ? tbl : null; },
    contains(n) { return n === sheet || n === tbl || n === cell; },
    insertBefore() {}, firstChild: null
  };
  els.cmSheet = sheet;
  els['sc-list'] = { classList: classList(['on']) };
  els.cmZoomVal = { textContent: '' };
  els.cmZoomOut = { disabled: false };
  els.cmZoomIn = { disabled: false };
  const body = { classList: classList([]) };
  const b = {
    Math, Number, String, isFinite, JSON,
    curView: 'cm',
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    window: { requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; } },
    document: { body },
    setTimeout: (f) => { rafQ.push(f); return rafQ.length; },
    $: (id) => els[id] || null,
    shWarn_: () => {},
    els, sheet, tbl, cell, body, rafQ,
    flush() { while (rafQ.length) rafQ.shift()(); }
  };
  vm.createContext(b);
  vm.runInContext([
    line(RM, /var CM_ZOOM_KEY=[^\n]*/),
    cutF(RM, 'cmZoomRead_'),
    line(RM, /var cmZoom=cmZoomRead_\(\);/),
    line(RM, /var cmFitPx=null;[^\n]*/),
    line(RM, /var cmZoomRaf=0;[^\n]*/),
    cutF(RM, 'cmZoomSet_'), cutF(RM, 'cmZoomStep_'), cutF(RM, 'cmApplyPx_'), cutF(RM, 'cmZoomApply_'),
    cutF(RM, 'cmZoomPaint_'), cutF(RM, 'shViewActive_'), cutF(RM, 'cmPinchOk_'),
    line(RM, /var cmGesture=null, cmTouch=null;[^\n]*/),
    cutF(RM, 'cmOnWheel_'), cutF(RM, 'cmOnGestureStart_'), cutF(RM, 'cmOnGestureChange_'), cutF(RM, 'cmOnGestureEnd_'),
    cutF(RM, 'cmTouchDist_'), cutF(RM, 'cmOnTouchStart_'), cutF(RM, 'cmOnTouchMove_'), cutF(RM, 'cmOnTouchEnd_'),
    cutF(RM, 'cmZoomRestore_'), cutF(RM, 'shFit_'), cutF(RM, 'fitCmSheet')
  ].join('\n'), b);
  return b;
}
const g = (b, name) => vm.runInContext(name, b);
function ev(o) { const e = Object.assign({ prevented: 0 }, o); e.preventDefault = () => { e.prevented++; }; return e; }

console.log('\n— 1. 倍率の読み書き（rmaster_cm_zoom）—');
{
  const cases = [[undefined, 1], ['1.5', 1.5], ['0.5', 0.5], ['3', 3], ['1', 1], ['2.25', 2.25],
    ['3.01', 1], ['0.49', 1], ['0', 1], ['-1', 1], ['abc', 1], ['NaN', 1], ['1.5abc', 1], ['', 1],
    ['Infinity', 1], [' 1.5', 1], ['1e0', 1], ['{"z":2}', 1]];
  for (const [v, want] of cases) {
    const st = {}; if (v !== undefined) st.rmaster_cm_zoom = v;
    const b = makeEnv(st);
    t('保存値 ' + JSON.stringify(v) + ' → ' + want, g(b, 'cmZoom') === want, g(b, 'cmZoom'));
  }
  {
    const b = makeEnv({});
    b.localStorage.getItem = () => { throw new Error('denied'); };
    t('読めない端末（例外）でも 1 で動く', b.cmZoomRead_() === 1, b.cmZoomRead_());
  }
  {
    const st = {}; const b = makeEnv(st);
    b.cmZoomSet_(1.234567); b.flush();
    t('書く値は数だけ（小数3桁まで）', st.rmaster_cm_zoom === '1.235', st);
    t('書いた値を読み直すと同じ倍率', makeEnv({ rmaster_cm_zoom: st.rmaster_cm_zoom }).cmZoomRead_() === 1.235, '');
    b.cmZoomSet_(9); b.flush();
    t('上限を超える倍率は 3 に止める', g(b, 'cmZoom') === 3 && st.rmaster_cm_zoom === '3', [g(b, 'cmZoom'), st]);
    b.cmZoomSet_(0.01); b.flush();
    t('下限を下回る倍率は 0.5 に止める', g(b, 'cmZoom') === 0.5 && st.rmaster_cm_zoom === '0.5', [g(b, 'cmZoom'), st]);
    b.cmZoomSet_(NaN); b.cmZoomSet_('x'); b.flush();
    t('数でない倍率は無視する（今の倍率のまま）', g(b, 'cmZoom') === 0.5, g(b, 'cmZoom'));
    const keys = Object.keys(st);
    t('端末に書くキーは rmaster_cm_zoom の1つだけ', keys.length === 1 && keys[0] === 'rmaster_cm_zoom', keys);
  }
  {
    const b = makeEnv({});
    b.cmZoomSet_(1.1); b.cmZoomSet_(1.2); b.cmZoomSet_(1.3);
    t('続けて変えても描き直しは1コマに1回（requestAnimationFrame で間引く）', b.rafQ.length === 1, b.rafQ.length);
    b.flush();
    t('間引いた後は最後の倍率で描く', g(b, 'cmZoom') === 1.3 && b.els.cmZoomVal.textContent === '130%', b.els.cmZoomVal.textContent);
  }
}

console.log('\n— 2. ボタン（−・＋・100%）—');
{
  const b = makeEnv({});
  b.cmZoomPaint_();
  t('既定は 100%・両方押せる', b.els.cmZoomVal.textContent === '100%' && !b.els.cmZoomOut.disabled && !b.els.cmZoomIn.disabled, b.els);
  b.cmZoomStep_(0.1); b.flush(); b.cmZoomStep_(0.1); b.flush();
  t('「＋」2回で 120%（1回1割・小数の誤差なし）', g(b, 'cmZoom') === 1.2 && b.els.cmZoomVal.textContent === '120%', g(b, 'cmZoom'));
  b.cmZoomSet_(0.55); b.flush(); b.cmZoomStep_(-0.1); b.flush();
  t('端の手前から「−」で 50% に止まる', g(b, 'cmZoom') === 0.5, g(b, 'cmZoom'));
  t('50% では「−」を押せない・「＋」は押せる', b.els.cmZoomOut.disabled === true && b.els.cmZoomIn.disabled === false, b.els);
  b.cmZoomStep_(-0.1); b.flush();
  t('50% で「−」を呼んでも 50% のまま', g(b, 'cmZoom') === 0.5, g(b, 'cmZoom'));
  b.cmZoomSet_(2.95); b.flush(); b.cmZoomStep_(0.1); b.flush();
  t('端の手前から「＋」で 300% に止まる', g(b, 'cmZoom') === 3 && b.els.cmZoomVal.textContent === '300%', g(b, 'cmZoom'));
  t('300% では「＋」を押せない・「−」は押せる', b.els.cmZoomIn.disabled === true && b.els.cmZoomOut.disabled === false, b.els);
  b.cmZoomSet_(1.23); b.flush();
  t('ピンチの後の端数でも両方押せる・表示は整数の %', !b.els.cmZoomIn.disabled && !b.els.cmZoomOut.disabled && b.els.cmZoomVal.textContent === '123%', b.els.cmZoomVal.textContent);

  const bar = RM.slice(RM.indexOf('<div class="sh-bar" id="cmBar"'), RM.indexOf('</div>', RM.indexOf('<div class="sh-bar" id="cmBar"')));
  t('ボタンは CM表のバー（#cmBar・紙に出ない .sh-bar）の中', /id="cmZoomOut"/.test(bar) && /id="cmZoomIn"/.test(bar) && /id="cmZoomReset"/.test(bar) && /id="cmZoomVal"/.test(bar), bar.slice(0, 200));
  t('「−」の読み上げの名前', /<button type="button" id="cmZoomOut" aria-label="ケアマネ一覧を小さく">−<\/button>/.test(bar), '');
  t('「＋」の読み上げの名前', /<button type="button" id="cmZoomIn" aria-label="ケアマネ一覧を大きく">＋<\/button>/.test(bar), '');
  t('「100%」の読み上げの名前に、画面に出ている「100%」を含める（音声操作で呼べる）', /<button type="button" id="cmZoomReset" aria-label="100%（ケアマネ一覧の大きさを元に戻す）">100%<\/button>/.test(bar), '');
  t('今の倍率は role="status" で読み上げる', /<span class="cmzv" id="cmZoomVal" role="status"[^>]*>100%<\/span>/.test(bar), '');
  t('紙ではバーごと消える（body.cm-on .sh-bar{display:none}）', /body\.cm-on \.sh-bar,\s*body\.lvl-on \.sh-bar\{display:none !important\}/.test(RM), '');
  t('押せる所は 44px 以上（.sh-bar button の min-height/min-width）', /\.sh-bar button\{min-height:44px; min-width:44px;/.test(RM), '');
  t('端で押せないことを薄さでも見せる', /\.cmzoom button:disabled\{opacity:\.45;/.test(RM), '');
  t('「−」「＋」「100%」の配線（1割・元に戻す）', /\$\('cmZoomOut'\)\.addEventListener\('click',function\(\)\{ cmZoomStep_\(-CM_ZOOM_STEP\) \}\)/.test(RM)
    && /\$\('cmZoomIn'\)\.addEventListener\('click',function\(\)\{ cmZoomStep_\(CM_ZOOM_STEP\) \}\)/.test(RM)
    && /\$\('cmZoomReset'\)\.addEventListener\('click',function\(\)\{ cmZoomSet_\(1\) \}\)/.test(RM)
    && /CM_ZOOM_MIN=0\.5, CM_ZOOM_MAX=3, CM_ZOOM_STEP=0\.1/.test(RM), '');
}

console.log('\n— 3. 画面＝採寸 × 倍率・紙＝採寸のまま —');
{
  /* 倍率 1: 今までの式（改修前の apply の中身）と同じ値になる */
  const b = makeEnv({});
  const r = b.fitCmSheet();
  const px = r && r.size;
  t('画面の採寸ができる（架空の表で）', px > 6 && px <= 22, r);
  const old = { '--cmpad': (px >= 16 ? 3 : px >= 14 ? 2 : 1) + 'px', '--cmpx': (px >= 14 ? 8 : 6) + 'px',
    '--cmsum': Math.round(px * 1.05) + 'px', '--shd1': Math.round(px * 1.5) + 'px' };
  t('倍率 1 では今までと同じ大きさ（表の文字＝採寸の px）', b.tbl.style.fontSize === px + 'px', [b.tbl.style.fontSize, px]);
  t('倍率 1 では余白・合計欄・見出しも今までと同じ', JSON.stringify(b.sheet.vars) === JSON.stringify(old), [b.sheet.vars, old]);
  t('画面の採寸の px を覚える', g(b, 'cmFitPx') === px, g(b, 'cmFitPx'));

  /* 倍率 1.5: 表・余白・合計欄・見出しは掛けた後の px から同じ式で出す */
  const b2 = makeEnv({ rmaster_cm_zoom: '1.5' });
  const r2 = b2.fitCmSheet(); const z = r2.size * 1.5;
  t('倍率 1.5 の画面: 表の文字＝採寸 × 1.5', b2.tbl.style.fontSize === z + 'px', [b2.tbl.style.fontSize, r2.size]);
  t('倍率 1.5 の画面: 余白・合計欄・見出しも掛けた後の px から同じ式', b2.sheet.vars['--cmpad'] === (z >= 16 ? 3 : z >= 14 ? 2 : 1) + 'px'
    && b2.sheet.vars['--cmpx'] === (z >= 14 ? 8 : 6) + 'px' && b2.sheet.vars['--cmsum'] === Math.round(z * 1.05) + 'px'
    && b2.sheet.vars['--shd1'] === Math.round(z * 1.5) + 'px', b2.sheet.vars);
  t('倍率を掛けても採寸の結果（返す値）は変えない＝「1枚に収まりません」の判定は紙のまま', r2.size === px && r2.fits === r.fits, [r2, r]);

  /* 倍率を変えても採寸はやり直さない（覚えた px に掛け直すだけ） */
  let calls = 0; const orig = b2.shFit_;
  b2.shFit_ = function () { calls++; return orig.apply(this, arguments); };
  b2.cmZoomSet_(2); b2.flush();
  t('倍率を変えた時は採寸をやり直さない', calls === 0 && b2.tbl.style.fontSize === (r2.size * 2) + 'px', [calls, b2.tbl.style.fontSize]);

  /* 紙の採寸（m 付き）: 倍率を掛けない・画面の採寸の値を上書きしない */
  const m = { wPx: 1047, hPx: 600 };   /* 画面の既定（718px）より低い用紙＝紙の px は画面と違う値になる */
  const rp = b2.fitCmSheet(m);
  t('紙の採寸では倍率を掛けない（表の文字＝紙の採寸の px）', b2.tbl.style.fontSize === rp.size + 'px', [b2.tbl.style.fontSize, rp.size]);
  t('紙の採寸の余白・見出しも倍率なし', b2.sheet.vars['--shd1'] === Math.round(rp.size * 1.5) + 'px', b2.sheet.vars);
  t('紙の採寸は画面と別の大きさになる用紙で試している（空振りしない）', rp.size !== r2.size, [rp.size, r2.size]);
  t('紙の採寸は画面の採寸の値（cmFitPx）を上書きしない', g(b2, 'cmFitPx') === r2.size, g(b2, 'cmFitPx'));

  /* 印刷の準備中は倍率の描き直しで紙の大きさを上書きしない */
  b2.body.classList.add('su-printing'); b2.body.classList.add('cm-on');
  b2.cmZoomSet_(2.5); b2.flush();
  t('印刷の準備中に倍率が変わっても紙の大きさのまま', b2.tbl.style.fontSize === rp.size + 'px', b2.tbl.style.fontSize);

  /* 印刷の後（su-print の後始末の中）: 画面の大きさへ戻す */
  b2.cmZoomRestore_();
  t('印刷の後は画面の大きさ（採寸 × 倍率）へ戻る', b2.tbl.style.fontSize === (r2.size * 2.5) + 'px', b2.tbl.style.fontSize);
  t('印刷の後始末で戻す配線（def(\'cm\') の onAfter）', /def\('cm', \{[\s\S]*?onAfter: function\(\)\{ cmZoomRestore_\(\); \} \}\);/.test(RM), '');
  t('紙の採寸の入口は今までどおり fitCmSheet(st.metrics)', /measure: measureWith\(fitCmSheet, 'cmSheet'\)/.test(RM), '');

  /* 非表示で測れなかった時: 古い採寸を新しいシートに掛けない */
  const b3 = makeEnv({ rmaster_cm_zoom: '2' });
  b3.fitCmSheet();
  b3.sheet.offsetParent = null;
  const rn = b3.fitCmSheet();
  t('非表示で測れなかった時は採寸の値を捨てる（古い値を掛けない）', rn === null && g(b3, 'cmFitPx') === null, g(b3, 'cmFitPx'));
  const fsBefore = b3.tbl.style.fontSize;
  b3.cmZoomSet_(1.5); b3.flush();
  t('非表示のままなら倍率を変えても測らない・触らない', b3.tbl.style.fontSize === fsBefore, [b3.tbl.style.fontSize, fsBefore]);
  b3.sheet.offsetParent = {};
  b3.cmZoomSet_(1.6); b3.flush();
  t('表示された後に倍率を変えると、1回測ってから掛ける', g(b3, 'cmFitPx') > 0 && b3.tbl.style.fontSize === (g(b3, 'cmFitPx') * 1.6) + 'px', [g(b3, 'cmFitPx'), b3.tbl.style.fontSize]);
}

console.log('\n— 4. ピンチ（CM表の上でだけ扱う）—');
{
  /* Ctrl＋ホイール／トラックパッドのピンチ（Chrome・Edge） */
  const b = makeEnv({});
  let e = ev({ ctrlKey: true, deltaY: -5, deltaMode: 0, target: b.cell });
  b.cmOnWheel_(e); b.flush();
  t('CM表の上の Ctrl＋ホイール: ページの拡大を止めて表を大きくする', e.prevented === 1 && g(b, 'cmZoom') > 1, [e.prevented, g(b, 'cmZoom')]);
  const z1 = g(b, 'cmZoom');
  e = ev({ ctrlKey: true, deltaY: 100, deltaMode: 0, target: b.cell });
  b.cmOnWheel_(e); b.flush();
  t('マウスのホイール1目盛り（100）は約1割で頭打ち', Math.abs(g(b, 'cmZoom') / z1 - Math.exp(-0.1)) < 1e-9, g(b, 'cmZoom') / z1);
  e = ev({ ctrlKey: true, deltaY: -1, deltaMode: 0, target: b.cell });
  const z2 = g(b, 'cmZoom'); b.cmOnWheel_(e); b.flush();
  t('トラックパッドの小さな量は細かく動く（無段階）', g(b, 'cmZoom') > z2 && g(b, 'cmZoom') / z2 < 1.02, g(b, 'cmZoom') / z2);
  e = ev({ ctrlKey: false, deltaY: -50, target: b.cell });
  const z3 = g(b, 'cmZoom'); b.cmOnWheel_(e);
  t('Ctrl なしのホイール（ふつうのスクロール）は止めない・倍率も変えない', e.prevented === 0 && g(b, 'cmZoom') === z3, e.prevented);
  e = ev({ ctrlKey: true, deltaY: -5, target: { id: 'outside' } });
  b.cmOnWheel_(e);
  t('CM表の外の Ctrl＋ホイールはページの拡大に任せる', e.prevented === 0 && g(b, 'cmZoom') === z3, e.prevented);

  for (const v of ['std', 'lvl', 'room', 'hist', 'bday']) {
    const bo = makeEnv({}); bo.curView = v;
    const w = ev({ ctrlKey: true, deltaY: -5, target: bo.cell });
    bo.cmOnWheel_(w);
    const gs = ev({ scale: 1, target: bo.cell }); bo.cmOnGestureStart_(gs);
    const gc = ev({ scale: 2, target: bo.cell }); bo.cmOnGestureChange_(gc);
    const tsv = [{ clientX: 0, clientY: 0, target: bo.cell }, { clientX: 100, clientY: 0, target: bo.cell }];
    bo.cmOnTouchStart_(ev({ touches: tsv }));
    const tm = ev({ touches: [tsv[0], { clientX: 200, clientY: 0, target: bo.cell }] }); bo.cmOnTouchMove_(tm);
    t('ほかの画面（' + v + '）ではホイール・Safari のピンチ・2本指のどれも奪わない', w.prevented === 0 && gs.prevented === 0 && gc.prevented === 0 && tm.prevented === 0 && g(bo, 'cmZoom') === 1,
      [w.prevented, gs.prevented, gc.prevented, tm.prevented, g(bo, 'cmZoom')]);
  }
  {
    const bh = makeEnv({}); bh.els['sc-list'].classList.remove('on');   /* 詳細画面を開いていて一覧が隠れている */
    const w = ev({ ctrlKey: true, deltaY: -5, target: bh.cell }); bh.cmOnWheel_(w);
    t('一覧が隠れている間（詳細・編集画面）は奪わない', w.prevented === 0 && g(bh, 'cmZoom') === 1, w.prevented);
  }

  /* Safari のピンチ */
  const bs = makeEnv({ rmaster_cm_zoom: '1.2' });
  let gs = ev({ scale: 1, target: bs.cell }); bs.cmOnGestureStart_(gs);
  let gc = ev({ scale: 1.5, target: bs.cell }); bs.cmOnGestureChange_(gc); bs.flush();
  t('Safari のピンチ: 始めた時の倍率 × scale（1.2 × 1.5）', gs.prevented === 1 && gc.prevented === 1 && Math.abs(g(bs, 'cmZoom') - 1.8) < 1e-9, g(bs, 'cmZoom'));
  const w2 = ev({ ctrlKey: true, deltaY: -10, target: bs.cell }); bs.cmOnWheel_(w2); bs.flush();
  t('Safari のピンチ中に来た Ctrl＋ホイールは二重に掛けない（止めるだけ）', w2.prevented === 1 && Math.abs(g(bs, 'cmZoom') - 1.8) < 1e-9, g(bs, 'cmZoom'));
  gc = ev({ scale: 0.1, target: bs.cell }); bs.cmOnGestureChange_(gc); bs.flush();
  t('Safari のピンチでも 50% より小さくしない', g(bs, 'cmZoom') === 0.5, g(bs, 'cmZoom'));
  const ge = ev({}); bs.cmOnGestureEnd_(ge);
  gc = ev({ scale: 3, target: bs.cell }); bs.cmOnGestureChange_(gc);
  t('ピンチを終えた後のジェスチャーは扱わない', gc.prevented === 0 && g(bs, 'cmZoom') === 0.5, gc.prevented);
  gs = ev({ scale: 1, target: { id: 'outside' } }); bs.cmOnGestureStart_(gs);
  t('CM表の外で始めた Safari のピンチは奪わない', gs.prevented === 0, gs.prevented);

  /* タッチ画面の2本指 */
  const bt = makeEnv({});
  const A = { clientX: 0, clientY: 0, target: bt.cell }, B = { clientX: 100, clientY: 0, target: bt.cell };
  bt.cmOnTouchStart_(ev({ touches: [A] }));
  let tm = ev({ touches: [{ clientX: 0, clientY: 50, target: bt.cell }] }); bt.cmOnTouchMove_(tm);
  t('1本指の動き（スクロール）は止めない', tm.prevented === 0 && g(bt, 'cmZoom') === 1, tm.prevented);
  bt.cmOnTouchStart_(ev({ touches: [A, B] }));
  tm = ev({ touches: [A, { clientX: 150, clientY: 0, target: bt.cell }] }); bt.cmOnTouchMove_(tm); bt.flush();
  t('2本指を広げると指の間の比で大きくなる（100→150 で 1.5 倍）', tm.prevented === 1 && Math.abs(g(bt, 'cmZoom') - 1.5) < 1e-9, g(bt, 'cmZoom'));
  const gcT = ev({ scale: 3, target: bt.cell });
  bt.cmOnGestureStart_(ev({ scale: 1, target: bt.cell })); bt.cmOnGestureChange_(gcT); bt.flush();
  t('iPad で同時に来る gesture は2本指の処理に任せる（二重に掛けない）', gcT.prevented === 1 && Math.abs(g(bt, 'cmZoom') - 1.5) < 1e-9, g(bt, 'cmZoom'));
  bt.cmOnTouchEnd_(ev({ touches: [A] }));
  tm = ev({ touches: [A] }); bt.cmOnTouchMove_(tm);
  t('指が1本に戻ったら扱わない', tm.prevented === 0 && g(bt, 'cmTouch') === null, tm.prevented);
  const bt2 = makeEnv({});
  bt2.cmOnTouchStart_(ev({ touches: [{ clientX: 0, clientY: 0, target: bt2.cell }, { clientX: 100, clientY: 0, target: { id: 'outside' } }] }));
  tm = ev({ touches: [{ clientX: 0, clientY: 0, target: bt2.cell }, { clientX: 200, clientY: 0, target: { id: 'outside' } }] }); bt2.cmOnTouchMove_(tm);
  t('片方の指が CM表の外ならページに任せる', tm.prevented === 0 && g(bt2, 'cmZoom') === 1, tm.prevented);

  /* 配線: 一覧の箱に付け、止める必要のある wheel・touchmove・gesture だけ passive:false */
  t('wheel は passive:false で一覧の箱へ', /rbx\.addEventListener\('wheel',cmOnWheel_,\{passive:false\}\)/.test(RM), '');
  t('Safari のジェスチャー3つ', /rbx\.addEventListener\('gesturestart',cmOnGestureStart_,\{passive:false\}\)/.test(RM)
    && /rbx\.addEventListener\('gesturechange',cmOnGestureChange_,\{passive:false\}\)/.test(RM)
    && /rbx\.addEventListener\('gestureend',cmOnGestureEnd_,\{passive:false\}\)/.test(RM), '');
  t('touchstart/end は passive（スクロールを待たせない）・touchmove だけ passive:false', /rbx\.addEventListener\('touchstart',cmOnTouchStart_,\{passive:true\}\)/.test(RM)
    && /rbx\.addEventListener\('touchmove',cmOnTouchMove_,\{passive:false\}\)/.test(RM)
    && /rbx\.addEventListener\('touchend',cmOnTouchEnd_,\{passive:true\}\)/.test(RM), '');
  t('表の上の2本指はブラウザに拡大させない（touch-action）', /#cmSheet\{touch-action:pan-x pan-y\}/.test(RM), '');
  t('touch-action は紙の区切り（@media print）に入れていない', !/@media print[^{]*\{[^}]*touch-action/.test(RM), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);

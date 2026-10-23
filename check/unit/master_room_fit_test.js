/* 入居者マスタ：居室一覧の画面のはみ出しを直す・氏名に「様」を付けない（2026-10-23 本人指示・代表者の決定）
   実行: node check/unit/master_room_fit_test.js
   守ること:
     1. 画面の守り: 実際に表示している幅でマスの中身があふれている時だけ、2枚とも同じ大きさで 0.25px 相当ずつ下げる。
        あふれが無ければ何もしない（Mac の見た目は変わらない）。下限は採寸の最小（5px 相当）。
        下げてもあふれの合計が減らない端末（最小の文字の設定など）は 8段で打ち切り、上限は 24段。
        あふれを0にできなかった時は採寸の大きさ（守りの前）へ戻す（表題だけ小さくしない）。丸めで1段だけ減らない所は越える
     2. 紙の採寸（fitRoomSheets(m)）は画面の守りを通らない。画面で下げた後でも、紙は紙の幅から測り直した大きさ
     3. 採寸し直しのきっかけ: 窓の幅の変化（居室一覧の時だけ・前に測った幅と違う時だけ・200ms 後に1回）・文字の読み込みの後・
        非表示で測れなかった時は一覧が表示された時
     4. 居室一覧の氏名の後ろに「様」を付けない（画面・紙とも）。氏名の文字（空白・異体字）は直さない。
        同じ居室に2名の時の並べ方（rp-dup・改行）はそのまま
   実物のソースから関数を切り出して vm で動かす（写経しない）。氏名はすべて架空。 */
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
function classList(arr) {
  const s = new Set(arr || []);
  return { contains: (c) => s.has(c), add: (c) => s.add(c), remove: (c) => s.delete(c) };
}

/* ── 偽の居室一覧（1階・2階）──
   文字の大きさ＝ --rpk × シートの幅 / 100（cqw と同じ）。採寸中は style.width＝紙幅。
   widen は「画面でだけ小さな文字の幅が比のとおりに縮まない」度合い（Windows を模す。Mac は 1）。
   マスの幅もシートの幅に比例する（図の形は比で持つ）。 */
const PW = Math.round((297 - 20) * 96 / 25.4);   /* 採寸の既定の紙幅（1047px） */
function makeSheet(id, cellsSpec, env) {
  const sh = {
    id, vars: { '--rpk': '1.3' }, offsetParent: {},
    style: { width: '', padding: '', setProperty(k, v) { sh.vars[k] = String(v); if (k === '--rpk') env.sets[id] = (env.sets[id] || 0) + 1; } },
    width() { return sh.style.width ? parseFloat(sh.style.width) : env.screenW; },
    font() {
      let f = parseFloat(sh.vars['--rpk']) * sh.width() / 100 * (sh.style.width ? 1 : env.widen);
      if (!sh.style.width) {
        if (env.minFont) f = Math.max(f, env.minFont);   /* 最小の文字の設定で、これより小さくならない端末を模す */
        if (env.quant) f = Math.ceil(f);                  /* 文字の送りを画素に丸める端末を模す（下げても幅が変わらない段がある） */
      }
      return f;
    },
    get scrollHeight() { return Math.round(sh.width() * 0.6); },   /* 紙の高さには常に収まる（見るのはマスのあふれ） */
    querySelector(sel) { return sel === '.rp-grid' ? { offsetWidth: sh.width() } : null; },
    querySelectorAll(sel) { return sel === '.rp-cell' ? sh.cells : []; }
  };
  sh.cells = cellsSpec.map(([frac, chars]) => ({
    get clientWidth() { return Math.floor(frac * sh.width()); },
    get scrollWidth() { return Math.max(this.clientWidth, Math.ceil(chars * sh.font())); },
    get clientHeight() { return 40; },
    get scrollHeight() { return 40; }
  }));
  return sh;
}
function makeEnv(opt) {
  const env = { screenW: opt.screenW || 933, widen: opt.widen || 1, minFont: opt.minFont || 0, quant: !!opt.quant, sets: {} };
  const els = {
    roomSheet_f1: makeSheet('roomSheet_f1', [[0.08, 5], [0.08, 4], [0.12, 6]], env),
    roomSheet_f2: makeSheet('roomSheet_f2', [[0.08, 3], [0.10, 6]], env)
  };
  const timers = [];
  const body = { classList: classList([]) };
  const b = {
    Math, Number, String, isFinite, parseFloat,
    curView: 'room',
    document: { body },
    window: { innerWidth: opt.innerWidth || 1280 },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].f = null; },
    $: (id) => els[id] || null,
    env, els, body, timers
  };
  vm.createContext(b);
  vm.runInContext([
    cutF(RM, 'fitRoomSheets'), line(RM, /var ROOM_GUARD_MAX=24, ROOM_GUARD_STALL=8;/), cutF(RM, 'roomScreenGuard_'),
    line(RM, /var roomFitWait_=false, roomResizeT_=0, roomFitW_=null;/),
    cutF(RM, 'roomPrinting_'), cutF(RM, 'fitRoomScreen_'), cutF(RM, 'roomOnResize_')
  ].join('\n'), b);
  return b;
}
const g = (b, name) => vm.runInContext(name, b);
const kOf = (px) => Math.round(px * 100 / PW * 1000) / 1000;
function overflowCount(b) {
  let n = 0;
  for (const sh of [b.els.roomSheet_f1, b.els.roomSheet_f2])
    for (const c of sh.cells) if (c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1) n++;
  return n;
}

console.log('\n— 1. 画面の守り（全体を1つの大きさのまま・あふれた時だけ下げる）—');
{
  /* Mac: 画面でも比のとおりに縮む → あふれ無し → 採寸の大きさのまま */
  const mac = makeEnv({ widen: 1 });
  const rs = mac.fitRoomScreen_();
  const best = rs[0].size;
  t('採寸ができる（架空の居室で）', best > 5 && best < 26, rs);
  t('Mac（比のとおり）: 画面であふれていない', overflowCount(mac) === 0, overflowCount(mac));
  t('Mac（比のとおり）: 何もしない＝採寸の大きさのまま（1階・2階とも）', mac.els.roomSheet_f1.vars['--rpk'] === String(kOf(best))
    && mac.els.roomSheet_f2.vars['--rpk'] === String(kOf(best)), [mac.els.roomSheet_f1.vars, kOf(best)]);

  /* Windows: 画面でだけ文字の幅が 4% 広い → あふれる → 2枚とも同じだけ下げる */
  const win = makeEnv({ widen: 1.04 });
  const before = (() => { const r = win.fitRoomSheets(); return overflowCount(win); })();
  t('Windows（比より広い）: 採寸だけだと画面であふれる（空振りしない前提）', before > 0, before);
  const rw = win.fitRoomScreen_();
  const k1 = win.els.roomSheet_f1.vars['--rpk'], k2 = win.els.roomSheet_f2.vars['--rpk'];
  t('Windows: 守りの後は画面であふれない', overflowCount(win) === 0, overflowCount(win));
  t('Windows: 1階・2階は同じ大きさのまま（氏名ごと・階ごとに変えない）', k1 === k2, [k1, k2]);
  t('Windows: 採寸の大きさより小さくなる', parseFloat(k1) < kOf(rw[0].size), [k1, kOf(rw[0].size)]);
  /* 0.25px 刻み: 下げた大きさは「採寸の px − 0.25 × n」の式の値で、1段上ではあふれる */
  for (const sh of [win.els.roomSheet_f1, win.els.roomSheet_f2]) sh.style.setProperty('--rpk', kOf(rw[0].size));   /* 採寸の直後の状態へ戻してから */
  const px = win.roomScreenGuard_([win.els.roomSheet_f1, win.els.roomSheet_f2], rw[0].size, PW);
  t('守りが返す大きさと画面に当てた大きさが同じ', String(kOf(px)) === k1, [kOf(px), k1]);
  t('下げる幅は 0.25px 刻み', Math.abs(((rw[0].size - px) / 0.25) - Math.round((rw[0].size - px) / 0.25)) < 1e-9 && px < rw[0].size, [rw[0].size, px]);
  for (const sh of [win.els.roomSheet_f1, win.els.roomSheet_f2]) sh.style.setProperty('--rpk', kOf(px + 0.25));
  t('1段上（+0.25px）ではあふれる＝必要以上に下げていない', overflowCount(win) > 0, overflowCount(win));
  t('採寸の結果（返す値）は紙の大きさのまま', rw[0].size === best && rw[0].W === PW, rw[0]);

  /* どうしても収まらない時: 下げたままにせず採寸の大きさへ戻す（無限に回らない・表題だけ小さくしない） */
  const hard = makeEnv({ widen: 6 });
  const rh = hard.fitRoomScreen_();
  t('あふれを0にできない時は採寸の大きさ（守りの前）へ戻す（1階・2階とも）', hard.els.roomSheet_f1.vars['--rpk'] === String(kOf(rh[0].size))
    && hard.els.roomSheet_f2.vars['--rpk'] === String(kOf(rh[0].size)) && overflowCount(hard) > 0, hard.els.roomSheet_f1.vars);

  /* 窓を広げた時は採寸からやり直す（守りで下げた大きさを引きずらない） */
  const grow = makeEnv({ widen: 1.04 });
  grow.fitRoomScreen_();
  const low = grow.els.roomSheet_f1.vars['--rpk'];
  grow.env.widen = 1;
  grow.fitRoomScreen_();
  t('あふれなくなれば採寸の大きさへ戻る（下げた大きさを引きずらない）', grow.els.roomSheet_f1.vars['--rpk'] === String(kOf(best)) && low !== grow.els.roomSheet_f1.vars['--rpk'],
    [low, grow.els.roomSheet_f1.vars['--rpk']]);
}

console.log('\n— 1b. 縮まない端末・丸めの段・段数の上限（M1）—');
{
  const shsOf = (b) => [b.els.roomSheet_f1, b.els.roomSheet_f2];
  /* 縮まない端末: 画面の文字が 30px より小さくならない（最小の文字の設定）＝下げてもあふれの合計が減らない */
  const st = makeEnv({ widen: 1.04, minFont: 30 });
  const r0 = st.fitRoomSheets();
  st.env.sets = {};
  const got = st.roomScreenGuard_(shsOf(st), r0[0].size, PW);
  t('縮まない端末: 8段で打ち切る（下げる8回＋戻す1回＝--rpk を9回書く・84段まで回らない）', st.env.sets.roomSheet_f1 === 9 && st.env.sets.roomSheet_f2 === 9, st.env.sets);
  t('縮まない端末: 採寸の大きさ（守りの前）へ戻す・返す値も採寸の大きさ', got === r0[0].size && st.els.roomSheet_f1.vars['--rpk'] === String(kOf(r0[0].size))
    && st.els.roomSheet_f2.vars['--rpk'] === String(kOf(r0[0].size)), [got, r0[0].size, st.els.roomSheet_f1.vars]);

  /* 丸めの段: 文字の送りを画素に丸める端末では、0.25px 下げてもあふれの合計が変わらない段がある */
  const q = makeEnv({ widen: 1.06, quant: true });
  const rq = q.fitRoomSheets();
  const sums = [];
  const sumOf = () => { let s = 0; for (const sh of shsOf(q)) for (const c of sh.cells) { const dw = c.scrollWidth - (c.clientWidth + 1); if (dw > 0) s += dw; } return s; };
  for (let px = rq[0].size; px >= 5; px = Math.round((px - 0.25) * 100) / 100) {
    for (const sh of shsOf(q)) sh.style.setProperty('--rpk', kOf(px));
    sums.push(sumOf()); if (!sums[sums.length - 1]) break;
  }
  let plateau = 0, run = 0; for (let i = 1; i < sums.length; i++) { if (sums[i] > 0 && sums[i] >= sums[i - 1]) plateau = Math.max(plateau, ++run); else run = 0; }
  t('前提: この条件では、下げても合計が減らない段が続く（1段で打ち切ると直せない・空振りしない）', plateau >= 2 && sums[sums.length - 1] === 0, sums);
  for (const sh of shsOf(q)) sh.style.setProperty('--rpk', kOf(rq[0].size));
  const gq = q.roomScreenGuard_(shsOf(q), rq[0].size, PW);
  t('丸めの段があっても1段で打ち切らず、あふれが0になる大きさまで下げる', overflowCount(q) === 0 && gq < rq[0].size
    && q.els.roomSheet_f1.vars['--rpk'] === q.els.roomSheet_f2.vars['--rpk'], [gq, rq[0].size, overflowCount(q)]);

  /* 段数の上限: 下げるたびに少しずつ減るが、24段でもあふれが残る */
  const cap = makeEnv({ widen: 2.5 });
  const rc = cap.fitRoomSheets();
  cap.env.sets = {};
  const gc = cap.roomScreenGuard_(shsOf(cap), rc[0].size, PW);
  t('前提: 24段下げても 5px 相当の下限より上', rc[0].size - 24 * 0.25 > 5, rc[0].size);
  t('段数の上限: 24段で止め（下げる24回＋戻す1回）、採寸の大きさへ戻す', cap.env.sets.roomSheet_f1 === 25 && gc === rc[0].size
    && cap.els.roomSheet_f1.vars['--rpk'] === String(kOf(rc[0].size)), [cap.env.sets, gc, rc[0].size]);
  t('あふれの見方は紙の判定と同じ決まりであることをコメントに残している（中央寄せの左・+1px）',
    /中央寄せで左へはみ出した分は scrollWidth に\s*入らない・\+1px までは許す/.test(cutF(RM, 'roomScreenGuard_')), '');
}

console.log('\n— 2. 紙（fitRoomSheets(m)）は画面の守りを通らない —');
{
  const win = makeEnv({ widen: 1.04 });
  win.fitRoomScreen_();
  const screenK = win.els.roomSheet_f1.vars['--rpk'];
  /* 印刷の採寸（su-print の用紙・既定と同じ A4横10mm）。画面で下げた後に呼ぶ */
  win.body.classList.add('su-printing'); win.body.classList.add('room-on');
  const m = { wPx: PW, hPx: (210 - 20) * 96 / 25.4 };
  const rp = win.fitRoomSheets(m);
  const mac = makeEnv({ widen: 1 }); const macBest = mac.fitRoomSheets(m)[0].size;
  t('紙の採寸は紙の幅から測り直す（画面で下げた大きさが混ざらない）', rp[0].size === macBest, [rp[0].size, macBest]);
  t('紙の採寸の後のシートは紙の大きさ（下げていない）', win.els.roomSheet_f1.vars['--rpk'] === String(kOf(macBest))
    && win.els.roomSheet_f2.vars['--rpk'] === String(kOf(macBest)) && screenK !== String(kOf(macBest)), [win.els.roomSheet_f1.vars, screenK]);
  const fr = cutF(RM, 'fitRoomSheets');
  t('fitRoomSheets の中に画面の守りを入れていない', !/roomScreenGuard_|fitRoomScreen_|roomPrinting_/.test(fr), '');
  t('印刷の入口は今までどおり fitRoomSheets(st.metrics)', /var rs=fitRoomSheets\(st\.metrics\);/.test(RM), '');
  t('印刷の後は su-print の putSnap が印刷前の画面の style へ戻す（restoreSel に2枚）', /restoreSel:\['roomSheet_f1','roomSheet_f2'\]/.test(RM), '');

  /* 印刷の準備中に画面の採寸が走っても、守りは掛けない */
  const p = makeEnv({ widen: 1.04 });
  p.body.classList.add('su-printing');
  p.fitRoomScreen_();
  t('印刷の準備中（su-printing）は画面の守りを掛けない', p.els.roomSheet_f1.vars['--rpk'] === String(kOf(macBest)), p.els.roomSheet_f1.vars);
  const q = makeEnv({ widen: 1.04 });
  q.body.classList.add('room-on');
  q.fitRoomScreen_();
  t('印刷の準備中（room-on）も同じ', q.els.roomSheet_f1.vars['--rpk'] === String(kOf(macBest)), q.els.roomSheet_f1.vars);
}

console.log('\n— 3. 採寸し直しのきっかけ —');
{
  const b = makeEnv({ widen: 1.04 });
  b.els.roomSheet_f1.offsetParent = null;
  const r0 = b.fitRoomScreen_();
  t('非表示で測れなかった時は印を立てる', r0 === null && g(b, 'roomFitWait_') === true, g(b, 'roomFitWait_'));
  b.els.roomSheet_f1.offsetParent = {};
  b.fitRoomScreen_();
  t('表示されて測れたら印を下ろす（守りも掛かる）', g(b, 'roomFitWait_') === false && overflowCount(b) === 0, [g(b, 'roomFitWait_'), overflowCount(b)]);
  t('一覧が表示された時（showScreen の list）、印がある時だけ測り直す',
    /if\(curView==='room'&&roomFitWait_\)\{ try\{ fitRoomScreen_\(\); \}catch\(e\)\{\} \}/.test(cutF(RM, 'showScreen')), '');
  t('描画（renderRoster）は採寸＋画面の守りを通す', /if\(curView==='room'\) fitRoomScreen_\(\);/.test(cutF(RM, 'renderRoster'))
    && !/fitRoomSheets\(\)/.test(cutF(RM, 'renderRoster')), '');

  const r = makeEnv({ widen: 1.04 });
  r.curView = 'cm';
  r.roomOnResize_();
  t('窓の大きさが変わっても、居室一覧でなければ何もしない', r.timers.length === 0, r.timers.length);
  r.curView = 'room';
  r.roomOnResize_(); r.roomOnResize_(); r.roomOnResize_();
  const live = r.timers.filter((x) => x.f);
  t('居室一覧の時は 200ms 待って1回だけ（続けて変わっても1回）', live.length === 1 && live[0].ms === 200, r.timers.map((x) => [!!x.f, x.ms]));
  live[0].f();
  t('待った後に採寸＋画面の守りを掛ける', overflowCount(r) === 0 && r.els.roomSheet_f1.vars['--rpk'] !== '1.3', r.els.roomSheet_f1.vars);
  const r2 = makeEnv({ widen: 1.04 });
  r2.roomOnResize_(); r2.body.classList.add('su-printing');
  r2.timers[0].f();
  t('印刷の準備中に待ちが明けても採寸しない', r2.els.roomSheet_f1.vars['--rpk'] === '1.3', r2.els.roomSheet_f1.vars);
  t('窓の大きさの変化を見ている', /window\.addEventListener\('resize',roomOnResize_\);/.test(RM), '');

  /* 幅が前に測った時と同じなら測らない（L6・iPhone のツールバーの出入りは高さだけの resize） */
  const w = makeEnv({ widen: 1.04, innerWidth: 1280 });
  w.fitRoomScreen_();
  t('測った時の窓の幅を覚える', g(w, 'roomFitW_') === 1280, g(w, 'roomFitW_'));
  w.roomOnResize_(); w.roomOnResize_();
  t('幅が同じ resize（高さだけ）では測らない', w.timers.length === 0, w.timers.length);
  w.window.innerWidth = 1000;
  w.roomOnResize_();
  t('幅が変わった時は 200ms 後に測る', w.timers.filter((x) => x.f).length === 1, w.timers.length);
  w.env.sets = {};
  w.timers.filter((x) => x.f)[0].f();
  t('測ったら新しい幅を覚える', g(w, 'roomFitW_') === 1000 && (w.env.sets.roomSheet_f1 || 0) > 0, [g(w, 'roomFitW_'), w.env.sets]);
  w.window.innerWidth = 1100; w.roomOnResize_();
  w.window.innerWidth = 1000;                       /* 待っている間に元の幅へ戻った */
  w.env.sets = {};
  w.timers.filter((x) => x.f)[0].f();
  t('待っている間に測った幅へ戻ったら測らない', !w.env.sets.roomSheet_f1, w.env.sets);
  t('文字の読み込みの後に1回（居室一覧の時だけ）', /document\.fonts\.ready\.then\(function\(\)\{\s*if\(curView==='room'&&!roomPrinting_\(\)\)\{ try\{ fitRoomScreen_\(\); \}catch\(e\)\{\} \}/.test(RM), '');
}

console.log('\n— 4. 居室一覧の氏名に「様」を付けない —');
{
  const b = { String, Array, Object, Math, Number, isFinite };
  vm.createContext(b);
  vm.runInContext([cutF(RM, 'esc'), cutF(RM, 'rpNum_'), cutF(RM, 'roomSideCls'), cutF(RM, 'roomCellHtml')].join('\n'), b);
  const cell = { r: 1, c: 1, room: '101' };
  const one = b.roomCellHtml(cell, { '101': [{ name: '架空　一郎' }] });
  t('氏名だけを出す（「様」を付けない）', /<div class="rp-nm">架空　一郎<\/div>/.test(one) && one.indexOf('様') < 0, one);
  const sp = b.roomCellHtml(cell, { '101': [{ name: '架空 二郎' }] });
  t('名前の中の空白（半角）は直さない', /<div class="rp-nm">架空 二郎<\/div>/.test(sp), sp);
  const ix = b.roomCellHtml(cell, { '101': [{ name: '架空　髙﨑𠮷' }] });
  t('異体字は直さない（そのまま出す）', /<div class="rp-nm">架空　髙﨑𠮷<\/div>/.test(ix), ix);
  const nosp = b.roomCellHtml(cell, { '101': [{ name: '架空三郎' }] });
  t('空白の無い名前に空白を足さない', /<div class="rp-nm">架空三郎<\/div>/.test(nosp), nosp);
  const two = b.roomCellHtml(cell, { '101': [{ name: '架空　一郎' }, { name: '架空　花子' }] });
  t('同じ居室に2名の時は今までどおり（改行で並べる・rp-dup）', /class="rp-cell rp-room rp-dup"/.test(two)
    && /<div class="rp-nm">架空　一郎<br>架空　花子<\/div>/.test(two) && two.indexOf('様') < 0, two);
  const evil = b.roomCellHtml(cell, { '101': [{ name: '<b>架空</b>' }] });
  t('氏名は今までどおりエスケープする', evil.indexOf('<b>') < 0 && evil.indexOf('&lt;b&gt;架空&lt;/b&gt;') >= 0, evil);
  const empty = b.roomCellHtml({ r: 1, c: 1, room: '102', note: '倉庫' }, {});
  t('空室の用途の表示は今までどおり', /<div class="rp-nm">倉庫<\/div>/.test(empty), empty);
  t('居室一覧の組み立て（roomCellHtml）に「様」の文字が無い', cutF(RM, 'roomCellHtml').indexOf("'様'") < 0, '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);

/* su-dialog.js（ブラウザの alert・confirm の代わりに画面の中の窓を出す共通部品・2026-11-12 代表者の決定）の試験。
 * 架空の window / document で動かす（外へは通信しない・端末に書かない）。
 * 確かめること: 文がそのまま入る（textContent・改行もそのまま）／OK＝true・キャンセル＝false・Esc＝false・Enter（OK に合っている時）＝true／
 *   OK に初めから合わせる／2つ続けて呼ぶと1つ目を閉じてから2つ目が出る／showModal が無い・例外の時はブラウザの窓に落ちる／
 *   ボタンの文字は「OK」「キャンセル」／文字 17px・ボタン 44px 以上／<style> を差し込まず su-dialog.css を <link> で読む／
 *   印刷で隠す／busy と idle／二重に読み込んでも1つ／体重管理の読み込みの位置と受け口・置き換えの残り
 * 実行: node check/unit/su_dialog_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-dialog.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'su-dialog.css'), 'utf8');
let ok = 0, ng = 0;
function t(name, cond, extra){ if(cond){ ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } }
const tick = () => new Promise((r) => setImmediate(r));

function makeEnv(opt){
  opt = opt || {};
  const nativeLog = [], links = [], styles = [];
  let focused = null;
  function el(tag){
    const L = {};
    const e = { tagName: String(tag).toUpperCase(), style: {}, attrs: {}, children: [], parentNode: null, className: '', id: '', textContent: '', open: false,
      setAttribute(k, v){ this.attrs[k] = String(v); },
      appendChild(c){ c.parentNode = this; this.children.push(c); if(c.tagName === 'LINK') links.push(c); if(c.tagName === 'STYLE') styles.push(c); return c; },
      removeChild(c){ this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      addEventListener(ev, fn){ (L[ev] = L[ev] || []).push(fn); },
      fire(ev, obj){ const o = Object.assign({ type: ev, defaultPrevented: false, stopped: false,
        preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; } }, obj || {});
        (L[ev] || []).slice().forEach((f) => f.call(this, o)); return o; },
      contains(x){ for(let n = x; n; n = n.parentNode) if(n === this) return true; return false; },
      focus(){ focused = this; } };
    if(e.tagName === 'DIALOG' && !opt.noShowModal){
      e.showModal = function(){ if(opt.throwShow) throw new Error('壊れた'); this.open = true; };
      e.close = function(){ if(!this.open) return; this.open = false; const self = this; setImmediate(() => self.fire('close')); };
    }
    return e;
  }
  const body = el('body'), head = el('head');
  const document = { body, head, documentElement: body, createElement: el };
  const winL = {}; const winCap = [];
  const win = { document, setTimeout, clearTimeout, Promise,
    alert(m){ nativeLog.push(['alert', m]); },
    confirm(m){ nativeLog.push(['confirm', m]); return opt.nativeAnswer !== undefined ? opt.nativeAnswer : true; },
    addEventListener(ev, fn, opt){ (winL[ev] = winL[ev] || []).push(fn); if(ev === 'keydown') winCap.push(opt === true || !!(opt && opt.capture)); } };
  win.window = win; win.self = win; win.top = opt.inFrame ? {} : win;
  const ctx = vm.createContext(win);
  return { ctx, win, body, nativeLog, links, styles, focused: () => focused,
    load(){ vm.runInContext(SRC, ctx); },
    dialogs(){ return body.children.filter((c) => c.tagName === 'DIALOG'); },
    winCap: () => winCap,
    winFire(ev){ (winL[ev] || []).forEach((f) => f()); },
    winKey(o){ const e = Object.assign({ defaultPrevented: false, imm: false, preventDefault(){ this.defaultPrevented = true; }, stopImmediatePropagation(){ this.imm = true; } }, o); (winL.keydown || []).forEach((f) => f(e)); return e; } };
}
function partsOf(d){
  const inner = d.children[0];
  const msg = inner.children[0], row = inner.children[1];
  const btns = row.children;
  return { msg, btns, ok: btns.find((b) => b.textContent === 'OK'), cancel: btns.find((b) => b.textContent === 'キャンセル') };
}

(async () => {
  console.log('su-dialog.js');
  {
    const E = makeEnv(); E.load();
    t('window.SUDialog に alert・confirm・busy・idle', ['alert', 'confirm', 'busy', 'idle'].every((k) => typeof E.win.SUDialog[k] === 'function'));
    t('見た目は su-dialog.css を <link> で読む（<style> を差し込まない）', E.links.length === 1 && /^su-dialog\.css\?v=2026-11-12$/.test(E.links[0].href) && E.styles.length === 0 && !/createElement\(\s*['"]style['"]\s*\)/.test(SRC));
    t('innerHTML を使わない', !/innerHTML/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

    const MSG = '一行目\n<b>二行目</b> & "引用"\n\nOK＝保存する';
    let ans = 'まだ';
    const p = E.win.SUDialog.confirm(MSG); p.then((v) => { ans = v; });
    const ds = E.dialogs();
    t('confirm: 呼んだその場で窓が1つ出る（showModal）', ds.length === 1 && ds[0].open === true);
    const P = partsOf(ds[0]);
    t('文がそのまま入る（textContent・改行も記号もそのまま）', P.msg.textContent === MSG, P.msg.textContent);
    t('改行が見える（white-space: pre-wrap）', P.msg.style.whiteSpace === 'pre-wrap' && /\.sud-msg\{[^}]*white-space:pre-wrap/.test(CSS));
    t('ボタンは「キャンセル」「OK」の2つ', P.btns.length === 2 && !!P.ok && !!P.cancel);
    t('OK に初めから合わせる', E.focused() === P.ok);
    t('confirm: 窓に読み上げ用の名前「確認」が付く（名前の無いダイアログにしない）', ds[0].attrs['aria-label'] === '確認', ds[0].attrs['aria-label']);
    t('文字 17px・ボタン 44px 以上（要素への直接の指定と CSS の両方）', P.msg.style.fontSize === '17px' && P.ok.style.minHeight === '44px' && P.cancel.style.minHeight === '44px'
      && /\.sud-btn\{min-height:44px/.test(CSS) && /\.sud-msg\{[^}]*font-size:17px/.test(CSS));
    t('窓が出ている間は busy', E.win.SUDialog.busy() === true);
    t('答える前は約束が解けていない', (await tick(), ans === 'まだ'));
    P.ok.fire('click'); await tick();
    t('OK＝true', ans === true);
    t('閉じた後は窓を取り除き busy でない', E.dialogs().length === 0 && E.win.SUDialog.busy() === false);
  }
  {
    const E = makeEnv(); E.load();
    let ans = 'まだ'; E.win.SUDialog.confirm('消しますか？').then((v) => { ans = v; });
    partsOf(E.dialogs()[0]).cancel.fire('click'); await tick();
    t('キャンセル＝false', ans === false);
  }
  {
    const E = makeEnv(); E.load();
    let ans = 'まだ'; E.win.SUDialog.confirm('消しますか？').then((v) => { ans = v; });
    const d = E.dialogs()[0];
    await new Promise((r) => setTimeout(r, 5));   // 人が Esc を押すのは、窓が開いた後の別の処理の中
    const kd = d.fire('keydown', { key: 'Escape' });
    t('窓の中のキーは画面へ伝えない（画面の Esc の処理を一緒に動かさない）', kd.stopped === true);
    d.fire('cancel'); d.open = false; await tick();   // Esc はブラウザが cancel を出して窓を閉じる
    t('Esc＝false', ans === false);
  }
  {
    /* 窓が出ている間に、入力の的が窓の外（body など）にある時のキーは画面へ渡さない（2026-11-13 反証レビューの指摘・週間計画の偽りの「削除しました」の道） */
    const E = makeEnv(); E.load();
    let ans = 'まだ'; E.win.SUDialog.confirm('この予定を削除しますか？').then((v) => { ans = v; });
    await new Promise((r) => setTimeout(r, 5));
    const P = partsOf(E.dialogs()[0]);
    const k1 = E.winKey({ key: 'z', metaKey: true, target: E.body });
    t('窓の外のキー（Cmd+Z など）は画面へ渡さず、既定の動きも止め、OK に入力の的を戻す', k1.imm === true && k1.defaultPrevented === true && E.focused() === P.ok && ans === 'まだ');
    const k2 = E.winKey({ key: 'Enter', target: E.body });
    t('窓の外の Enter では OK にしない（答えはまだ）', k2.imm === true && ans === 'まだ');
    const kIn = E.winKey({ key: 'Enter', target: P.ok });
    t('窓の中のキーはそのまま（守りは手を出さない）', kIn.imm === false && kIn.defaultPrevented === false);
    t('守りは画面より先に受ける（window の capture で付ける）', E.winCap().length === 1 && E.winCap()[0] === true, E.winCap());
    const kc = E.winKey({ key: 'c', metaKey: true, target: E.body });
    t('窓の文を写す Cmd+C は画面へ渡さないが、写す動き（既定）は止めない', kc.imm === true && kc.defaultPrevented === false && ans === 'まだ');
    E.winKey({ key: 'Escape', target: E.body }); await tick();
    t('窓の外の Esc は、今の窓のキャンセル＝false（画面の Esc の処理は動かない）', ans === false);
    const k3 = E.winKey({ key: 'Escape', target: E.body });
    t('窓が閉じた後のキーは、画面へそのまま渡す', k3.imm === false && k3.defaultPrevented === false);
  }
  {
    /* Esc 以外（ボタンの押下・答えを待った後の続き）で開いた窓は、開いた直後の Esc（cancel）もキャンセルとして受ける（2026-11-13 実測の指摘） */
    const E = makeEnv(); E.load();
    E.win.event = { type: 'click' };
    let ans = 'まだ'; E.win.SUDialog.confirm('消しますか？').then((v) => { ans = v; });
    E.win.event = undefined;
    const d = E.dialogs()[0];
    const c0 = d.fire('cancel'); d.open = false; await tick();
    t('ボタンの押下で開いた窓は、開いた直後の Esc でもキャンセル＝false', c0.defaultPrevented === false && ans === false);
  }
  {
    /* 素早い二度押しの2回目が、中央に出た OK に重なっても答えない（マウス・指の押下だけ・開いてから少しの間） */
    const E = makeEnv(); E.load();
    let ans = 'まだ'; E.win.SUDialog.confirm('切り替えますか？').then((v) => { ans = v; });
    const P = partsOf(E.dialogs()[0]);
    P.ok.fire('click', { detail: 1 }); await tick();
    t('開いてすぐのマウスの押下（二度押しの2回目）では OK にしない', ans === 'まだ' && E.dialogs().length === 1);
    P.ok.fire('click', { detail: 0 }); await tick();
    t('キーボード（Enter・Space）の押下は、開いてすぐでも今までどおり OK', ans === true);
    const E2 = makeEnv(); E2.load();
    let ans2 = 'まだ'; E2.win.SUDialog.confirm('切り替えますか？').then((v) => { ans2 = v; });
    await new Promise((r) => setTimeout(r, 400));
    partsOf(E2.dialogs()[0]).ok.fire('click', { detail: 1 }); await tick();
    t('少し経った後のマウスの押下は、今までどおり OK', ans2 === true);
  }
  {
    /* 画面の Esc の処理の中で窓を開いた時、同じ Esc が開いたばかりの窓をすぐ閉じない（週間計画で実測した穴・部品の側で塞ぐ） */
    const E = makeEnv(); E.load();
    const esc = { type: 'keydown', key: 'Escape', defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; } };
    E.win.event = esc;
    let ans = 'まだ'; E.win.SUDialog.confirm('閉じますか？').then((v) => { ans = v; });
    E.win.event = undefined;
    const d = E.dialogs()[0];
    t('Esc キーの押下の中で開いた時は、その Esc の既定の動き（窓を閉じる）を止める', esc.defaultPrevented === true);
    const c1 = d.fire('cancel'); await tick();
    t('開いたのと同じ一続きの処理の中の cancel は受けない（窓は出たまま・答えはまだ）', c1.defaultPrevented === true && ans === 'まだ' && E.dialogs().length === 1);
    await new Promise((r) => setTimeout(r, 5));
    d.fire('cancel'); d.open = false; await tick();
    t('その後の Esc（cancel）は今までどおりキャンセル＝false', ans === false);
  }
  {
    const E = makeEnv(); E.load();
    let ans = 'まだ'; E.win.SUDialog.confirm('保存しますか？').then((v) => { ans = v; });
    const d = E.dialogs()[0]; const P = partsOf(d);
    const rep = d.fire('keydown', { key: 'Enter', repeat: true });
    t('押しっぱなしの Enter（窓を開いたボタンの続き）では OK にしない', rep.defaultPrevented === true && ans === 'まだ');
    const kd = d.fire('keydown', { key: 'Enter', repeat: false });
    t('Enter は止めない（合っている OK ボタンがブラウザの既定の動きで押される）', kd.defaultPrevented === false);
    E.focused().fire('click'); await tick();   // ブラウザは Enter で、合っているボタン（OK）を押す
    t('Enter＝true', ans === true);
  }
  {
    const E = makeEnv(); E.load();
    let done = false; E.win.SUDialog.alert('お知らせ\n2行目').then((v) => { done = v === undefined; });
    const P = partsOf(E.dialogs()[0]);
    t('alert: ボタンは「OK」1つで、文がそのまま', P.btns.length === 1 && !!P.ok && P.msg.textContent === 'お知らせ\n2行目');
    t('alert: OK に初めから合わせる', E.focused() === P.ok);
    t('alert: 窓に読み上げ用の名前「お知らせ」が付く', E.dialogs()[0].attrs['aria-label'] === 'お知らせ', E.dialogs()[0].attrs['aria-label']);
    P.ok.fire('click'); await tick();
    t('alert: 閉じたら約束が解ける', done === true);
  }
  {
    const E = makeEnv(); E.load();
    const order = [];
    E.win.SUDialog.confirm('1つ目').then((v) => order.push('1:' + v));
    E.win.SUDialog.alert('2つ目').then(() => order.push('2'));
    E.win.SUDialog.confirm('3つ目').then((v) => order.push('3:' + v));
    t('3つ続けて呼んでも、出ている窓は1つ目だけ', E.dialogs().length === 1 && partsOf(E.dialogs()[0]).msg.textContent === '1つ目');
    partsOf(E.dialogs()[0]).cancel.fire('click'); await tick();
    t('1つ目を閉じると2つ目が出る', E.dialogs().length === 1 && partsOf(E.dialogs()[0]).msg.textContent === '2つ目' && order.join() === '1:false');
    partsOf(E.dialogs()[0]).ok.fire('click'); await tick();
    t('2つ目を閉じると3つ目が出て、OK に合わせる', E.dialogs().length === 1 && partsOf(E.dialogs()[0]).msg.textContent === '3つ目' && E.focused() === partsOf(E.dialogs()[0]).ok);
    let idled = false; E.win.SUDialog.idle().then(() => { idled = true; });
    await tick(); await new Promise((r) => setTimeout(r, 5));
    t('窓が残っている間は idle が解けない', idled === false && E.win.SUDialog.busy() === true);
    partsOf(E.dialogs()[0]).ok.fire('click'); await tick(); await new Promise((r) => setTimeout(r, 5));
    t('呼んだ順に答えが返る', order.join() === '1:false,2,3:true', order);
    t('全部閉じたら idle が解け、busy でない', idled === true && E.win.SUDialog.busy() === false);
  }
  {
    const E = makeEnv({ noShowModal: true, nativeAnswer: false }); E.load();
    const a = await E.win.SUDialog.confirm('古いブラウザ');
    await E.win.SUDialog.alert('お知らせ');
    t('showModal が無い時はブラウザの窓に落ちる（答えもそのまま）', a === false && E.nativeLog.length === 2 && E.nativeLog[0][0] === 'confirm' && E.nativeLog[0][1] === '古いブラウザ' && E.nativeLog[1][0] === 'alert', E.nativeLog);
    t('窓の部品を残さない', E.dialogs().length === 0 && E.win.SUDialog.busy() === false);
  }
  {
    const E = makeEnv({ throwShow: true, nativeAnswer: true }); E.load();
    let err = null, a;
    try { a = await E.win.SUDialog.confirm('例外'); } catch (e) { err = e; }
    t('showModal で例外の時もブラウザの窓に落ち、例外を外に出さない', err === null && a === true && E.nativeLog.length === 1 && E.dialogs().length === 0);
  }
  {
    const E = makeEnv({ inFrame: true }); E.load();
    E.win.SUDialog.alert('枠の中');
    t('枠（iframe）の中でも画面の中の窓を出す', E.dialogs().length === 1 && E.nativeLog.length === 0);
  }
  {
    const E = makeEnv(); E.load();
    const first = E.win.SUDialog; E.load();
    t('二重に読み込んでも1つ（作り直さない・CSS も1本）', E.win.SUDialog === first && E.links.length === 1);
    E.win.SUDialog.alert('印刷');
    E.winFire('beforeprint');
    const d = E.dialogs()[0];
    t('印刷の前に隠し、後で戻す（CSS が読めない時の守り）', d.style.visibility === 'hidden' && (E.winFire('afterprint'), d.style.visibility === ''));
    t('CSS: 印刷では窓を出さない・後ろを暗くする', /@media print\{\.sud-dlg\{display:none!important\}\}/.test(CSS) && /\.sud-dlg::backdrop\{background:rgba\(0,0,0,\.5\)\}/.test(CSS));
  }
  {
    /* 端末に書かない・通信しない */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
    t('端末に書かない・通信しない（localStorage・fetch・XMLHttpRequest を使わない）', !/localStorage|sessionStorage|fetch\(|XMLHttpRequest/.test(code));
    const GI = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    t('.gitignore に !/su-dialog.js と !/su-dialog.css', /^!\/su-dialog\.js$/m.test(GI) && /^!\/su-dialog\.css$/m.test(GI));
  }

  console.log('\n体重管理（weight-record.html）への当て方');
  {
    const WR = fs.readFileSync(path.join(ROOT, 'weight-record.html'), 'utf8');
    const iErr = WR.indexOf('<script src="su-errors.js'), iDlg = WR.indexOf('<script src="su-dialog.js?v=2026-11-13"></script>'), iInline = WR.indexOf('<script>', iErr);
    t('su-dialog.js を su-errors.js の後・画面のスクリプトより前に読む', iErr > 0 && iDlg > iErr && iDlg < iInline);
    /* 部品が読めない時の受け口：ブラウザの窓に落とし、同じ約束の形で答える */
    const shimM = /if\(!window\.SUDialog\) window\.SUDialog = \{[\s\S]*?\n\};/.exec(WR);
    t('部品が読めない時の受け口がある', !!shimM);
    if (shimM) {
      const log = [];
      const ctx = vm.createContext({ window: { alert(m){ log.push('a:' + m); }, confirm(m){ log.push('c:' + m); return true; } }, Promise });
      ctx.window.window = ctx.window;
      vm.runInContext(shimM[0], ctx);
      const S = ctx.window.SUDialog;
      const a = await S.confirm('確かめ'); await S.alert('知らせ');
      t('受け口: ブラウザの窓の答えを約束で返す', a === true && log.join() === 'c:確かめ,a:知らせ' && S.busy() === false && typeof S.idle().then === 'function', log);
    }
    const code = WR.replace(/<!--[\s\S]*?-->/g, '');
    const left = (code.match(/(?<![.\w$])(alert|confirm)\s*\(/g) || []).length;
    t('画面の処理にブラウザの alert( / confirm( が残っていない（受け口の window.alert・window.confirm だけ）', left === 0 && (code.match(/\bwindow\.(alert|confirm)\s*\(/g) || []).length === 2, left);
    t('窓が出ている間は同期を始めない（窓の後へ回す）', /SUDialog\.busy\(\)\) \? SUDialog\.idle\(\)\.then\(\(\)=> _syncFromAPIImpl\(showLoader\)\) : _syncFromAPIImpl\(showLoader\);/.test(WR));
    t('窓が出ている間は名簿の版の見張りが取り込まない', /if\(window\.SUDialog && typeof SUDialog\.busy === 'function' && SUDialog\.busy\(\)\) return;   \/\/ 画面の中の窓が出ている間は名簿を取り込まない/.test(WR));
    t('まとめて保存の後の車椅子の確かめは、入居者ごとに順に待ってから知らせる', /for\(const rid of chairResChanged\) await wcRecalcAsk_\(rid, wcLogStored_\(residentById\(rid\)\)\);\n  await alertChairChange_\(chairAsks\);/.test(WR));
  }

  console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.log('  ✗ 試験の途中で例外 ' + (e && e.stack)); process.exit(1); });

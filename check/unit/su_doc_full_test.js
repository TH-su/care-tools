/* 添付書類（職員マスタ・入居調整）の正本の切り替え・戻す（su-doc-full.js・統合 0065・2026-11-05）の試験。架空データのみ。
   守ること:
     V 切り替える前に、この端末の接続先の GAS に書類の切り替えの部品があり、種類が合うか（docPing が cutover:true・kind）を確かめる（何も止める前・札も取らない）
     A 切り替える: 札（種類つき）→ GAS の出し入れを止めて最後の写し（docCutover on・札と証明つき・more は続き）→ 切り替える（doc_set_mode live）→ 札を返す
     B 途中で止まったら: 切り替えの札を返し、戻す札を取り直して GAS の出し入れを戻す（docCutover off）。戻せなかったら知らせる
     C 札が取れない（別の操作中）時は GAS に触らない
     D 戻す: 札 → 写し返す（docMirror）→ 写しの期間に戻す（写し返しが残ればやり直す）→ GAS の印を外す（more は続き）→ 札を返す
     G 戻す時に今の状態を読めなければ、成功と言わずに止める
     F 断りの文・端末に何も書かない
   実行: node check/unit/su_doc_full_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-doc-full.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const w = { setTimeout, Promise, Object, Error, String, Number, JSON, Math };
w.window = w; vm.createContext(w); vm.runInContext(SRC, w);
const F = w.SUDocFull;

function io(o) {
  o = o || {};
  const log = [];
  let tokN = 0, mode = o.mode || 'shadow', setTries = 0;
  const kind = o.kind || 'stf';
  const x = {
    log, undoWait: [0, 0, 0],
    token: async () => (o.noLogin ? null : 'h.p.s'),
    progress: () => {},
    gas: async (b) => {
      log.push('gas:' + b.action + (b.on === true ? ':on' : b.on === false ? ':off' : '') + (b.opToken ? ':' + b.opToken : ''));
      if (b.action === 'docPing') {
        if (o.pingFail) throw new Error('offline');
        return o.ping || { ok: true, cutover: true, kind: o.gasKind || kind, switched: false };
      }
      if (b.accessToken !== 'h.p.s') return { ok: false, error: 'no token' };
      if (b.action === 'docCutover' && b.on && o.gasOnFail) return { ok: false, error: 'refused', hint: o.onHint || 'ほかの保存が終わるのを待っています。少し待ってからもう一度お試しください' };
      if (b.action === 'docCutover' && !b.on && o.gasOffFail) return { ok: false, error: 'refused', hint: o.offHint || '戻せません' };
      if (b.action === 'docMirror' && o.mirrorFail) return { ok: false, error: 'refused', hint: '写し返す中身を受け取れませんでした' };
      if (b.action === 'docCutover' && o.moreN && o.moreN-- > 0) return { ok: true, switched: !!b.on, copied: 2, more: true };
      return b.action === 'docCutover' ? { ok: true, switched: !!b.on, copied: 3 } : { ok: true, kind, mode, copied: 1, removed: 0, left: 0, failed: 0, more: false };
    },
    rpc: async (n, a) => {
      log.push('rpc:' + n + (a && a.p_kind ? ':' + a.p_kind : '') + (a && a.p_op ? ':' + a.p_op : '') + (a && a.p_mode ? ':' + a.p_mode : '') + (a && a.p_token ? ':' + a.p_token : ''));
      if (n === 'doc_op_begin') { if (o.busy) return { data: { ok: false, error: 'busy' } }; return { data: { ok: true, token: 'T' + (++tokN) } }; }
      if (n === 'doc_op_end') return { data: { ok: true } };
      if (n === 'doc_mode_get') { if (o.modeFail) throw new Error('offline'); const d = { ok: true, tenant: '00000000-0000-4000-8000-000000000001', stf: { mode: 'shadow' }, adm: { mode: 'shadow' } }; d[kind] = { mode }; return { data: d }; }
      if (n === 'doc_set_mode') {
        setTries++;
        if (a.p_mode === 'live') { if (o.setFail) return { data: { ok: false, error: o.setFail } }; const was = mode; mode = 'live'; return { data: { ok: true, mode: 'live', unchanged: was === 'live' } }; }
        if (o.unmirroredOnce && setTries === 1) return { data: { ok: false, error: 'unmirrored' } };
        mode = 'shadow'; return { data: { ok: true, mode: 'shadow' } };
      }
      return { data: { ok: true } };
    }
  };
  return x;
}

(async () => {
  console.log('V 部品の確かめ');
  {
    const a = io({ ping: { ok: false, error: 'unknown action' } });
    const r = await F.cutover(a, 'stf');
    t('V 書類の切り替えの部品の無い GAS → 決まった文で止め、札も取らず GAS に触らない', !r.ok && /職員マスタの GAS に書類の切り替えの部品が入っていないか/.test(r.why) && a.log.join() === 'gas:docPing', a.log);
    const b = io({ kind: 'adm', gasKind: 'stf' });
    const r2 = await F.cutover(b, 'adm');
    t('V 入居調整の接続先が職員マスタの GAS になっている → 止める（種類が違う）', !r2.ok && /別のアプリの GAS/.test(r2.why) && b.log.join() === 'gas:docPing', r2);
    const c = io({ ping: { ok: false, error: 'unauthorized' } });
    const r3 = await F.cutover(c, 'stf');
    t('V 合言葉が違う → 止める', !r3.ok && /合言葉が違います/.test(r3.why) && c.log.join() === 'gas:docPing');
    const d = io({ pingFail: true });
    const r4 = await F.cutover(d, 'adm');
    t('V GAS に届かない → 止める', !r4.ok && /入居調整の GAS に届きませんでした/.test(r4.why) && d.log.join() === 'gas:docPing');
    const e = io();
    const r5 = await F.cutover(e, 'xyz');
    t('V 種類が違う → 何もしない', !r5.ok && e.log.length === 0);
  }
  console.log('A 切り替える');
  {
    const a = io({ kind: 'adm' });
    const r = await F.cutover(a, 'adm');
    t('A 順番: 部品の確かめ → 札（種類つき）→ docCutover on → doc_set_mode live → 札を返す',
      r.ok && a.log.join() === 'gas:docPing,rpc:doc_op_begin:adm:cutover,gas:docCutover:on:T1,rpc:doc_set_mode:adm:live:T1,rpc:doc_op_end:adm:T1', a.log);
    t('A 止めた後に写した書類の数を返す', r.files === 3 && r.unchanged === false, r);
    const m = io({ moreN: 2 });
    const rm = await F.cutover(m, 'stf');
    t('A 書類が多い（more）→ 同じ札で続きを写してから切り替える・数は合計', rm.ok && m.log.filter(l => l === 'gas:docCutover:on:T1').length === 3 && rm.files === 7, [rm, m.log]);
    const m2 = io({ moreN: 9 });
    const rm2 = await F.cutover(m2, 'stf');
    t('A 6回で写し終わらない → 切り替えず、GAS の出し入れを戻す', !rm2.ok && /写しが終わりませんでした/.test(rm2.why) && !m2.log.some(l => /doc_set_mode:stf:live/.test(l)) && m2.log.includes('gas:docCutover:off:T2'), m2.log);
    const b = io({ mode: 'live' });
    const r2 = await F.cutover(b, 'stf');
    t('A もう切り替わっている（unchanged）は成功・何も変えていない', r2.ok && r2.unchanged === true);
    const c = io({ noLogin: true });
    const r3 = await F.cutover(c, 'stf');
    t('A ログインしていなければ何もしない', !r3.ok && c.log.length === 0);
  }
  console.log('B 途中で止まった');
  {
    const a = io({ gasOnFail: true, onHint: '写せない書類が 2 件あります（形が対象外・大きすぎる・名前の形が違う）。Google ドライブの書類を直してから押してください' });
    const r = await F.cutover(a, 'stf');
    t('B GAS が断った（写せない書類）→ 戻す札で GAS の出し入れを戻し、断りの文（hint）を出す', !r.ok && /写せない書類が 2 件/.test(r.why) && a.log.includes('gas:docCutover:off:T2') && a.log.includes('rpc:doc_op_end:stf:T1') && a.log.includes('rpc:doc_op_end:stf:T2'), [r, a.log]);
    const b = io({ setFail: 'notclean' });
    const r2 = await F.cutover(b, 'stf');
    t('B 切り替えが断られた（写せない書類が残る）→ GAS の出し入れを戻す', !r2.ok && /写せない書類が残っています/.test(r2.why) && b.log.includes('gas:docCutover:off:T2'), b.log);
    const c = io({ kind: 'adm', setFail: 'stale', gasOffFail: true });
    const r3 = await F.cutover(c, 'adm');
    t('B 戻せなかった → 「入居調整の書類を写しの期間に戻す」を押すよう知らせる', !r3.ok && /入居調整の書類を写しの期間に戻す/.test(r3.why));
  }
  console.log('C 札が取れない');
  {
    const a = io({ busy: true });
    const r = await F.cutover(a, 'stf');
    t('C 別の操作中 → GAS に触らない', !r.ok && /別の画面で/.test(r.why) && !a.log.some(l => /docCutover/.test(l)), a.log);
  }
  console.log('D 戻す');
  {
    const a = io({ mode: 'live' });
    const r = await F.back(a, 'stf');
    t('D 順番: 札 → 印 → 写し返す → 写しの期間に戻す → GAS の印を外す → 札を返す',
      r.ok && a.log.join() === 'rpc:doc_op_begin:stf:back,rpc:doc_mode_get,gas:docMirror,rpc:doc_set_mode:stf:shadow:T1,gas:docCutover:off:T1,rpc:doc_op_end:stf:T1', a.log);
    const b = io({ mode: 'live', unmirroredOnce: true });
    const r2 = await F.back(b, 'stf');
    t('D 写し返しが残っていた → 写し返してやり直す', r2.ok && b.log.filter(l => l === 'gas:docMirror').length === 2, b.log);
    const c = io({ mode: 'shadow', kind: 'adm' });
    const r3 = await F.back(c, 'adm');
    t('D 写しの期間なら写し返さずに印を外すだけ', r3.ok && !c.log.includes('gas:docMirror') && c.log.includes('gas:docCutover:off:T1'));
    const m = io({ mode: 'shadow', moreN: 2 });
    const rm = await F.back(m, 'stf');
    t('D 印を外す前の写し返しが多い（more）→ 同じ札で続ける', rm.ok && m.log.filter(l => l === 'gas:docCutover:off:T1').length === 3, m.log);
    const d = io({ mode: 'live', gasOffFail: true, offHint: '先に写しの見比べ画面で「写しの期間に戻す」を押してください' });
    const r4 = await F.back(d, 'stf');
    t('D GAS の印を外せない → 何が残っているかを知らせ、札は返す', !r4.ok && /書類の出し入れがまだ止まったまま/.test(r4.why) && /職員マスタの書類を写しの期間に戻す/.test(r4.why) && d.log.includes('rpc:doc_op_end:stf:T1'));
    const e = io({ mode: 'live', mirrorFail: true });
    const r5 = await F.back(e, 'stf');
    t('D 写し返しが続けて断られる → 写しの期間に戻さない', !r5.ok && !e.log.some(l => /doc_set_mode/.test(l)) && /写し返す中身/.test(r5.why));
  }
  console.log('G 状態を読めない');
  {
    const a = io({ modeFail: true });
    const r = await F.back(a, 'stf');
    t('G 戻す時に印を読めない → 成功と言わずに止める（GAS の印を外さない）', !r.ok && /確かめられません/.test(r.why) && !a.log.some(l => /docCutover/.test(l)) && a.log.includes('rpc:doc_op_end:stf:T1'));
  }
  console.log('F 部品の決まり');
  {
    t('F データベースの断りの文（busy・unmirrored・notclean・準備）', /別の画面/.test(F._dbWhy('busy')) && /写し返しが済んでいません/.test(F._dbWhy('unmirrored'))
      && /写せない書類が残っています/.test(F._dbWhy('notclean')) && /0065/.test(F._dbWhy({ code: 'PGRST202' })));
    t('F 端末に何も書かない', !/localStorage|sessionStorage/.test(SRC));
    t('F 空の catch で捨てない（札を返す・印は記録へ）', /catch \(e\) \{ note\('札を返す', e\); \}/.test(SRC) && /catch \(e\) \{ note\('印', e\); return ''; \}/.test(SRC));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();

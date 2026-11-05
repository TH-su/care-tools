/* 排泄ケア記録の正本の切り替え・戻す（su-hb-full.js・統合 0064・2026-11-05）の試験。架空データのみ。
   守ること:
     V 切り替える前に、この端末の接続先の GAS に切り替えの部品があるか（hbPing が cutover:true）を確かめる（何も止める前・札も取らない）
     A 切り替える: 札 → GAS の保存を止めて最後の写し（hbCutover on・札と証明つき）→ 切り替える（hb_set_mode live）→ 札を返す。
       もう切り替わっている（unchanged）は成功として「何も変えていない」を返す
     B 途中で止まったら: 切り替えの札を返し、戻す札を取り直して GAS の保存を戻す（hbCutover off）。戻せなかったら知らせる
     C 札が取れない（別の操作中）時は GAS の保存に触らない
     D 戻す: 札 → 写し返す（hbMirror）→ 写しの期間に戻す（写し返しが残ればやり直す）→ GAS の印を外す → 札を返す
     G 戻す時に今の状態を読めなければ、成功と言わずに止める
     F GAS の断りは hint の文を出す
   実行: node check/unit/su_hb_full_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-hb-full.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const w = { setTimeout, Promise, Object, Error, String, Number, JSON, Math };
w.window = w; vm.createContext(w); vm.runInContext(SRC, w);
const F = w.SUHbFull;

function io(o) {
  o = o || {};
  const log = [];
  let tokN = 0, mode = o.mode || 'shadow', setTries = 0;
  const x = {
    log, undoWait: [0, 0, 0],
    token: async () => (o.noLogin ? null : 'h.p.s'),
    progress: () => {},
    gas: async (b) => {
      log.push('gas:' + b.action + (b.on === true ? ':on' : b.on === false ? ':off' : '') + (b.opToken ? ':' + b.opToken : ''));
      if (b.action === 'hbPing') {
        if (o.pingFail) throw new Error('offline');
        return o.ping || { ok: true, cutover: true, switched: false };
      }
      if (b.accessToken !== 'h.p.s') return { ok: false, error: 'no token' };
      if (b.action === 'hbCutover' && b.on && o.gasOnFail) return { ok: false, error: 'refused', hint: 'ほかの保存が終わるのを待っています。少し待ってからもう一度お試しください' };
      if (b.action === 'hbCutover' && !b.on && o.gasOffFail) return { ok: false, error: 'refused', hint: o.offHint || '戻せません' };
      if (b.action === 'hbMirror' && o.mirrorFail) return { ok: false, error: 'refused', hint: '写し返す中身を受け取れませんでした' };
      if (b.action === 'hbCutover' && o.moreN && o.moreN-- > 0) return { ok: true, switched: !!b.on, days: 3, more: true };
      return b.action === 'hbCutover' ? { ok: true, switched: !!b.on, days: 5 } : { ok: true, mode, days: 2 };
    },
    rpc: async (n, a) => {
      log.push('rpc:' + n + (a && a.p_op ? ':' + a.p_op : '') + (a && a.p_mode ? ':' + a.p_mode : '') + (a && a.p_token ? ':' + a.p_token : ''));
      if (n === 'hb_op_begin') { if (o.busy) return { data: { ok: false, error: 'busy' } }; return { data: { ok: true, token: 'T' + (++tokN) } }; }
      if (n === 'hb_op_end') return { data: { ok: true } };
      if (n === 'hb_mode_get') { if (o.modeFail) throw new Error('offline'); return { data: { ok: true, mode } }; }
      if (n === 'hb_set_mode') {
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
    const a = io({ ping: { ok: false, error: 'unknown action: hbPing' } });
    const r = await F.cutover(a);
    t('V 切り替えの部品の無い GAS → 決まった文で止め、札も取らず GAS の保存に触らない', !r.ok && /切り替えの部品が入っていないか/.test(r.why) && a.log.join() === 'gas:hbPing', a.log);
    const c = io({ ping: { ok: false, error: '認証エラー: 同期トークンが未設定または一致しません。', code: 403 } });
    const r3 = await F.cutover(c);
    t('V 合言葉が違う → 止める', !r3.ok && /合言葉が違います/.test(r3.why) && c.log.join() === 'gas:hbPing');
    const d = io({ pingFail: true });
    const r4 = await F.cutover(d);
    t('V GAS に届かない → 止める', !r4.ok && /届きませんでした/.test(r4.why) && d.log.join() === 'gas:hbPing');
  }
  console.log('A 切り替える');
  {
    const a = io();
    const r = await F.cutover(a);
    t('A 順番: 部品の確かめ → 札 → hbCutover on → hb_set_mode live → 札を返す', r.ok && a.log.join() === 'gas:hbPing,rpc:hb_op_begin:cutover,gas:hbCutover:on:T1,rpc:hb_set_mode:live:T1,rpc:hb_op_end:T1', a.log);
    t('A 止めた後に写した日数を返す', r.days === 5 && r.unchanged === false);
    const m = io({ moreN: 2 });
    const rm = await F.cutover(m);
    t('A 違う日が多い（more）→ 同じ札で続きを写してから切り替える', rm.ok && m.log.filter(l => l === 'gas:hbCutover:on:T1').length === 3 && m.log.includes('rpc:hb_set_mode:live:T1'), m.log);
    const m2 = io({ moreN: 9 });
    const rm2 = await F.cutover(m2);
    t('A 4回で写し終わらない → 切り替えず、GAS の保存を戻す', !rm2.ok && /写しが終わりませんでした/.test(rm2.why) && !m2.log.some(l => /hb_set_mode:live/.test(l)) && m2.log.includes('gas:hbCutover:off:T2'), m2.log);
    const b = io({ mode: 'live' });
    const r2 = await F.cutover(b);
    t('A もう切り替わっている（unchanged）は成功・何も変えていない', r2.ok && r2.unchanged === true);
    const c = io({ noLogin: true });
    const r3 = await F.cutover(c);
    t('A ログインしていなければ何もしない', !r3.ok && c.log.length === 0);
  }
  console.log('B 途中で止まった');
  {
    const a = io({ gasOnFail: true });
    const r = await F.cutover(a);
    t('B GAS が止められない → 戻す札で GAS の保存を戻し、断りの文（hint）を出す', !r.ok && /ほかの保存が終わるのを待って/.test(r.why) && a.log.includes('gas:hbCutover:off:T2') && a.log.includes('rpc:hb_op_end:T1') && a.log.includes('rpc:hb_op_end:T2'), [r, a.log]);
    const b = io({ setFail: 'notclean' });
    const r2 = await F.cutover(b);
    t('B 切り替えが断られた（違う日が残る）→ GAS の保存を戻す', !r2.ok && /違う日/.test(r2.why) && b.log.includes('gas:hbCutover:off:T2'), b.log);
    const c = io({ setFail: 'stale', gasOffFail: true });
    const r3 = await F.cutover(c);
    t('B 戻せなかった → 「写しの期間に戻す」を押すよう知らせる', !r3.ok && /排泄ケア記録を写しの期間に戻す/.test(r3.why));
  }
  console.log('C 札が取れない');
  {
    const a = io({ busy: true });
    const r = await F.cutover(a);
    t('C 別の操作中 → GAS の保存に触らない', !r.ok && /別の画面で/.test(r.why) && !a.log.some(l => /hbCutover/.test(l)), a.log);
  }
  console.log('D 戻す');
  {
    const a = io({ mode: 'live' });
    const r = await F.back(a);
    t('D 順番: 札 → 印 → 写し返す → 写しの期間に戻す → GAS の印を外す → 札を返す', r.ok && a.log.join() === 'rpc:hb_op_begin:back,rpc:hb_mode_get,gas:hbMirror,rpc:hb_set_mode:shadow:T1,gas:hbCutover:off:T1,rpc:hb_op_end:T1', a.log);
    const b = io({ mode: 'live', unmirroredOnce: true });
    const r2 = await F.back(b);
    t('D 写し返しが残っていた → 写し返してやり直す', r2.ok && b.log.filter(l => l === 'gas:hbMirror').length === 2, b.log);
    const c = io({ mode: 'shadow' });
    const r3 = await F.back(c);
    t('D 写しの期間なら写し返さずに印を外すだけ', r3.ok && !c.log.includes('gas:hbMirror') && c.log.includes('gas:hbCutover:off:T1'));
    const d = io({ mode: 'live', gasOffFail: true, offHint: '先に写しの見比べ画面で「写しの期間に戻す」を押してください' });
    const r4 = await F.back(d);
    t('D GAS の印を外せない → 何が残っているかを知らせ、札は返す', !r4.ok && /Google での保存がまだ止まったまま/.test(r4.why) && d.log.includes('rpc:hb_op_end:T1'));
    const e = io({ mode: 'live', mirrorFail: true });
    const r5 = await F.back(e);
    t('D 写し返しが続けて断られる → 写しの期間に戻さない', !r5.ok && !e.log.some(l => /hb_set_mode/.test(l)) && /写し返す中身/.test(r5.why));
  }
  console.log('G 状態を読めない');
  {
    const a = io({ modeFail: true });
    const r = await F.back(a);
    t('G 戻す時に印を読めない → 成功と言わずに止める（GAS の印を外さない）', !r.ok && /確かめられません/.test(r.why) && !a.log.some(l => /hbCutover/.test(l)) && a.log.includes('rpc:hb_op_end:T1'));
  }
  console.log('F 部品の決まり');
  {
    t('F データベースの断りの文（busy・unmirrored・nodata・notclean・準備）', /別の画面/.test(F._dbWhy('busy')) && /写し返しが済んでいません/.test(F._dbWhy('unmirrored')) && /写しがありません/.test(F._dbWhy('nodata'))
      && /違う日/.test(F._dbWhy('notclean')) && /0064/.test(F._dbWhy({ code: 'PGRST202' })));
    t('F 端末に何も書かない', !/localStorage|sessionStorage/.test(SRC));
    t('F 空の catch で捨てない（札を返す・印は記録へ）', /catch \(e\) \{ note\('札を返す', e\); \}/.test(SRC) && /catch \(e\) \{ note\('印', e\); return ''; \}/.test(SRC));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();

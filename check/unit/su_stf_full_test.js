/* 職員マスタの正本の切り替え・戻す（su-stf-full.js・統合 0045・2026-11-02）の試験。架空データのみ。
   守ること:
     A 切り替える: 札 → GAS の保存を止めて最後の写し（stfCutover on・札と証明つき）→ 切り替える（stf_set_mode live・札つき）→ 札を返す
     B 途中で止まったら: 切り替えの札を返し、戻す札を取り直して GAS の保存を戻す（stfCutover off）。戻せなかったら知らせる
     C 札が取れない（別の操作中）時は GAS に触らない
     D 戻す: 札 → Google へ写し返す（stfMirror）→ 写しの期間に戻す（写し返しが残れば写し返してやり直す）→ GAS の印を外す → 札を返す
     E 戻す途中の失敗は、何が残っているかを知らせる。札はいつも返す
     G 戻す時に今の状態（印）を読めなければ、成功と言わずに止める（反証レビュー 2026-11-02 指摘10）
   実行: node check/unit/su_stf_full_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-stf-full.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const w = { setTimeout, Promise, Object, Error, String, Number, JSON };
w.window = w; vm.createContext(w); vm.runInContext(SRC, w);
const F = w.SUStfFull;

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
      if (b.accessToken !== 'h.p.s') return { ok: false, error: 'no token' };
      if (b.action === 'stfCutover' && b.on && o.gasOnFail) return { ok: false, error: 'Error: refused: ほかの保存が終わるのを待っています' };
      if (b.action === 'stfCutover' && !b.on && o.gasOffFail) return { ok: false, error: 'refused: 戻せません' };
      if (b.action === 'stfMirror' && o.mirrorFail) return { ok: false, error: 'refused: 写し返す中身を受け取れませんでした' };
      return b.action === 'stfCutover' ? { ok: true, rows: 7, switched: !!b.on } : { ok: true, rows: 7 };
    },
    rpc: async (n, a) => {
      log.push('rpc:' + n + (a && a.p_op ? ':' + a.p_op : '') + (a && a.p_mode ? ':' + a.p_mode : '') + (a && a.p_token ? ':' + a.p_token : ''));
      if (n === 'stf_op_begin') { if (o.busy) return { data: { ok: false, error: 'busy' } }; return { data: { ok: true, token: 'T' + (++tokN) } }; }
      if (n === 'stf_op_end') return { data: { ok: true } };
      if (n === 'stf_mode_get') return o.modeErr ? { error: { code: '500' } } : { data: { ok: true, mode } };
      if (n === 'stf_set_mode') {
        setTries++;
        if (a.p_mode === 'live' && o.setFail) return { data: { ok: false, error: 'notfrozen' } };
        if (a.p_mode === 'shadow' && o.unmirrored && setTries <= o.unmirrored) return { data: { ok: false, error: 'unmirrored' } };
        mode = a.p_mode; return { data: { ok: true } };
      }
      return { error: { code: 'PGRST202' } };
    }
  };
  return x;
}

(async () => {
  console.log('A 切り替える');
  {
    const x = io();
    const r = await F.cutover(x);
    t('A 札 → 止めて写す → 切り替える → 札を返す', r.ok === true && r.rows === 7 &&
      x.log.join('|') === 'rpc:stf_op_begin:cutover|gas:stfCutover:on:T1|rpc:stf_set_mode:live:T1|rpc:stf_op_end:T1', x.log);
  }
  console.log('B 途中で止まった');
  {
    const x = io({ setFail: true });
    const r = await F.cutover(x);
    t('B 切り替えが断られた → 切り替えの札を返し、戻す札で GAS の保存を戻し、その札も返す', r.ok === false && /止めた後の写しではありません/.test(r.why) &&
      x.log.join('|') === 'rpc:stf_op_begin:cutover|gas:stfCutover:on:T1|rpc:stf_set_mode:live:T1|rpc:stf_mode_get|rpc:stf_op_end:T1|rpc:stf_op_begin:back|gas:stfCutover:off:T2|rpc:stf_op_end:T2', x.log);
  }
  {
    const x = io({ gasOnFail: true });
    const r = await F.cutover(x);
    t('B GAS が断った → 理由を知らせ、GAS の保存を戻す', r.ok === false && /ほかの保存が終わるのを待っています/.test(r.why) && !/^Error/.test(r.why) && x.log.includes('gas:stfCutover:off:T2'), [r, x.log]);
  }
  {
    const x = io({ setFail: true, gasOffFail: true });
    const r = await F.cutover(x);
    t('B 戻せなかった → 「写しの期間に戻す」を押すよう知らせる・札は返す', r.ok === false && /止めたままの可能性/.test(r.why) && x.log.filter(l => /stf_op_end/.test(l)).length === 2, [r, x.log]);
  }
  console.log('C 札が取れない');
  {
    const x = io({ busy: true });
    const r = await F.cutover(x);
    t('C 別の操作中 → GAS に触らない', r.ok === false && /別の画面/.test(r.why) && !x.log.some(l => /^gas:/.test(l)), x.log);
    const x2 = io({ noLogin: true });
    const r2 = await F.cutover(x2);
    t('C ログインの証明が無い → 札も取らず GAS にも触らない', r2.ok === false && /ログイン/.test(r2.why) && x2.log.length === 0, [r2, x2.log]);
  }
  console.log('D 戻す');
  {
    const x = io({ mode: 'live' });
    const r = await F.back(x);
    t('D 札 → 写し返す → 写しの期間に戻す → GAS の印を外す → 札を返す', r.ok === true &&
      x.log.join('|') === 'rpc:stf_op_begin:back|rpc:stf_mode_get|gas:stfMirror|rpc:stf_set_mode:shadow:T1|gas:stfCutover:off:T1|rpc:stf_op_end:T1', x.log);
  }
  {
    const x = io({ mode: 'live', unmirrored: 1 });
    const r = await F.back(x);
    t('D 写し返しが残っていた → もう一度写し返してから戻す', r.ok === true && x.log.filter(l => l === 'gas:stfMirror').length === 2, x.log);
  }
  {
    const x = io({ mode: 'shadow' });
    const r = await F.back(x);
    t('D もう写しの期間（GAS の印だけ残っていた）→ 写し返さずに印を外す', r.ok === true && !x.log.includes('gas:stfMirror') && x.log.includes('gas:stfCutover:off:T1'), x.log);
  }
  console.log('G 状態を確かめられない（反証レビュー指摘10）');
  {
    const x = io({ modeErr: true });
    const r = await F.back(x);
    t('G 戻す時に印を読めない → 成功と言わずに止める・GAS に触らない・札は返す', r.ok === false && /状態を確かめられませんでした/.test(r.why) && !x.log.some(l => /^gas:/.test(l)) && x.log.includes('rpc:stf_op_end:T1'), [r, x.log]);
  }
  console.log('E 戻す途中の失敗');
  {
    const x = io({ mode: 'live', mirrorFail: true });
    const r = await F.back(x);
    t('E 写し返しが届かない → 写しの期間に戻さず知らせる・札は返す', r.ok === false && /受け取れませんでした/.test(r.why) && !x.log.some(l => /stf_set_mode/.test(l)) && x.log.includes('rpc:stf_op_end:T1'), [r, x.log]);
  }
  {
    const x = io({ mode: 'live', gasOffFail: true });
    const r = await F.back(x);
    t('E GAS の印を外せない → 「保存がまだ止まったまま」と知らせる・札は返す', r.ok === false && /止まったまま/.test(r.why) && x.log.includes('rpc:stf_op_end:T1'), r);
  }
  t('E データベースの断りは職員向けの文（技術用語なし）', !/PGRST|42501/.test(F._dbWhy('unmirrored') + F._dbWhy('busy') + F._dbWhy('noop')));
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();

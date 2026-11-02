/* シフト分析（過去シフト・アナライザのクラウド同期）の正本の切り替え・戻す（su-sa-full.js・統合 0051・2026-11-03）の試験。架空データのみ。
   守ること:
     V 切り替える前に、この端末の接続先の GAS が新しい版（codeVersion 2026-11-03.1 以上）で、編集できる合言葉かを確かめる（何も止める前・札も取らない）
     A 切り替える: 札 → GAS の保存を止めて最後の写し（saCutover on・札と証明つき）→ 切り替える（sa_set_mode live）→ 札を返す。
       もう切り替わっている（unchanged）は成功として「何も変えていない」を返す
     B 途中で止まったら: 切り替えの札を返し、戻す札を取り直して GAS の保存を戻す（saCutover off）。戻せなかったら知らせる
     C 札が取れない（別の操作中）時は GAS の保存に触らない
     D 戻す: 札 → 写し返す（saMirror）→ 写しの期間に戻す（写し返しが残ればやり直す）→ GAS の印を外す → 札を返す
     G 戻す時に今の状態を読めなければ、成功と言わずに止める
     F GAS の断りは hint の文を出す
   実行: node check/unit/su_sa_full_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-sa-full.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 400) : '')); } }
const w = { setTimeout, Promise, Object, Error, String, Number, JSON, Math };
w.window = w; vm.createContext(w); vm.runInContext(SRC, w);
const F = w.SUSaFull;

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
      if (b.action === 'ping') {
        if (o.pingFail) throw new Error('offline');
        return o.ping || { ok: true, server: 'shiftanalyzer-gas', role: 'rw', codeVersion: '2026-11-03.2', cutover: true };
      }
      if (b.accessToken !== 'h.p.s') return { ok: false, error: 'no token' };
      if (b.action === 'saCutover' && b.on && o.gasOnFail) return { ok: false, error: 'refused', hint: 'ほかの保存が終わるのを待っています。少し待ってからもう一度お試しください' };
      if (b.action === 'saCutover' && !b.on && o.gasOffFail) return { ok: false, error: 'refused', hint: o.offHint || '戻せません' };
      if (b.action === 'saMirror' && o.mirrorFail) return { ok: false, error: 'refused', hint: '写し返す中身を受け取れませんでした' };
      return b.action === 'saCutover' ? { ok: true, switched: !!b.on, months: 24, entries: 1 } : { ok: true, mode, entries: 1 };
    },
    rpc: async (n, a) => {
      log.push('rpc:' + n + (a && a.p_op ? ':' + a.p_op : '') + (a && a.p_mode ? ':' + a.p_mode : '') + (a && a.p_token ? ':' + a.p_token : ''));
      if (n === 'sa_op_begin') { if (o.busy) return { data: { ok: false, error: 'busy' } }; return { data: { ok: true, token: 'T' + (++tokN) } }; }
      if (n === 'sa_op_end') return { data: { ok: true } };
      if (n === 'sa_mode_get') { if (o.modeFail) throw new Error('offline'); return { data: { ok: true, mode } }; }
      if (n === 'sa_set_mode') {
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
  console.log('V 版の確かめ');
  {
    t('V 版の比べ方', F._verAtLeast('2026-11-03.1', '2026-11-03.1') && F._verAtLeast('2026-11-03.10', '2026-11-03.1') && F._verAtLeast('2026-12-01', '2026-11-03.1')
      && !F._verAtLeast('2026-11-03', '2026-11-03.1') && !F._verAtLeast('2026-10-06a', '2026-11-03.1') && !F._verAtLeast('', '2026-11-03.1') && !F._verAtLeast(undefined, '2026-11-03.1'));
    const a = io({ ping: { ok: true, role: 'rw', codeVersion: '2026-10-06' } });
    const r = await F.cutover(a);
    t('V 古い版の GAS → 決まった文で止め、札も取らず GAS の保存に触らない', !r.ok && r.why === 'アナライザ同期の GAS が古い版です。新しい版を公開してから押してください' && a.log.join() === 'gas:ping', a.log);
    const b = io({ ping: { ok: true, role: 'ro', codeVersion: '2026-11-03.1' } });
    const r2 = await F.cutover(b);
    t('V 見るだけの合言葉 → 止める', !r2.ok && /見るだけ/.test(r2.why) && b.log.join() === 'gas:ping');
    const c = io({ ping: { error: 'unauthorized' } });
    const r3 = await F.cutover(c);
    t('V 合言葉が違う → 止める', !r3.ok && /合言葉が違います/.test(r3.why) && c.log.join() === 'gas:ping');
    const d = io({ pingFail: true });
    const r4 = await F.cutover(d);
    t('V GAS に届かない → 止める', !r4.ok && /届きませんでした/.test(r4.why) && d.log.join() === 'gas:ping');
    const e1 = io({ ping: { ok: true, role: 'rw', codeVersion: '2026-11-03.1', cutover: true } });
    const r6 = await F.cutover(e1);
    t('V 2026-11-03.1（切り替えた後に読み取りを断らない版）→ 古い版として止める（指摘1・9）', !r6.ok && /古い版/.test(r6.why) && e1.log.join() === 'gas:ping');
    const e2 = io({ ping: { ok: true, role: 'rw', codeVersion: '2026-11-03.2' } });
    const r7 = await F.cutover(e2);
    t('V 版が新しくても切り替えの部品（cutover:true）が無ければ止める（指摘9）', !r7.ok && /古い版/.test(r7.why) && e2.log.join() === 'gas:ping');
    t('V 求める版は 2026-11-03.2', F.NEED_VERSION === '2026-11-03.2');
    const e = io({ ping: { ok: true, role: 'rw' } });
    const r5 = await F.cutover(e);
    t('V 版が分からない → 古いとみなして止める', !r5.ok && /古い版/.test(r5.why));
  }
  console.log('A 切り替える');
  {
    const a = io();
    const r = await F.cutover(a);
    t('A 順番: 版の確かめ → 札 → saCutover on → sa_set_mode live → 札を返す', r.ok && a.log.join() === 'gas:ping,rpc:sa_op_begin:cutover,gas:saCutover:on:T1,rpc:sa_set_mode:live:T1,rpc:sa_op_end:T1', a.log);
    t('A 写した月の数を返す', r.months === 24 && r.unchanged === false);
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
    t('B GAS が止められない → 戻す札で GAS の保存を戻し、断りの文（hint）を出す', !r.ok && /ほかの保存が終わるのを待って/.test(r.why) && a.log.includes('gas:saCutover:off:T2') && a.log.includes('rpc:sa_op_end:T1') && a.log.includes('rpc:sa_op_end:T2'), [r, a.log]);
    const b = io({ setFail: 'stale' });
    const r2 = await F.cutover(b);
    t('B 切り替えが断られた → GAS の保存を戻す', !r2.ok && /止めた後の写しが取れていません/.test(r2.why) && b.log.includes('gas:saCutover:off:T2'), b.log);
    const c = io({ setFail: 'stale', gasOffFail: true });
    const r3 = await F.cutover(c);
    t('B 戻せなかった → 「写しの期間に戻す」を押すよう知らせる', !r3.ok && /シフト分析を写しの期間に戻す/.test(r3.why));
  }
  console.log('C 札が取れない');
  {
    const a = io({ busy: true });
    const r = await F.cutover(a);
    t('C 別の操作中 → GAS の保存に触らない', !r.ok && /別の画面で/.test(r.why) && !a.log.some(l => /saCutover/.test(l)), a.log);
  }
  console.log('D 戻す');
  {
    const a = io({ mode: 'live' });
    const r = await F.back(a);
    t('D 順番: 札 → 印 → 写し返す → 写しの期間に戻す → GAS の印を外す → 札を返す', r.ok && a.log.join() === 'rpc:sa_op_begin:back,rpc:sa_mode_get,gas:saMirror,rpc:sa_set_mode:shadow:T1,gas:saCutover:off:T1,rpc:sa_op_end:T1', a.log);
    const b = io({ mode: 'live', unmirroredOnce: true });
    const r2 = await F.back(b);
    t('D 写し返しが残っていた → 写し返してやり直す', r2.ok && b.log.filter(l => l === 'gas:saMirror').length === 2, b.log);
    const c = io({ mode: 'shadow' });
    const r3 = await F.back(c);
    t('D 写しの期間なら写し返さずに印を外すだけ', r3.ok && !c.log.includes('gas:saMirror') && c.log.includes('gas:saCutover:off:T1'));
    const d = io({ mode: 'live', gasOffFail: true, offHint: '先に写しの見比べ画面で「写しの期間に戻す」を押してください' });
    const r4 = await F.back(d);
    t('D GAS の印を外せない → 何が残っているかを知らせ、札は返す', !r4.ok && /Google での保存がまだ止まったまま/.test(r4.why) && d.log.includes('rpc:sa_op_end:T1'));
    const e = io({ mode: 'live', mirrorFail: true });
    const r5 = await F.back(e);
    t('D 写し返しが続けて断られる → 写しの期間に戻さない', !r5.ok && !e.log.some(l => /sa_set_mode/.test(l)) && /写し返す中身/.test(r5.why));
  }
  console.log('G 状態を読めない');
  {
    const a = io({ modeFail: true });
    const r = await F.back(a);
    t('G 戻す時に印を読めない → 成功と言わずに止める（GAS の印を外さない）', !r.ok && /確かめられません/.test(r.why) && !a.log.some(l => /saCutover/.test(l)) && a.log.includes('rpc:sa_op_end:T1'));
  }
  console.log('F 部品の決まり');
  {
    t('F データベースの断りの文（busy・unmirrored・nodoc）', /別の画面/.test(F._dbWhy('busy')) && /写し返しが済んでいません/.test(F._dbWhy('unmirrored')) && /写しがありません/.test(F._dbWhy('nodoc')));
    t('F 端末に何も書かない', !/localStorage|sessionStorage/.test(SRC));
    t('F 空の catch で捨てない（札を返す・印は記録へ・指摘10）', /catch \(e\) \{ note\('札を返す', e\); \}/.test(SRC) && /catch \(e\) \{ note\('印', e\); return ''; \}/.test(SRC));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();

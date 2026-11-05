/* su-doc-full.js — 添付書類（職員マスタ・入居調整）の正本の切り替え・戻す（統合 0065・2026-11-05 代表者の決定: 移す準備ができるものから次々に進める・
 *   排泄ケア記録の su-hb-full.js と同じ手順。種類 kind は 'stf'（職員マスタ）か 'adm'（入居調整））
 *
 * 写しはその種類の GAS が1時間ごとに自動で取る（統合 0063・この部品は写さない）。この部品は写しの見比べ画面の管理者のボタンから呼ぶ。
 *   切り替える: その種類の GAS に書類の切り替えの部品（docshadow.gs の段2）が入り、ウェブアプリの版が新しいかを確かめる（docPing が cutover:true と同じ種類を返す）
 *             → 札（doc_op_begin cutover）→ GAS の書類の出し入れを止めて、止めた後の写しを GAS が取る（docCutover on・多い時は more が返るので続きを頼む）
 *             → 新しい保存先へ切り替える（doc_set_mode live・もう切り替わっている時は unchanged）→ 札を返す。
 *             途中で止まったら、戻す札を取り直して GAS の書類の出し入れを戻す
 *   戻す: 札（back・この間の新しい保存先での書類の出し入れは断られる）→ Google ドライブへ写し返す（docMirror）→ 写しの期間に戻す（doc_set_mode shadow・
 *        写し返しが残れば写し返してやり直す）→ Google での書類の出し入れを受け付けるように戻す（docCutover off・GAS が最後まで写し返してから印を外す）→ 札を返す
 * 出すのは件数と職員向けの文だけ（氏名・書類の名前は出さない）。端末に何も残さない。
 * io = { gas(本文) → GAS の応答（合言葉は io が添える）, rpc(名前, 引数) → supabase の rpc の答え, token() → ログインの証明, progress(文), undoWait（試験用） }
 */
(function (root) {
  'use strict';
  function note(where, e) {
    try { if (root.SUErrors && typeof root.SUErrors.note === 'function') root.SUErrors.note('切り替えの失敗', e, 'doc-full:' + where); } catch (x) { /* 記録できなくても止めない */ }
  }
  var NAME = { stf: '職員マスタ', adm: '入居調整' };
  function oldGas(kind) { return NAME[kind] + 'の GAS に書類の切り替えの部品が入っていないか、ウェブアプリの版が古いです。新しい版を公開してから押してください'; }
  function dbWhy(e) {
    var c = String(e && (e.code || e.error || e.message) || e || '');
    if (c === '42501' || /not allowed/.test(c)) return '管理者（二段階認証済み）のアカウントで開いてください。';
    if (/PGRST202|42883|PGRST205|42P01/.test(c)) return 'データベースの準備（0065）がまだです。';
    if (c === 'busy') return '別の画面で「切り替える」か「写しの期間に戻す」が動いています。終わるのを待ってから押してください（30分たつと押せます）。';
    if (c === 'live') return 'もう切り替わっています。';
    if (c === 'mirror' || c === 'unmirrored') return 'Google ドライブへの写し返しが済んでいません。もう一度押してください。';
    if (c === 'noop') return '切り替えの操作が時間切れになりました。もう一度押してください。';
    if (c === 'stale') return '書類の出し入れを止めた後の写しが取れていません（時間切れか、取れなかった）。もう一度押してください。';
    if (c === 'notfrozen') return '書類の出し入れを止めた後の写しではありません。もう一度押してください。';
    if (c === 'notclean') return 'Google ドライブの目録と写した書類の数が合いません（写せない書類が残っています）。写しの見比べの知らせを確かめてから押してください。';
    if (c === 'badmode') return '操作の種類が違いました。';
    if (c === 'stfshadow') return '先に職員マスタを新しい保存先へ切り替えてください（職員マスタの書類は、職員マスタの後に切り替えます）。';
    return 'データベースが受け付けませんでした（' + c + '）。';
  }
  function gasWhy(j) { return String(j && (j.hint || j.error) || 'Google が受け付けませんでした').replace(/^Error: (refused: )?/, ''); }   // GAS は断りの文を hint に入れる
  async function gasAdmin(io, body) {
    var at = await io.token();
    if (!at) throw new Error('ログインしてからもう一度押してください');
    var j = await io.gas(Object.assign({}, body, { accessToken: at }));
    if (!j || j.ok !== true) throw new Error(gasWhy(j));
    return j;
  }
  /* 切り替える前に、この端末の接続先の GAS に書類の切り替えの部品があり、種類が合うかを確かめる（何も止める前） */
  async function gasReady(io, kind) {
    var j;
    try { j = await io.gas({ action: 'docPing' }); } catch (e) { return NAME[kind] + 'の GAS に届きませんでした。通信を確かめて、もう一度押してください。'; }
    if (j && j.ok === true && j.cutover === true && j.kind === kind) return '';
    if (j && j.ok === true && j.cutover === true) return 'この端末の' + NAME[kind] + 'の接続先が、別のアプリの GAS になっています。' + NAME[kind] + 'の設定で接続先を確かめてから押してください。';
    if (j && /unauthorized|token|認証|合言葉/i.test(String(j.error || ''))) return 'この端末の' + NAME[kind] + 'の合言葉が違います。' + NAME[kind] + 'の設定で接続先と合言葉を確かめてから押してください。';
    return oldGas(kind);   // 古い版は docPing を知らない（unknown action）
  }
  async function opBegin(io, kind, op) {
    var r = await io.rpc('doc_op_begin', { p_kind: kind, p_op: op });
    if (!r || r.error || !r.data || r.data.ok !== true) throw new Error(dbWhy(r && (r.error || r.data && r.data.error)));
    return r.data.token;
  }
  /* 後片付けは、届かなかった時に少し待って3回まで送り直す（排泄ケア記録と同じ） */
  var UNDO_WAIT = [2000, 5000, 10000];
  async function again(io, fn) {
    var waits = Array.isArray(io.undoWait) ? io.undoWait : UNDO_WAIT;
    for (var k = 0; ; k++) {
      try { return await fn(); }
      catch (e) {
        if (k >= waits.length) throw e;
        await new Promise(function (ok) { setTimeout(ok, waits[k]); });
      }
    }
  }
  async function opEnd(io, kind, tok) {
    try {
      await again(io, async function () {
        var r = await io.rpc('doc_op_end', { p_kind: kind, p_token: tok });
        if (r && r.error) throw new Error('op_end');
      });
    } catch (e) { note('札を返す', e); }   // 返せなくても30分で失効する
  }
  async function modeOf(io, kind) {
    try { var g = await io.rpc('doc_mode_get', {}); return g && g.data && g.data[kind] ? String(g.data[kind].mode || '') : ''; } catch (e) { note('印', e); return ''; }
  }
  /* GAS の切り替え（on/off）。書類が多い・写し返しが多い時は more が返るので、同じ札で続きを頼む（6回まで） */
  async function gasCut(io, on, tok) {
    var g = null, sum = 0;
    for (var i = 0; i < 6; i++) {
      g = await gasAdmin(io, { action: 'docCutover', on: on, opToken: tok });
      sum += Number(g.copied) || 0;
      if (!g.more) { g.total = sum; return g; }
    }
    throw new Error(on ? '書類が多く、止めた後の写しが終わりませんでした。少し待ってから、もう一度押してください。'
                       : 'Google ドライブへの写し返しが終わりませんでした。もう一度押してください。');
  }

  async function cutover(io, kind) {
    var say = io.progress || function () {};
    if (!NAME[kind]) return { ok: false, why: '書類の種類が違います。' };
    var frozen = false, tok = null;
    async function undo(why) {
      if (frozen) {
        try {
          if (tok) { await opEnd(io, kind, tok); tok = null; }
          var bt = await again(io, function () { return opBegin(io, kind, 'back'); });
          try { await again(io, function () { return gasCut(io, false, bt); }); }
          finally { await opEnd(io, kind, bt); }
        } catch (e) {
          why += '（Google での書類の出し入れを止めたままの可能性があります。「' + NAME[kind] + 'の書類を写しの期間に戻す」を押してください）';
        }
      }
      return { ok: false, why: why };
    }
    if (!(await io.token())) return { ok: false, why: 'ログインしてからもう一度押してください' };   // 何も止める前に確かめる
    var bad = await gasReady(io, kind);
    if (bad) return { ok: false, why: bad };
    try {
      try { tok = await opBegin(io, kind, 'cutover'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      say(NAME[kind] + 'の書類の Google での出し入れを止め、最後の写しを取っています（数分かかることがあります）…');
      frozen = true;
      var g = await gasCut(io, true, tok);
      say('切り替えています…');
      var m = await io.rpc('doc_set_mode', { p_kind: kind, p_mode: 'live', p_token: tok });
      if (!m || m.error || !m.data || m.data.ok !== true) {
        if ((await modeOf(io, kind)) !== 'live') return await undo(dbWhy(m && (m.error || m.data && m.data.error)));
      }
      return { ok: true, files: g.total || 0, unchanged: !!(m && m.data && m.data.unchanged) || g.live === true };
    } catch (e) {
      return await undo(String(e && e.message || e));
    } finally {
      if (tok) await opEnd(io, kind, tok);
    }
  }

  async function back(io, kind) {
    var say = io.progress || function () {};
    if (!NAME[kind]) return { ok: false, why: '書類の種類が違います。' };
    var tok = null;
    if (!(await io.token())) return { ok: false, why: 'ログインしてからもう一度押してください' };
    var bad = await gasReady(io, kind);   // 古い GAS・別の GAS では何も変えずに止める（指摘12）
    if (bad) return { ok: false, why: bad };
    try {
      try { tok = await opBegin(io, kind, 'back'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      var md = await modeOf(io, kind);
      if (!md) return { ok: false, why: '新しい保存先の状態を確かめられませんでした。少し待ってから、もう一度押してください。' };   // 分からないまま印を外さない
      if (md === 'live') {
        var done = false, why = '';
        for (var i = 0; i < 5 && !done; i++) {
          say('Google ドライブへ写し返しています…');
          try { await gasAdmin(io, { action: 'docMirror' }); } catch (e) { why = String(e && e.message || e); continue; }
          say('写しの期間に戻しています…');
          var m = await io.rpc('doc_set_mode', { p_kind: kind, p_mode: 'shadow', p_token: tok });
          if (m && !m.error && m.data && m.data.ok === true) { done = true; break; }
          var c = m && (m.error || m.data && m.data.error);
          why = dbWhy(c);
          if (String(c && (c.code || c) || '') !== 'unmirrored') break;
        }
        if (!done) return { ok: false, why: why || '写しの期間に戻せませんでした。もう一度押してください。' };
      }
      say('Google での書類の出し入れを受け付けるように戻しています…');
      var last = null;
      try { last = await gasCut(io, false, tok); } catch (e) { last = e; }
      if (!last || last instanceof Error) return { ok: false, why: '写しの期間には戻しました。Google での書類の出し入れがまだ止まったままです: ' + String(last && last.message || '') + '　もう一度「' + NAME[kind] + 'の書類を写しの期間に戻す」を押してください。' };
      return { ok: true, files: last.total || 0 };
    } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
    finally { if (tok) await opEnd(io, kind, tok); }
  }

  root.SUDocFull = { cutover: cutover, back: back, _dbWhy: dbWhy };
})(typeof window !== 'undefined' ? window : this);

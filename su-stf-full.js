/* su-stf-full.js — 職員マスタの正本の切り替え・戻す（統合 0045・2026-11-02 代表者「全て進めて」案2・入居調整の su-adm-full.js と同じ手順）
 *
 * 写しは職員マスタの GAS が1時間ごとに自動で取る（統合 0044・この部品は写さない）。この部品は写しの見比べ画面の管理者のボタンから呼ぶ。
 *   切り替える: 札（stf_op_begin cutover）→ 職員マスタの GAS の保存を止めて、止めた後の写しを GAS が取る（stfCutover on）
 *             → 新しい保存先へ切り替える（stf_set_mode live）→ 札を返す。途中で止まったら、戻す札を取り直して GAS の保存を戻す
 *   戻す: 札（back）→ Google へ写し返す（stfMirror・残りが無くなるまで）→ 写しの期間に戻す（stf_set_mode shadow・写し返しが残れば写し返してやり直す）
 *        → Google での保存を受け付けるように戻す（stfCutover off・GAS が最後まで写し返してから印を外す）→ 札を返す
 * 添付ファイル（Google ドライブ）はどちらでも触らない。出すのは人数と職員向けの文だけ（氏名・中身は出さない）。端末に何も残さない。
 * io = { gas(本文) → GAS の応答（合言葉は io が添える）, rpc(名前, 引数) → supabase の rpc の答え, token() → ログインの証明, progress(文), undoWait（試験用） }
 */
(function (root) {
  'use strict';
  function dbWhy(e) {
    var c = String(e && (e.code || e.error || e.message) || e || '');
    if (c === '42501' || /not allowed/.test(c)) return '管理者（二段階認証済み）のアカウントで開いてください。';
    if (/PGRST202|42883|PGRST205|42P01/.test(c)) return 'データベースの準備（0045）がまだです。';
    if (c === 'busy') return '別の画面で「切り替える」か「写しの期間に戻す」が動いています。終わるのを待ってから押してください（30分たつと押せます）。';
    if (c === 'live') return 'もう切り替わっています。';
    if (c === 'mirror' || c === 'unmirrored') return 'Google への写し返しが済んでいません。もう一度押してください。';
    if (c === 'noop') return '切り替えの操作が時間切れになりました。もう一度押してください。';
    if (c === 'stale') return 'Google の保存を止めた後の写しが取れていません（時間切れか、取れなかった）。もう一度押してください。';
    if (c === 'notfrozen') return 'Google の保存を止めた後の写しではありません。もう一度押してください。';
    if (c === 'nodoc') return '職員マスタの写しがありません。写しが取れてから押してください。';
    if (c === 'badmode') return '操作の種類が違いました。';
    return 'データベースが受け付けませんでした（' + c + '）。';
  }
  function gasWhy(j) { return String(j && j.error || 'Google が受け付けませんでした').replace(/^Error: (refused: )?/, ''); }
  async function gasAdmin(io, body) {
    var at = await io.token();
    if (!at) throw new Error('ログインしてからもう一度押してください');
    var j = await io.gas(Object.assign({}, body, { accessToken: at }));
    if (!j || j.ok !== true) throw new Error(gasWhy(j));
    return j;
  }
  async function opBegin(io, op) {
    var r = await io.rpc('stf_op_begin', { p_op: op });
    if (!r || r.error || !r.data || r.data.ok !== true) throw new Error(dbWhy(r && (r.error || r.data && r.data.error)));
    return r.data.token;
  }
  /* 後片付けは、届かなかった時に少し待って3回まで送り直す（入居調整・計画書と同じ・2026-10-30 の学び） */
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
  async function opEnd(io, tok) {
    try {
      await again(io, async function () {
        var r = await io.rpc('stf_op_end', { p_token: tok });
        if (r && r.error) throw new Error('op_end');
      });
    } catch (e) { /* 30分で失効する */ }
  }
  async function modeOf(io) {
    try { var g = await io.rpc('stf_mode_get', {}); return g && g.data ? g.data.mode : ''; } catch (e) { return ''; }
  }

  async function cutover(io) {
    var say = io.progress || function () {};
    var frozen = false, tok = null;
    /* 途中で止まった時: GAS の止める印を外す。GAS は「戻す」の札でだけ外すので、切り替えの札を返してから戻す札を取り直す */
    async function undo(why) {
      if (frozen) {
        try {
          if (tok) { await opEnd(io, tok); tok = null; }
          var bt = await again(io, function () { return opBegin(io, 'back'); });
          try { await again(io, function () { return gasAdmin(io, { action: 'stfCutover', on: false, opToken: bt }); }); }
          finally { await opEnd(io, bt); }
        } catch (e) {
          why += '（Google の保存を止めたままの可能性があります。「職員マスタを写しの期間に戻す」を押してください）';
        }
      }
      return { ok: false, why: why };
    }
    if (!(await io.token())) return { ok: false, why: 'ログインしてからもう一度押してください' };   // 何も止める前に確かめる
    try {
      try { tok = await opBegin(io, 'cutover'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      say('職員マスタの Google への直接の保存を止め、最後の写しを取っています（1分ほど）…');
      frozen = true;
      var g = await gasAdmin(io, { action: 'stfCutover', on: true, opToken: tok });
      say('切り替えています…');
      var m = await io.rpc('stf_set_mode', { p_mode: 'live', p_token: tok });
      if (!m || m.error || !m.data || m.data.ok !== true) {
        if ((await modeOf(io)) !== 'live') return await undo(dbWhy(m && (m.error || m.data && m.data.error)));
      }
      return { ok: true, rows: Number(g.rows) || 0 };
    } catch (e) {
      return await undo(String(e && e.message || e));
    } finally {
      if (tok) await opEnd(io, tok);
    }
  }

  async function back(io) {
    var say = io.progress || function () {};
    var tok = null;
    if (!(await io.token())) return { ok: false, why: 'ログインしてからもう一度押してください' };
    try {
      try { tok = await opBegin(io, 'back'); } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
      if ((await modeOf(io)) === 'live') {
        var done = false, why = '';
        for (var i = 0; i < 5 && !done; i++) {
          say('Google へ写し返しています…');
          try { await gasAdmin(io, { action: 'stfMirror' }); } catch (e) { why = String(e && e.message || e); continue; }
          say('写しの期間に戻しています…');
          var m = await io.rpc('stf_set_mode', { p_mode: 'shadow', p_token: tok });
          if (m && !m.error && m.data && m.data.ok === true) { done = true; break; }
          var c = m && (m.error || m.data && m.data.error);
          why = dbWhy(c);
          if (String(c && (c.code || c) || '') !== 'unmirrored') break;
        }
        if (!done) return { ok: false, why: why || '写しの期間に戻せませんでした。もう一度押してください。' };
      }
      say('Google での保存を受け付けるように戻しています…');
      var last = null;
      for (var k = 0; k < 5; k++) {
        try { last = await gasAdmin(io, { action: 'stfCutover', on: false, opToken: tok }); break; }
        catch (e) { last = e; if (!/残っています/.test(String(e && e.message))) break; }
      }
      if (!last || last instanceof Error) return { ok: false, why: '写しの期間には戻しました。Google での保存がまだ止まったままです: ' + String(last && last.message || '') + '　もう一度「職員マスタを写しの期間に戻す」を押してください。' };
      return { ok: true, rows: Number(last.rows) || 0 };
    } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
    finally { if (tok) await opEnd(io, tok); }
  }

  root.SUStfFull = { cutover: cutover, back: back, _dbWhy: dbWhy };
})(typeof window !== 'undefined' ? window : this);

/* su-data-supabase.js — 共通データ部品の Supabase の道（2026-10-27・M1 段0 の設計 v3 2.2 の1〜4）
 *
 * ★段0 の1段目は「登録」と「入口の空の枠」だけ。呼ばれたら「まだ使えません」で断り、Google へは流さない
 *   （スイッチが入なのに断られた時に Google へ流すと、保存先が2つに割れる。CLAUDE.md §4）。
 *   表と関数を呼ぶ中身は、表を作る後の段で足す。
 * ★この道を使うのは su-data.js の名前付きの入口（SU.data.training 等）だけ。入口を通らない呼び出し
 *   （kvGet・kvPut・kvRaw・入居者の4つ・context・can・audit）は端末の su_backend が何であっても gas の道のまま。
 * ★KV の箱（週間計画・ワークスケジュール・勤務表）は持たない。su-kv.js が正（Google への写し返しも su-kv.js）。
 *
 * 読み込み方: su-data.js → su-data-gas.js → su-data-supabase.js の順（gas の道が先に居る＝これが読めなくても gas で動く）
 */
(function (global) {
  'use strict';
  if (!global.SU || !global.SU.data || typeof global.SU.data.register !== 'function') return;  /* 読めなくても画面は gas で動く */

  var NOT_YET = '新しい保存先（Supabase）はまだ使えません。管理者へ連絡してください。';

  var SUPA = {
    /* 名前付きの入口から呼ばれる。group＝入口のまとまり（training 等）・method＝関数の名前・args＝画面が渡した引数 */
    entry: function (group, method, args) {
      var e = new Error(NOT_YET);
      e.code = 'supabase_not_ready';
      return Promise.reject(e);
    }
  };

  global.SU.data.register('supabase', SUPA);
})(window);

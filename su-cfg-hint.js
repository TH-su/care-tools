/*
 * su-cfg-hint.js — 接続先が空の時の案内（2026-09-27 代表者の決定）
 * ════════════════════════════════════════════════════════════════
 * 背景: iPhone で各アプリの GAS の URL・合言葉がほぼ消え、1つずつ入れ直しになった。
 *   iPhone はブラウザ（Chrome・Safari）とホーム画面のWebアプリがそれぞれ別の保存場所を持ち、
 *   OS・ブラウザの更新や閲覧データの削除で「開く場所」が変わると、設定が消えたように見える。
 * この部品: 開いた画面の接続先が空なら、画面の下に小さな帯で
 *   「接続設定の『控えから戻す』で全部のアプリの設定を一括で戻せます」と案内する。
 * ★表示するだけ。アプリの動き・保存・通信には一切触れない。localStorage は読むだけ（書かない）。
 * ★アプリが自分で設定を直す時間（体重管理の多層復元など）を待つため、4秒後に確かめ、出す直前にもう一度確かめる。
 * ★帯は × で閉じられる（その画面を開いている間は再び出さない）。印刷には出さない。
 * ★現場の端末（su_device_role === 'field'）では「事務所に連絡」とだけ出す（接続設定は事務所専用）。
 */
(function () {
  'use strict';
  // 画面 → その画面が使う接続先（どれか1つに URL があれば設定済み）。[キー, フィールド]（フィールド null は文字列キー）
  var SYNC = [['su_sync_common', 'endpoint'], ['ws_settings', 'endpoint']];
  var MAP = {
    'care-schedule.html': SYNC.concat([['care_schedule_sync_v1', 'endpoint']]),
    'daycare-roster.html': SYNC,
    'support-overview.html': SYNC,
    'visit-overview.html': SYNC,
    'resident-master.html': [['rmaster_cfg', 'url']],
    'facesheet.html': [['rmaster_cfg', 'url']],
    'weight-record.html': [['wtmgr_api_url', null]],
    'moushiokuri-viewer.html': [['msk_cfg', 'url']],
    'genogram.html': [['genogram:cloudCfg', 'gasUrl']],
    'admission-flow.html': [['adm_cfg', 'url']],
    'training-plan.html': [['tp_cfg', 'url']],
    'shift-analyzer.html': [['shiftanalyzer:v1:cloud', 'url']],
    // メニュー: 主な2つ（週間計画系・入居者マスタ系）がどちらも空＝端末の設定がまとめて消えた可能性
    'index.html': SYNC.concat([['rmaster_cfg', 'url']])
  };
  var WAIT_MS = 4000;

  function page() {
    var p = (location.pathname.split('/').pop() || 'index.html');
    return MAP[p] ? p : '';
  }
  function has(k, f) {
    try {
      var s = localStorage.getItem(k);
      if (!s) return false;
      if (!f) return String(s).trim() !== '';
      var o = JSON.parse(s);
      return !!(o && typeof o === 'object' && String(o[f] || '').trim());
    } catch (e) { return true; }   // 読めない＝判断しない（出さない側に倒す）
  }
  function empty(list) {
    for (var i = 0; i < list.length; i++) if (has(list[i][0], list[i][1])) return false;
    return true;
  }
  function isField() { try { return localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; } }

  function show() {
    if (document.getElementById('su-cfg-hint')) return;
    var st = document.createElement('style');
    st.textContent = '@media print{#su-cfg-hint{display:none!important}}';
    document.head.appendChild(st);
    var bar = document.createElement('div');
    bar.id = 'su-cfg-hint';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147482000;background:#fff8e1;color:#5d4037;' +
      'border:1px solid #ffe0a3;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.18);padding:10px 12px;' +
      'font:600 14px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;' +
      'display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:720px;margin:0 auto';
    var t = document.createElement('span');
    t.style.cssText = 'flex:1 1 240px';
    var a = null;
    if (isField()) {
      t.textContent = 'この端末には、この画面の接続先が入っていません。事務所に連絡してください。';
    } else {
      t.textContent = 'この端末には、この画面の接続先が入っていません。「設定の控え」があれば、接続設定の「控えから戻す」で全部のアプリの設定を一括で戻せます。';
      a = document.createElement('a');
      a.href = 'connection-settings.html#restore';
      a.textContent = '接続設定を開く';
      a.style.cssText = 'background:#0b57d0;color:#fff;border-radius:8px;padding:8px 12px;text-decoration:none;min-height:40px;display:inline-flex;align-items:center';
    }
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', '案内を閉じる');
    x.textContent = '×';
    x.style.cssText = 'border:0;background:transparent;color:#5d4037;font-size:20px;min-width:40px;min-height:40px;cursor:pointer';
    x.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(t);
    if (a) bar.appendChild(a);
    bar.appendChild(x);
    document.body.appendChild(bar);
  }

  function check() {
    var p = page();
    if (!p || !document.body) return;
    if (!empty(MAP[p])) return;
    // アプリ側の自動復元（多層保存・接続先の自己修復）を待ってから、もう一度確かめる
    setTimeout(function () { if (empty(MAP[p])) show(); }, WAIT_MS);
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
    else check();
  } catch (e) { /* 案内の失敗は画面に影響させない */ }

  window.SUCfgHint = { _map: MAP, _empty: function () { var p = page(); return p ? empty(MAP[p]) : false; } };
})();

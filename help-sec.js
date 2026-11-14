/* 使い方・困った時（help.html）の「画面ごとの使い方」へ、住所の ?sec=<画面> から飛ぶ部品（2026-11-13 代表者の指示）
 *   help.html?sec=care-schedule のように、決まった値（対応表 SEC にある画面）の時だけ、その画面の節までスクロールして見出しに焦点を当てる。
 *   決まっていない値・壊れた値の時は何もしない（値を画面に書かない・記録にも残さない）。
 *   読み込めなくても、使い方の画面はそのまま読める（この部品は見出しへ移すだけ）。
 *   画面の中のスクリプトを増やさないよう、同じサイトの外のファイルにしている（help.html の CSP は script-src 'self' と指紋1つ）。
 */
(function () {
  'use strict';
  /* 受ける値 → 見出しの id（help.html の各節の h2）。ここに無い値は受けない */
  var SEC = {
    'care-schedule': 'h-care-schedule',
    'work-schedule': 'h-work-schedule',
    'shift-app': 'h-shift-app',
    'shift-analyzer': 'h-shift-analyzer',
    'resident-master': 'h-resident-master',
    'weight-record': 'h-weight-record',
    'facesheet': 'h-facesheet',
    'genogram': 'h-genogram',
    'patch-calendar': 'h-patch-calendar',
    'moushiokuri-viewer': 'h-moushiokuri-viewer',
    'admission-flow': 'h-admission-flow',
    'care-meeting': 'h-care-meeting',
    'supplies': 'h-supplies',
    'equip-log': 'h-equip-log',
    'visit-overview': 'h-visit-overview',
    'support-overview': 'h-support-overview',
    'overview-compare': 'h-overview-compare',
    'daycare-roster': 'h-daycare-roster',
    'training-plan': 'h-training-plan',
    'staff-master': 'h-staff-master',
    'ats': 'h-ats',
    'connection-settings': 'h-connection-settings',
    'accounts': 'h-accounts',
    'app-access': 'h-app-access',
    'menu-settings': 'h-menu-settings',
    'shadow-check': 'h-shadow-check',
    'unsent': 'h-unsent'
  };
  function want() {
    var q = String(window.location.search || '');
    var m = /[?&]sec=([a-z-]{1,40})(?:&|$)/.exec(q);
    if (!m || !Object.prototype.hasOwnProperty.call(SEC, m[1])) return null;
    return SEC[m[1]];
  }
  function go() {
    try {
      var id = want();
      if (!id) return;
      var h = document.getElementById(id);
      if (!h) return;
      if (typeof h.scrollIntoView === 'function') h.scrollIntoView({ block: 'start' });
      if (typeof h.focus === 'function') h.focus({ preventScroll: true });
    } catch (e) {
      try { if (window.SUErrors && typeof SUErrors.note === 'function') SUErrors.note('使い方の節へ移る', e); } catch (x) { /* 記録できなくても止めない */ }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();

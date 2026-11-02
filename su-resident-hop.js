/* su-resident-hop.js — 「この方の画面：」の行き来のボタン（代表者の決定 2026-11-02 案A）
 *
 * ある方で開いている画面の本人確認の帯（「〇〇さんを開いています」）の中に、同じ方の別の画面へ移るボタンを並べる。
 * ・同じタブで移る（target を付けない）。保存していない編集の確かめは、各画面の「離れる前の確かめ」に任せる
 * ・行き先へ渡すのは入居者マスタの番号（利用者No）だけ。氏名は URL に載せない
 *   （家族構成図だけは既存の受け口が氏名を保存の鍵に使うため、入居者マスタと同じく ?resident=&name= で渡す）
 * ・現場の端末（su_device_role==='field'）では、事務所向けの画面（入居者マスタ・週間計画・計画書・担当者会議）への行き先を出さない
 * ・今の画面は出さない。番号の形が正しくない時は何も出さない
 * ・画面だけ（.srh は @media print で消す）。外からの値は全部エスケープする。例外を外に出さない
 * 使い方: SUResHop.html('facesheet.html', 番号, 氏名) が帯に足す HTML を返す（出せない時は ''）。
 */
(function () {
  'use strict';
  if (window.SUResHop) return;

  /* 行き先（並び順＝帯に並ぶ順）。office: 事務所向け（現場の端末では出さない） */
  var TARGETS = [
    { href: 'resident-master.html', ic: '🗂️', nm: '入居者マスタ', q: 'id', office: true },
    { href: 'facesheet.html', ic: '📄', nm: 'フェイスシート', q: 'masterId' },
    { href: 'genogram.html', ic: '🌳', nm: '家族構成図', q: 'resident', withName: true },
    { href: 'care-schedule.html', ic: '📅', nm: '週間計画', q: 'masterId', office: true },
    { href: 'weight-record.html', ic: '⚖️', nm: '体重管理', q: 'masterId' },
    { href: 'moushiokuri-viewer.html', ic: '📝', nm: '申送ビューア', q: 'masterId' },
    { href: '../haiben-record/haiben-record.html', ic: '🚽', nm: '排便ケア記録', q: 'masterId' },
    { href: 'training-plan.html', ic: '🏃', nm: '計画書', q: 'masterId', office: true },
    { href: 'care-meeting.html', ic: '🤝', nm: '担当者会議', q: 'resident', office: true }
  ];
  var ID_RE = /^[0-9A-Za-z_-]{1,32}$/;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isField() {
    try { return localStorage.getItem('su_device_role') === 'field'; } catch (e) { return false; }
  }
  function linkOf(t, id, name) {
    var u = t.href + '?' + t.q + '=' + encodeURIComponent(id);
    if (t.withName) u += '&name=' + encodeURIComponent(name || '');
    return u;
  }
  /* 帯に並べる行き先の一覧（試験からも使う） */
  function targets(current, id, name, field) {
    if (id == null) return [];
    id = String(id).trim();
    if (!ID_RE.test(id)) return [];
    var out = [];
    for (var i = 0; i < TARGETS.length; i++) {
      var t = TARGETS[i];
      if (t.href === current) continue;
      if (field && t.office) continue;
      if (t.withName && (!name || field)) continue;   // 家族構成図は氏名が無いと開けない。現場の端末では氏名を URL に載せない
      out.push({ href: linkOf(t, id, name), ic: t.ic, nm: t.nm });
    }
    return out;
  }
  function html(current, id, name) {
    try {
      var list = targets(current, id, name, isField());
      if (!list.length) return '';
      return '<span class="srh" role="group" aria-label="この方の画面">' +
        '<span class="srh-lbl">この方の画面：</span>' +
        list.map(function (t) {
          return '<a class="srh-a" href="' + esc(t.href) + '"><span aria-hidden="true">' + esc(t.ic) + '</span> ' + esc(t.nm) + '</a>';
        }).join('') + '</span>';
    } catch (e) {
      try { if (window.SUErrors && typeof SUErrors.note === 'function') SUErrors.note('行き来の帯', e && e.message, 'su-resident-hop.js'); } catch (e2) { /* 記録もできない時は黙る（画面の動きを止めない） */ }
      return '';
    }
  }
  window.SUResHop = { html: html, targets: targets, TARGETS: TARGETS };
})();

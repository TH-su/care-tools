/*
 * su-export.js — 全データの書き出しの「中身を作る」部品（2026-10-26 新設・使える人の管理の「全データの書き出し」）
 * ════════════════════════════════════════════════════════════════
 * ここは通信も画面も触らない純関数だけ（試験は check/unit/export_zip_test.js）。
 *   zip(files)          … 圧縮しない ZIP（stored）を作る。外部の部品に頼らない。名前は UTF-8 の印（bit 11）付き
 *   csv(rows, cols)     … 表計算用の CSV（UTF-8・BOM 付き・改行は CRLF）。
 *                         ★先頭が = + - @ タブ 改行 の値は、頭に ' を付ける（表計算ソフトが式として動かさないように）。
 *                           そのため CSV は「見る用」。元の値のとおりに戻すのは JSON の方（説明書きにも書く）
 *   tableOf(value)      … GAS の応答を、CSV にできる「行の並び」に寄せる（できない形なら null）
 *   readme(meta)        … ZIP の最初に入れる説明書き（何がどこに・何件・入っていないもの・扱いの注意）
 *   counts(data)        … {表: 行の配列} から {表: 件数}
 * ★値の中身はどこにも送らない・端末に残さない（呼ぶ側も Blob を保存させるだけ）。
 */
(function (global) {
  'use strict';

  /* ── UTF-8 ── */
  function utf8(s) { return new TextEncoder().encode(String(s)); }

  /* ── CRC-32（ZIP の決まり。表を1回だけ作る）── */
  var CRC_T = null;
  function crc32(bytes) {
    if (!CRC_T) {
      CRC_T = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_T[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_T[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ZIP の日時（DOS 形式・端末の時刻） */
  function dosTime(d) {
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF,
      date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    };
  }

  /* files: [{name:'db/kv_entries.json', data: 文字列 か Uint8Array}] → Uint8Array（ZIP 1つ）
     ★名前は英数字と / . _ - だけを受ける（よその階層へ展開させない・どの解凍ソフトでも同じ名前にする）。
       名前が重なった時・4GB を超えた時・65535 個を超えた時は作らずに例外（途中まで作った物を渡さない）。 */
  var NAME_RE = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\.[A-Za-z0-9]+$/;
  function zip(files, when) {
    var d = dosTime(when || new Date());
    var seen = {}, parts = [], central = [], offset = 0;
    if (files.length > 65535) throw new Error('ファイルが多すぎます');
    files.forEach(function (f) {
      if (!NAME_RE.test(f.name) || f.name.length > 200) throw new Error('ZIP に入れられない名前です: ' + f.name);
      if (seen[f.name]) throw new Error('同じ名前が2つあります: ' + f.name);
      seen[f.name] = true;
      var name = utf8(f.name);
      var data = (f.data instanceof Uint8Array) ? f.data : utf8(f.data);
      var crc = crc32(data);
      if (offset + 30 + name.length + data.length > 0xFFFFFFFF) throw new Error('大きすぎて ZIP にできません');
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);   // ローカルヘッダの印
      lh.setUint16(4, 20, true);           // 展開に要る版（2.0）
      lh.setUint16(6, 0x0800, true);       // 名前は UTF-8
      lh.setUint16(8, 0, true);            // 圧縮しない（stored）
      lh.setUint16(10, d.time, true);
      lh.setUint16(12, d.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);   // 中央ディレクトリの印
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, d.time, true);
      ch.setUint16(14, d.date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var csize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var out = new Uint8Array(offset + csize + 22), p = 0;
    all.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }

  /* ── CSV ── */
  var RISKY = /^[=+\-@\t\r]/;
  function cell(v) {
    var s;
    if (v === null || v === undefined) s = '';
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (RISKY.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  /* rows: 行（オブジェクト）の配列。cols を省くと、全部の行に出てくる項目名を、出てきた順に並べる */
  function columnsOf(rows) {
    var cols = [], seen = {};
    rows.forEach(function (r) {
      Object.keys(r || {}).forEach(function (k) { if (!seen.hasOwnProperty(k)) { seen[k] = true; cols.push(k); } });
    });
    return cols;
  }
  function csv(rows, cols) {
    cols = cols && cols.length ? cols : columnsOf(rows);
    var lines = [cols.map(cell).join(',')];
    rows.forEach(function (r) {
      lines.push(cols.map(function (c) { return cell(r == null ? null : r[c]); }).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* GAS の応答の一部を、CSV にできる行の並びへ寄せる。
     ・オブジェクトの配列 → そのまま
     ・値の配列 → {値} の1列
     ・オブジェクト（キー→中身）→ {キー, 中身} の行（中身は CSV で JSON の文字になる）
     ・それ以外 → null（CSV を作らない。JSON の方にはそのまま入る） */
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function tableOf(v) {
    if (Array.isArray(v)) {
      if (v.every(isObj)) return v;
      return v.map(function (x) { return { '値': x }; });
    }
    if (isObj(v)) {
      return Object.keys(v).map(function (k) {
        var x = v[k];
        return isObj(x) ? Object.assign({ 'キー': k }, flatOne(x)) : { 'キー': k, '中身': x };
      });
    }
    return null;
  }
  /* 1段だけ開く（入れ子の中身は JSON の文字のまま列に入る） */
  function flatOne(o) {
    var r = {};
    Object.keys(o).forEach(function (k) { r[k === 'キー' ? 'キー(元)' : k] = o[k]; });
    return r;
  }

  function counts(data) {
    var c = {};
    Object.keys(data).forEach(function (k) { c[k] = Array.isArray(data[k]) ? data[k].length : 0; });
    return c;
  }

  /* ── 説明書き ── */
  var SCOPE = { tenant: 'この事業者の行だけ', self: 'この事業者の1行だけ', shared: 'ケアログの表（テナントの印なし・全行）' };
  function pad(s, n) { s = String(s); return s + new Array(Math.max(0, n - s.length) + 1).join(' '); }
  function readme(m) {
    var L = [];
    L.push('全データの書き出し — 説明書き');
    L.push('════════════════════════════════════════');
    L.push('事業者: ' + (m.tenantName || '') + '（' + (m.tenantId || '') + '）');
    L.push('書き出した日時: ' + m.startedAt);
    L.push('書き出した人: ' + m.actorEmail);
    L.push('書き出しの番号: ' + m.runId + '（データベースの export_runs に、日時・人・件数が残っています）');
    L.push('');
    L.push('■ 扱いの注意');
    L.push('・入居者・ご家族・職員の個人情報がそのまま入っています。鍵はかかっていません。');
    L.push('・共有フォルダ・メール・チャットに置かないでください。使い終わったら消してください。');
    L.push('');
    L.push('■ 中身の場所');
    L.push('・README.txt     … この説明書き');
    L.push('・manifest.json  … 機械が読む目録（表・系統ごとの件数・列の一覧）');
    L.push('・db/<表>.json   … データベース（Supabase）の表。元の値のとおり（日時・数・配列・JSON もそのまま）');
    L.push('・db/<表>.csv    … 同じ表を表計算ソフト用にしたもの（UTF-8・BOM 付き）');
    L.push('・gas/<系統>.json … Google（GAS）から読んだもの。応答のまま');
    L.push('・gas/<系統>__<部分>.csv … その中で表の形にできた部分');
    L.push('');
    L.push('■ CSV について');
    L.push('・先頭が = + - @ の値は、表計算ソフトで式として動かないよう、頭に \' を付けています。');
    L.push('・JSON の値（同期データの中身など）は、1つのセルに JSON の文字で入っています。');
    L.push('・元の値に戻す・ほかの仕組みへ移す時は、CSV ではなく JSON を使ってください。');
    L.push('');
    L.push('■ データベース（Supabase）の表  合計 ' + m.dbTotal + ' 行');
    m.tables.forEach(function (t) {
      L.push('');
      L.push('【' + t.name + '】 ' + t.count + ' 行（' + (SCOPE[t.scope] || t.scope) + '）');
      L.push('  ' + (t.comment || '（説明なし）'));
      L.push('  列: ' + (t.columns || []).map(function (c) {
        return c.name + '（' + c.type + (c.comment ? '・' + c.comment : '') + '）';
      }).join('、'));
    });
    L.push('');
    L.push('■ Google（GAS）');
    m.gas.forEach(function (g) {
      var st = g.ok ? (g.count + ' 件') : ('入っていません: ' + (g.note || ''));
      L.push('・' + pad(g.title, 16) + ' ' + st + (g.ok && g.note ? '（' + g.note + '）' : ''));
    });
    L.push('');
    L.push('■ 入っていないもの');
    L.push('・ログインの表（Supabase が管理）・ファイル置き場（Storage）・設定と合言葉の類（private の領域）');
    L.push('・勤務表の編集券の合言葉（shift_leases の token の列）');
    m.notIncluded.forEach(function (s) { L.push('・' + s); });
    L.push('');
    return '﻿' + L.join('\r\n');
  }

  global.SUExport = { zip: zip, crc32: crc32, csv: csv, columnsOf: columnsOf, tableOf: tableOf, readme: readme, counts: counts, NAME_RE: NAME_RE };
})(typeof window !== 'undefined' ? window : globalThis);

/* 職員マスタ・入居調整の添付書類の道（su-doc-live.js・統合 0065・2026-11-05）の試験。架空データのみ（職員ID・案件 id・ファイル名は見本）。
   守ること:
     S スイッチ docs が切・現場の端末・ログインの控えが無い・印が写しの期間・0065 の前（関数が無い）の時は、Google へ送る関数をそのまま呼ぶ（新しい保存先に触らない）
     P 置く: 指紋を数えて「事業者 id/種類/持ち主/書類の id/指紋の頭16字」へ置き、doc_put で台帳へ足す。断られたら置いた物を消す。形・大きさの違いは置かない
     L 一覧: 職員マスタは Google の一覧の各職員の書類の欄を台帳の中身に置き換える（台帳を読めない時は Google の一覧のまま）・入居調整は台帳から目録を作る
     O 開く・消す: 置き場から読む（入居調整は今の downloadFile と同じ形）・doc_del
     R Google が「切り替えた後」と断ったら、印を読み直して1回だけ道を選び直す
     F 部品の決まり: 端末に書かない・console を使わない・置き場の名前を画面へ返さない
   実行: node check/unit/su_doc_live_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'su-doc-live.js'), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 500) : '')); } }
const TEN = '00000000-0000-4000-8000-000000000001';
const sha = s => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');
const b64 = s => Buffer.from(s).toString('base64');

function world(o = {}) {
  o = Object.assign({ flag: true, login: true, status: 'ok', stf: 'live', adm: 'live' }, o);
  const st = { gas: 0, rpcs: [], uploads: [], removes: [], downloads: [], modeCalls: 0, objects: {}, files: {}, ls: {} };
  if (o.login) st.ls['sb-abc-auth-token'] = '{}';
  if (o.field) st.ls.su_device_role = 'field';
  const client = {
    rpc: async (fn, a) => {
      st.rpcs.push(fn);
      if (fn === 'doc_mode_get') {
        st.modeCalls++;
        if (o.modeMissing) return { error: { code: 'PGRST202' } };
        const m = typeof o.modeSeq === 'function' ? o.modeSeq(st.modeCalls) : { stf: o.stf, adm: o.adm };
        return { data: { ok: true, tenant: TEN, stf: { mode: m.stf }, adm: { mode: m.adm } } };
      }
      if (fn === 'doc_put') {
        st.put = a;
        if (o.putRefuse) return { data: { ok: false, error: o.putRefuse } };
        const key = TEN + '/' + a.p_kind + '/' + a.p_owner + '/' + a.p_fid + '/' + a.p_sha256.slice(0, 16);
        const f = Object.assign({}, a.p_meta, { addedAt: '2026-11-05T01:00:00.000Z', by: '事務 甲', fid: a.p_fid, key });
        (st.files[a.p_owner] = st.files[a.p_owner] || []).push(f);
        return { data: { ok: true, file: f } };
      }
      if (fn === 'doc_del') { st.del = a; return { data: o.delRefuse ? { ok: false, error: 'notfound' } : { ok: true } }; }
      if (fn === 'doc_list') {
        if (o.listFail) return { data: { ok: false, error: 'doc_not_live' } };
        const files = {};
        Object.keys(st.files).forEach(k => { if (!a.p_owner || a.p_owner === k) files[k] = st.files[k]; });
        return { data: { ok: true, files } };
      }
      return { data: null };
    },
    storage: { from: (b) => ({
      upload: async (key, blob, opt) => { st.uploads.push({ b, key, type: opt.contentType, upsert: opt.upsert }); st.objects[key] = Buffer.from(await blob.arrayBuffer()); return o.uploadFail ? { error: { statusCode: '403' } } : { data: { path: key } }; },
      remove: async (keys) => { st.removes.push(keys); return { data: [] }; },
      download: async (key) => { st.downloads.push(key); return st.objects[key] ? { data: new Blob([st.objects[key]], { type: 'application/pdf' }) } : { error: { statusCode: '400' } }; }
    }) }
  };
  const w = {
    setTimeout, clearTimeout, Promise, Object, Error, String, Number, JSON, Math, Array, Uint8Array, Blob, atob, btoa,
    crypto: crypto.webcrypto,
    localStorage: {
      get length() { return Object.keys(st.ls).length; }, key: i => Object.keys(st.ls)[i],
      getItem: k => (k in st.ls ? st.ls[k] : null), setItem: () => { st.lsWrite = true; }, removeItem: () => { st.lsWrite = true; }
    },
    fetch: async () => ({ ok: true, json: async () => ({ supabase: { docs: !!o.flag } }) }),
    SUAuth: { STATUS: { OK: 'ok' }, check: async () => ({ status: o.status }), client: () => client }
  };
  w.window = w; vm.createContext(w); vm.runInContext(SRC, w);
  const gasRes = (d) => { const txt = JSON.stringify(d); return { ok: true, status: 200, text: async () => txt, clone() { return { text: async () => txt }; } }; };
  const gasSend = (d) => () => { st.gas++; return Promise.resolve(gasRes(typeof d === 'function' ? d(st.gas) : d)); };
  const gasCall = (d) => () => { st.gas++; return Promise.resolve(typeof d === 'function' ? d(st.gas) : d); };
  return { D: w.SUDocLive, st, gasSend, gasCall };
}
const up = (extra) => Object.assign({ action: 'uploadFile', token: 'kakuu', id: 'S0001', name: '見本.pdf', mime: 'application/pdf', kind: 'license', title: '見本の書類', dataB64: b64('PDF-DUMMY'), by: '' }, extra || {});
const rd = async (res) => JSON.parse(await res.text());

(async () => {
  console.log('S Google へ流す時');
  for (const [label, opt] of [['スイッチ docs が切', { flag: false }], ['現場の端末', { field: true }], ['ログインの控えが無い', { login: false }],
                               ['ログインを確かめられない', { status: 'signed_out' }], ['印が写しの期間', { stf: 'shadow' }], ['0065 の前（関数が無い）', { modeMissing: true }]]) {
    const w = world(opt);
    const d = await rd(await w.D.staff(up(), w.gasSend({ ok: true, file: { fid: 'drv_x' } })));
    t('S ' + label + ' → 職員マスタの置くは Google へ（置き場・台帳に触らない）', w.st.gas === 1 && d.ok === true && !w.st.uploads.length && !w.st.rpcs.includes('doc_put'), { st: w.st.rpcs, d });
  }
  {
    const w = world({ stf: 'shadow', adm: 'live' });
    await w.D.staff(up(), w.gasSend({ ok: true }));
    t('S 入居調整だけ切り替えた後でも、職員マスタは Google へ（種類ごとに決める）', w.st.gas === 1 && !w.st.uploads.length);
    const w2 = world();
    await w2.D.staff({ action: 'bulkSave', token: 'kakuu' }, w2.gasSend({ ok: true }));
    t('S 書類でない送信は印も読まずにそのまま Google へ', w2.st.gas === 1 && w2.st.modeCalls === 0);
  }
  console.log('P 置く');
  {
    const w = world();
    const d = await rd(await w.D.staff(up(), w.gasSend({ ok: false })));
    const u = w.st.uploads[0] || {};
    const fid = w.st.put && w.st.put.p_fid;
    t('P 置き場の名前は「事業者 id/stf/職員ID/書類の id/指紋の頭16字」・上書きしない・形はそのまま', u.b === 'doc-files' && u.key === TEN + '/stf/S0001/' + fid + '/' + sha('PDF-DUMMY').slice(0, 16) && u.upsert === false && u.type === 'application/pdf', u);
    t('P 台帳へ足す（指紋・大きさ・見出し。合言葉・送った名前 by は送らない）', w.st.put.p_sha256 === sha('PDF-DUMMY') && w.st.put.p_meta.size === 9 && w.st.put.p_meta.title === '見本の書類'
      && !('by' in w.st.put.p_meta) && /^[A-Za-z0-9_-]{10,128}$/.test(fid), w.st.put);
    t('P Google へは送らない・答えは Google と同じ形（ok・file）で、置き場の名前を返さない', w.st.gas === 0 && d.ok === true && d.file.fid === fid && d.file.by === '事務 甲' && !('key' in d.file), d);
    const w2 = world({ putRefuse: 'toomany' });
    const d2 = await rd(await w2.D.staff(up(), w2.gasSend({})));
    t('P 台帳が断った → 置いた物を消し、職員向けの文を返す', d2.ok === false && /上限/.test(d2.error) && w2.st.removes.length === 1 && w2.st.removes[0][0] === w2.st.uploads[0].key, d2);
    const w3 = world();
    const d3 = await rd(await w3.D.staff(up({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), w3.gasSend({})));
    t('P 職員マスタは PDF・JPEG・PNG だけ（Word は置かない）', d3.ok === false && !w3.st.uploads.length);
    const w4 = world();
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');
    const d4 = await rd(await w4.D.staff(up({ dataB64: big }), w4.gasSend({})));
    t('P 10MB を超えるファイルは置かない', d4.ok === false && /大きすぎます/.test(d4.error) && !w4.st.uploads.length);
    const w5 = world({ uploadFail: true });
    const d5 = await rd(await w5.D.staff(up(), w5.gasSend({})));
    t('P 置き場に置けない → 台帳へ足さず、職員向けの文', d5.ok === false && !w5.st.rpcs.includes('doc_put'), d5);
    const w6 = world();
    const d6 = await rd(await w6.D.staff(up({ id: '../S0001' }), w6.gasSend({})));
    t('P 持ち主の形が違う → 置かない', d6.ok === false && !w6.st.uploads.length);
  }
  console.log('L 一覧');
  {
    const w = world();
    await w.D.staff(up(), w.gasSend({}));
    const list = { ok: true, ver: 3, rows: [{ id: 'S0001', name: '見本 甲', filesJson: [{ fid: 'drv_old' }] }, { id: 'S0002', name: '見本 乙', filesJson: [{ fid: 'drv_stale' }] }] };
    const d = await rd(await w.D.staff({ action: 'list', token: 'kakuu' }, w.gasSend(list)));
    t('L 職員マスタ: Google の一覧の書類の欄を台帳の中身に置き換える（ほかの欄・版はそのまま・書類の無い人は空）',
      w.st.gas === 1 && d.ver === 3 && d.rows[0].name === '見本 甲' && d.rows[0].filesJson.length === 1 && d.rows[0].filesJson[0].title === '見本の書類' && !('key' in d.rows[0].filesJson[0])
      && Array.isArray(d.rows[1].filesJson) && d.rows[1].filesJson.length === 0, d);
    const w2 = world({ listFail: true });
    const d2 = await rd(await w2.D.staff({ action: 'list', token: 'kakuu' }, w2.gasSend(list)));
    t('L 台帳を読めない時は Google の一覧のまま返す（職員の一覧は止めない）', d2.rows[0].filesJson[0].fid === 'drv_old', d2);
    const w3 = world({ stf: 'shadow' });
    const d3 = await rd(await w3.D.staff({ action: 'list', token: 'kakuu' }, w3.gasSend(list)));
    t('L 写しの期間なら一覧は Google のまま', d3.rows[0].filesJson[0].fid === 'drv_old' && !w3.st.rpcs.includes('doc_list'));
  }
  console.log('O 開く・消す（職員マスタ）');
  {
    const w = world();
    const d = await rd(await w.D.staff(up(), w.gasSend({})));
    const o1 = await w.D.open('stf', 'S0001', d.file.fid);
    t('O 開く: 置き場から読んだ中身を返す（台帳を読み直さずに覚えた名前で読む）', o1.ok === true && Buffer.from(await o1.blob.arrayBuffer()).toString() === 'PDF-DUMMY' && w.st.downloads.length === 1, o1);
    const w2 = world();
    w2.st.files.S0001 = [{ fid: 'drv_aaaaaaaaaa1', name: 'a.pdf', size: 3, mime: 'application/pdf', key: TEN + '/stf/S0001/drv_aaaaaaaaaa1/' + sha('AAA').slice(0, 16) }];
    w2.st.objects[w2.st.files.S0001[0].key] = Buffer.from('AAA');
    const o2 = await w2.D.open('stf', 'S0001', 'drv_aaaaaaaaaa1');
    t('O 開く: 覚えていない書類は台帳を読んで置き場の名前を知る', o2.ok === true && w2.st.rpcs.includes('doc_list'), o2);
    const o3 = await w2.D.open('stf', 'S0001', 'drv_nonexist01');
    t('O 開く: 無い書類は職員向けの文', o3.ok === false && /見つかりません/.test(o3.error));
    const r = await rd(await w2.D.staff({ action: 'removeFile', token: 'kakuu', id: 'S0001', fid: 'drv_aaaaaaaaaa1', by: '' }, w2.gasSend({})));
    t('O 消す: doc_del（種類・持ち主・書類の id）・答えは Google と同じ形', r.ok === true && Array.isArray(r.warnings) && w2.st.del.p_kind === 'stf' && w2.st.del.p_owner === 'S0001' && w2.st.del.p_fid === 'drv_aaaaaaaaaa1' && w2.st.gas === 0, r);
    const w3 = world({ delRefuse: true });
    const r3 = await rd(await w3.D.staff({ action: 'removeFile', token: 'kakuu', id: 'S0001', fid: 'drv_x0000000001' }, w3.gasSend({})));
    t('O 消す: 無い書類は職員向けの文', r3.ok === false && /見つかりません/.test(r3.error));
    const w4 = world({ stf: 'shadow' });
    const o4 = await w4.D.open('stf', 'S0001', 'x');
    t('O 写しの期間に開く口を呼んでも置き場を読まない', o4.ok === false && !w4.st.downloads.length);
    t('O 画面の描き分けの印（liveNow）は直前の道の選び方', w.D.liveNow('stf') === true && w4.D.liveNow('stf') === false);
  }
  console.log('A 入居調整');
  {
    const w = world();
    const r = await w.D.adm({ action: 'uploadFile', cid: 'case-1', name: '見本.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'other', title: '', dataB64: b64('DOCX') }, w.gasCall({}));
    t('A 置く: Word も置ける・答えは Google と同じ形（ok・file・filesRev）', r.ok === true && r.file && r.filesRev === 0 && w.st.uploads[0].key.indexOf(TEN + '/adm/case-1/') === 0 && w.st.gas === 0, r);
    const g = await w.D.adm({ action: 'filesGet' }, w.gasCall({}));
    t('A 一覧: 台帳から目録を作る（案件ごと）', g.ok === true && g.filesRev === 0 && g.files['case-1'].length === 1 && !('key' in g.files['case-1'][0]), g);
    const dl = await w.D.adm({ action: 'downloadFile', cid: 'case-1', fid: r.file.fid }, w.gasCall({}));
    t('A 開く: 今の downloadFile と同じ形（dataB64・mime・size）', dl.ok === true && Buffer.from(dl.dataB64, 'base64').toString() === 'DOCX' && dl.size === 4, dl);
    const rm = await w.D.adm({ action: 'removeFile', cid: 'case-1', fid: r.file.fid }, w.gasCall({}));
    t('A 消す: doc_del・答えは Google と同じ形', rm.ok === true && rm.filesRev === 0 && w.st.del.p_kind === 'adm' && w.st.del.p_owner === 'case-1');
    const w2 = world({ adm: 'shadow' });
    const g2 = await w2.D.adm({ action: 'filesGet' }, w2.gasCall({ ok: true, files: { x: [] }, filesRev: 7 }));
    t('A 写しの期間なら Google の答えをそのまま返す', g2.filesRev === 7 && w2.st.gas === 1);
    const w3 = world();
    const p3 = await w3.D.adm({ action: 'put', key: 'admission_flow_v1' }, w3.gasCall({ ok: true, rev: 2 }));
    t('A 台帳の保存など書類でない送信はそのまま Google へ', p3.rev === 2 && w3.st.modeCalls === 0);
  }
  console.log('R 道の選び直し');
  {
    const w = world({ modeSeq: n => (n === 1 ? { stf: 'shadow', adm: 'shadow' } : { stf: 'live', adm: 'live' }) });
    const d = await rd(await w.D.staff(up(), w.gasSend({ ok: false, error: '添付書類の保存先を切り替えている最中か、切り替えた後です。', code: 'doc_switched' })));
    t('R 職員マスタ: Google が「切り替えた後」と断ったら、印を読み直して新しい保存先へ置く（1回だけ）', d.ok === true && w.st.gas === 1 && w.st.modeCalls === 2 && w.st.uploads.length === 1, { d, st: w.st.modeCalls });
    const w2 = world({ modeSeq: () => ({ stf: 'shadow', adm: 'shadow' }) });
    const d2 = await rd(await w2.D.staff(up(), w2.gasSend({ ok: false, error: '切り替えた後です', code: 'doc_switched' })));
    t('R 読み直しても写しの期間なら、Google の断りをそのまま返す（送り直しは1回だけ）', d2.ok === false && w2.st.gas === 2, w2.st.gas);
    const w3 = world({ modeSeq: n => (n === 1 ? { stf: 'shadow', adm: 'shadow' } : { stf: 'live', adm: 'live' }) });
    const r3 = await w3.D.adm({ action: 'filesGet' }, w3.gasCall({ ok: false, error: '切り替えた後です', code: 'doc_switched' }));
    t('R 入居調整: 同じく読み直して新しい保存先から読む', r3.ok === true && w3.st.gas === 1 && w3.st.rpcs.includes('doc_list'), r3);
  }
  console.log('F 部品の決まり');
  {
    const w = world();
    await w.D.staff(up(), w.gasSend({}));
    t('F 端末に書かない（localStorage へ書く処理が無い・試験の間に書いていない）', !/localStorage\.setItem|localStorage\.removeItem|sessionStorage/.test(SRC) && !w.st.lsWrite);
    t('F console を使わない', !/console\./.test(SRC));
    t('F 二重に読み込んでも動きを重ねない', /if \(root\.SUDocLive\) return;/.test(SRC));
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exitCode = fail ? 1 : 0;
})();

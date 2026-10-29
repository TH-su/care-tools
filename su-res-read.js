/*
 * su-res-read.js — 入居者マスタを Supabase の正本から読む口（正本の切り替えの手順4・2026-10-29 代表者の決定 B）
 * ════════════════════════════════════════════════════════════════
 * 画面は今までの Google への読み取り（getRoster・getResident・getSection・getBulk・getListFull・getMedsBulk・getMealList）を
 *   SUResRead.call(本文, Google へ送る関数, { screen: '画面の名前' }) に通す。
 * ・スイッチ su-backend.json の supabase.master_live が切（今）・読めない時は、Google へ送る関数をそのまま呼ぶ
 *   ＝本文も送り方も1バイトも変わらない（CLAUDE.md §2-3）。
 * ・スイッチが入の時は、データベースの印（統合 0035 の res_mode）が「切り替えた後」の時だけ Supabase から読む。
 *   印が写しの期間の時・関数が無い（0035 の前）時は Google（切り替えは1回で、読み手と書き手は同じ印で動く）。
 * ・Supabase から読む時は、入居者マスタの GAS の読み取り関数の写し（下の GAS の箱・コメントを除き一字一句同じ）を、
 *   写しの記録から組み立てた仮の行に当てて、Google と同じ形の応答を作る（形の作り直しを二重に書かない）。
 * ・スイッチが入で印が「切り替えた後」なのに Supabase で断られた時は、Google へ流さない（CLAUDE.md §4）。
 * ・読んだ中身は端末に保存しない（画面が今までどおり扱う）。現場の端末・現場のアカウントは、データベースが
 *   現場の項目だけを返す（res_get）。
 * ★共通部品の決まり: 読み込むだけで効く・読み込めなくても動く（画面は SUResRead が無ければ Google へ送る）・例外を外に出さない。
 */
(function (root) {
  'use strict';
  if (root.SUResRead) return;
  var FLAG = 'master_live';
  var FLAGS_URL = 'su-backend.json';
  var FLAGS_LS = 'su_backend_flags';
  var GET_MAX = 200;

  /* ── 入居者マスタの GAS（版58・master.gs）の読み取り関数の写し。コメントを除き一字一句同じ。
   *    rows（仮の行）を入れてから呼ぶ。シートの読み方（_sheet）だけを、仮の行を返すものに置き換える ── */
  var GAS = (function () {
    var ROWS = [];
    function _sheet() {
      var v = [HEADERS].concat(ROWS);
      return {
        getDataRange: function () { return { getValues: function () { return v.map(function (r) { return r.slice(); }); } }; },
        getLastRow: function () { return v.length; },
        getLastColumn: function () { return HEADERS.length; },
        getRange: function (r, c, nr, nc) {
          return { getValues: function () {
            var out = [];
            for (var i = r - 1; i < r - 1 + (nr || 1); i++) {
              var row = v[i] || [], o = [];
              for (var j = c - 1; j < c - 1 + (nc || 1); j++) o.push(row[j] === undefined ? '' : row[j]);
              out.push(o);
            }
            return out;
          } };
        }
      };
    }
    var HEADERS = ['id','name','kana','room','gender','careLevel','active','updatedAt','dataJson','targetApps'];
    function _truthy(v){ return v!==false && v!=='false' && v!=='退去' && v!==''; }
    var FAMILY_KEYS = ['name','relation','role','phone','address','emergency','kp'];
    var FAMILY_MAX  = 10;
    var ROSTER_EXTRA = ['birthDate','height','dischargeDate','doctor','visitDay','hospital'];
    var FACESHEET_SAFE = ['name','kana','room','gender','preferredName','allergy','infections','medicalCare',
      'formAdjust','careHints','mealForm','thickener','swallow','denture','mobility','problemBehavior',
      'medMgmt','medAssist','medRefusal','hospitalized',
      'adlGrid','moveAid','excreteWay','bathPlace','medLevel','medExists','bpsd','night',
      'allergenTags','forbiddenTags'];
    var BULK_FIELDS = [
      'name',
      'kana','room','gender','careLevel','birthDate','admissionDate','dischargeDate','dischargeTo',
      'height','adl','dementia',
      'careCertStart','careCertEnd','certDate','copayRate','welfare','insuredNo','insurer',
      'medicalInsurance','disabilityCert','guardianship','phone',
      'careOffice','careManager','careOfficeTel','careOfficeFax',
      'welfareEquip','welfareEquipStaff','welfareEquipTel','serviceManager',
      'prevCareOffice','prevCareManager',
      'hospital','doctor','hospitalTel','hospitalFax','emergencyHospital','emergencyHospitalTel',
      'visitDay','pharmacy','pharmacyTel','pharmacyFax','bloodType',
      'medsRegular','medsPrn','medsNotes','highRiskMeds','formAdjust','medRefusal'
    ];
    var LIST_FULL_KEYS = ['family','diseases','currentDiseases','pastHistory','medsRegular'];
    function _famNorm(v){
      if(!v) return [];
      if(Object.prototype.toString.call(v) !== '[object Array]') return [];
      var out = [];
      for(var i = 0; i < v.length && out.length < FAMILY_MAX; i++){
        var f = v[i];
        if(!f || typeof f !== 'object') continue;
        var o = {};
        for(var k = 0; k < FAMILY_KEYS.length; k++){
          var key = FAMILY_KEYS[k];
          if(key === 'emergency' || key === 'kp') o[key] = (f[key] === true || f[key] === 'true' || f[key] === 1 || f[key] === '1');
          else o[key] = String(f[key] == null ? '' : f[key]).trim();
        }
        if(o.name === '' && o.phone === '' && o.address === '') continue;
        out.push(o);
      }
      return out;
    }
    function getRosterSafe(){
      return getRoster(null,true).filter(function(r){ return r.active!==false; })
        .map(function(r){ return {id:r.id, name:r.name, kana:r.kana, room:r.room, gender:r.gender, careLevel:r.careLevel, active:true}; });
    }
    function getRoster(since, skipExtra){
      var sh=_sheet(), v=sh.getDataRange().getValues(), out=[], s=since?new Date(since).getTime():0;
      for(var i=1;i<v.length;i++){ var r=v[i]; if(r[0]==='') continue;
        if(s){ var u=r[7]?new Date(r[7]).getTime():0; if(u<s) continue; }
        var e={ id:r[0], name:r[1], kana:r[2], room:r[3], gender:r[4], careLevel:r[5],
                active:_truthy(r[6]), updatedAt:r[7], targetApps:String(r[9]||'') };
        if(!skipExtra){
          var d=null; try{ d=JSON.parse(r[8]||'{}'); }catch(err){ d=null; }
          if(d && Object.prototype.hasOwnProperty.call(d,'hospitalized')){
            e.hospitalized = (d.hospitalized === true || d.hospitalized === 'true');
          }
          for(var k=0;k<ROSTER_EXTRA.length;k++){
            var key=ROSTER_EXTRA[k];
            if(e[key]!==undefined) continue;
            var val=(d && d[key]!=null) ? d[key] : '';
            e[key]=(typeof val==='object') ? '' : String(val);
            if(e[key].indexOf('\n')>=0 || e[key].indexOf('\r')>=0)
              e[key]=e[key].replace(/[\r\n]+/g,' ');
          }
        }
        out.push(e);
      }
      return out;
    }
    function _findRow(sh,id){
      var ids=sh.getRange(1,1,Math.max(sh.getLastRow(),1),1).getValues();
      for(var i=1;i<ids.length;i++){ if(String(ids[i][0])===String(id)) return i+1; }
      return -1;
    }
    function getResident(id){
      var sh=_sheet(), row=_findRow(sh,id); if(row<0) return null;
      var v=sh.getRange(row,1,1,HEADERS.length).getValues()[0], data={};
      try{ data=JSON.parse(v[8]||'{}'); }catch(e){}
      data.id=v[0]; data.name=v[1]; data.kana=v[2]; data.room=v[3]; data.gender=v[4];
      data.careLevel=v[5]; data.active=_truthy(v[6]); data.updatedAt=v[7];
      if(v[9]) data.targetApps=String(v[9]).split(',').map(function(x){return x.trim();}).filter(String);
      return data;
    }
    function getSection(id, section){
      var rec=getResident(id); if(!rec) return null;
      var map={
        basic:['gender','birthDate','phone','careLevel','careCertStart','careCertEnd','certDate','copayRate','welfare','insuredNo','insurer','medicalInsurance','disabilityCert','guardianship','admissionDate','dischargeDate','deathDate','height','weight','adl','dementia'],
        careHistory:['careLevelHistory'],
        note:['preAdmission','postDischarge','dischargeTo'],
        family:['family'],
        consents:['consents'],
        office:['careOffice','careManager','careOfficeTel','careOfficeFax','welfareEquip','welfareEquipStaff','welfareEquipTel','serviceManager','prevCareOffice','prevCareManager','dayUse','rhythm'],
        medical:['hospital','doctor','hospitalTel','hospitalFax','emergencyHospital','emergencyHospitalTel','visitDay','pharmacy','pharmacyTel','pharmacyFax','allergy','infections','bloodType','medicalCare','vaccinations','disclosure','currentDiseases','sideEffects','pastHistory','medsRegular','medsNotes','problemBehavior'],
        meds:['medMgmt','medAssist','highRiskMeds','formAdjust','medRefusal','medsPrn','medsPastLog'],
        adl_detail:['swallow','water','excretion','bath','dress','mobility','transfer','bedriddenRank','pressureUlcer','vision','hearing'],
        cognitive:['dementiaType','cogScore','careHints','psychHistory'],
        comm:['preferredName','commMethod','commNotes'],
        meal:['mealStaple','mealSide','mealForm','thickener','denture','mealNote'],
        person:['personality','hobby','foodPref','lifePrefs','smoking','drinking'],
        history:['lifeHistory','values'],
        wishes:['complaint','wishSelf','wishFamily','goal','acp','dnar','strengths'],
        support:['supportLog'],
        medSupport:['medicalSupportLog'],
        meds_view:['medsRegular','medsNotes'],
        meds_hist:['medsHistory'],
        facesheet_safe:FACESHEET_SAFE
      };
      var keys=map[section]; if(!keys) return null;
      var out={id:rec.id,name:rec.name}; keys.forEach(function(k){ out[k]=rec[k]; }); return out;
    }
    function getBulk(){
      var sh = _sheet(), last = sh.getLastRow();
      if(last < 2) return [];
      var v = sh.getRange(1, 1, last, Math.max(sh.getLastColumn(), 10)).getValues(), out = [];
      var seenId = {};
      for(var i = 1; i < v.length; i++){
        if(v[i][0] === '' || v[i][0] == null) continue;
        var sid0 = String(v[i][0]);
        if(seenId[sid0]) continue;
        seenId[sid0] = 1;
        var d = {}, broken = false;
        var s = String(v[i][8] == null ? '' : v[i][8]).trim();
        if(s !== ''){
          if(s.charAt(0) !== '{') broken = true;
          else{ try{ var p = JSON.parse(s); if(p && typeof p === 'object') d = p; else broken = true; }catch(e){ broken = true; } }
        }
        var o = { id: v[i][0], name: String(v[i][1] || ''), active: _truthy(v[i][6]) };
        if(d.family != null && Object.prototype.toString.call(d.family) !== '[object Array]') o.familyBad = true;
        o.family = _famNorm(d.family);
        if(broken) o.broken = true;
        for(var k = 0; k < BULK_FIELDS.length; k++){
          var f = BULK_FIELDS[k], val = d[f];
          if(val == null) o[f] = '';
          else if(typeof val === 'object') o[f] = '';
          else if(typeof val === 'boolean') o[f] = val;
          else o[f] = String(val);
        }
        o.name = String(v[i][1] || '');
        o.kana = String(v[i][2] || ''); o.room = String(v[i][3] || '');
        o.gender = String(v[i][4] || ''); o.careLevel = String(v[i][5] || '');
        out.push(o);
      }
      return out;
    }
    function getListFull_(){
      var sh = _sheet(), last = sh.getLastRow();
      if(last < 2) return [];
      var v = sh.getRange(1, 1, last, Math.max(sh.getLastColumn(), 10)).getValues(), out = [], seen = {};
      for(var i = 1; i < v.length; i++){
        if(v[i][0] === '' || v[i][0] == null) continue;
        var sid = String(v[i][0]);
        if(seen[sid]) continue;
        seen[sid] = 1;
        if(!_truthy(v[i][6])) continue;
        var d = {};
        try{ d = JSON.parse(v[i][8] || '{}'); }catch(e){ d = {}; }
        if(!d || typeof d !== 'object' || Object.prototype.toString.call(d) === '[object Array]') continue;
        var o = { id: v[i][0] };
        for(var k = 0; k < LIST_FULL_KEYS.length; k++){
          var key = LIST_FULL_KEYS[k];
          if(Object.prototype.hasOwnProperty.call(d, key)) o[key] = d[key];
        }
        out.push(o);
      }
      return out;
    }
    function getMedsBulk_(ids){
      var want = {}, n = 0;
      var list = Object.prototype.toString.call(ids) === '[object Array]' ? ids : String(ids == null ? '' : ids).split(',');
      for(var j = 0; j < list.length && n < 100; j++){
        var k = String(list[j] == null ? '' : list[j]).trim();
        if(k && /^[0-9A-Za-z_-]{1,32}$/.test(k) && !want[k]){ want[k] = 1; n++; }
      }
      if(!n) return [];
      var sh = _sheet(), last = sh.getLastRow();
      if(last < 2) return [];
      var v = sh.getRange(1, 1, last, Math.max(sh.getLastColumn(), 10)).getValues(), out = [], seen = {};
      for(var i = 1; i < v.length; i++){
        var sid = String(v[i][0] == null ? '' : v[i][0]);
        if(!sid || !want[sid] || seen[sid]) continue;
        seen[sid] = 1;
        if(!_truthy(v[i][6])) continue;
        var d = {}, js = String(v[i][8] == null ? '' : v[i][8]).trim();
        if(js.charAt(0) === '{'){ try{ var pj = JSON.parse(js); if(pj && typeof pj === 'object') d = pj; }catch(e){} }
        out.push({ id: v[i][0], medsRegular: d.medsRegular == null ? '' : String(d.medsRegular),
                   medsHistory: Object.prototype.toString.call(d.medsHistory) === '[object Array]' ? d.medsHistory : [] });
      }
      return out;
    }
    var MEAL_FIELDS = ['mealStaple','mealSide','mealNote','allergy','sideEffects'];
    var MEAL_EXTRA = ['copayRate','birthDate'];
    function getMealList(){
      var sh = _sheet(), last = sh.getLastRow();
      if(last < 2) return [];
      var v = sh.getRange(1, 1, last, Math.max(sh.getLastColumn(), 10)).getValues(), out = [];
      var keys = MEAL_FIELDS.concat(MEAL_EXTRA);
      var seenId = {};
      for(var i = 1; i < v.length; i++){
        if(v[i][0] === '' || v[i][0] == null) continue;
        var sid = String(v[i][0]);
        if(seenId[sid]) continue;
        seenId[sid] = 1;
        if(!_truthy(v[i][6])) continue;
        var d = {}, broken = false;
        var s = String(v[i][8] == null ? '' : v[i][8]).trim();
        if(s !== ''){
          if(s.charAt(0) !== '{') broken = true;
          else{ try{ var p = JSON.parse(s); if(p && typeof p === 'object') d = p; else broken = true; }catch(e){ broken = true; } }
        }
        var o = { id: v[i][0], name: String(v[i][1] || ''), kana: String(v[i][2] || ''),
                  room: String(v[i][3] || ''), careLevel: String(v[i][5] || '') };
        if(broken) o.broken = true;
        for(var k = 0; k < keys.length; k++){
          var val = d[keys[k]];
          o[keys[k]] = (val == null || typeof val === 'object') ? '' : String(val);
        }
        out.push(o);
      }
      return out;
    }
    return { setRows: function (rows) { ROWS = rows; }, HEADERS: HEADERS,
             getRoster: getRoster, getRosterSafe: getRosterSafe, getResident: getResident, getSection: getSection,
             getBulk: getBulk, getListFull_: getListFull_, getMedsBulk_: getMedsBulk_, getMealList: getMealList };
  })();

  /* 写しの記録（getResident と同じ形）から、入居者マスタのシートの1行（HEADERS の順）を組み立てる */
  function toRow(rec) {
    rec = rec || {};
    var apps = Array.isArray(rec.targetApps) ? rec.targetApps.join(',') : String(rec.targetApps == null ? '' : rec.targetApps);
    return [rec.id == null ? '' : rec.id, rec.name == null ? '' : rec.name, rec.kana == null ? '' : rec.kana,
            rec.room == null ? '' : rec.room, rec.gender == null ? '' : rec.gender, rec.careLevel == null ? '' : rec.careLevel,
            rec.active === false ? false : true, rec.updatedAt == null ? '' : rec.updatedAt, JSON.stringify(rec), apps];
  }
  /* 仮の行に GAS の読み取り関数を当てて、Google と同じ応答（JSON にして戻した形）を作る */
  function answer(action, body, recs) {
    GAS.setRows((recs || []).map(toRow));
    var o;
    try {
      if (action === 'getRoster') o = { roster: GAS.getRoster(body.since) };
      else if (action === 'getResident') o = { record: GAS.getResident(body.id) };
      else if (action === 'getSection') o = { section: GAS.getSection(body.id, body.section) };
      else if (action === 'getBulk') o = { rows: GAS.getBulk() };
      else if (action === 'getListFull') o = { rows: GAS.getListFull_() };
      else if (action === 'getMedsBulk') o = { rows: GAS.getMedsBulk_(body.ids) };
      else if (action === 'getMealList') o = { rows: GAS.getMealList() };
      else throw new Error('unknown');
    } finally { GAS.setRows([]); }
    return JSON.parse(JSON.stringify(o));
  }
  var ACTIONS = ['getRoster', 'getResident', 'getSection', 'getBulk', 'getListFull', 'getMedsBulk', 'getMealList'];

  /* ── スイッチ（su-roster.js と同じ読み方）── */
  var ownFlags = null;
  function flags() {
    try { if (root.SUKv && typeof root.SUKv._flags === 'function') return root.SUKv._flags(); } catch (e) { /* 何もしない */ }
    if (ownFlags) return ownFlags;
    try { return JSON.parse(localStorage.getItem(FLAGS_LS) || 'null'); } catch (e) { return null; }
  }
  function switchOn() { var f = flags(); return !!(f && f.supabase && typeof f.supabase === 'object' && f.supabase[FLAG] === true); }
  function refreshFlags() {
    if (root.SUKv && typeof root.SUKv._flags === 'function') return Promise.resolve();
    return Promise.race([
      fetch(FLAGS_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { if (j && j.supabase && typeof j.supabase === 'object') ownFlags = { supabase: j.supabase }; }, function () {}),
      new Promise(function (ok) { setTimeout(ok, 3000); })
    ]);
  }

  /* ── ログインの部品を必要な時だけ読む ── */
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src; s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function loadAuth() {
    if (root.SUAuth) return Promise.resolve(root.SUAuth);
    var p = root.supabase ? Promise.resolve() : loadScript('supabase-js-2.112.4.js');
    return p.then(function () { return root.SUAuth ? null : loadScript('su-auth.js?v=2026-10-28'); }).then(function () { return root.SUAuth || null; });
  }

  function fail(text, code) { var e = new Error(text); e.code = code || 'res_read'; return e; }
  function dbErr(err) {
    var c = String(err && (err.code || err.message) || '');
    if (c === '42501') return fail('入居者の記録を読む権限がありません。ログインし直してください。', c);
    return fail('入居者の記録を読めませんでした（新しい保存先）。少し待ってから、もう一度開いてください。', c || 'db');
  }

  /* io（試験で差し替える）: { auth() → Promise<SUAuth> } */
  async function readSupabase(body, opts, io) {
    var A = await (io && io.auth ? io.auth() : loadAuth());
    if (!A) throw fail('ログインの部品を読み込めませんでした。ページを読み込み直してください。', 'noauth');
    var st = await A.check();
    if (!st || st.status !== A.STATUS.OK) throw fail('この端末はログインしていません。ログインしてから開いてください。', 'signed_out');
    var sb = A.client();
    var screen = String(opts && opts.screen || '');
    var action = body.action;
    var ids;
    if (action === 'getResident' || action === 'getSection') ids = [String(body.id == null ? '' : body.id)];
    else if (action === 'getMedsBulk') ids = String(body.ids == null ? '' : body.ids).split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 100);
    else {
      // 名簿・一覧は、正本の全員の利用者No をまず読む（res_roster は名簿の項目だけを返す・開いた記録は残さない）
      var rr = await sb.rpc('res_roster');
      if (rr.error) throw dbErr(rr.error);
      if (!rr.data || rr.data.ok !== true) throw dbErr({ code: rr.data && rr.data.error });
      if (action === 'getRoster') return answer(action, body, rr.data.rows || []);
      ids = (rr.data.rows || []).map(function (r) { return String(r.id); });
    }
    var recs = [];
    for (var i = 0; i < ids.length; i += GET_MAX) {
      var g = await sb.rpc('res_get', { p_ids: ids.slice(i, i + GET_MAX), p_screen: screen });
      if (g.error) throw dbErr(g.error);
      if (!g.data || g.data.ok !== true) throw dbErr({ code: g.data && g.data.error });
      recs = recs.concat(g.data.rows || []);
    }
    return answer(action, body, recs);
  }

  /* 画面の入口。gasFn(body) は今までどおり Google へ送る関数（この部品は本文を変えずに渡す） */
  function call(body, gasFn, opts, io) {
    try {
      if (!body || ACTIONS.indexOf(body.action) < 0 || !switchOn()) return gasFn(body);
    } catch (e) { return gasFn(body); }
    return mode(io).then(function (m) {
      if (m !== 'live') return gasFn(body);
      return readSupabase(body, opts, io);
    });
  }
  /* データベースの印（res_mode）。スイッチが入の時だけ読む（体重の切り替え 0032 と同じ決まり）。
   * ・印が写しの期間・関数がまだ無い（0035 の前）時は 'shadow'（Google から読む）
   * ・ログインしていない・使えないアカウント・通信の失敗は、Google へ流さずに失敗にする（スイッチが入の間は Google を正としない） */
  var modeCache = null, modeAt = 0;
  function mode(io) {
    if (modeCache && Date.now() - modeAt < 60000) return Promise.resolve(modeCache);
    return Promise.resolve().then(function () { return io && io.auth ? io.auth() : loadAuth(); }).then(function (A) {
      if (!A) throw fail('ログインの部品を読み込めませんでした。ページを読み込み直してください。', 'noauth');
      return A.check().then(function (st) {
        if (!st || st.status !== A.STATUS.OK) throw fail('この端末はログインしていません。ログインしてから開いてください。', 'signed_out');
        return A.client().rpc('res_mode_get').then(function (r) {
          var c = String(r && r.error && (r.error.code || '') || '');
          if (r && r.error && /PGRST202|42883/.test(c)) return 'shadow';
          if (!r || r.error || !r.data) throw dbErr(r && r.error);
          var m = r.data.mode === 'live' ? 'live' : 'shadow';
          modeCache = m; modeAt = Date.now();
          return m;
        });
      });
    });
  }

  root.SUResRead = { call: call, refreshFlags: refreshFlags, _answer: answer, _toRow: toRow, _gas: GAS, _reset: function () { modeCache = null; modeAt = 0; ownFlags = null; } };
})(typeof window !== 'undefined' ? window : this);

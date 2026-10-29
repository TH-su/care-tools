// res-read-gas-sync.mjs — su-res-read.js に写した入居者マスタの GAS の読み取り関数が、GAS の正本（care-backend の master.gs）と
// コメントを除いて一字一句同じかを確かめる（CLAUDE.md §3「画面の中に写して入れている GAS のコードは、非公開の正本と一字一句同じにする」）。
// 使い方: node check/res-read-gas-sync.mjs <care-backend>/gas/bound/resident-master-api/master.gs
//   同じなら「一致」と exit 0。違えば違う定義の名前だけを出して exit 1（中身は出さない）。正本は公開しないので、この道具は手元で回す。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const NAMES = ['HEADERS', '_truthy', 'FAMILY_KEYS', 'FAMILY_MAX', 'ROSTER_EXTRA', 'FACESHEET_SAFE', 'BULK_FIELDS', 'LIST_FULL_KEYS',
  '_famNorm', 'getRosterSafe', 'getRoster', '_findRow', 'getResident', 'getSection', 'getBulk', 'getListFull_', 'getMedsBulk_',
  'MEAL_FIELDS', 'MEAL_EXTRA', 'getMealList'];
export function strip(src){
  let out='',i=0,n=src.length,last='';
  const reBefore=/[(,=:[!&|?{};+\-*%<>~^]$/;
  while(i<n){
    const c=src[i],d=src[i+1];
    if(c==='/'&&d==='/'){ while(i<n&&src[i]!=='\n')i++; continue; }
    if(c==='/'&&d==='*'){ i+=2; while(i<n&&!(src[i]==='*'&&src[i+1]==='/'))i++; i+=2; continue; }
    if(c==='"'||c==="'"||c==='`'){ let j=i+1; while(j<n&&src[j]!==c){ if(src[j]==='\\')j++; j++; } out+=src.slice(i,j+1); i=j+1; last=c; continue; }
    if(c==='/'){ const t=out.replace(/\s+$/,''); if(!t||reBefore.test(t)||/\breturn$/.test(t)){ let j=i+1,cls=false; while(j<n){ if(src[j]==='\\'){j+=2;continue;} if(src[j]==='[')cls=true; else if(src[j]===']')cls=false; else if(src[j]==='/'&&!cls)break; j++; } j++; while(/[a-z]/.test(src[j]))j++; out+=src.slice(i,j); i=j; continue; } }
    out+=c; i++;
  }
  return out.split('\n').map(l=>l.replace(/\s+$/,'')).filter(l=>l.trim()!=='').join('\n');
}
export function pick(src,name){
  const re=new RegExp('^(function '+name+'\\(|var '+name+' *=)','m');
  const m=re.exec(src); if(!m) throw new Error('not found '+name);
  let i=m.index;
  if(m[1].startsWith('var')){ let depth=0,j=i; for(;j<src.length;j++){ const ch=src[j]; if(ch==='['||ch==='{'||ch==='(')depth++; else if(ch===']'||ch==='}'||ch===')')depth--; else if(ch===';'&&depth===0)break; } return src.slice(i,j+1); }
  let j=src.indexOf('{',i),depth=0; for(;j<src.length;j++){ const ch=src[j]; if(ch==='"'||ch==="'"){ j++; while(src[j]!==ch){ if(src[j]==='\\')j++; j++; } continue; } if(ch==='{')depth++; else if(ch==='}'){depth--; if(depth===0)break;} } return src.slice(i,j+1);
}
const gasPath = process.argv[2];
if (!gasPath || !fs.existsSync(gasPath)) { console.error('master.gs の場所を渡してください'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const mine = strip(fs.readFileSync(path.join(here, '..', 'su-res-read.js'), 'utf8')).split('\n').map(l => l.trim()).join('\n');
const gas = strip(fs.readFileSync(gasPath, 'utf8'));
const bad = NAMES.filter(n => { const g = pick(gas, n).split('\n').map(l => l.trim()).join('\n'); return mine.indexOf(g) < 0; });
if (bad.length) { console.log('違う: ' + bad.join('・')); process.exit(1); }
console.log('一致（' + NAMES.length + ' の定義）');

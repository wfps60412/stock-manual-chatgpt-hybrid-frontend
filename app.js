const APP_VERSION = '0.2.0-alpha-r18-r3-json-repair-token-expiry';
const DB_NAME = 'stock_manual_chatgpt_hybrid_v0_2';
const STORE = 'records';
const SETTINGS = 'settings';
let db;

function $(id){return document.getElementById(id)}
function log(el, obj){$(el).textContent = typeof obj === 'string' ? obj : JSON.stringify(obj,null,2)}
function nowIso(){return new Date().toISOString()}
function taipeiDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function uuid(){
  const c = window.crypto || window.msCrypto;
  if(c && c.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,ch=>{
    const r = (c && c.getRandomValues) ? (c.getRandomValues(new Uint8Array(1))[0] & 15) : (Math.random()*16|0);
    const v = ch==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function sanitizeStock(v){return String(v||'').trim().toUpperCase().replace(/[^0-9A-Z]/g,'')}
function fallbackHash(text){
  // Non-cryptographic fallback for Safari/non-secure HTTP contexts where crypto.subtle is unavailable.
  // Server recalculates canonical SHA256 and is the source of truth; this client hash is only an idempotency hint.
  let h1=0x811c9dc5, h2=0x01000193;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    h1^=c; h1=Math.imul(h1,0x01000193)>>>0;
    h2=(Math.imul(h2^c,0x85ebca6b)+0xc2b2ae35)>>>0;
  }
  return 'fallback_'+h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0');
}
async function sha256(text){
  try{
    const c = window.crypto || window.msCrypto;
    if(c && c.subtle && typeof c.subtle.digest === 'function'){
      const buf=await c.subtle.digest('SHA-256',new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    }
  }catch(e){}
  return fallbackHash(text);
}
async function writeClipboard(text){
  if(!text){throw new Error('沒有可複製的內容')}
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return {ok:true, method:'clipboard-api'};
    }
  }catch(e){}
  const ta=document.createElement('textarea');
  ta.value=text;
  ta.setAttribute('readonly','');
  ta.style.position='fixed';
  ta.style.opacity='0';
  ta.style.left='-9999px';
  document.body.appendChild(ta);
  ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
  let ok=false;
  try{ok=document.execCommand('copy')}catch(e){ok=false}
  document.body.removeChild(ta);
  if(!ok) throw new Error('瀏覽器不允許自動複製，請手動選取 Prompt 後複製');
  return {ok:true, method:'execCommand'};
}
async function readClipboardText(){
  // iOS Safari only allows clipboard read in secure contexts and direct user gestures.
  // HTTP LAN usually blocks readText even when copy succeeded. Keep this best-effort.
  try{
    if(navigator.clipboard && typeof navigator.clipboard.readText === 'function'){
      return await navigator.clipboard.readText();
    }
  }catch(e){
    throw new Error('Safari/iOS 在 HTTP 區網常會阻擋讀取剪貼簿。請長按下方回答框貼上，再按「解析並存為 local pending」。原始錯誤：'+e.message);
  }
  throw new Error('此瀏覽器不支援自動讀取剪貼簿。請長按下方回答框貼上，再按「解析並存為 local pending」。');
}
function focusResponseBox(){
  const el=$('responseBox');
  if(el){el.focus(); el.scrollIntoView({behavior:'smooth',block:'center'});}
}


function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains(STORE)){const s=d.createObjectStore(STORE,{keyPath:'local_id'});s.createIndex('pending_id','pending_id',{unique:false});s.createIndex('status','status',{unique:false});s.createIndex('stock_id','stock_id',{unique:false});} if(!d.objectStoreNames.contains(SETTINGS)){d.createObjectStore(SETTINGS,{keyPath:'key'});}};req.onsuccess=e=>{db=e.target.result;resolve(db)};req.onerror=()=>reject(req.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function getSetting(key){return new Promise(res=>{const r=tx(SETTINGS).get(key);r.onsuccess=()=>res(r.result&&r.result.value);r.onerror=()=>res(null)})}
function setSetting(key,value){return new Promise((res,rej)=>{const r=tx(SETTINGS,'readwrite').put({key,value});r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function getAllRecords(){return new Promise((res,rej)=>{const r=tx(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function putRecord(rec){return new Promise((res,rej)=>{const r=tx(STORE,'readwrite').put(rec);r.onsuccess=()=>res(rec);r.onerror=()=>rej(r.error)})}
function delRecord(local_id){return new Promise((res,rej)=>{const r=tx(STORE,'readwrite').delete(local_id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

async function ensureDeviceId(){let id=await getSetting('device_id'); if(!id){id='device_'+uuid().replaceAll('-',''); await setSetting('device_id',id)} return id}

function schemaExample(stockId){const date=taipeiDate();return `{
  "schema_version": 1,
  "stock_id": "${stockId}",
  "stock_name": "股票名稱",
  "analysis_date": "${date}",
  "analysis_ai": "ChatGPT",
  "current_price_date": "YYYY-MM-DD 或 null",
  "current_price": null,
  "data_freshness": {
    "price_date": null,
    "financial_date": null,
    "institutional_date": null,
    "source_note": "請說明資料新鮮度"
  },
  "fundamental": {"score": 1.0, "summary": "基本面說明"},
  "technical": {"score": 1.0, "summary": "技術面說明"},
  "chip": {"score": 1.0, "summary": "籌碼面說明"},
  "entry_price": {
    "conservative": {"price_low": null, "price_high": null, "display": "資料不足", "explanation": "說明"},
    "reasonable": {"price_low": null, "price_high": null, "display": "資料不足", "explanation": "說明"},
    "aggressive": {"price_low": null, "price_high": null, "display": "資料不足", "explanation": "說明"}
  },
  "take_profit_price": {
    "first_target": {"price_low": null, "price_high": null, "display": "資料不足", "explanation": "說明"},
    "second_target": {"price_low": null, "price_high": null, "display": "資料不足", "explanation": "說明"}
  },
  "risk_notes": ["主要風險"],
  "overall_summary": "整體結論",
  "not_investment_advice": true
}`}
function makePrompt(stockId){return `請問「${stockId}」（股票代號或標的名稱）目前的技術面、籌碼面、基本面綜合分析，你認為合理的進場價以及獲利了結價格在什麼位置？

請只輸出一個有效 JSON 物件，不要使用 Markdown code fence，不要加入任何 JSON 以外的自然語言、說明、前言或結語。
請務必依照以下 JSON 格式回答，不要省略欄位。若資料不足，請填 null 或「資料不足」，不要自行編造。
請明確說明資料可能不是即時資料，並標示你能判斷的資料日期或資料新鮮度。
評分需為 1.0 到 10.0 的數字。價格欄位 price_low / price_high 請填數字或 null。
重要：完整報告必須包含製作報告時最新現價日期 current_price_date 與最新現價 current_price；若無法取得，兩欄請填 null，並在 data_freshness.source_note 說明。

JSON 格式如下：
${schemaExample(stockId)}`}

function balanceJsonBraces(s){
  let stack=[], inStr=false, esc=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(inStr){ if(esc) esc=false; else if(ch==='\\') esc=true; else if(ch==='"') inStr=false; }
    else { if(ch==='"') inStr=true; else if(ch==='{') stack.push('{'); else if(ch==='}'&&stack.length) stack.pop(); }
  }
  return s + '}'.repeat(stack.length);
}
function stripTrailingCommas(s){ return s.replace(/,\s*([}\]])/g,'$1'); }
function repairCommonJsonMistakes(s){
  const variants = [];
  const add = (x)=>{ if(x && !variants.includes(x)) variants.push(x); };
  add(s);
  // Common ChatGPT paste error: one missing brace before top-level take_profit_price,
  // causing take_profit_price to be nested inside entry_price after aggressive.
  add(s.replace(/("aggressive"\s*:\s*\{[\s\S]*?\}\s*),\s*("take_profit_price"\s*:)/, '$1},$2'));
  // Same class of error before risk_notes, if take_profit_price was closed but missing one parent brace.
  add(s.replace(/("second_target"\s*:\s*\{[\s\S]*?\}\s*),\s*("risk_notes"\s*:)/, '$1},$2'));
  // Remove trailing commas and balance final braces for each candidate.
  const more = [];
  for(const v of variants){
    more.push(stripTrailingCommas(v));
    more.push(balanceJsonBraces(stripTrailingCommas(v)));
  }
  for(const v of more) add(v);
  return variants;
}
function parseMaybeRepairJson(s){
  let lastError=null;
  for(const candidate of repairCommonJsonMistakes(s)){
    try{
      const obj=JSON.parse(candidate);
      if(obj && typeof obj==='object' && !Array.isArray(obj)){
        const repaired = candidate !== s;
        return {obj, repaired};
      }
    }catch(e){ lastError=e; }
  }
  throw lastError || new Error('JSON_PARSE_FAILED');
}
function extractFinalJson(text){
  const candidates=[];
  const fence=/```(?:json)?\s*({[\s\S]*?})\s*```/gi;
  let m;
  while((m=fence.exec(text))) candidates.push(m[1]);
  let stack=[],start=null,inStr=false,esc=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inStr){ if(esc) esc=false; else if(ch==='\\') esc=true; else if(ch==='"') inStr=false; }
    else {
      if(ch==='"') inStr=true;
      else if(ch==='{'){ if(!stack.length) start=i; stack.push(ch); }
      else if(ch==='}'&&stack.length){
        stack.pop();
        if(!stack.length&&start!==null){ candidates.push(text.slice(start,i+1)); start=null; }
      }
    }
  }
  if(start!==null && stack.length) candidates.push(balanceJsonBraces(text.slice(start)));
  for(let i=candidates.length-1;i>=0;i--){
    try{
      const parsed=parseMaybeRepairJson(candidates[i]);
      if(parsed.repaired){
        window.__lastJsonRepairNote = '已自動修正常見 JSON 小錯誤：可能補上缺少的 } 或移除尾端逗號。請仍檢查完整報告內容是否正確。';
      }else{
        window.__lastJsonRepairNote = '';
      }
      return parsed.obj;
    }catch(e){}
  }
  throw new Error('找不到有效 JSON 物件；可能是缺少 }、多餘逗號，或 take_profit_price 被誤放進 entry_price。可重貼一次，或讓系統嘗試自動修正常見小錯誤。')
}
function validateAnalysis(o){const req=['schema_version','stock_id','stock_name','analysis_date','analysis_ai','current_price_date','current_price','data_freshness','fundamental','technical','chip','entry_price','take_profit_price','risk_notes','overall_summary','not_investment_advice']; for(const k of req) if(!(k in o)) throw new Error('缺少欄位 '+k); if(o.schema_version!==1) throw new Error('schema_version 必須為 1'); if(!/^\d{4}-\d{2}-\d{2}$/.test(o.analysis_date)) throw new Error('analysis_date 必須 YYYY-MM-DD'); if(o.current_price_date!==null && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.current_price_date))) throw new Error('current_price_date 必須 YYYY-MM-DD 或 null'); if(o.current_price!==null && typeof o.current_price!=='number') throw new Error('current_price 必須是數字或 null'); for(const sec of ['fundamental','technical','chip']){const s=o[sec].score; if(typeof s!=='number'||s<1||s>10) throw new Error(sec+'.score 必須 1.0-10.0'); if(!o[sec].summary) throw new Error(sec+'.summary 必填')} const check=(node,path)=>{if(!node||typeof node!=='object') throw new Error(path+' 必須是 object'); const l=node.price_low,h=node.price_high; if(l!==null&&typeof l!=='number') throw new Error(path+'.price_low 必須數字或 null'); if(h!==null&&typeof h!=='number') throw new Error(path+'.price_high 必須數字或 null'); if(typeof l==='number'&&typeof h==='number'&&l>h) throw new Error(path+' price_low 不可大於 price_high')}; ['conservative','reasonable','aggressive'].forEach(k=>check(o.entry_price[k],'entry_price.'+k)); ['first_target','second_target'].forEach(k=>check(o.take_profit_price[k],'take_profit_price.'+k)); if(o.not_investment_advice!==true) throw new Error('not_investment_advice 必須 true'); return o}
function auditAnalysis(obj){
  const errors=[];
  try{validateAnalysis(obj)}catch(e){errors.push(e.message)}
  if(!obj.not_investment_advice) errors.push('not_investment_advice 必須為 true');
  for(const sec of ['fundamental','technical','chip']){
    const summary=obj?.[sec]?.summary||'';
    if(String(summary).trim().length<6) errors.push(sec+'.summary 過短');
  }
  const ok=errors.length===0;
  return {ok, audit_status: ok?'passed':'failed', errors, checked_at: nowIso(), message: ok?'格式檢核通過，將自動送出 pending。':'格式檢核失敗，不會送出 pending。'};
}
function canonicalCore(o){const keys=['schema_version','stock_id','stock_name','analysis_date','analysis_ai','current_price_date','current_price','data_freshness','fundamental','technical','chip','entry_price','take_profit_price','risk_notes','overall_summary','not_investment_advice']; const sortObj=v=>{if(Array.isArray(v))return v.map(sortObj); if(v&&typeof v==='object'){return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sortObj(typeof v[k]==='string'?v[k].trim():v[k])]))} return typeof v==='string'?v.trim():v}; return JSON.stringify(sortObj(Object.fromEntries(keys.map(k=>[k,o[k]]))))}

async function generate(){
  const stock=sanitizeStock($('stockId').value);
  if(!stock){alert('請輸入股票代號');return}
  $('promptBox').value=makePrompt(stock);
  log('parseResult','Prompt 已產生。請按「複製 Prompt 並嘗試開啟 ChatGPT App」或「複製 Prompt 並開啟網頁版」。');
}
async function copyPrompt(){
  try{
    if(!$('promptBox').value.trim()) await generate();
    const r=await writeClipboard($('promptBox').value);
    log('parseResult',{ok:true,message:'Prompt 已複製',method:r.method});
    return true;
  }catch(e){
    log('parseResult',{ok:false,error:e.message});
    return false;
  }
}
function openUrl(url){
  const w=window.open(url,'_blank','noopener');
  return !!w;
}
async function copyAndOpenChatGPTApp(){
  const ok=await copyPrompt();
  // iOS normally routes universal links to the installed ChatGPT app when the system association is enabled.
  // If it stays in Safari, use the web fallback button. Prompt is already copied either way.
  const opened=openUrl('https://chatgpt.com/');
  log('parseResult',{ok, opened, message: opened ? 'Prompt 已複製，已嘗試開啟 ChatGPT App/Universal Link。若仍在 Safari，請手動貼上送出；取得回答後複製回本 App。' : 'Prompt 已處理；瀏覽器阻擋開啟 ChatGPT，請手動開啟 ChatGPT App 或網頁。'});
}
async function copyAndOpenChatGPTWeb(){
  const ok=await copyPrompt();
  const opened=openUrl('https://chatgpt.com/');
  log('parseResult',{ok, opened, message: opened ? 'Prompt 已複製，已開啟 ChatGPT 網頁版。請手動貼上送出；取得回答後複製回本 App。' : 'Prompt 已處理；瀏覽器阻擋自動開啟網頁版，請手動開啟 https://chatgpt.com/'});
}
async function pasteClipboardToResponse(){
  try{
    const txt=await readClipboardText();
    $('responseBox').value=txt;
    log('parseResult',{ok:true,message:'已從剪貼簿讀取回答，請按「解析並存為 local pending」'});
  }catch(e){
    focusResponseBox();
    log('parseResult',{ok:false,error:e.message, manual_fallback:'已聚焦回答框。請長按回答框貼上，再按「解析並存為 local pending」。'});
  }
}
async function pasteAndParse(){
  try{
    const txt=await readClipboardText();
    $('responseBox').value=txt;
  }catch(e){
    focusResponseBox();
    log('parseResult',{ok:false,error:e.message, manual_fallback:'無法自動讀取剪貼簿。請手動貼上後按「解析並存為 local pending」。'});
    return;
  }
  await parseSave();
}

async function parseSave(){
  try{
    const raw=$('responseBox').value;
    const obj=validateAnalysis(extractFinalJson(raw));
    const audit=auditAnalysis(obj);
    if(!audit.ok){log('parseResult',{ok:false,audit}); return;}
    const device=await ensureDeviceId();
    const stock=sanitizeStock(obj.stock_id);
    const utc=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const pid=`${device}_${utc}_${stock}_${uuid().slice(0,8)}`;
    const ph=await sha256(canonicalCore(obj));
    const rec={local_id:uuid(),pending_id:pid,device_id:device,created_at:nowIso(),stock_id:stock,analysis_date:obj.analysis_date,status:'pending_local',client_payload_hash:ph,prompt_text:$('promptBox').value,raw_response_text:raw,parsed_json:obj,audit,updated_at:nowIso()};
    await putRecord(rec);
    let submit_result=null;
    try{submit_result=await submitRecord(rec);}catch(e){rec.status='sync_error'; rec.server_response={ok:false,error:e.message,stage:'auto_submit'}; rec.updated_at=nowIso(); await putRecord(rec); submit_result=rec.server_response;}
    log('parseResult',{ok:true,audit,status:rec.status,pending_id:pid,stock_id:stock,analysis_date:obj.analysis_date,client_payload_hash:ph,auto_submit:submit_result,note:'格式檢核通過後已自動嘗試送出 pending；不需要再按獨立送出。'});
    await renderLocal();
    await loadClientReports(false);
  }catch(e){log('parseResult',{ok:false,error:e.message})}
}

async function api(path,method='GET',body=null){const host=$('hostUrl').value.trim().replace(/\/$/,''); if(!host) throw new Error('請輸入 Mac Host URL'); await setSetting('last_host_url',host); const headers={'Content-Type':'application/json'}; const res=await fetch(host+path,{method,headers,body:body?JSON.stringify(body):undefined}); const txt=await res.text(); let obj; try{obj=JSON.parse(txt)}catch{obj={raw:txt}} if(!res.ok) throw new Error(obj.message||res.statusText); return obj}
async function health(){try{const obj=await api('/api/health'); $('netBadge').textContent='Mac 已連線'; $('netBadge').className='badge ok'; log('syncResult',{...obj, note:'r11 手機送出 pending 不需要 token；Approve / Commit 請到 Mac Admin 輸入 token。'})}catch(e){$('netBadge').textContent='Mac 未連線'; $('netBadge').className='badge warn'; log('syncResult',{ok:false,error:e.message, hint:'請確認 Mac Host URL 與同一個 Wi‑Fi。'})}}
async function submitRecord(r){
  const resp=await api('/api/pending/submit','POST',{
    device_id:r.device_id,
    pending_id:r.pending_id,
    created_at:r.created_at,
    stock_id:r.stock_id,
    client_payload_hash:r.client_payload_hash,
    prompt_text:r.prompt_text,
    raw_response_text:r.raw_response_text,
    parsed_json:r.parsed_json
  });
  if(resp.ok===true){
    r.status=resp.server_status||'pending_submitted';
  }else if(resp.server_status){
    r.status=resp.server_status;
  }else{
    r.status='sync_error';
  }
  r.server_payload_hash=resp.server_payload_hash||r.server_payload_hash;
  r.submitted_at=resp.submitted_at||r.submitted_at||(r.status==='pending_submitted'?nowIso():r.submitted_at);
  r.matched_pending_id=resp.matched_pending_id||r.matched_pending_id;
  r.matched_status=resp.matched_status||r.matched_status;
  r.server_response=resp;
  r.updated_at=nowIso();
  await putRecord(r);
  return {pending_id:r.pending_id, stock_id:r.stock_id, status:r.status, response:resp};
}
async function submitOne(local_id){
  try{
    const all=await getAllRecords();
    const r=all.find(x=>x.local_id===local_id);
    if(!r) throw new Error('找不到 local record');
    const out=await submitRecord(r);
    log('syncResult',{ok:true,submitted:1,results:[out], next:'請到 Mac Admin 按「載入 Mac Pending」。若 Mac 仍顯示 0，請匯出診斷報告。'});
    await renderLocal();
  }catch(e){log('syncResult',{ok:false,error:e.message})}
}
async function submitAll(){try{
  const all=await getAllRecords();
  const pending=all.filter(r=>r.status==='pending_local'||r.status==='sync_error');
  const out=[];
  if(!pending.length){log('syncResult',{ok:true,submitted:0,message:'沒有 pending_local / sync_error 可送出'}); return;}
  for(const r of pending){
    try{out.push(await submitRecord(r));}
    catch(e){r.status='sync_error'; r.updated_at=nowIso(); r.server_response={ok:false,error:e.message}; await putRecord(r); out.push({pending_id:r.pending_id,status:'sync_error',error:e.message})}
  }
  const submitted=out.filter(x=>x.status==='pending_submitted').length;
  const blocked=out.filter(x=>x.status!=='pending_submitted').length;
  log('syncResult',{ok:true,submitted,blocked,total:out.length,results:out,next:'若 submitted > 0，Mac Admin 應可載入 pending 並顯示 Approve / Reject。'});
  await renderLocal();
}catch(e){log('syncResult',{ok:false,error:e.message})}}
async function pullStatus(){try{
  const device=await ensureDeviceId();
  const resp=await api('/api/sync/status?device_id='+encodeURIComponent(device));
  const all=await getAllRecords();
  const byPid=Object.fromEntries(all.map(r=>[r.pending_id,r]));
  const deleted=[];
  for(const sr of resp.records||[]){
    const r=byPid[sr.pending_id]; if(!r) continue;
    if(['rejected','duplicate_blocked'].includes(sr.server_status)){
      await delRecord(r.local_id); deleted.push({pending_id:r.pending_id,status:sr.server_status,reason:'server_closed'}); continue;
    }
    if(['committed','revision_required','approved','pending_submitted'].includes(sr.server_status)){
      r.status=sr.server_status; r.server_payload_hash=sr.server_payload_hash; r.review_note=sr.review_note; r.rejected_reason=sr.rejected_reason; r.submitted_at=sr.submitted_at||r.submitted_at; r.committed_at=sr.committed_at; r.updated_at=nowIso(); await putRecord(r)
    }
  }
  log('syncResult',{...resp,local_deleted:deleted});
  await renderLocal();
}catch(e){log('syncResult',{ok:false,error:e.message})}}

function esc(v){return String(v ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function priceCard(title, obj){obj=obj||{}; return `<div class="price-card"><b>${esc(title)}</b><br><span class="score-number">${esc(obj.display || [obj.price_low,obj.price_high].filter(x=>x!==undefined&&x!==null).join('-') || '—')}</span><br><span class="small">${esc(obj.explanation||'')}</span></div>`}
function sectionCard(title, section){section=section||{}; return `<div class="report-section"><h3>${esc(title)}</h3><div class="score-card"><span class="score-number">${esc(section.score ?? '—')}</span> / 10</div><p>${esc(section.summary||'')}</p></div>`}
function readableReportHtml(r, options={}){
  const p=r.parsed_json||{}; const entry=p.entry_price||{}; const take=p.take_profit_price||{}; const risks=Array.isArray(p.risk_notes)?p.risk_notes:[];
  return `<div class="report-readable client-report-readable">
    <div class="report-header-card"><h2>${esc(r.stock_id||p.stock_id)} ${esc(r.stock_name||p.stock_name||'')}</h2>
    <p class="small">狀態：${esc(r.status||options.status||'')}｜日期：${esc(r.analysis_date||p.analysis_date||'')}｜pending_id：<code>${esc(r.pending_id||'')}</code></p>
    <div class="price-highlight"><b>現價資訊</b>：${esc(r.current_price_date ?? p.current_price_date ?? '資料不足')}｜${esc(r.current_price ?? p.current_price ?? '資料不足')}</div>
    <div class="price-highlight"><b>現價資訊</b>：${esc(r.current_price_date ?? p.current_price_date ?? '資料不足')}｜${esc(r.current_price ?? p.current_price ?? '資料不足')}</div>
    <p>${esc(p.overall_summary||'')}</p><div class="score-grid"><div class="score-card"><b>基本面</b><br><span class="score-number">${esc(r.fundamental_score ?? p.fundamental?.score ?? '—')}</span>/10</div><div class="score-card"><b>技術面</b><br><span class="score-number">${esc(r.technical_score ?? p.technical?.score ?? '—')}</span>/10</div><div class="score-card"><b>籌碼面</b><br><span class="score-number">${esc(r.chip_score ?? p.chip?.score ?? '—')}</span>/10</div></div></div>
    ${sectionCard('基本面說明',p.fundamental)}${sectionCard('技術面說明',p.technical)}${sectionCard('籌碼面說明',p.chip)}
    <div class="report-section"><h3>合理進場價</h3><div class="price-grid">${priceCard('保守',entry.conservative)}${priceCard('合理',entry.reasonable)}${priceCard('積極',entry.aggressive)}</div></div>
    <div class="report-section"><h3>獲利了結價格</h3><div class="price-grid">${priceCard('第一目標',take.first_target)}${priceCard('第二目標',take.second_target)}</div></div>
    <div class="report-section"><h3>主要風險</h3>${risks.length?`<ul>${risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="small">未提供</p>'}</div>
  </div>`;
}
function isOlderThanDays(iso, days){if(!iso) return false; const t=Date.parse(iso); if(Number.isNaN(t)) return false; return Date.now()-t > days*24*60*60*1000;}
async function cleanupLocalAgainstMacDB(auto=false){
  try{
    const device=await ensureDeviceId();
    const resp=await api('/api/local/retention_state?device_id='+encodeURIComponent(device));
    const state=resp.state||{};
    const committedIds=new Set((state.committed||[]).map(x=>x.pending_id));
    const committedHashes=new Set((state.committed||[]).map(x=>x.payload_hash));
    const activeIds=new Set((state.active_pending||[]).map(x=>x.pending_id));
    const activeHashes=new Set((state.active_pending||[]).map(x=>x.payload_hash));
    const all=await getAllRecords();
    const deleted=[];
    const kept=[];
    const closedIds=new Set((state.closed_pending||[]).map(x=>x.pending_id));
    for(const r of all){
      const st=r.status||'pending_local';
      const pid=r.pending_id;
      const ch=r.client_payload_hash||r.server_payload_hash;
      if(st==='pending_local' || st==='sync_error'){kept.push({pending_id:pid,status:st,reason:'local_draft'}); continue;}
      if(closedIds.has(pid) || st==='rejected' || st==='duplicate_blocked'){
        await delRecord(r.local_id); deleted.push({pending_id:pid,stock_id:r.stock_id,status:st,reason:'rejected_or_closed_by_server'}); continue;
      }
      if(st==='pending_submitted' && isOlderThanDays(r.submitted_at||r.updated_at,5)){
        await delRecord(r.local_id); deleted.push({pending_id:pid,stock_id:r.stock_id,status:st,reason:'pending_submitted_not_approved_over_5_days'}); continue;
      }
      if(committedIds.has(pid) || committedHashes.has(ch)){
        await delRecord(r.local_id); deleted.push({pending_id:pid,stock_id:r.stock_id,status:st,reason:'already_committed_in_mac_db_local_copy_removed'}); continue;
      }
      if(activeIds.has(pid) || activeHashes.has(ch)){kept.push({pending_id:pid,status:st,reason:'exists_in_active_pending'}); continue;}
      await delRecord(r.local_id);
      deleted.push({pending_id:pid,stock_id:r.stock_id,status:st,reason:'not_found_in_current_mac_db'});
    }
    const out={ok:true,auto,mac_counts:state.counts||{},local_total_before:all.length,deleted_count:deleted.length,kept_count:kept.length,deleted, note:'已依目前 Mac SQLite 清理 local。pending_local/sync_error 會保留；若報告已 commit 到 Mac DB，local copy 會刪除，只保留 Mac DB 正式報告；已送出但 Mac DB 不存在或逾期者會刪除。'};
    log('syncResult',out);
    await renderLocal();
    return out;
  }catch(e){
    if(!auto) log('syncResult',{ok:false,error:e.message});
    return {ok:false,error:e.message};
  }
}

async function pullStatusAndCleanup(){
  await pullStatus();
  await cleanupLocalAgainstMacDB(true);
}
function analysisAiLabel(r){
  return r?.parsed_json?.analysis_ai || r?.parsed_json?.analysis_model || r?.analysis_ai || 'ChatGPT 手動';
}
function reportRowHtml(r, sourceLabel='local'){
  const p=r.parsed_json||{};
  const name=(r.stock_id||p.stock_id||'')+' '+(p.stock_name||r.stock_name||'');
  const date=r.analysis_date||p.analysis_date||'';
  const status=r.status||'';
  const cpDate = r.current_price_date ?? p.current_price_date ?? '資料不足';
  const cp = r.current_price ?? p.current_price ?? '資料不足';
  return `<div class="report-row-main"><div class="report-col report-name"><b>${esc(name)}</b>${status?`<span class="status status-inline ${esc(status)}">${esc(status)}</span>`:''}</div><div class="report-col"><span class="label-inline">日期</span>${esc(date)}<br><span class="small">現價 ${esc(cpDate)}：${esc(cp)}</span></div><div class="report-col"><span class="label-inline">解析AI</span>${esc(analysisAiLabel(r))}</div><div class="report-col report-source"><span class="label-inline">來源</span>${esc(sourceLabel)}</div></div>`;
}
async function renderLocal(){
  const all=await getAllRecords(); const q=($('searchBox').value||'').trim().toLowerCase(); $('localList').innerHTML='';
  const filtered=all.filter(r=>!q||String(r.stock_id).toLowerCase().includes(q)||String(r.status).toLowerCase().includes(q)||String(r.parsed_json?.stock_name||'').toLowerCase().includes(q));
  if(!filtered.length){$('localList').innerHTML='<div class="item small">目前沒有本機紀錄。</div>'; return;}
  for(const r of filtered){
    const div=document.createElement('div'); div.className='item compact-report-card report-row-card';
    div.innerHTML=reportRowHtml(r,'local');
    const row=document.createElement('div'); row.className='row report-actions';
    const show=document.createElement('button'); show.textContent='顯示完整報告'; show.onclick=()=>{
      const existing=div.querySelector('.embedded-report');
      if(existing){existing.remove(); return;}
      const box=document.createElement('div'); box.className='embedded-report'; box.innerHTML=readableReportHtml(r,{status:r.status}); div.appendChild(box); box.scrollIntoView({behavior:'smooth',block:'nearest'});
    };
    row.appendChild(show);
    const del=document.createElement('button'); del.className='danger'; del.textContent='刪除 local record'; del.onclick=async()=>{if(confirm('只刪除此裝置本機資料，已送到 Mac 的資料不會刪除。確定？')){await delRecord(r.local_id); setupCollapsibles(); renderLocal(); loadClientReports(false)}};
    row.appendChild(del);
    if(r.server_response){const details=document.createElement('details'); details.innerHTML=`<summary>上次自動送出結果</summary><pre>${JSON.stringify(r.server_response,null,2)}</pre>`; div.appendChild(details);}
    div.appendChild(row); $('localList').appendChild(div);
  }
}

async function loadClientReports(showLog=true){
  try{
    // 先依 Mac DB 狀態清理 local：已 commit 的 local copy、rejected、DB retention 過期、或 pending_submitted 超過 5 日未 approved 都會被刪除。
    await cleanupLocalAgainstMacDB(true);
    const device=await ensureDeviceId();
    const resp=await api('/api/client/reports/list?device_id='+encodeURIComponent(device)+'&limit=200');
    const serverRecords=resp.records||[];
    const serverIds=new Set(serverRecords.map(r=>r.pending_id));
    const serverHashes=new Set(serverRecords.map(r=>r.payload_hash||r.server_payload_hash));
    const local=(await getAllRecords()).filter(r=>['pending_submitted','approved','revision_required'].includes(r.status) && !serverIds.has(r.pending_id) && !serverHashes.has(r.client_payload_hash||r.server_payload_hash));
    const list=$('clientReportList'); if(!list) return;
    list.innerHTML='';
    const combined=[];
    for(const r of local){combined.push({source:'local_pending', pending_id:r.pending_id, stock_id:r.stock_id, stock_name:r.parsed_json?.stock_name||'', analysis_date:r.analysis_date, status:r.status, parsed_json:r.parsed_json, fundamental_score:r.parsed_json?.fundamental?.score, technical_score:r.parsed_json?.technical?.score, chip_score:r.parsed_json?.chip?.score});}
    for(const r of serverRecords){combined.push({...r, source:'mac_committed', status:'committed'});}
    if(!combined.length){list.innerHTML='<div class="item small">目前沒有可閱讀的用戶端報告。送出 pending 或 Mac commit 後會出現在這裡。</div>';}
    for(const r of combined){
      const div=document.createElement('div'); div.className='item compact-report-card report-row-card';
      div.innerHTML=reportRowHtml(r, r.source==='mac_committed'?'Mac DB':'pending');
      const btn=document.createElement('button'); btn.textContent='顯示完整報告'; btn.onclick=async()=>{
        let detail=r;
        if(r.source==='mac_committed'){
          const d=await api('/api/client/reports/detail?pending_id='+encodeURIComponent(r.pending_id)); detail={...d.report, status:'committed'};
        }
        const existing=div.querySelector('.embedded-report'); if(existing){existing.remove(); return;}
        const box=document.createElement('div'); box.className='embedded-report'; box.innerHTML=readableReportHtml(detail,{status:detail.status}); div.appendChild(box);
      };
      const actions=document.createElement('div'); actions.className='row report-actions'; actions.appendChild(btn); div.appendChild(actions); list.appendChild(div);
    }
    if(showLog) log('clientReportResult',{ok:true,server_reports:serverRecords.length,local_pending_reports:local.length,total:combined.length,cleanup:'已先依 Mac DB 清理 local。已 commit 的 local copy 不再重複顯示；用戶端超前於 DB 的內容只會是 pending 中的報告。'});
  }catch(e){ if(showLog) log('clientReportResult',{ok:false,error:e.message}); }
}

async function adminList(){try{const resp=await api('/api/pending/list'); const list=$('adminList'); list.innerHTML=''; for(const r of resp.records||[]){const div=document.createElement('div'); div.className='item'; const status=r.server_status||'unknown'; const actionHint=status==='pending_submitted'?'可操作：Approve / Reject；Commit 需先 Approve。':status==='approved'?'可操作：Commit / Reject。':status==='committed'?'已正式寫入 SQLite，無可用操作。':status==='revision_required'?'需人工確認是否為修正版；本版不自動 commit。':'此狀態無可用操作。'; div.innerHTML=`<h3>${r.stock_id} <span class="status ${status}">${status}</span></h3><div class="meta">${r.pending_id}<br>${r.analysis_date} · ${r.submitted_at||''}</div><div class="small"><b>操作資訊：</b>${actionHint}</div>`; const row=document.createElement('div'); row.className='row'; const approve=document.createElement('button'); approve.textContent='Approve'; approve.onclick=async()=>{log('adminResult',await api('/api/pending/approve','POST',{pending_id:r.pending_id,review_note:'approved from frontend admin UI'})); adminList()}; const commit=document.createElement('button'); commit.textContent='Commit'; commit.onclick=async()=>{log('adminResult',await api('/api/pending/commit','POST',{pending_id:r.pending_id})); adminList()}; const disabled=document.createElement('button'); disabled.textContent='Commit（需先 Approve）'; disabled.disabled=true; disabled.className='secondary'; const rej=document.createElement('button'); rej.className='danger'; rej.textContent='Reject'; rej.onclick=async()=>{const reason=prompt('Reject reason')||''; if(reason) {log('adminResult',await api('/api/pending/reject','POST',{pending_id:r.pending_id,rejected_reason:reason})); adminList()}}; if(status==='pending_submitted'){row.append(approve,rej,disabled)} else if(status==='approved'){row.append(commit,rej)} else {const span=document.createElement('span'); span.className='small'; span.textContent=actionHint; row.append(span)} div.appendChild(row); list.appendChild(div)} log('adminResult',{ok:true,count:(resp.records||[]).length, records:resp.records||[]})}catch(e){log('adminResult',{ok:false,error:e.message})}}
async function diagnostics(){try{log('adminResult',await api('/api/diagnostics'))}catch(e){log('adminResult',{ok:false,error:e.message})}}
async function backup(){try{log('adminResult',await api('/api/backup/sqlite','POST',{}))}catch(e){log('adminResult',{ok:false,error:e.message})}}
async function exportServer(){try{log('adminResult',await api('/api/export/json','POST',{device_id:await ensureDeviceId()}))}catch(e){log('adminResult',{ok:false,error:e.message})}}
async function exportLocal(){const all=await getAllRecords(); const obj={app:'stock_manual_chatgpt_hybrid',schema_version:1,exported_at:nowIso(),export_source:'indexeddb_frontend',device_id:await ensureDeviceId(),records:all}; const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='stock_manual_chatgpt_local_export_'+taipeiDate()+'.json'; a.click(); URL.revokeObjectURL(url); log('backupResult',{ok:true,records:all.length})}
async function importLocal(){const f=$('importFile').files[0]; if(!f){alert('請選擇 JSON');return} const obj=JSON.parse(await f.text()); if(obj.schema_version!==1||!Array.isArray(obj.records)) throw new Error('不支援的匯入格式'); let inserted=0, dup=0; const existing=await getAllRecords(); const ids=new Set(existing.map(r=>r.pending_id)); for(const r of obj.records){if(ids.has(r.pending_id)){dup++;continue} r.local_id=r.local_id||uuid(); await putRecord(r); inserted++} log('backupResult',{ok:true,total:obj.records.length,inserted,duplicates:dup}); setupCollapsibles(); renderLocal(); loadClientReports(false)}
function setupCollapsibles(){document.querySelectorAll('.card > h2').forEach(h=>{if(h.dataset.collapseReady)return; h.dataset.collapseReady='1'; const btn=document.createElement('button'); btn.type='button'; btn.className='collapse-toggle secondary'; btn.textContent='收合'; btn.onclick=()=>{const card=h.parentElement; card.classList.toggle('collapsed'); btn.textContent=card.classList.contains('collapsed')?'展開':'收合';}; h.appendChild(btn);});}
async function boot(){await openDB(); const device=await ensureDeviceId(); $('hostUrl').value=await getSetting('last_host_url') || (location.protocol==='http:' && location.hostname!=='localhost' ? location.origin : ''); $('diagBox').textContent=`App ${APP_VERSION}
Device ID: ${device}
IndexedDB: ${DB_NAME}
analysis_date 採 Asia/Taipei YYYY-MM-DD。
r16：解析通過 audit 後自動送 pending；用戶端完整報告會先依 Mac DB 清理，已 commit 的 local copy 會刪除，只保留 Mac DB 正式報告；用戶端超前於 DB 的內容只會是 pending 中報告。`; $('btnGenerate').onclick=generate; $('btnCopyOpenChatGPTApp').onclick=copyAndOpenChatGPTApp; $('btnCopyOpenChatGPTWeb').onclick=copyAndOpenChatGPTWeb; $('btnPasteResponse').onclick=pasteClipboardToResponse; $('btnPasteParse').onclick=pasteAndParse; $('btnParseSave').onclick=parseSave; $('btnHealth').onclick=health; $('btnPullStatus').onclick=async()=>{await pullStatusAndCleanup(); await loadClientReports(false);}; $('btnCleanupLocal').onclick=async()=>{await cleanupLocalAgainstMacDB(false); await loadClientReports(false);}; $('btnRefreshLocal').onclick=async()=>{await renderLocal(); await loadClientReports(false);}; if($('btnLoadClientReports')) $('btnLoadClientReports').onclick=()=>loadClientReports(true); $('searchBox').oninput=renderLocal; $('btnExportLocal').onclick=exportLocal; $('btnImportLocal').onclick=importLocal; setupCollapsibles(); renderLocal(); loadClientReports(false)}
boot().catch(e=>alert(e.message));

// r18-r3 marker: json_repair_note

const ADMIN_VERSION='0.2.0-alpha-r18-r8-pilot-admin-workflow-prompt-gemini-ux';
let lastImportedUpdateZip='';
function $(id){return document.getElementById(id)}
function log(el,obj){$(el).textContent=typeof obj==='string'?obj:JSON.stringify(obj,null,2)}
const ADMIN_SESSION_KEY='stock_manual_chatgpt_admin_token_session_v1';
const ADMIN_SESSION_MINUTES=15;
let adminTokenExpiryTimer=null;
function saveSettings(){sessionStorage.setItem('stock_manual_chatgpt_admin_host', $('adminHostUrl').value.trim())}
function saveTokenSession(host, token, verifyResponse){
  const session={host,token,expires_at:Date.now()+ADMIN_SESSION_MINUTES*60*1000,verified_at:new Date().toISOString(),version:verifyResponse.version||'',runtime_version_constant:verifyResponse.runtime_version_constant||''};
  localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  scheduleTokenAutoClear(session.expires_at);
}
function clearTokenSession(reason=''){
  localStorage.removeItem(ADMIN_SESSION_KEY);
  if(adminTokenExpiryTimer){ clearTimeout(adminTokenExpiryTimer); adminTokenExpiryTimer=null; }
  if($('adminToken')) $('adminToken').value='';
  if($('adminNetBadge')){
    $('adminNetBadge').textContent='Token 未驗證 / 已清除';
    $('adminNetBadge').className='badge warn';
  }
  if(reason) log('adminStatus',{ok:false,token_session_cleared:true,reason});
}
function scheduleTokenAutoClear(expiresAt){
  if(adminTokenExpiryTimer){ clearTimeout(adminTokenExpiryTimer); adminTokenExpiryTimer=null; }
  const ms = Number(expiresAt) - Date.now();
  if(ms <= 0){ clearTokenSession('token session 已過期，自動清除欄位。'); return; }
  adminTokenExpiryTimer = setTimeout(()=>clearTokenSession('token session 已達 15 分鐘有效期限，已自動清除欄位。'), ms + 250);
}
function loadSettings(){
  const host=sessionStorage.getItem('stock_manual_chatgpt_admin_host') || location.origin;
  $('adminHostUrl').value=host; $('adminToken').value='';
  try{
    const session=JSON.parse(localStorage.getItem(ADMIN_SESSION_KEY)||'null');
    if(session && session.expires_at>Date.now() && session.host.replace(/\/$/,'')===host.replace(/\/$/,'')){
      $('adminToken').value=session.token;
      scheduleTokenAutoClear(session.expires_at);
      $('adminNetBadge').textContent='已載入 15 分鐘 token session，驗證中…';
      $('adminNetBadge').className='badge warn';
      setTimeout(()=>health(true),100);
    }else if(session){clearTokenSession('token session 已過期或 Host 不同，請重新輸入目前 Terminal 顯示的 token。')}
  }catch(e){clearTokenSession('token session 格式錯誤，已清除')}
}
async function api(path, method='GET', body=null){
  const host=$('adminHostUrl').value.trim().replace(/\/$/,'') || location.origin;
  const token=$('adminToken').value.trim();
  saveSettings();
  const headers={'Content-Type':'application/json'};
  if(token) headers['X-Sync-Token']=token;
  const res=await fetch(host+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const text=await res.text(); let obj; try{obj=JSON.parse(text)}catch{obj={raw:text}}
  if(!res.ok){
    if(res.status===401 || res.status===403) clearTokenSession('token 無效或已失效，已自動清除欄位。');
    throw new Error(obj.message||res.statusText);
  }
  return obj;
}
async function health(auto=false){try{const h=await api('/api/token/verify'); $('adminNetBadge').textContent='Token 已驗證（15 分鐘有效）'; $('adminNetBadge').className='badge ok'; saveTokenSession(($('adminHostUrl').value.trim().replace(/\/$/,'')||location.origin), $('adminToken').value.trim(), h); log('adminStatus',{...h,token_session_expires_at:new Date(Date.now()+ADMIN_SESSION_MINUTES*60*1000).toISOString(),note:'若 Mac Host 重新啟動，舊 token 會失效；下次驗證失敗時會自動清除 session。'})}catch(e){$('adminNetBadge').textContent='Token 無效或連線失敗'; $('adminNetBadge').className='badge warn'; clearTokenSession('token 無效、已過期，或 Mac Host 已重新啟動換 token'); if(!auto) log('adminStatus',{ok:false,error:e.message,hint:'請輸入本次 Mac 終端機顯示的新 One-time Token；舊 token 會失效。'})}}
function recordCard(r){
  const div=document.createElement('div'); div.className='record';
  const parsed=(()=>{try{return JSON.parse(r.parsed_json||'{}')}catch{return {}}})();
  const status=r.server_status || 'unknown';
  const actionHint = status==='pending_submitted' ? '可操作：Approve / Reject；Commit 需先 Approve。' :
    status==='approved' ? '可操作：Commit / Reject。' :
    status==='committed' ? '已正式寫入 SQLite，無可用操作。' :
    status==='revision_required' ? '需人工確認是否為修正版；本版不自動 commit。' :
    status==='duplicate_blocked' ? '重複 payload，未建立第二筆 pending_queue。' :
    '此狀態無可用操作。';
  div.innerHTML=`<b>${r.stock_id}</b> ${parsed.stock_name||''}｜${r.analysis_date||''}<br>
    狀態：<span class="badge status-badge">${status}</span><br>
    現價資訊：${esc(parsed.current_price_date ?? r.current_price_date ?? '資料不足')}｜${esc(parsed.current_price ?? r.current_price ?? '資料不足')}<br>
    操作資訊：<b>${actionHint}</b><br>
    Pending ID：<code>${r.pending_id}</code><br>
    來源：${esc(r.source_mode||'local')}｜Cloud Pending ID：<code>${esc(r.cloud_pending_id||'')}</code><br>
    Cloud Sync：${esc(r.cloud_sync_status||r.cloud_status||'未同步/待確認')}｜最後同步：${esc(r.last_cloud_sync_at||'')}<br>
    Hash：<code>${String(r.payload_hash||'').slice(0,16)}...</code><br>
    <details><summary>完整 pending JSON</summary><pre>${JSON.stringify(parsed,null,2)}</pre></details>`;
  const row=document.createElement('div'); row.className='row';
  const approve=document.createElement('button'); approve.textContent='Approve'; approve.onclick=()=>adminAction('/api/pending/approve',{pending_id:r.pending_id,review_note:'approved from admin.html'});
  const reject=document.createElement('button'); reject.textContent='Reject'; reject.className='danger'; reject.onclick=()=>{const reason=prompt('Reject reason?','rejected from admin.html'); if(reason) adminAction('/api/pending/reject',{pending_id:r.pending_id,rejected_reason:reason})};
  const commit=document.createElement('button'); commit.textContent='Commit（自動回寫 Worker）'; commit.onclick=()=>adminAction('/api/pending/commit',{pending_id:r.pending_id});
  const commitDisabled=document.createElement('button'); commitDisabled.textContent='Commit（需先 Approve）'; commitDisabled.disabled=true; commitDisabled.className='secondary';
  if(status==='pending_submitted'){row.append(approve,reject,commitDisabled)}
  else if(status==='approved'){row.append(commit,reject)}
  else {const span=document.createElement('span'); span.className='small'; span.textContent=actionHint; row.append(span)}
  div.appendChild(row); return div;
}
async function loadPending(){try{const resp=await api('/api/pending/list'); const list=$('adminList'); list.innerHTML=''; const records=resp.records||[]; if(!records.length){list.innerHTML='<div class="record small">Mac SQLite pending_queue 目前是 0。若朋友/iPhone 已 cloud_submitted，請先按「從 Cloudflare 拉取 Pending 並刷新」。</div>';} else {records.forEach(r=>list.appendChild(recordCard(r)));} log('adminResult',{ok:true,count:records.length, records})}catch(e){log('adminResult',{ok:false,error:e.message})}}
async function adminAction(path, body){
  try{
    const resp=await api(path,'POST',body);
    let cloud_sync=null;
    if(path==='/api/pending/commit' && body && body.pending_id){
      try{
        cloud_sync=await api('/api/cloudflare/status/sync_one','POST',{pending_id:body.pending_id});
      }catch(e){
        cloud_sync={ok:false,error:e.message,cloud_sync_failed:true,note:'本機 commit 已完成；雲端狀態回寫失敗，可稍後重試。'};
      }
    }
    log('adminResult',cloud_sync?{ok:resp.ok!==false,local_action:resp,cloud_sync}:resp);
    await loadPending(); await loadReports(false)
  }catch(e){log('adminResult',{ok:false,error:e.message})}
}
async function cloudPullRefresh(){
  try{
    const pull=await api('/api/cloudflare/host/pull_import','POST',{});
    await loadPending();
    log('adminResult',{ok:true,cloud_pull_import:pull,next:'已從 Cloudflare 拉取並刷新 Mac Pending。請審核後 Approve / Commit。'});
  }catch(e){
    log('adminResult',{ok:false,error:e.message,hint:'請確認 Cloud Sync Lab 已儲存 Worker URL / Host ID / Host Secret，且 Worker Health 正常。'});
  }
}

function reportCard(r){
  const div=document.createElement('div'); div.className='record';
  div.innerHTML=`<b>${r.stock_id}</b> ${r.stock_name||''}｜${r.analysis_date||''}<br>
  分數：基本 ${r.fundamental_score} / 技術 ${r.technical_score} / 籌碼 ${r.chip_score}<br>
  現價資訊：${r.current_price_date || '資料不足'}｜${r.current_price ?? '資料不足'}<br>
  committed_at：${r.committed_at||''}<br>
  pending_id：<code>${r.pending_id}</code>`;
  const row=document.createElement('div'); row.className='row';
  const btn=document.createElement('button'); btn.textContent='查看完整報告'; btn.onclick=()=>loadReportDetail(r.id);
  row.appendChild(btn); div.appendChild(row); return div;
}
async function loadReports(showLog=true){try{const resp=await api('/api/reports/list'); const list=$('reportList'); list.innerHTML=''; const records=resp.records||[]; if(!records.length){list.innerHTML='<div class="record small">尚無已 Commit 的正式報告。請先在 Pending Queue Approve + Commit。</div>';} else {records.forEach(r=>list.appendChild(reportCard(r)));} if(showLog) log('reportResult',{ok:true,count:records.length})}catch(e){log('reportResult',{ok:false,error:e.message})}}
function esc(v){return String(v ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function priceCard(title, obj){
  obj=obj||{};
  return `<div class="price-card"><b>${esc(title)}</b><br><span class="score-number">${esc(obj.display || [obj.price_low,obj.price_high].filter(x=>x!==undefined&&x!==null).join('-') || '—')}</span><br><span class="small">${esc(obj.explanation||'')}</span></div>`;
}
function sectionCard(title, section){
  section=section||{};
  return `<div class="report-section"><h3>${esc(title)}</h3><div class="score-card"><span class="score-number">${esc(section.score ?? '—')}</span> / 10</div><p>${esc(section.summary||'')}</p></div>`;
}
function renderReadableReport(r){
  const p=r.parsed_json||{};
  const entry=p.entry_price||{};
  const take=p.take_profit_price||{};
  const risks=Array.isArray(p.risk_notes)?p.risk_notes:[];
  return `<div class="report-readable">
    <div class="report-header-card">
      <h2>${esc(r.stock_id || p.stock_id)} ${esc(r.stock_name || p.stock_name || '')}</h2>
      <p class="small">analysis_date：${esc(r.analysis_date || p.analysis_date || '')}｜committed_at：${esc(r.committed_at||'')}｜pending_id：<code>${esc(r.pending_id||'')}</code></p>
      <div class="price-highlight"><b>現價資訊</b>：${esc(r.current_price_date ?? p.current_price_date ?? '資料不足')}｜${esc(r.current_price ?? p.current_price ?? '資料不足')}</div>
      <p>${esc(p.overall_summary||'')}</p>
      <div class="score-grid">
        <div class="score-card"><b>基本面</b><br><span class="score-number">${esc(r.fundamental_score ?? p.fundamental?.score ?? '—')}</span>/10</div>
        <div class="score-card"><b>技術面</b><br><span class="score-number">${esc(r.technical_score ?? p.technical?.score ?? '—')}</span>/10</div>
        <div class="score-card"><b>籌碼面</b><br><span class="score-number">${esc(r.chip_score ?? p.chip?.score ?? '—')}</span>/10</div>
      </div>
    </div>
    ${sectionCard('基本面說明', p.fundamental)}
    ${sectionCard('技術面說明', p.technical)}
    ${sectionCard('籌碼面說明', p.chip)}
    <div class="report-section"><h3>合理進場價</h3><div class="price-grid">
      ${priceCard('保守', entry.conservative)}${priceCard('合理', entry.reasonable)}${priceCard('積極', entry.aggressive)}
    </div></div>
    <div class="report-section"><h3>獲利了結價格</h3><div class="price-grid">
      ${priceCard('第一目標', take.first_target)}${priceCard('第二目標', take.second_target)}
    </div></div>
    <div class="report-section"><h3>主要風險</h3>${risks.length?`<ul>${risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="small">未提供</p>'}</div>
    <details class="report-section"><summary>原始 prompt / ChatGPT 回答</summary><h4>Prompt</h4><div class="raw-box">${esc(r.prompt_text||'')}</div><h4>Raw Response</h4><div class="raw-box">${esc(r.raw_response_text||'')}</div></details>
  </div>`;
}
function reportToolbar(){return `<div class="report-toolbar"><button onclick="resizeReportPane(120)">加高報告窗格</button><button onclick="resizeReportPane(-120)" class="secondary">降低報告窗格</button><button onclick="resetReportPane()" class="secondary">重設高度</button><span class="report-resize-hint">Mac 可拖拉報告框右下角調整高度；iPhone 可用上方按鈕調整。</span></div>`}
function resizeReportPane(delta){const el=$('reportResult'); const h=Math.max(300, (el.offsetHeight||480)+delta); el.style.height=h+'px'; sessionStorage.setItem('stock_manual_report_pane_height', String(h));}
function resetReportPane(){const el=$('reportResult'); el.style.height='62vh'; sessionStorage.removeItem('stock_manual_report_pane_height');}
function restoreReportPaneHeight(){const h=sessionStorage.getItem('stock_manual_report_pane_height'); if(h) $('reportResult').style.height=h+'px';}
async function loadReportDetail(id){try{const resp=await api('/api/reports/detail?id='+encodeURIComponent(id)); const r=resp.report; $('reportResult').innerHTML=reportToolbar()+renderReadableReport(r); restoreReportPaneHeight(); $('reportResult').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){log('reportResult',{ok:false,error:e.message})}}
async function updateInfo(){try{log('updateResult', await api('/api/update/info'))}catch(e){log('updateResult',{ok:false,error:e.message})}}
function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader(); r.onload=()=>{const s=String(r.result||''); resolve(s.includes(',')?s.split(',')[1]:s)}; r.onerror=()=>reject(r.error); r.readAsDataURL(file)})}
async function importUpdateZip(){try{const f=$('updateZipFile').files[0]; if(!f) throw new Error('請先選擇 update ZIP'); const content_b64=await fileToBase64(f); const resp=await api('/api/update/import_zip','POST',{filename:f.name,content_b64}); lastImportedUpdateZip=f.name; log('updateResult',resp); await updateInfo()}catch(e){log('updateResult',{ok:false,error:e.message})}}
function selectedUpdateName(){let name=lastImportedUpdateZip; if(!name){const f=$('updateZipFile').files[0]; if(f) name=f.name;} if(!name) name=prompt('請輸入已匯入 updates/ 的 zip 檔名')||''; return name;}
async function applyUpdateZip(){try{const name=selectedUpdateName(); if(!name) throw new Error('沒有 update zip 檔名'); const resp=await api('/api/update/apply_zip','POST',{filename:name}); log('updateResult',resp)}catch(e){log('updateResult',{ok:false,error:e.message})}}
async function dryRunInstallUpdateZip(){try{const name=selectedUpdateName(); if(!name) throw new Error('沒有 update zip 檔名'); const resp=await api('/api/update/install_zip','POST',{filename:name,dry_run:true}); log('updateResult',resp)}catch(e){log('updateResult',{ok:false,error:e.message})}}
async function installUpdateZip(){try{const name=selectedUpdateName(); if(!name) throw new Error('沒有 update zip 檔名'); if(!confirm('確定要完整安裝更新 ZIP？系統會備份目前程式與 SQLite，保留 data/diagnostic/updates，複製新版程式檔。安裝完成後必須重新啟動 Mac Host。')) return; const resp=await api('/api/update/install_zip','POST',{filename:name,dry_run:false}); log('updateResult',resp); alert('更新檔已安裝到目前資料夾。請停止目前 Mac Host，重新執行 run_host_mac.command 載入新版。');}catch(e){log('updateResult',{ok:false,error:e.message})}}

async function rollbackLatestBackup(){
  try{
    if(!confirm('確定要 rollback 最新 code backup？會保留 data/diagnostic/updates，但會還原程式碼。完成後必須重新啟動 Mac Host。')) return;
    const resp=await api('/api/update/rollback_latest','POST',{});
    log('updateResult',resp);
    alert('Rollback 已執行。請停止目前 Mac Host，重新執行 run_host_mac.command 載入回復後版本。');
  }catch(e){log('updateResult',{ok:false,error:e.message})}
}

async function diagnostics(){try{log('diagResult', await api('/api/diagnostics'))}catch(e){log('diagResult',{ok:false,error:e.message})}}
async function exportDiagnostics(){try{log('diagResult', await api('/api/diagnostics/export','POST',{}))}catch(e){log('diagResult',{ok:false,error:e.message})}}
async function sqliteBackup(){try{log('backupResult', await api('/api/backup/sqlite','POST',{}))}catch(e){log('backupResult',{ok:false,error:e.message})}}
async function jsonExport(){try{log('backupResult', await api('/api/export/json','POST',{device_id:'mac_admin'}))}catch(e){log('backupResult',{ok:false,error:e.message})}}
async function oldSqlitePreview(){try{const f=$('oldSqliteFile').files[0]; if(!f) throw new Error('請先選擇舊版 app.sqlite3'); const content_b64=await fileToBase64(f); const resp=await api('/api/import/sqlite/preview','POST',{filename:f.name,content_b64}); log('sqliteImportResult',resp)}catch(e){log('sqliteImportResult',{ok:false,error:e.message})}}
async function oldSqliteApply(){try{const f=$('oldSqliteFile').files[0]; if(!f) throw new Error('請先選擇舊版 app.sqlite3'); if(!confirm('確定要合併舊版 SQLite？匯入後同一個股只保留最近 3 份正式報告。')) return; const content_b64=await fileToBase64(f); const resp=await api('/api/import/sqlite/apply','POST',{filename:f.name,content_b64}); log('sqliteImportResult',resp); await loadReports(false)}catch(e){log('sqliteImportResult',{ok:false,error:e.message})}}
function setupCollapsibles(){document.querySelectorAll('.card > h2').forEach(h=>{if(h.dataset.collapseReady)return; h.dataset.collapseReady='1'; const btn=document.createElement('button'); btn.type='button'; btn.className='collapse-toggle secondary'; btn.textContent='收合'; btn.onclick=()=>{const card=h.parentElement; card.classList.toggle('collapsed'); btn.textContent=card.classList.contains('collapsed')?'展開':'收合';}; h.appendChild(btn);});}
window.addEventListener('DOMContentLoaded',()=>{
  setupCollapsibles();
  loadSettings();
  $('btnAdminHealth').onclick=health; if($('btnCloudPullRefresh')) $('btnCloudPullRefresh').onclick=cloudPullRefresh; $('btnLoadPending').onclick=loadPending;
  $('btnLoadReports').onclick=()=>loadReports(true);
  $('btnUpdateInfo').onclick=updateInfo; $('btnImportUpdateZip').onclick=importUpdateZip; $('btnApplyUpdateZip').onclick=applyUpdateZip; $('btnDryRunInstallUpdateZip').onclick=dryRunInstallUpdateZip; $('btnInstallUpdateZip').onclick=installUpdateZip; $('btnRollbackLatest').onclick=rollbackLatestBackup;
  $('btnDiagnostics').onclick=diagnostics; $('btnExportDiagnostics').onclick=exportDiagnostics;
  $('btnPreviewOldSqlite').onclick=oldSqlitePreview; $('btnApplyOldSqlite').onclick=oldSqliteApply;
  $('btnSqliteBackup').onclick=sqliteBackup; $('btnJsonExport').onclick=jsonExport;
});

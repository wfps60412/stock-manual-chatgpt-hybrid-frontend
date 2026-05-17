(function(){
  const $ = (id) => document.getElementById(id);
  const defaultHost = window.location.origin || 'http://127.0.0.1:8765';
  const defaultWorker = 'https://stock-manual-r18-pending-inbox.stock-manual-r18-pending-inbox.workers.dev';
  $('hostUrl').value = localStorage.getItem('cloudBridgeHostUrl') || defaultHost;
  $('workerUrl').value = localStorage.getItem('cloudBridgeWorkerUrl') || defaultWorker;
  const savedToken = sessionStorage.getItem('cloudBridgeToken') || '';
  if (savedToken) $('syncToken').value = savedToken;
  function base(){ const v = ($('hostUrl').value || defaultHost).trim().replace(/\/+$/,''); localStorage.setItem('cloudBridgeHostUrl', v); return v; }
  function token(){ const t = ($('syncToken').value || '').trim(); if(t) sessionStorage.setItem('cloudBridgeToken', t); return t; }
  function headers(){ const h = {'Content-Type':'application/json'}; const t = token(); if(t) h['X-Sync-Token'] = t; return h; }
  function show(id, obj){ $(id).textContent = typeof obj === 'string' ? obj : JSON.stringify(obj,null,2); }
  async function fetchJson(url, opts){
    const res = await fetch(url, opts || {});
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch(e) { data = text.slice(0, 500); }
    return {ok:res.ok, status:res.status, url, data};
  }
  async function api(path, method='GET', body=null){
    const opts = {method, headers: headers(), cache:'no-store'};
    if(body !== null) opts.body = JSON.stringify(body);
    return await fetchJson(base()+path, opts);
  }
  $('btnMainHealth').onclick = async () => {
    const paths = ['/api/health','/admin.html','/','/manifest.json','/cloud_sync_lab.html'];
    const out = [];
    for(const p of paths){ try { out.push(await fetchJson(base()+p, {cache:'no-store'})); } catch(e){ out.push({ok:false,path:p,error:String(e)}); } }
    show('mainOut', out);
  };
  $('btnVerifyToken').onclick = async () => { try { show('mainOut', await fetchJson(base()+'/api/token/verify', {headers:{'X-Sync-Token': token()}})); } catch(e){ show('mainOut',{ok:false,error:String(e)}); } };
  $('btnForgetToken').onclick = () => { sessionStorage.removeItem('cloudBridgeToken'); $('syncToken').value=''; show('mainOut',{ok:true,message:'已清除本頁 token'}); };
  $('btnLoadConfig').onclick = async () => { try { show('configOut', await api('/api/cloudflare/config/status')); } catch(e){ show('configOut',{ok:false,error:String(e)}); } };
  $('btnSaveConfig').onclick = async () => {
    const payload = {
      worker_url: ($('workerUrl').value || '').trim().replace(/\/+$/,''),
      device_id: ($('deviceId').value || '').trim(),
      device_secret: ($('deviceSecret').value || '').trim(),
      host_id: ($('hostId').value || '').trim(),
      host_secret: ($('hostSecret').value || '').trim()
    };
    localStorage.setItem('cloudBridgeWorkerUrl', payload.worker_url);
    try { show('configOut', await api('/api/cloudflare/config/save','POST', payload)); }
    catch(e){ show('configOut',{ok:false,error:String(e)}); }
  };
  $('btnWorkerHealth').onclick = async () => { try { show('configOut', await api('/api/cloudflare/worker/health','POST',{worker_url:($('workerUrl').value||'').trim()})); } catch(e){ show('configOut',{ok:false,error:String(e)}); } };
  $('btnTestSubmit').onclick = async () => { try { show('e2eOut', await api('/api/cloudflare/device/test_submit','POST',{})); } catch(e){ show('e2eOut',{ok:false,error:String(e)}); } };
  $('btnPullImport').onclick = async () => { try { show('e2eOut', await api('/api/cloudflare/host/pull_import','POST',{})); } catch(e){ show('e2eOut',{ok:false,error:String(e)}); } };
  $('btnListLocal').onclick = async () => { try { show('e2eOut', await api('/api/cloudflare/local/list')); } catch(e){ show('e2eOut',{ok:false,error:String(e)}); } };
  $('btnSyncOne').onclick = async () => { try { show('statusOut', await api('/api/cloudflare/status/sync_one','POST',{pending_id:($('pendingId').value||'').trim()})); } catch(e){ show('statusOut',{ok:false,error:String(e)}); } };
})();

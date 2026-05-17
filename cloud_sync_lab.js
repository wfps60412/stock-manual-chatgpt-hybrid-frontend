(function(){
  const $ = (id) => document.getElementById(id);
  const defaultHost = window.location.origin || 'http://127.0.0.1:8765';
  $('hostUrl').value = localStorage.getItem('cloudSyncLabHostUrl') || defaultHost;
  const savedToken = sessionStorage.getItem('cloudSyncLabToken') || '';
  if (savedToken) $('syncToken').value = savedToken;
  function base(){
    const v = ($('hostUrl').value || defaultHost).trim().replace(/\/+$/,'');
    localStorage.setItem('cloudSyncLabHostUrl', v);
    return v;
  }
  function show(id, obj){ $(id).textContent = typeof obj === 'string' ? obj : JSON.stringify(obj,null,2); }
  async function fetchText(url, opts){
    const res = await fetch(url, opts || {});
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch(e) { data = text.slice(0,200); }
    return {ok:res.ok, status:res.status, url, data};
  }
  $('btnHealth').addEventListener('click', async () => {
    try { show('healthOut', await fetchText(base() + '/api/health')); }
    catch(e){ show('healthOut', {ok:false, error:String(e)}); }
  });
  $('btnStatic').addEventListener('click', async () => {
    const paths = ['/admin.html','/','/manifest.json'];
    const out = [];
    for (const p of paths) {
      try { const r = await fetch(base()+p,{cache:'no-store'}); out.push({path:p,status:r.status,ok:r.ok}); }
      catch(e){ out.push({path:p,ok:false,error:String(e)}); }
    }
    show('healthOut', out);
  });
  $('btnVerifyToken').addEventListener('click', async () => {
    const token = ($('syncToken').value || '').trim();
    if (!token) return show('tokenOut', {ok:false, message:'請先輸入 token'});
    sessionStorage.setItem('cloudSyncLabToken', token);
    try { show('tokenOut', await fetchText(base() + '/api/token/verify', {headers:{'X-Sync-Token': token}})); }
    catch(e){ show('tokenOut', {ok:false, error:String(e)}); }
  });
  $('btnForgetToken').addEventListener('click', () => {
    sessionStorage.removeItem('cloudSyncLabToken'); $('syncToken').value=''; show('tokenOut',{ok:true,message:'已清除本頁暫存 token'});
  });
  $('btnLanInfo').addEventListener('click', async () => {
    try {
      const h = await fetchText(base() + '/api/health');
      show('lanOut', {ok:true, note:'請以 Mac Host 終端機顯示的 LAN URL 連線，例如 http://192.168.x.x:8765/。Cloud Sync Lab 位於 /cloud_sync_lab.html。不要在公用 Wi-Fi 使用。', health:h});
    } catch(e){ show('lanOut',{ok:false,error:String(e)}); }
  });
})();

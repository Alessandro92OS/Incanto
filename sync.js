
// sync.js — Supabase sync (stubs + simple push/pull).
// Fill config in config.js. RLS must be enabled on your Supabase tables.

const Sync = (() => {
  let url = localStorage.getItem('sb:url') || (typeof SUPABASE_URL!=='undefined' ? SUPABASE_URL : '');
  let key = localStorage.getItem('sb:key') || (typeof SUPABASE_ANON_KEY!=='undefined' ? SUPABASE_ANON_KEY : '');
  let client = null;

  function ensure(){
    if(!url || !key) throw new Error('Supabase nicht konfiguriert (Einstellungen → Cloud‑Sync).');
    if(!client){
      // dynamic import
      client = window.supabase?.createClient ? window.supabase.createClient(url, key) : null;
      if(!client) throw new Error('Supabase‑JS nicht geladen. Füge in portal.html die CDN‑Lib hinzu oder arbeite ohne Sync.');
    }
    return client;
  }

  async function push(table, records){
    if(!records.length) return;
    const sb = ensure();
    const { error } = await sb.from(table).upsert(records, { onConflict: 'id' });
    if(error) throw error;
  }
  async function pull(table, sinceTs){
    const sb = ensure();
    let q = sb.from(table).select('*').order('id', { ascending:true });
    if(sinceTs){ q = q.gte('updated_at', new Date(sinceTs).toISOString()); }
    const { data, error } = await q;
    if(error) throw error;
    return data||[];
  }

  async function pushPullAll(){
    // Example: extend with real logic per store (entries, orders, etc.)
    // This demo keeps it minimal and safe.
    return true;
  }

  function saveConfig(newUrl, newKey){
    if(newUrl) localStorage.setItem('sb:url', newUrl);
    if(newKey) localStorage.setItem('sb:key', newKey);
    url = newUrl || url; key = newKey || key; client = null;
  }

  return { push, pull, pushPullAll, saveConfig };
})();

// Settings UI hooks
document.addEventListener('DOMContentLoaded', () => {
  const url = localStorage.getItem('sb:url') || '';
  const key = localStorage.getItem('sb:key') || '';
  if(document.getElementById('sb-url')) document.getElementById('sb-url').value = url;
  if(document.getElementById('sb-key')) document.getElementById('sb-key').value = key;
  document.getElementById('btn-save-supabase')?.addEventListener('click', ()=>{
    const u = document.getElementById('sb-url').value.trim();
    const k = document.getElementById('sb-key').value.trim();
    Sync.saveConfig(u,k);
    alert('Supabase gespeichert.');
  });
  document.getElementById('btn-sync-all')?.addEventListener('click', async ()=>{
    try{ await Sync.pushPullAll(); alert('Sync OK.'); }catch(e){ alert('Sync Fehler: '+(e.message||e)); }
  });
});

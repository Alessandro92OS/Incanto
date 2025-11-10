// portal.js (RPC-Version) — nutzt Supabase RPC-Funktionen portal_entries / portal_orders
(async () => {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const from = params.get('from'); const to = params.get('to');

  const rangeEl = document.getElementById('range');
  rangeEl.textContent = `Zeitraum: ${from || '—'} bis ${to || '—'}`;

  const clientEl = document.getElementById('client');
  const tBody = document.getElementById('times');
  const oBody = document.getElementById('orders');

  function err(msg){
    clientEl.textContent = `Kundenportal — Fehler`;
    tBody.innerHTML = `<tr><td colspan="6"><em>${msg}</em></td></tr>`;
    oBody.innerHTML = `<tr><td colspan="6"><em>${msg}</em></td></tr>`;
  }

  if(!token){ err('Kein Token übergeben (?token=...)'); return; }

  const URL_ = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) || localStorage.getItem('sb:url') || '';
  const KEY_ = (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) || localStorage.getItem('sb:key') || '';
  if(!URL_ || !KEY_){ err('Supabase nicht konfiguriert (config.js oder App-Einstellungen).'); return; }

  const sb = window.supabase.createClient(URL_, KEY_);

  try{
    const { data: times, error: e1 } = await sb.rpc('portal_entries', { p_token: token, p_from: from || null, p_to: to || null });
    if(e1) throw e1;
    const { data: orders, error: e2 } = await sb.rpc('portal_orders', { p_token: token, p_from: from || null, p_to: to || null });
    if(e2) throw e2;

    // Optional: Clientname via weiterer RPC (falls vorhanden) – hier fallback
    clientEl.textContent = 'Incanto · Kundenportal';

    tBody.innerHTML = (times && times.length)
      ? times.map(e => `<tr>
          <td>${e.user_name || '—'}</td>
          <td>${e.area_name || '—'}</td>
          <td>${new Date(e.start_ts).toLocaleString('de-DE')}</td>
          <td>${new Date(e.end_ts).toLocaleString('de-DE')}</td>
          <td>${e.duration_min ?? ''}</td>
          <td>${e.note ? String(e.note).replace(/</g,'&lt;') : ''}</td>
        </tr>`).join('')
      : '<tr><td colspan="6"><em>Keine Einträge im Zeitraum.</em></td></tr>';

    oBody.innerHTML = (orders && orders.length)
      ? orders.map(o => `<tr>
          <td>${o.title || '—'}</td>
          <td>${o.area_name || '—'}</td>
          <td>${o.assigned_name || '—'}</td>
          <td>${o.start_plan ? new Date(o.start_plan).toLocaleString('de-DE') : ''}</td>
          <td>${o.status || ''}</td>
          <td>${o.address ? String(o.address).replace(/</g,'&lt;') : ''}</td>
        </tr>`).join('')
      : '<tr><td colspan="6"><em>Keine Einsätze im Zeitraum.</em></td></tr>';

  }catch(e){
    err(`Zugriff fehlgeschlagen: ${e.message || e}`);
  }
})();

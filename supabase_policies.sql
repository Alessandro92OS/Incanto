-- supabase_policies.sql (Grundidee – anpassen nach Bedarf)
alter table clients enable row level security;
alter table areas enable row level security;
alter table users_incanto enable row level security;
alter table work_orders enable row level security;
alter table time_entries enable row level security;
alter table portal_tokens enable row level security;

-- Beispiel: öffentliche SELECTs für Portal-Views sind über signierte Token-Route vorgesehen (alternativ RLS mit RPC).
-- Für App-Zugriff (Anon Key) Regeln: Nutzer auf Mandant begrenzen. Hier Dummy-Policies (ALLOW NONE) – bitte konkretisieren.
create policy "no anon by default" on clients for all to public using (false);
create policy "no anon by default" on areas for all to public using (false);
create policy "no anon by default" on users_incanto for all to public using (false);
create policy "no anon by default" on work_orders for all to public using (false);
create policy "no anon by default" on time_entries for all to public using (false);
create policy "no anon by default" on portal_tokens for all to public using (false);

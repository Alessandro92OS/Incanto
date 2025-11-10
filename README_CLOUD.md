# Incanto Ops+ Cloud v4 (Preview)

**Was ist neu?**
- Einheitliches Layout, **rollenbasierte Navigation** (nur relevante Funktionen sichtbar).
- **Logo** (dein SVG) in Header/Login/Portal und in Icons (PNG, falls möglich).
- **Supabase‑Vorbereitung**: `config.js`, `sync.js`, SQL‑Schema + RLS‑Skeleton.
- **Kundenportal (online)**: `portal.html?token=...&from=YYYY-MM-DD&to=YYYY-MM-DD` (liest freigegebene Daten).

## Deploy
1. Dateien in dein GitHub‑Repo (Root) hochladen: `index.html`, `style.css`, `app.js`, `config.js`, `sync.js`, `sw.js`, `portal.html`, `portal.js`, `manifest.webmanifest`, Ordner `icons/`, `.nojekyll`.
2. GitHub Pages aktivieren. URL öffnen.
3. **Login**: Admin‑PIN setzen → Mitarbeiter anlegen.

## Logo
- Dein Logo liegt in `icons/incanto.svg` und wird überall genutzt.
- iOS‑Homescreen benötigt PNG‑Icons. Wenn die Automatik dein SVG nicht rendern kann, bitte eine **PNG 512x512** schicken – ich ersetze die Icons sofort.

## Cloud‑Sync (Supabase)
1. Supabase‑Projekt anlegen (EU‑Region).  
2. SQL im Supabase SQL Editor ausführen: `supabase_schema.sql`, dann **Policies** in `supabase_policies.sql` anpassen und ausführen.  
3. In **Einstellungen** der App `URL` und `Anon Key` speichern.  
4. `Online‑Portal`: `portal.html?token=<PORTAL_TOKEN>&from=2025-01-01&to=2025-01-31`

> Hinweis: Die Policies sind **Bewusst restriktiv (deny all)**. Bitte anpassen (Mandanten‑Isolierung via `client_id`, Rollenrechte), dann schalte ich dir gern konkrete RLS‑Beispiele frei.

## Rollen (sichtbare Tabs)
- **Putzkraft**: Einsätze, Timer, Einträge, Aufgaben.  
- **Personalmanagement**: Einsätze, Einträge, Aufgaben, Arbeitsbereiche, Kundenportal, Export.  
- **Geschäftsführung (Admin)**: alle Tabs inkl. Admin & Einstellungen.

## Exporte (Deutsch)
- CSV: Semikolon, `de-DE`‑Datum, UTF‑8‑BOM, Spalten **Deutsch** inkl. „Genehmigt“, „Freigegeben“.

— Incanto

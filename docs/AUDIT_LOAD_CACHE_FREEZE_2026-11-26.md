# RuinExpose — Auditoría de carga, caché y congelamiento

**Fecha:** 2026-11-26 (America/Bogota)  
**Branch:** `cursor/audit-load-cache-freeze-16d1`  
**Alcance:** No se modificó economía de monedas, pagos, publicaciones ni lógica comercial.

---

## 1. Causa raíz encontrada

Los síntomas (“funciona en incógnito / a veces no carga / se congela a mitad / no se puede navegar”) no tenían una sola causa. La auditoría midió producción y el cliente y aisló **tres causas raíz concurrentes**:

### R1 — Worker de Cloudflare responde 404 en ~8–9s (crítico)

Mediciones desde este entorno (2026-11-26):

| Endpoint | HTTP | Tiempo |
|----------|------|--------|
| `/feed?limit=1` | 200 | ~0.15s |
| `/avatars?users=…` | **404** | **~8.5–8.7s** |
| `/notifs?to=…` | 200 | **~8.1s** |
| `/ledger`, `/wallet/list` | 404 | **~8–11s** |
| Rutas desconocidas | 404 | **~8s** |

El cliente llamaba `GET /avatars` **sin timeout** desde `prefetchAvatars()` en cada paint del feed. El primer 404 dejaba la UI esperando ~9s (sensación de “congelado” / carga a mitad). El flag `__cfAvatarsDead` solo se activaba **después** de ese hang.

Incógnito “funcionaba” más a menudo porque no tenía Cache Storage / SW viejo **y** porque sesiones frías evitaban algunos prefetch; el hang de `/avatars` seguía afectando a perfiles normales al pintar el feed.

### R2 — Rutas SPA sin política `no-store` (alto)

Producción (Cloudflare → Vercel):

| Ruta | Cache-Control | CDN-Cache-Control | x-vercel-cache |
|------|---------------|-------------------|----------------|
| `/`, `/index.html` | `no-store` | `no-store` | HIT (age ~2h) |
| `/wall`, `/feed`, `/profile`, … | **`public, max-age=0, must-revalidate`** | **ausente** | HIT |

Misma HTML, políticas distintas. Bookmarks / refresh en `/wall` / `/profile` podían recibir documentos con cabeceras más débiles que `/`, facilitando HTML obsoleto tras deploys (JS/CSS van **inline** en el monolito → cualquier HTML viejo = app vieja completa).

### R3 — Scripts CDN bloqueantes en `<head>` + capas fantasma (medio)

- `@supabase/supabase-js` y `tus-js-client` en `<head>` (sync) bloqueaban el parseo **antes** de pintar el age-gate.
- Ya existían mitigaciones de SW no-op y `releaseInteractionBlockers`, pero faltaba watchdog periódico + recuperación ante `unhandledrejection`, y `showPanel` no limpiaba overlays al navegar.

### R4 — Wall vacío en carga fría de `/wall` (alto)

CF `/feed` a menudo devuelve `posts: []` mientras Supabase sí tiene contenido. `loadNormalFeed`:

1. Pintaba vacío y **escribía** `rs_wall_cache = []` (envenenaba caché).
2. El merge SB mutaba el **mismo** array y luego comprobaba `merged.length > normalFeedPosts.length` → siempre falso → **nunca repintaba**.
3. El `select` del merge pedía `media_url` / `thumb_url` / `media_type` / `comments_count` → **HTTP 400** (`column posts.media_url does not exist`) → el catch devolvía lista vacía y el Wall se quedaba en “No posts yet” / “Loading the wall…”.

Por eso `/wall` directo fallaba mientras navegar al Wall tras un feed ya hidratado (u otra caché) a veces sí mostraba posts.

### Ya mitigado (confirmado, no regresionado)

- Service Worker interceptando navegaciones → `sw.js` no-op + recovery in-place (sigue vigente).
- Overlay Telegram invisible bloqueando taps (fix #163).
- `getSession` / recovery sin timeout (auditoría 2026-11-25).

---

## 2. Archivos y configuraciones modificados

| Archivo | Cambio |
|---------|--------|
| `vercel.json` | `no-store` + `CDN-Cache-Control` + `Cloudflare-CDN-Cache-Control` + `Surrogate-Control` en **todas** las rutas SPA document + `/build.json` + refuerzo `/`, `/index.html`, `/sw.js` |
| `build.json` | **Nuevo** — sonda ligera de versión (`build: 202611262259`) |
| `index.html` | Meta `rs-app-build`; CDN movidos tras age-gate + fallback unpkg; timeout en `/avatars` y pin board; soft update; watchdog; error recovery; `showPanel` limpia blockers |
| `scripts/test-load-cache-freeze-audit.js` | **Nuevo** — guards estáticos |
| `scripts/test-load-cache-browser-e2e.js` | **Nuevo** — matriz headless Chrome |
| `docs/AUDIT_LOAD_CACHE_FREEZE_2026-11-26.md` | Este informe |

**No tocados:** `api/fc-spend.js`, precios, roulette, delete-post commercial paths, schema Supabase.

---

## 3. Correcciones implementadas

1. **Caché por tipo de recurso**
   - Documentos HTML / SPA / `sw.js` / `build.json` → `no-store` (browser + CDN + Cloudflare + Surrogate).
   - Media R2 / assets inmutables → sin cambio (siguen `immutable` en workers).
   - Sitemap / robots → TTLs públicos existentes.

2. **Versionado / actualización segura**
   - `meta rs-app-build` + `window.__RS_APP_BUILD` + `/build.json`.
   - `checkAppFreshness()` compara build remoto; **un** reload por tab life si hay deploy nuevo (no borra sesiones).

3. **Service Worker**
   - Se mantiene el patrón no-op + update in-place + unregister (sin `?v=`).

4. **Recuperación automática**
   - `prefetchAvatars`: `fetchWithTimeout(2500)` + dead-flag inmediato ante 404/abort.
   - `loadPublicPins` / `retirePinBoardNotifs`: timeout 4.5s.
   - `armInteractionWatchdog` cada 2.5s + `visibilitychange` / `pageshow` (bfcache).
   - `armGlobalErrorRecovery` en `error` / `unhandledrejection`.
   - `showPanel` llama `releaseInteractionBlockers` antes de cambiar sección.
   - Boot rescue + feed safety net existentes se conservan.

5. **CDN**
   - Libs fuera de `<head>`; fallback `unpkg` vía `document.write` si jsDelivr falla.
   - Age-gate puede pintar antes de esperar la RTT del CDN.

6. **Wall cold `/wall`**
   - No escribir caché vacía; comparar longitud **antes** del merge SB; boot fuerza `refreshWallSection` en rutas wall/explore.

---

## 4. Pruebas realizadas

| Prueba | Resultado |
|--------|-----------|
| `scripts/test-load-cache-freeze-audit.js` | Pass |
| `scripts/test-load-cache-browser-e2e.js` | Pass |
| `scripts/test-sw-kill-incognito-blank.js` | Pass |
| `scripts/test-feed-loading.js` | Pass |
| `scripts/test-js-syntax.js` | Pass |
| `scripts/test-auth-nav-freeze.js` (static + browser) | Pass |
| `scripts/test-password-recovery-freeze.js` | Pass |
| Curl producción (diagnóstico pre-fix) | Headers SPA débiles + CF `/avatars` 8.7s confirmados |
| Headless Chrome first visit | Age gate / app pinta |
| Headless Chrome return visit (`rs_age_ok`) | App auto-enter; feed **no** stuck en Loading |
| Headless Chrome ghost overlay | Blockers liberan pointer-events |
| Headless Chrome `/wall` SPA | Documento carga con app |

### Matriz de navegadores (este entorno)

| Escenario | Resultado | Notas |
|-----------|-----------|-------|
| Chrome normal (perfil persistente simulado) | Pass | Return visit + feed |
| Chrome “incógnito” (perfil temp limpio) | Pass | First visit |
| Safari normal / privado | **Pendiente device lab** | Sin WebKit/Safari en el VM |
| Móvil real iOS/Android | **Pendiente post-deploy** | Viewport headless OK |
| Usuario registrado | Pass parcial | Shell local + auth paths no rotos; login E2E email no ejecutado aquí |
| Usuario sin sesión | Pass | Guest feed paints |

---

## 5. Problemas pendientes (owner / infra)

1. **Reparar o retirar rutas muertas del Worker CF** (`/avatars` 404 lento; catch-all ~8s). El cliente ya no se cuelga, pero el Worker sigue quemando tiempo en llamadas admin/legacy (`/ledger`, etc.).
2. **Acelerar `/notifs`** (~8s en 200) — afecta Spotlight / pin board; el cliente ahora corta a 4.5s.
3. **Device lab real** Safari iOS + Chrome Android + Telegram WebView tras merge.
4. **`manifest.webmanifest` / iconos** → 404 en producción (PWA); no causa el freeze, pero conviene añadirlos.
5. Vercel aún reporta `x-vercel-cache: HIT` con `age` alto incluso en `no-store` (artefacto de edge del deployment). Las cabeceras nuevas + `build.json` mitigan skew; purge de zona CF tras deploy sigue siendo buena práctica operativa.

---

## 6. Criterios de “solucionado”

| Criterio | Estado tras este PR |
|----------|---------------------|
| Abrir completo, no a mitad | Mitigado (timeouts + rescue + CDN reorder) — validar en prod |
| No depender de incógnito | Mitigado (SW no-op + avatars timeout + cache SPA) |
| No congelar al navegar | Mitigado (watchdog + showPanel blockers) |
| Perfiles / inicio / posts / buscador | Sin cambios de lógica; nav guards reforzados |
| Sesiones | Soft reload no limpia storage; auth timeouts previos intactos |
| Recuperación de red | Timeouts + dead-flags + rescue UI |
| Actualización en nuevo deploy | `build.json` soft update |

---

## 7. Cómo verificar en producción tras merge

1. Hard refresh en `/`, `/wall`, `/profile` → Response headers deben incluir `CDN-Cache-Control: no-store` y `Cloudflare-CDN-Cache-Control: no-store`.
2. `GET /build.json` → JSON con `build` y `no-store`.
3. DevTools Network: `/avatars` debe abortar ≤2.5s o no reintentarse tras el primer fallo.
4. Safari normal + Chrome normal: primera visita, segunda visita, y tras un deploy nuevo (debe soft-reload una vez).

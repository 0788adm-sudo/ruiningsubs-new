# RuinExpose — Auth / Profile / Perf Audit

**Date:** 2026-11-25 (America/Bogota)  
**Branch:** `cursor/audit-auth-profile-perf-6f3e`  
**Backup:** `backups/audit-2026-11-25/` (gitignored)

---

## 1. Qué causaba el bloqueo al recuperar contraseñas

Causa principal: `checkRecoveryHash` abría la UI y **borraba el hash `#access_token…&type=recovery` antes de confirmar** que Supabase hubiera establecido la sesión de recuperación. En Safari / Chrome móvil / WebView de Telegram eso dejaba `updateUser({password})` sin sesión válida → la promesa quedaba pendiente y la UI se congelaba en **Step 1/2 — Updating password… / Saving…**.

Factores adicionales:

- Sin timeout en `updateUser` / `resetPasswordForEmail` / `getSession`
- Sin verificación de sesión antes de guardar
- Sin manejo de enlaces vencidos / ya usados / errores en la URL
- Doble tap podía reenviar mientras la petición colgaba

## 2. Qué se corrigió en Supabase Auth (cliente)

- `ensureRecoverySession` + `applyRecoveryTokensFromUrl` (`setSession` / `exchangeCodeForSession`)
- Solo se limpian tokens de la URL **después** de sesión confirmada
- `sbAuthTimeout` en login, register, forgot, update password, signOut, getSession
- Confirmación solo si `updateUser` devuelve `data.user`
- Estados de error claros + botón **Request a new reset link**
- Guards `__rs_saving_pass` / `__rs_forgot_busy`

No se cambiaron claves, RLS ni el esquema de Auth.

## 3. Cómo quedó el cambio de username

- Disponibilidad **case-insensitive** (`ilike`) en cliente + servidor
- Indicador en vivo al escribir
- Preferencia de `UPDATE profiles … WHERE user_id = …` (no crea cuenta clon)
- `rename_username` en `/api/game-play` rechaza `username_taken` (409)
- Migración por `user_id`; el handle anterior se libera; posts/comentarios/etc. siguen al ID permanente

## 4. Personalización del perfil

- Formulario sacado de debajo de `#my-posts`
- Modal `#edit-profile-modal` (sheet oscuro, móvil)
- **Edit profile** abre el modal; Save/Cancel/backdrop lo cierran y vuelven al perfil
- Username, bio, detalles, foto, cover, redes conservados

## 5. Pantallas blancas / cargas infinitas

Causas históricas ya mitigadas (SW interceptando fetch) + gaps restantes:

- `getSession` sin timeout podía retrasar identidad
- Failsafe de age-gate a 4s no recuperaba feed atascado en “Loading…”

## 6. Optimizaciones

- Timeout 9s en `getSession` al boot (no bloquea first paint)
- Failsafe a 3.5s / 9s con **Retry feed**
- Timeouts en auth; feed ya usaba `sbQueryTimeout` / paint progresivo

## 7. Pruebas

| Test | Resultado |
|------|-----------|
| `scripts/test-js-syntax.js` | Pass |
| `scripts/test-username-identity-sync.js` | Pass |
| `scripts/test-audit-auth-profile-perf.js` | Pass |
| `scripts/test-sw-kill-incognito-blank.js` | Pass |
| `scripts/test-feed-loading.js` | Pass |
| `scripts/test-audit-controlled-fixes.js` | Pass |
| Envío real de email de recovery / login post-cambio | Pendiente en producción (sin mailbox en CI) |
| Telegram / Safari / Chrome device lab | Pendiente verificación post-deploy |

## 8. Pendientes

1. Validar recovery end-to-end en producción (email → Telegram WebView → nueva contraseña → login)
2. Índice único `lower(username)` en `profiles` (opcional; no aplicado para no tocar esquema sin necesidad)
3. Device lab real iPhone Safari / Android Chrome / Telegram tras merge

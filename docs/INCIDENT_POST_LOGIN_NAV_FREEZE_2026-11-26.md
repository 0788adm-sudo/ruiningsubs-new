# INCIDENTE — Navegación congelada tras login (Safari iPhone)

**Fecha:** 2026-11-26 (America/Bogota)  
**Branch:** `cursor/fix-post-login-nav-freeze-82b1`  
**Síntoma:** Login OK → My Profile pinta → bottom nav visible → taps a Wall / GoonTok / Explore / Create / Home no responden. A veces barra de progreso de Safari queda colgada.

---

## 1. Causa raíz exacta

Varios mecanismos se sumaban. El más crítico tras #163/#165:

### A — `client.navigate()` desde el Service Worker (crítico)

`sw.js` en activate hacía `client.navigate(client.url)` para salir de documentos en blanco. En Safari iPhone eso inicia una navegación de documento **mientras el SPA ya está pintado** → barra de carga stuck + la página deja de recibir taps (perfil visible, nav muerto).

### B — Residual de #163: `animation:forwards` en `#modal-tg-group`

#163 puso `opacity:1` en `.show`, pero mantuvo `animation:tgGroupIn … forwards` animando opacity en el root fullscreen. Si WebKit se queda en `from{opacity:0}`, el layer sigue con `pointer-events:auto` e invisible sobre el bottom nav (z=8010 > 5000).

### C — Rescue fullscreen sobre `#app` pintado (#165)

`rescueBlankShell` montaba `#rs-boot-rescue` (z≈2e9) cuando `#app.show` y el feed aún decía “Loading…”, cubriendo cualquier panel (incluido Profile).

### D — Latch de gesto + `rsTapWasScroll` en bottom nav

Tras dismiss del teclado de login, deltas >12px marcaban `moved=true` y el nav tragaba pointerup/click.

---

## 2. Por qué #163 no resolvió el reporte

- Solo atacó el shield invisible del invite de Telegram.
- No quitó la animación de opacity del root (residual).
- No corrigió `client.navigate` del SW (introducido/reforzado en #165).
- Login solo hacía `releaseInteractionBlockers({})` (ghost-only), no `force`.
- El rescue de blank-screen podía cubrir una app ya usable.

---

## 3. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `sw.js` | Sin force-navigate; solo `postMessage` + claim |
| `index.html` | Sin animación opacity en tg-group root; side-menu `pointer-events:none` cerrado; rescue no cubre `#app`; login/`SIGNED_IN` `force:true`; probe `elementFromPoint`; gesture clear; nav ignora latch global |
| `build.json` | `202611270115` |
| Tests | Guards + flujo Profile→Wall→GoonTok→Explore→Feed |

**No tocado:** monedas, pagos, borrados, publicación, reglas de negocio.

---

## 4. Pruebas

| Test | Resultado |
|------|-----------|
| `scripts/test-auth-nav-freeze.js` (static + browser) | PASS — navFlow wall/goontok/explore/feed |
| `scripts/test-blank-screen-rootfix.js` | PASS |
| `scripts/test-sw-kill-incognito-blank.js` | PASS |
| `scripts/test-load-cache-freeze-audit.js` | PASS |
| `scripts/test-load-cache-browser-e2e.js` | PASS |
| `scripts/test-auth-shell-smoke.js` | PASS |
| `scripts/test-password-recovery-freeze.js` | PASS |
| `scripts/test-auth-mobile-nav.js` | PASS |
| Device lab Safari/Chrome real | Pendiente post-deploy |

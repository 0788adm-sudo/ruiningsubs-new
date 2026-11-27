# INCIDENTE — Pantalla blanca (Safari) / negra (Chrome) en iPhone

**Fecha:** 2026-11-26 (America/Bogota)  
**Branch:** `cursor/blank-screen-rootfix-16d1`  
**Evidencia usuario:** Safari blanco + barra ~25%; Chrome negro + carga incompleta; **Incógnito sí carga**.

---

## 1. Causa raíz exacta

Hay **dos mecanismos** que juntos explican las capturas y la diferencia Incógnito vs normal:

### Causa A — Service Worker que intercepta navegaciones (crítico)

Un SW antiguo con `fetch` + `respondWith` sintético (o colgado) entrega un documento vacío (`<body style="background:#050506">` o respuesta que nunca completa).

| Navegador | Síntoma |
|-----------|---------|
| Chrome normal | Pantalla negra (fondo del documento vacío) |
| Safari normal | Pantalla blanca / carga a ~20–25% (navegación interceptada) |
| Incógnito | Sin SW → HTML real → funciona |

**Reproducción automática:** `scripts/test-blank-screen-rootfix.js` instala un blank SW y obtiene `text:""`, `hasGate:false`.

El HTML de recuperación del PR #164 **nunca llega** a esos clientes mientras el SW siga sirviendo el documento vacío. Por eso mitigaciones “dentro de index.html” no bastaban solas.

### Causa B — First paint bloqueado + auto-enter a `#app` vacío (agravante)

1. Google Fonts era **render-blocking** en `<head>` → Safari puede quedarse blanco hasta timeout.
2. CDN sync / `document.write` podían colgar el parser o vaciar el documento.
3. Con `rs_age_ok=1` (visita recurrente), `enterSite()` ocultaba el age-gate y mostraba `#app` vacío → **Chrome negro** hasta que boot pintara (si CDN/JS no terminaban, nunca).

---

## 2. Condición que reproduce el problema

```
1. Perfil normal con Service Worker que intercepta mode=navigate
2. Abrir ruinexpose.com
3. Resultado: documento vacío (negro/blanco), progress stuck
4. Mismo dispositivo en Incógnito: carga OK
```

Secundario (sin SW):

```
1. localStorage.rs_age_ok = "1"
2. CDN o fonts colgados / lentos
3. Age-gate oculto, #app vacío → pantalla negra
```

---

## 3. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `sw.js` | No-op + `clients.claim()` + postMessage (no force-navigate — that froze Safari taps) |
| `index.html` | CSS crítico inline; fonts async; age-gate con estilos inline; CDN async sin document.write; `ensureSbClient`; boot trace; enterSite pinta “Loading…”; rescue más rápido (1.2s+) |
| `build.json` | `202611262331` |
| `vercel.json` | `Clear-Site-Data: "cache"` en HTML/SW (no `storage` → sesiones intactas) |
| `scripts/test-blank-screen-rootfix.js` | Repro + guards |
| Tests SW / load-cache | Claves v3, sin document.write |

**No tocado:** pagos, monedas, publicaciones, saldos.

---

## 4. Prueba antes / después

| Escenario | Antes | Después (local) |
|-----------|-------|-----------------|
| Blank SW navigate | Documento vacío | Repro confirmado; no-op + navigate recupera en siguiente ciclo |
| Return visit `rs_age_ok` | Riesgo `#app` negro vacío | `alive:true`, feed pinta, trace: `head-start→cdn→sb-ready→enterSite` |
| Fonts colgados | Safari blanco | CSS crítico + fonts `media=print` |
| Incógnito | OK | OK (sin regresión) |

Comando: `node scripts/test-blank-screen-rootfix.js` → PASS.

---

## 5. Confirmación en producción

Tras merge + deploy Vercel, verificar en iPhone **normal** (no incógnito):

1. `GET /build.json` → `"build":"202611262331"`
2. HTML contiene `rs-critical-paint` y `rs_sw_recovered_v3`
3. Headers HTML incluyen `Clear-Site-Data: "cache"`
4. Safari + Chrome: age-gate o feed visibles (no blanco/negro eterno)
5. Segunda visita con sesión: no pantalla negra vacía

**Hasta que eso se vea en dispositivo real, el incidente no se declara cerrado en prod.**

---

## 6. Pendiente en dispositivos reales

- [ ] Safari iPhone normal (recurrente)
- [ ] Chrome iPhone normal (recurrente)
- [ ] Safari / Chrome privado (control)
- [ ] Usuario logueado vs visitante
- [ ] Si un dispositivo sigue en blanco: `localStorage.rs_boot_trace` (diagnóstico sin borrar sesión)

---

## 7. Nota operativa

Si un usuario sigue atrapado con un SW que nunca cede la navegación, una sola visita tras el deploy debería:

1. Browser update-check de `/sw.js` (bypass) → instala no-op  
2. `skipWaiting` + `claim` + `client.navigate` → recarga por red  
3. `Clear-Site-Data: cache` limpia Cache Storage sin tocar localStorage/sesiones  

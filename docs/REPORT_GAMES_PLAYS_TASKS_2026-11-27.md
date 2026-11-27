# Informe — Sistema de juegos, intentos, tareas y puntos

Fecha: 2026-11-27 (America/Bogota)

## Resumen

Se unificó la compra de intentos (10 Coins → 10 plays) en Triki, Exposure Dice y Roulette con modal `OUT OF FREE PLAYS?`, se eliminó Custom 30 Options, y se añadió un catálogo expandable de tareas + economía de puntos (separada de Coins) con panel admin y scaffolding de recompensas de exposición (desactivado).

## Archivos modificados / creados

| Archivo | Cambio |
|---------|--------|
| `index.html` | Modal de compra, UI Free/Purchased, secciones YOUR TASKS, catálogo/puntos cliente, admin Game tasks, eliminación Custom 30 |
| `api/game-play.js` | Custom 30 deshabilitado (`custom_removed`); packs intactos |
| `api/game-tasks.js` | **Nuevo** — catálogo, select/submit, puntos, admin review, rewards scaffold |
| `migrations/20261127_game_tasks_points.sql` | **Nuevo** — tablas opcionales mirror |
| `scripts/test-games-plays-tasks-system.js` | **Nuevo** — suite estática |
| `scripts/test-fc-hot-games.js` | Actualizado (Custom 30 removed / modal) |
| `scripts/_patch-games-tasks.js` | Script one-shot de parche (histórico) |

## Tablas creadas (migración opcional)

- `game_task_catalog`
- `game_task_progress`
- `game_points_ledger`
- `game_reward_defs` (enabled/published = false por defecto)
- `game_reward_redemptions`

Runtime primario: boards CF (`__GAME_TASK_CATALOG__`, `__GAME_TASK_PROGRESS__`, `__GAME_POINTS__`, `__GAME_REWARD_DEFS__`).

## Funciones nuevas (principales)

**Cliente:** `openGamePackModal`, `confirmGamePackPurchase`, `renderGameTasksSection`, `selectCatalogTask`, `apiGameTasks`, `creditLocalPoints`, admin `adminLoadGameTaskCatalog`, `adminSaveGameTask`, `adminLoadPendingTaskProofs`, `adminLookupUserPoints`, `adminLoadRewardDefs`.

**API `/api/game-tasks`:** `list_catalog`, `select_task`, `submit_proof`, `my_points`, admin `create_task` / `update_task` / `deactivate_task` / `approve_submission` / `reject_submission` / `user_points` / `list_rewards` / `set_reward`. Redeem → `403 rewards_disabled`.

## Cambios por juego

1. **Triki** — Modal de compra al agotar free; Free/Purchased visibles; YOUR TASKS bajo el menú (no interrumpe partida).
2. **Dice** — Mismo pack 10/10; Custom 30 eliminado; YOUR TASKS bajo resultados.
3. **Roulette** — Modal + unlock box; Custom 30 eliminado; catálogo + pending tasks bajo la rueda.

## Pruebas realizadas

- `node scripts/test-games-plays-tasks-system.js`
- `node scripts/test-fc-hot-games.js`
- `node scripts/test-game-play-free-uses.js`
- `node scripts/test-game-tasks-unify.js`
- `node scripts/test-anon-roulette-pack-purchase.js`
- `node scripts/test-roulette-wall-payments.js`
- `node scripts/test-js-syntax.js`
- `node -c api/game-play.js` / `api/game-tasks.js`

Escenarios cubiertos estáticamente: modal, packs idempotentes, Custom 30 ausente, tareas no consumen plays, puntos sin doble crédito, rewards off, Coins/shop intactos.

## Problemas encontrados

- La compra de packs ya existía vía `buy_pack` + `confirm()`; el gap real era UX (modal) + Custom 30 + catálogo/puntos server-side.
- Tareas de catálogo usan boards CF + localStorage; la migración Supabase es mirror opcional (mismo patrón que juegos previos).
- Aprobación de puntos requiere admin bearer; sin admin, pruebas quedan en PENDING REVIEW (correcto).

## Confirmación de alcance

**No se alteraron:** recargas de Coins, Wall, Feed, autenticación, ni economía comercial fuera de packs de juegos. Custom 30 se eliminó a propósito. Recompensas de exposición pública **no activadas**.

## Seguimiento — pagos externos $5 (PayPal / Throne)

El modal de cobro de cada juego incluye PayPal $5, Throne $5 y **YA PAGUÉ — RECLAMAR**. La solicitud llega al admin (Supabase + CF notifs + `/requests`) con usuario, juego y hora (Bogotá). Botones **APROBAR** (acredita 10 intentos al instante vía `grant_pack` por juego) y **ELIMINAR**.

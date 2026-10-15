# Spec 13 — Dashboard

> **Estado: IMPLEMENTED.** Las decisiones `DSH-1` a `DSH-12` de §2 y las cuestiones
> `A-1` a `A-4` de §13 quedaron **cerradas e implementadas**: todo miembro activo ve
> agregados de la comunidad (A-1), las finanzas son solo para `ADMIN` (A-2), las
> listas se cortan a 5 (A-3) y la serie de reservas agrupa por mes (A-4). Este spec
> usa la nomenclatura **DSH-1 a DSH-12**. El endpoint
> `GET /api/v1/communities/:communityId/dashboard` está detrás de la función
> `SECURITY DEFINER` `app_community_dashboard()` y cubierto por el test
> `backend/src/__tests__/dashboard.api.integration.test.ts`.
> **Fase:** 13 (agregados de la home de una comunidad: KPIs + series para
> Recharts). Precedida de `01-authentication` … `12-external-apis`.
> **Base de datos:** `supabase/sql/01_schema.sql` y `02_rls.sql` **no se tocan**:
> el dashboard **no crea tablas**. Añade una función `SECURITY DEFINER` en
> **`02n_dashboard.sql`** (archivo nuevo, en este bloque) que agrega datos de las
> tablas que ya existen.
> **Backend:** `backend/src/dashboard/`.
> **Fuera de alcance:** el frontend (páginas React, componentes Recharts), las
> notificaciones (§14, bloque propio) y el servidor MCP/agents. Ver §17.
>
> Este spec define **los datos de la pantalla de inicio** de una comunidad: los
> KPIs que pide el enunciado §7.1 (vecinos, incidencias abiertas y pendientes,
> reservas próximas, últimos avisos, gastos y próximas votaciones) más las
> **series** que alimentan los gráficos de Recharts. La decisión de fondo es
> **DSH-1: la home es una sola pantalla y una sola petición**; y **DSH-2: contar
> no es leer**, es decir, el dashboard expone **agregados** de la comunidad a
> cualquier miembro activo pero **nunca filas** que las políticas de RLS le
> esconderían, y la información financiera queda **solo para `ADMIN`** (DSH-3).

---

## 1. Objetivo

Que al abrir una comunidad el usuario vea, de un vistazo y en **una única
llamada**, el estado de su comunidad: cuántos vecinos hay, cómo están las
incidencias, qué reservas vienen, los últimos avisos, el gasto del periodo y las
votaciones abiertas; y que el frontend pueda pintar los gráficos de Recharts con
las **series** que devuelve esa misma llamada, sin pedir métricas por separado.

El dashboard es **de solo lectura**. No crea, modifica ni borra nada, no audita y
no genera notificaciones.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| **DSH-1** | **Un solo endpoint** `GET /api/v1/communities/:communityId/dashboard` que devuelve todos los KPIs y todas las series | Un endpoint por widget (`/dashboard/incidents`, `/dashboard/finance`, …) | La home es una pantalla: N llamadas convierten la primera carga en N+1 peticiones y N+1 estados de error. Con una sola respuesta, la pantalla tiene un único estado de carga y uno de error |
| **DSH-2** | **Contar no es leer.** El dashboard expone **agregados** de la comunidad (nº de incidencias por estado, nº de vecinos, nº de reservas, votaciones abiertas, últimos avisos, próximas reservas) a **cualquier miembro activo**, pero **nunca filas** de recursos que RLS le ocultaría. La invisibilidad de una incidencia concreta (spec 04) se mantiene | Reutilizar el listado de incidencias (RLS por rol) y contar en el cliente | Para un `NEIGHBOR` el listado solo trae **sus** incidencias; un "12 incidencias abiertas" sobre eso sería falso. Contar la comunidad entera es información del barrio, no la ficha de una incidencia ajena |
| **DSH-3** | La información **financiera** del dashboard (`gastos`, `facturas`) va **solo** a `ADMIN`. Para el resto, `finance` viaja `null` | Dársela a `PRESIDENT` "como en la tabla de §5" | El bloque 09 hizo las finanzas **solo `ADMIN`** (FN-1), listar incluido, y su RLS es `expenses_admin_only`. La tabla §5 de `ARCHITECTURE.md` ("PRESIDENT: resumen") quedó sin implementar; el dashboard **no** la reabre aquí. Reconciliar esa discrepancia es un cambio de permisos, no de dashboard |
| **DSH-4** | Se implementa en **una función `SECURITY DEFINER`** `app_community_dashboard(p_community_id, p_from, p_to) → jsonb`, `STABLE`, `search_path` fijo, con su propio guard de pertenencia dentro | Agregar en TypeScript con varias consultas | La visibilidad por rol (finanzas) y la lectura por encima de RLS (agregados de incidencias) son decisiones de seguridad: van **dentro del motor**, como en todos los bloques. Una sola ida a la base de datos y una sola copia de la regla |
| **DSH-5** | **Series por defecto: últimos 12 meses.** `?from`/`?to` opcionales (fecha ISO `YYYY-MM-DD`) recortan la ventana de las series y de los KPI de periodo | Solo rango fijo | Recharts necesita un eje temporal; 12 meses es un default sensato y el rango pedido lo puede ajustar el frontend |
| **DSH-6** | El **guard de pertenencia** de la función exige miembro `ACTIVE`; si no, `42501` (→ `403`). El `communityId` es un dato del cliente y se valida contra la pertenencia real (C-8), como en el resto | Confiar en el `requireCommunity()` de la ruta | El chequeo de ruta es el grueso; la función lo repite porque es `SECURITY DEFINER` y no puede asumir que se llegó por ahí |
| **DSH-7** | "Incidencias **abiertas**" = `status = 'OPEN'`; "**en curso**" = `IN_PROGRESS`; "**pendientes**" = `OPEN` **sin `assigned_to_id`**. `critical` = prioridad `CRITICAL` y estado no `RESOLVED`/`CANCELLED`. Todas excluyen `deleted_at is not null` | "abiertas" = no cerradas | El enunciado §7.1 distingue "abiertas" y "pendientes"; mapearlas a `OPEN` / `OPEN sin asignar` da a cada una un significado distinto y accionable, en vez de dos veces lo mismo |
| **DSH-8** | "**Vecinos**" = `community_members` con `status = 'ACTIVE'` y `role <> 'PROVIDER'` (el `PROVIDER` no vive en la comunidad). Se expone además `memberCount` (todos los `ACTIVE`) | Contar todos los `ACTIVE` | "Número de vecinos" son residentes; un proveedor asignado no es un vecino |
| **DSH-9** | "**Próximas reservas**" = `CONFIRMED`/`PENDING` con `starts_at >= now()`, de la comunidad, top 5 por `starts_at` ascendente. Van con nombre de zona y de vecino (la agenda es comunitaria, R-5); **sin `notes`** | Incluir `notes` | R-5 ya decidió que `notes` es privada. El dashboard repite esa regla, no la re-litiga |
| **DSH-10** | "**Últimos avisos**" = 5 más recientes **vigentes** (`deleted_at is null` y no caducados), `is_pinned` primero | Todos los avisos | La home muestra lo vigente; un aviso caducado en el dashboard es ruido |
| **DSH-11** | "**Próximas votaciones**" = `status = 'OPEN'` con `ends_at >= now()`, top 5 por `ends_at`; **sin recuento de votos** en el dashboard | Incluir resultados parciales | Los resultados tienen su propio endpoint con su `result_visibility` (bloque 10); el dashboard no adelanta lo que esa regla controla |
| **DSH-12** | **Sin caché y sin auditoría.** Los agregados son lecturas baratas con los índices existentes; el dashboard no escribe | Cachear el jsonb o auditar la lectura | Añadir caché sin medir primero es optimizar a ciegas; y auditar una lectura de home llenaría `audit_logs` de ruido sin valor forense |

---

## 3. Estado real del modelo de datos

**Este bloque no crea ni modifica tablas.** Se apoya en lo que ya existe:

| Tabla | Columnas que usa el dashboard |
|---|---|
| `community_members` | `status`, `role` (vecinos, miembros) |
| `incidents` | `status`, `priority`, `category`, `assigned_to_id`, `deleted_at`, `created_at` |
| `reservations` | `status`, `starts_at`, `ends_at`, `common_area_id`, `user_id` |
| `common_areas` | `name` (nombre de zona en próximas reservas) |
| `announcements` | `title`, `type`, `priority`, `is_pinned`, `publish_at`, `expires_at`, `deleted_at` |
| `expenses` | `amount`, `expense_date`, `deleted_at` (solo `ADMIN`) |
| `invoices` | `amount`, `status`, `due_date`, `paid_at`, `deleted_at` (solo `ADMIN`) |
| `votes` | `status`, `ends_at`, `deleted_at` |

Enums usados (ya existen): `incident_status`, `incident_priority`,
`incident_category`, `reservation_status`, `announcement_type`,
`announcement_priority`, `vote_status`, `member_status`, `member_role`.

### 3.1 Función nueva (`02n_dashboard.sql`)

```
app_community_dashboard(p_community_id uuid, p_from date, p_to date)
  returns jsonb
  -- SECURITY DEFINER, STABLE (solo lee), search_path fijo ('public', 'pg_temp').
  -- Guard: app_current_user_id() no nulo y miembro ACTIVE de p_community_id;
  --        si no, raise exception ... using errcode = '42501'.
  -- El bloque `finance` se rellena solo si app_is_admin_of(p_community_id);
  --        si no, viaja como null (DSH-3).
  -- Devuelve SIEMPRE una fila (una única columna jsonb), con las series
  --        recortadas a [p_from, p_to] (por defecto, últimos 12 meses).
```

---

## 4. Alcance funcional

La respuesta cubre, para la comunidad del contexto:

- **Vecinos**: número de vecinos y de miembros activos.
- **Incidencias**: abiertas, en curso, pendientes, críticas; y series por estado
  y por categoría.
- **Reservas**: próximas (top 5) y su número; serie por mes.
- **Avisos**: últimos 5 vigentes.
- **Votaciones**: abiertas (top 5) y su número.
- **Finanzas** (solo `ADMIN`): gasto total y nº de gastos del periodo, importe
  pendiente y nº de facturas pendientes/vencidas; y serie de gasto por mes.

---

## 5. Modelo de datos y DTO

### 5.1 `DashboardView` (contrato con el frontend)

```ts
type DashboardView = {
  community: {
    id: string
    name: string
    city: string
    neighborCount: number        // ACTIVE, role <> PROVIDER (DSH-8)
    memberCount: number          // ACTIVE, todos los roles
  }
  incidents: {
    open: number                 // status = OPEN
    inProgress: number           // status = IN_PROGRESS
    pending: number              // OPEN sin assigned_to_id (DSH-7)
    critical: number             // priority = CRITICAL y no RESOLVED/CANCELLED
    byStatus:   { status: string; count: number }[]      // serie
    byCategory: { category: string; count: number }[]    // serie
  }
  reservations: {
    upcomingCount: number
    upcoming: {
      id: string
      commonAreaId: string
      commonAreaName: string
      startsAt: string
      endsAt: string
      status: string
      userId: string
      userName: string
    }[]
    byMonth: { month: string; count: number }[]          // serie (YYYY-MM)
  }
  announcements: {
    latest: {
      id: string
      title: string
      type: string
      priority: string
      isPinned: boolean
      publishAt: string
    }[]
  }
  votes: {
    openCount: number
    open: {
      id: string
      title: string
      endsAt: string
    }[]
  }
  finance: null | {                                     // solo ADMIN (DSH-3)
    expenseTotal: number
    expenseCount: number
    invoiceOpenAmount: number
    invoicePendingCount: number
    invoiceOverdueCount: number
    expensesByMonth: { month: string; total: number }[]  // serie (YYYY-MM)
  }
  generatedAt: string            // ISO 8601
  period: { from: string; to: string }   // ventana efectiva de las series
}
```

`finance` es `null` para todo rol que no sea `ADMIN`. Los importes son `number`
(no string): la función devuelve `jsonb` con números, no `numeric` crudo.

### 5.2 Series (para Recharts)

| Serie | Forma | Ventana |
|---|---|---|
| `incidents.byStatus` | `[{ status, count }]`, un punto por estado presente | `created_at` en `[from, to]` |
| `incidents.byCategory` | `[{ category, count }]` | `created_at` en `[from, to]` |
| `reservations.byMonth` | `[{ month: 'YYYY-MM', count }]` | `starts_at` en `[from, to]` |
| `finance.expensesByMonth` | `[{ month: 'YYYY-MM', total }]` | `expense_date` en `[from, to]` |

Sin huecos: si un mes no tiene filas, **no** aparece el punto (el frontend
rellena con 0 si le hace falta). No se inventan ceros en el backend.

---

## 6. API

### 6.1 `GET /api/v1/communities/:communityId/dashboard`

- **Auth:** `requireAuth` + `requireCommunity()` (cualquier miembro activo, todos
  los roles, `PROVIDER` incluido).
- **Query:** `from` (fecha ISO, opcional), `to` (fecha ISO, opcional). Default:
  últimos 12 meses hasta hoy.
- **200:** `{ data: DashboardView }`.
- **Errores:** `400 VALIDATION_ERROR` (fecha mal formada, `from > to`, o rango de
  más de 24 meses); `401 UNAUTHORIZED` sin sesión; `403 FORBIDDEN` comunidad ajena
  o inexistente (C-8).

No hay `meta` de paginación: es un objeto único.

---

## 7. Permisos

| Endpoint | Rol mínimo |
|---|---|
| `GET .../dashboard` | cualquier miembro activo |

El aislamiento lo impone `requireCommunity()` (grueso) **y** el guard de la
función (fino, dentro de la transacción). La única asimetría por rol está **dentro
de la respuesta**: `finance` es `null` salvo para `ADMIN` (DSH-3).

---

## 8. Errores

**No se añaden códigos nuevos.** Se reutilizan los existentes:

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `from`/`to` mal formadas, `from > to` o rango > 24 meses |
| `UNAUTHORIZED` | 401 | Sin sesión |
| `FORBIDDEN` | 403 | Comunidad ajena o inexistente (C-8) |

---

## 9. Configuración (env)

**Ninguna variable nueva.** El default de ventana (12 meses) y los topes de
listas (5) son constantes del bloque, no configuración de despliegue.

---

## 10. Validaciones y casos límite

1. `communityId` no-UUID → `400` (validación de ruta existente, C-9).
2. Comunidad ajena o inexistente → `403` (C-8), vía `requireCommunity`.
3. `from`/`to` mal formadas → `400`; `from > to` → `400`; rango > 24 meses → `400`.
4. Comunidad sin datos (sin incidencias, sin reservas, sin avisos) → **todo a
   cero y listas vacías**, con `200`; no es un error.
5. `NEIGHBOR`/`PROVIDER`/`PRESIDENT` → `finance: null`, el resto completo.
6. Mes sin datos en una serie → ese mes no aparece; no se rellena con `0`.
7. Incidencias `deleted_at is not null` → no cuentan.
8. Avisos caducados o borrados → no aparecen en `latest`.
9. Votación `OPEN` con `ends_at` ya pasado (no cerrada por el job/nadie) → no
   aparece como "próxima".
10. Reserva `CANCELLED` o pasada → no aparece en `upcoming`.
11. `PROVIDER` como miembro activo: cuenta en `memberCount`, **no** en
    `neighborCount` (DSH-8).
12. Importes grandes (`numeric`) → se devuelven como número, nunca como string.

---

## 11. Estructura del backend

```
backend/src/dashboard/
├── routes.ts         # GET /:communityId/dashboard (requireAuth + requireCommunity())
├── controller.ts     # traduce HTTP ↔ service
├── service.ts        # llama a app_community_dashboard y compone el DTO
├── repository.ts     # $queryRaw de la función (jsonb) bajo withContext
└── validators.ts     # zod de from/to (§10.3)
```

Montaje en `app.ts`: `app.use('/api/v1/communities', createDashboardRouter())`.

### SQL y scripts

- Nuevo `supabase/sql/02n_dashboard.sql` (una función `SECURITY DEFINER`,
  `STABLE`, `search_path` fijo; GRANT a `app_runtime`, revoke de `PUBLIC`;
  autocomprobación `do $$` como `02m`).
- `04_verify.sql`: nueva sección para la spec 13 (antes del INFORME) — la función
  existe, es `SECURITY DEFINER`, `STABLE`, `search_path` fijo, ejecutable por
  `app_runtime` y **no** por `PUBLIC`; y el `INFORME` cuenta las funciones de la
  spec (debe ser 1).
- `backend/prisma/apply-sql.ts`: `02n_dashboard.sql` en `FILES` (tras
  `02m_external.sql`).
- **`schema.prisma` no cambia** (no hay tablas nuevas).

---

## 12. Tests

### Unit (`*.unit.test.ts`)

- `validators`: `from`/`to` opcionales; formato ISO; `from > to` → falla; rango
  > 24 meses → falla; rango válido → pasa; default a 12 meses.
- `service`: un `finance: null` cuando la fila devuelve `finance: null`
  (composición del DTO sin tocar la base de datos, con el repositorio mockeado).

### Integración (`dashboard.api.integration.test.ts`)

Con fixtures sembrados vía `admin` y afirmando por la API:

1. `200` con la estructura completa para un miembro; `401` anónimo; `403`
   comunidad ajena/inexistente.
2. **Recuentos correctos**: se siembran incidencias en varios estados/prioridades
   y sin asignar; `open`/`inProgress`/`pending`/`critical` cuadran.
3. **Reservas próximas**: se siembra una futura `CONFIRMED`, una pasada y una
   `CANCELLED`; solo cuenta la futura; `notes` no viaja.
4. **Avisos**: uno vigente, uno caducado y uno borrado → solo el vigente.
5. **Votaciones**: una `OPEN` futura y una `OPEN` ya vencida → solo la futura.
6. **Finanzas por rol**: `finance` presente y con cifras para `ADMIN`; `null`
   para `NEIGHBOR`/`PRESIDENT`/`PROVIDER` (DSH-3).
7. **Series y ventana**: con `?from&to` que incluye/excluye filas, `byStatus` /
   `byCategory` / `byMonth` cambian en consecuencia; un mes sin datos no aparece.
8. **Vecinos**: `neighborCount` excluye al `PROVIDER`; `memberCount` lo incluye.
9. **Aislamiento**: datos de la comunidad B no entran en el dashboard de A
   (ni un solo conteo).
10. **Validación**: `from` mal formada y `from > to` → `400 VALIDATION_ERROR`.

### SQL (`04_verify.sql`, nueva sección antes del INFORME)

- `app_community_dashboard` existe, `prosecdef = true`, `provolatile = 's'`
  (`STABLE`), `search_path` fijo, `EXECUTE` a `app_runtime` y no a `PUBLIC`.

### Criterio transversal

El dashboard es **de solo lectura**: la suite comprueba que ninguna llamada al
dashboard crea filas en `audit_logs` ni en `notifications`.

---

## 13. Decisiones cerradas

Cerradas en la revisión de aprobación:

- **A-1 — Alcance de los agregados de incidencias. CERRADA: agregados a todo
  miembro.** Cualquier miembro activo ve los **recuentos** de toda la comunidad;
  nunca filas de incidencias ajenas. Se descarta restringir el dashboard a
  `ADMIN`/`PRESIDENT` (DSH-2).
- **A-2 — Finanzas para `PRESIDENT`. CERRADA: solo `ADMIN`.** El bloque `finance`
  sigue el bloque 09 (FN-1) y su RLS `expenses_admin_only`; es `null` para
  `NEIGHBOR`/`PRESIDENT`/`PROVIDER`. No se reabren aquí los permisos de finanzas
  (DSH-3).
- **A-3 — Topes de lista. CERRADA: 5.** "Próximas reservas" y "últimos avisos" se
  cortan a 5.
- **A-4 — Series de reservas. CERRADA: por mes.** `reservations.byMonth` cuenta
  por mes en la ventana.

---

## 14. Criterios de aceptación

1. `GET /communities/:id/dashboard` devuelve un `DashboardView` completo para un
   miembro activo, con `200`.
2. Un no-miembro recibe `403` (C-8); un anónimo, `401`.
3. `neighborCount` excluye a `PROVIDER`; `memberCount` no.
4. `incidents.open` / `inProgress` / `pending` / `critical` cuadran con los datos
   sembrados (estados y asignación).
5. `reservations.upcoming` solo trae futuras `CONFIRMED`/`PENDING`, sin `notes`,
   ordenadas por `starts_at`.
6. `announcements.latest` solo trae avisos vigentes; `votes.open` solo votaciones
   `OPEN` no vencidas.
7. `finance` es `null` salvo para `ADMIN`; con `ADMIN` trae cifras y serie.
8. Las series respetan la ventana `?from&to` y omiten meses sin datos.
9. Las fechas inválidas dan `400 VALIDATION_ERROR`.
10. Los datos de otra comunidad nunca aparecen en el dashboard (aislamiento).
11. El dashboard no escribe: no hay efectos en `audit_logs` ni `notifications`.
12. `npm run db:verify` termina sin excepciones, con la sección de la spec 13.
13. `npm run typecheck` y `npm run test:unit` en verde.

---

## 15. Documentación a actualizar (al implementar)

- `docs/API.md`: sección del endpoint `GET .../dashboard` con el `DashboardView`.
- `docs/SECURITY.md` §8: recuento de endpoints (de 75 a **76**) y párrafo del
  bloque (agregados sin filas, aislamiento por función, `finance` solo `ADMIN`).
- `docs/README.md`: fila "Dashboard".
- `ARCHITECTURE.md` §6: marcar `GET .../dashboard` como implementado y
  referenciar `specs/13-dashboard.md`.

---

## 16. Fuera de alcance

- **Frontend**: la página de dashboard en React, los componentes Recharts y el
  consumo del DTO. Este spec es solo de la API; la UI es de un bloque de frontend.
- **Notificaciones** (`GET /notifications`, `unread-count`, marcar leídas): es un
  bloque propio (generación de eventos, cross-cutting). Ver §17 de este spec y el
  módulo `notifications` de `ARCHITECTURE.md` §4.
- **Series en tiempo real** (SSE/websockets): la home se refresca por petición.
- **Caché del dashboard**: DSH-12 lo deja fuera hasta medir.
- **Métricas de plataforma** (todas las comunidades, para staff): no aplican aquí.
- **Exportación** del dashboard (CSV/PDF): no se pide.

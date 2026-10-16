# Spec 14 — Notificaciones

> **Estado: IMPLEMENTED.** Bloque 14, el último del backend. Las decisiones
> `NTF-1` a `NTF-9` quedaron **cerradas e implementadas**: generación en SQL
> dentro de las escrituras existentes (`app_notify`, NTF-1), set enfocado de ocho
> eventos (NTF-2), lista global por usuario (NTF-3), audiencias por evento
> (dirección/difusión/destinatarios concretos, sin auto-notificación del actor,
> NTF-4), paginación `page`+`limit` con `?unread` (NTF-5), `read-all` global
> (NTF-6), sin dedup (NTF-7), `01_schema`/`02_rls` sin tocar (NTF-8) y sin borrado
> ni caducidad (NTF-9).
> **Fase:** 14 (notificaciones: generación de eventos, listado, no leídas y marcado
> de lectura). Precedida de `01-authentication` … `13-dashboard`.
> **Base de datos:** la tabla `notifications` (§4.17 de `01_schema.sql`), el enum
> `notification_type` y la política `notifications_own` de `02_rls.sql` **ya
> existían y no se tocaron**. Se añadió **`02o_notifications.sql`** (archivo nuevo)
> con tres funciones `SECURITY DEFINER`, y se **tocaron** las funciones de escritura
> de los módulos que emiten eventos (`02d`, `02e`, `02g`, `02h`, `02k`) para
> llamarlas.
> **Backend:** `backend/src/notifications/`, cubierto por
> `backend/src/__tests__/notifications.api.integration.test.ts` (15 tests) y por
> sus unitarios.
> **Fuera de alcance:** el frontend (la campana y el panel), el envío real por
> email/push/websocket, y los eventos que necesitan un planificador o un insert
> directo (`INVOICE_DUE`, `AI_DRAFT_READY`, `INCIDENT_COMMENT`). Ver §16.

---

## 1. Objetivo

Completar el backend con el sistema de notificaciones: **generar** avisos cuando
ocurren hechos que a alguien le importan, y **servirlos** para la campana de la
aplicación (listar, contar las no leídas y marcar como leídas).

Es el único módulo que no es vertical: la generación es **cross-cutting** (nace
dentro de las escrituras de incidencias, reservas, avisos, votaciones y
miembros), y esa es la parte que decide el diseño. Los cuatro endpoints de lectura
son la parte fácil.

El enunciado (§2) lista "Notificaciones" como funcionalidad y `ARCHITECTURE.md`
§4 describe el módulo como "generación de eventos, lectura, no leídas".

---

## 2. Decisiones

- **NTF-1 — Generación con un helper SQL llamado desde las funciones de escritura
  existentes.** *(Cerrada.)* Un `app_notify()` `SECURITY DEFINER` en
  `02o_notifications.sql`, y una llamada dentro de las funciones de escritura que
  ya existen (`app_create_incident`, `app_publish_vote`…). Es atómico (la
  notificación se inserta en la misma transacción que el hecho, o no se inserta
  ninguna de las dos cosas), vive en el mismo idioma que la autorización y no
  cambia el patrón del proyecto. Se descartan los **triggers** (moverían la lógica
  a `AFTER INSERT/UPDATE`, más difícil de leer y de probar) y la **generación en
  TypeScript** (no puede notificar a *otro* usuario: la política de `INSERT` exige
  `user_id = app_current_user_id()`).
- **NTF-2 — Set enfocado de eventos.** *(Cerrada.)* Se generan ocho de los once
  tipos del enum (§4.2). `INVOICE_DUE`, `AI_DRAFT_READY` e `INCIDENT_COMMENT`
  quedan fuera porque necesitan un *job* programado o nacen de un `INSERT`
  directo, no de una función. Los tres tipos siguen en el enum, reservados.
- **NTF-3 — La lista es global por usuario.** *(Cerrada.)* La campana ve todas las
  notificaciones del usuario en todas sus comunidades; es lo que ya permite la RLS
  (`user_id = app_current_user_id()`, sin filtro de comunidad). El `communityId`
  viaja en cada fila para que el frontend agrupe o filtre en el cliente.
- **NTF-4 — Audiencia por evento** (§4.2). Se propone: *dirección* = `ADMIN` +
  `PRESIDENT` activos; *difusión* = todos los miembros `ACTIVE` con rol distinto de
  `PROVIDER` (un proveedor no es un vecino, mismo criterio que DSH-8). El actor
  nunca se notifica a sí mismo.
- **NTF-5 — Paginación `page`+`limit`.** Igual que el resto de listas: `page` (≥1),
  `limit` (1..100, por defecto 20), `meta.{page,limit,total,totalPages}`. Filtro
  `unread=true` opcional. Orden por `created_at desc`.
- **NTF-6 — `read-all` global.** Marca como leídas **todas** las no leídas del
  usuario. Sin filtro por comunidad (coherente con NTF-3).
- **NTF-7 — Sin auto-notificación y sin deduplicación.** Cada hecho genera sus
  filas una vez. No se agrupa ("3 avisos nuevos") ni se evita repetir un mismo
  tipo.
- **NTF-8 — `01_schema.sql` y `02_rls.sql` no se tocan.** La tabla, el enum, el
  índice de no leídas y la política ya existen. Todo lo nuevo vive en
  `02o_notifications.sql` o en las funciones de escritura que se llaman.
- **NTF-9 — Sin borrado ni caducidad.** No hay `DELETE` de notificaciones ni purga
  por antigüedad en este bloque.

---

## 3. Estado real del modelo de datos

### 3.1 `notifications` (§4.17) — ya existe

```
id           uuid pk
user_id      uuid not null  → users(id) on delete cascade
community_id uuid            → communities(id) on delete cascade   (nullable)
type         notification_type not null
title        text not null
body         text
payload      jsonb
read_at      timestamptz     (null = no leída)
created_at   timestamptz not null default now()
```

Índices ya existentes: `notifications_user_unread_idx (user_id, created_at desc)
where read_at is null` (para el contador) y `notifications_user_idx (user_id,
created_at desc)` (para la lista).

### 3.2 `notification_type` — ya existe

```
INCIDENT_CREATED, INCIDENT_UPDATED, INCIDENT_COMMENT,
RESERVATION_CREATED, RESERVATION_CANCELLED,
ANNOUNCEMENT_NEW, VOTE_OPEN, VOTE_CLOSED,
INVOICE_DUE, MEMBER_JOINED, AI_DRAFT_READY
```

### 3.3 Permisos y RLS — ya existen

- `app_runtime` tiene `SELECT`, `INSERT` y `UPDATE` sobre `notifications`.
- Política `notifications_own` `for all using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id())`: **estrictamente personales**;
  la pertenencia a la comunidad no da acceso a las de otro.
- Consecuencia de diseño: leer y marcar como leídas se hacen con **SQL directo**
  (RLS acota a lo propio), y **generar** para otros exige una función
  `SECURITY DEFINER` (que corre como su dueño, `postgres`, y salta la RLS).

### 3.4 Funciones nuevas (`02o_notifications.sql`)

Tres funciones `SECURITY DEFINER`, `search_path = public, pg_temp`, **`volatile`**
(insertan; declararlas `stable` las rompería con `0A000`, la lección de los
bloques 11 y 12), con `EXECUTE` a `app_runtime` y revocadas de `PUBLIC`:

| Función | Qué hace |
|---|---|
| `app_notify(p_user_id, p_community_id, p_type, p_title, p_body, p_payload)` | Inserta **una** notificación. Devuelve el `uuid`; si `p_user_id` es `null`, no hace nada y devuelve `null`. |
| `app_notify_leadership(p_community_id, p_type, p_title, p_body, p_payload, p_exclude_user_id)` | Una fila por cada miembro `ACTIVE` con rol `ADMIN` o `PRESIDENT`, excluyendo a `p_exclude_user_id`. |
| `app_notify_community(p_community_id, p_type, p_title, p_body, p_payload, p_exclude_user_id)` | Una fila por cada miembro `ACTIVE` con rol distinto de `PROVIDER`, excluyendo a `p_exclude_user_id`. |

Las dos últimas se apoyan en `app_notify()` (una fila por destinatario).

### 3.5 Ficheros existentes que se tocan

Cinco funciones de escritura ganan **una** llamada `perform app_notify_*` al
final, sin cambiar su firma, su autorización ni su valor de retorno. Los ficheros
siguen siendo idempotentes (`create or replace function`):

| Fichero | Función | Evento |
|---|---|---|
| `02d_members.sql` | `app_redeem_invitation` | `MEMBER_JOINED` |
| `02e_incidents.sql` | `app_create_incident` | `INCIDENT_CREATED` |
| `02e_incidents.sql` | `app_assign_incident` | `INCIDENT_UPDATED` |
| `02e_incidents.sql` | `app_transition_incident` | `INCIDENT_UPDATED` |
| `02g_reservations.sql` | `app_create_reservation` | `RESERVATION_CREATED` |
| `02g_reservations.sql` | `app_cancel_reservation` | `RESERVATION_CANCELLED` |
| `02h_announcements.sql` | `app_create_announcement` | `ANNOUNCEMENT_NEW` |
| `02k_voting.sql` | `app_publish_vote` | `VOTE_OPEN` |
| `02k_voting.sql` | `app_close_vote` | `VOTE_CLOSED` |

> Nota: `02o_notifications.sql` se aplica **después** de `02e`/`02g`/`02h`/`02k`
> en `apply-sql.ts`, de modo que las funciones que llaman a `app_notify_*` se
> crean antes que `app_notify_*`. Es correcto: PL/pgSQL resuelve las funciones
> referenciadas en tiempo de ejecución, no al crear. Aun así, `02o` va **antes**
> de `03_storage.sql`, con el resto de módulos.

---

## 4. Alcance funcional

### 4.1 Lectura (la campana)

- Listar las notificaciones del usuario, más nuevas primero, con paginación y
  filtro `unread`.
- Contar las no leídas (para el *badge*).
- Marcar una como leída (idempotente).
- Marcar todas como leídas.

### 4.2 Generación (los eventos)

| Evento | Emisor | Destinatarios (NTF-4) | `payload` |
|---|---|---|---|
| `INCIDENT_CREATED` | `app_create_incident` | dirección | `{ incidentId, referenceCode }` |
| `INCIDENT_UPDATED` | `app_transition_incident`, `app_assign_incident` | reportero + proveedor asignado | `{ incidentId, status? }` |
| `RESERVATION_CREATED` | `app_create_reservation` | dirección | `{ reservationId, commonAreaId }` |
| `RESERVATION_CANCELLED` | `app_cancel_reservation` | reservante + dirección | `{ reservationId }` |
| `ANNOUNCEMENT_NEW` | `app_create_announcement` | difusión | `{ announcementId }` |
| `VOTE_OPEN` | `app_publish_vote` | difusión | `{ voteId }` |
| `VOTE_CLOSED` | `app_close_vote` | difusión | `{ voteId }` |
| `MEMBER_JOINED` | `app_redeem_invitation` | dirección | `{ userId }` |

El **actor** se excluye siempre (`p_exclude_user_id`). `title` y `body` son texto
en español, cortos y con el dato útil (`body` = título de la incidencia, nombre de
la zona, título del aviso, título de la votación, nombre del miembro).

---

## 5. Modelo de datos y DTO

### 5.1 `Notification` (contrato con el frontend)

```ts
type Notification = {
  id: string
  type: string            // notification_type
  title: string
  body: string | null
  payload: unknown | null // jsonb
  communityId: string | null
  readAt: string | null   // ISO 8601 UTC; null = no leída
  createdAt: string       // ISO 8601 UTC
}
```

`payload` se devuelve tal cual (jsonb sin reescribir en TypeScript). Fechas ISO
8601 en UTC con `Z`, como en el resto del backend.

---

## 6. API

Cuatro rutas bajo `/api/v1/notifications`, todas con `requireAuth` y **sin**
`requireCommunity` (son del usuario, no de una comunidad). Se montan en `app.ts`.

### 6.1 `GET /api/v1/notifications?unread=true&page=&limit=`

```
200 → { "data": [ { "id":"…", "type":"ANNOUNCEMENT_NEW", "title":"Nuevo aviso",
                    "body":"…", "payload":{…}, "communityId":"…",
                    "readAt":null, "createdAt":"2026-10-15T13:57:16.303Z" } ],
        "meta": { "page":1, "limit":20, "total":1, "totalPages":1 } }
401 → UNAUTHORIZED
400 → VALIDATION_ERROR (page/limit fuera de rango)
```

### 6.2 `GET /api/v1/notifications/unread-count`

```
200 → { "data": { "count": 3 } }
401 → UNAUTHORIZED
```

### 6.3 `PATCH /api/v1/notifications/:id/read`

Idempotente: si ya estaba leída, devuelve `200` con el mismo `readAt` (no lo
reescribe). Si el id no es tuyo (o no existe), `404` —la RLS lo hace invisible,
nunca `403`.

```
200 → { "data": { …Notification con readAt != null } }
401 → UNAUTHORIZED
404 → NOT_FOUND (no existe o no es tuya)
400 → VALIDATION_ERROR (:id no es un UUID)
```

### 6.4 `POST /api/v1/notifications/read-all`

```
200 → { "data": { "updated": 3 } }
401 → UNAUTHORIZED
```

---

## 7. Permisos

- Cualquier usuario autenticado. No hay rol: cada quien ve y toca **solo lo suyo**,
  y lo garantiza la RLS `notifications_own`, no un `if` en TypeScript.
- La generación no pasa por el usuario: la hacen funciones `SECURITY DEFINER`
  dentro de una escritura que ya estaba autorizada (si el `INSERT` de la
  incidencia no pasa el guard, no hay incidencia **ni** notificación).

---

## 8. Errores

No se añade ningún `code` nuevo. Se reutilizan:

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `page`/`limit` fuera de rango, `:id` no UUID |
| 401 | `UNAUTHORIZED` | falta la sesión |
| 404 | `NOT_FOUND` | marcar una notificación que no existe o no es tuya |

---

## 9. Configuración (env)

Ninguna. No hay proveedor de envío ni *feature flag*.

---

## 10. Validaciones y casos límite

- `unread`: booleano (`"true"`/`"false"` en query); cualquier otro valor → `400`.
- `page`: entero ≥ 1. `limit`: entero 1..100. Por defecto `page=1`, `limit=20`.
- `:id`: UUID válido → si no, `400` (no un `22P02` sin traducir).
- Marcar como leída una que ya lo estaba: `200`, `read_at` intacto (idempotente).
- Marcar/leer una notificación ajena: `404` (nunca `403`).
- `read-all` sin nada que marcar: `200` con `{ "updated": 0 }`.
- Un `INCIDENT_UPDATED` que no cambia nada observable (mismo asignado) **sí**
  notifica: no se compara el estado anterior (NTF-7, sin deduplicación).
- Difusión a una comunidad sin miembros (solo el actor): cero filas.

---

## 11. Estructura del backend

`backend/src/notifications/`, con el patrón de siempre
`routes → controller → service → repository → validators` (+ `errors.ts` solo si
hiciera falta traducir un *sentinel*: no hay ninguno en este bloque):

- `validators.ts`: `listQuerySchema` (`unread`, `page`, `limit`), `idParamsSchema`
  (UUID). Reutiliza `UUID_RE` donde ya existe.
- `repository.ts`: `SELECT` de la lista con `count(*) over ()` para el total, el
  `count` de no leídas, el `UPDATE ... returning` del marcado y el `UPDATE` masivo
  de `read-all`. SQL directo bajo RLS (`withContext`), sin funciones.
- `service.ts`: tipos `Notification`, `NotificationPage`, y el 404 del marcado
  cuando el `UPDATE` afecta 0 filas.
- `controller.ts` / `routes.ts`: cuatro handlers, `requireAuth`.

### SQL y scripts

- Nuevo `supabase/sql/02o_notifications.sql`: las tres funciones + `GRANT`/
  `REVOKE` + autocomprobación `do $$` (como `02m`/`02n`).
- `backend/prisma/apply-sql.ts`: `02o_notifications.sql` en `FILES` (tras
  `02n_dashboard.sql`, antes de `03_storage.sql`).
- `04_verify.sql`: sección nueva (§12) y recuentos en el `INFORME`.
- **`schema.prisma` no cambia** (no hay tablas nuevas). Pero al tocar `02e`/`02g`/
  `02h`/`02k`/`02d` no cambia ninguna columna, así que **no hace falta
  `db:generate`**.

---

## 12. Tests

### Unit (`*.unit.test.ts`)

- `validators`: `unread` booleano; `page`/`limit` enteros y límites; `:id` UUID.
- `service`: el `404` cuando el `UPDATE` de marcado devuelve 0 filas; la
  composición de `NotificationPage` con el repositorio mockeado.

### Integración (`notifications.api.integration.test.ts`)

Sembrando con `admin` y afirmando por la API:

1. `401` anónimo en las cuatro rutas.
2. **Generación — incidencias**: un `NEIGHBOR` crea una incidencia → el `ADMIN` y
   el `PRESIDENT` tienen una `INCIDENT_CREATED`; el `NEIGHBOR` reportero **no**
   (NTF-7); un `PROVIDER` no.
3. **Generación — incidencia actualizada**: asignar/cambiar estado notifica al
   reportero y al proveedor asignado, no al actor.
4. **Generación — reservas**: crear reserva notifica a dirección; cancelar
   notifica al reservante y a dirección.
5. **Generación — avisos y votaciones**: publicar un aviso y abrir/cerrar una
   votación notifica a todos los vecinos (`ACTIVE`, rol ≠ `PROVIDER`), no al
   autor, y **no** al `PROVIDER`.
6. **Generación — miembros**: canjear una invitación notifica a dirección.
7. **Listado**: orden `created_at desc`, paginación (`meta.total`/`totalPages`) y
   filtro `unread=true`.
8. **`unread-count`**: cuadra; baja al marcar; `read-all` lo deja en 0.
9. **Marcado**: `PATCH .../read` pone `readAt`; repetir es idempotente; la de otro
   usuario da `404`.
10. **Aislamiento**: las notificaciones de A no aparecen en la lista de B, y B no
    puede marcarlas (`404`).
11. **Validación**: `limit=0`, `unread=quizá`, `:id` no UUID → `400`.

### SQL (`04_verify.sql`, nueva sección antes del INFORME)

- `app_notify`, `app_notify_leadership` y `app_notify_community` existen, son
  `SECURITY DEFINER`, `volatile`, con `search_path` fijo, ejecutables por
  `app_runtime` y no por `PUBLIC`.
- **Regresión**: `pg_get_functiondef` de cada función emisora (`app_create_incident`,
  `app_assign_incident`, `app_transition_incident`, `app_create_reservation`,
  `app_cancel_reservation`, `app_create_announcement`, `app_publish_vote`,
  `app_close_vote`, `app_redeem_invitation`) **menciona** `app_notify`; si alguien
  quita la llamada, la verificación falla.
- El `INFORME` cuenta las funciones de notificaciones (deben ser 3) y sus
  `EXECUTE` a `PUBLIC` (deben ser 0).

### Criterio transversal

Leer (`GET` lista y `unread-count`) **no escribe**: ninguna lectura crea filas en
`notifications` ni en `audit_logs`.

---

## 13. Decisiones cerradas

- **NTF-1 a NTF-3** — cerradas con el usuario antes de escribir la spec.
- **NTF-4 a NTF-9** — se cierran en la revisión de esta spec.

---

## 14. Criterios de aceptación

1. Las cuatro rutas responden con el envelope de siempre; `401` sin sesión.
2. La lista respeta paginación (`meta.total`/`totalPages`), orden y `unread`.
3. `unread-count` y `read-all` cuadran.
4. Marcar es idempotente y ajena → `404`.
5. Cada uno de los ocho eventos del set genera las notificaciones de su audiencia,
   sin auto-notificar ni avisar al `PROVIDER` en las difusiones.
6. Las notificaciones son personales: A no ve ni toca las de B.
7. `02o_notifications.sql` deja las tres funciones `SECURITY DEFINER`, `volatile`,
   `search_path` fijo, ejecutables por `app_runtime` y no por `PUBLIC`.
8. `04_verify.sql` incluye la sección y los recuentos, y termina en verde.
9. `npm run typecheck` y `npm run test:unit` en verde.

---

## 15. Documentación a actualizar (al implementar)

- `docs/API.md`: sección "Notificaciones" con los cuatro endpoints y el DTO.
- `docs/SECURITY.md` §8: recuento de endpoints (de **76 a 80**) y párrafo del
  bloque (generación atómica dentro de escrituras ya autorizadas, personales por
  RLS, funciones `SECURITY DEFINER`).
- `docs/README.md`: fila "Notificaciones".
- `ARCHITECTURE.md` §6: marcar los cuatro endpoints como implementados y
  referenciar `specs/14-notifications.md`.

---

## 16. Fuera de alcance

- **Frontend**: la campana, el panel de notificaciones y el *badge* en React.
- **Envío real**: email, push y websockets/SSE (la campana se refresca por
  petición; el tiempo real es de un bloque de frontend/infra).
- **Eventos que no salen de una función**: `INVOICE_DUE` (necesita un *job* que
  vigile vencimientos), `AI_DRAFT_READY` (el borrador nace de un `INSERT` directo
  de `app_runtime`) e `INCIDENT_COMMENT` (los comentarios se insertan directo).
  Reservados en el enum.
- **Preferencias de notificación** por usuario o por tipo (activar/desactivar).
- **Agrupación/deduplicación** y **borrado/caducidad** (NTF-7, NTF-9).
- **Auditoría** de la generación (no es una acción sensible del usuario).

# Spec 07 — Avisos

> **Estado: IMPLEMENTED.** Las tres decisiones de §12 (D-1 a D-3) están
> tomadas, y AN-1 a AN-11 de §2 están cerradas.
> **Fase:** 7 (avisos). Precedida de `01-authentication`, `02-communities`,
> `03-members`, `04-incidents`, `05-common-areas` y `06-reservations`.
> **Base de datos:** `supabase/sql/01_schema.sql` (la tabla `announcements` ya
> existe), `02_rls.sql` (dos políticas ya existen) y `02h_announcements.sql`
> (archivo nuevo, en este bloque).
> **Backend:** `backend/src/announcements/`.
>
> Este spec define el **tablón de anuncios** de la comunidad: quién publica,
> quién lee, qué es "programado" y qué es "caducado", y por qué el borrado es
> de `ADMIN` y no de quien lo escribió. Es el bloque más pequeño de los
> implementados hasta aquí: cuatro endpoints, cinco funciones y ninguna columna
> nueva — la tabla ya viene completa en el esquema.

---

## 1. Objetivo

Que la presidencia y la administración de una comunidad puedan publicar avisos
—una reunión, una corte de agua, un cambio de horario del porter— y que
**cualquier miembro activo, `PROVIDER` incluido, los lea** ordenados con lo
fijado arriba, sin tener que estar en el momento de la publicación.

Un aviso es **broadcast asimétrico**: escriben pocos, leen todos. Esa
asimetría es la que la matriz de `ARCHITECTURE.md` §5 fija en dos filas —"Ver
avisos" ✅ para los cuatro roles, "Crear/pinear avisos" solo `PRESIDENT` y
`ADMIN`— y la que este spec convierte en funciones y guardas.

A diferencia de las reservas (spec 06), aquí **no hay estados**: un aviso no
está pendiente de aprobación, está publicado o no lo está, y "no lo está" no
es un estado sino una fecha (`publish_at` en el futuro). Tampoco hay nada que
confirmar ni nada que cancele otra persona.

Fuera de alcance: notificaciones (que `URGENT` dispare un push o un email es
del bloque de notificaciones, cuando exista); adjuntos y archivos (`08-
documents.md`); las tools `get_announcements()` de MCP (specs 11 y 12);
cualquier UI.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **AN-1** | **Crear, editar y fijar** es de `PRESIDENT` y `ADMIN`; **borrar** es solo de `ADMIN`; **leer** es de cualquier miembro activo | Incluir al `NEIGHBOR` en la creación (es su comunidad) o quitar al `PRESIDENT` | La matriz de §5 da "Crear/pinear avisos" a `PRESIDENT` y `ADMIN` con `—` para el resto. Para el borrado la matriz no tiene fila de avisos, y se sigue el precedente más cercano: "Eliminar incidencia" es `ADMIN` (soft delete). El `PRESIDENT` gestiona el contenido —fijar, corregir, caducar— pero no destruye el histórico; y el `NEIGHBOR` no es autor de nada aquí: `author_id` es metadato de quién publicó, no propiedad de un tablón personal |
| **AN-2** | Escrituras **y lecturas** pasan por funciones `SECURITY DEFINER`; se elimina la política `announcements_write_leadership` y se revoca `insert, update, delete` sobre `announcements` a `app_runtime` | Dejar el `for all` y escribir con Prisma | Mismo argumento que CA-6 (spec 05) y `02e_incidents.sql` §4a: una política `for all` concede borrar al `PRESIDENT` (AN-5 dice que no), no puede exigir el `PUT` completo campo a campo, no puede devolver un mensaje de error con contexto —un `23514` de la ventana `expires > publish` sale crudo— y no distingue `UPDATE` de `DELETE`. Y el `grant insert, update, delete` de `02_rls.sql` hay que revocarlo explícitamente: quitarlo de la lista no deshace un `GRANT` ya aplicado |
| **AN-3** | Toda lectura pasa por `app_list_announcements()`, y la respuesta lleva `authorName` | `SELECT` con Prisma y un `include` de autor en TypeScript | Tres cosas que un `where` de Prisma no puede fijar a la vez: (a) la ventana de AN-4 con `now()` **en la base de datos**, (b) `deleted_at is null`, y (c) `authorName`, que sale de `users` y `users_select_self` no deja leer. Es la misma excepción acotada que abrieron los bloques 03, 04 y 06 (`app_get_community_member`, `app_list_incidents`, `app_list_community_reservations`) |
| **AN-4** | **Ventana de visibilidad**: `deleted_at is null` **y** `publish_at <= now()` **y** (`expires_at is null or expires_at > now()`). Un `publish_at` futuro es un aviso **programado**, no pendiente: quien decide es `now()` al leer | Estados (`DRAFT`/`SCHEDULED`/`LIVE`/`EXPIRED`) con un job que los conmute | Un sistema de estados exigiría un reloj que corra por las filas —caducidad automática, publicación automática— y este proyecto no tiene workers: la única garantía que se puede hacer cumplir es la que se evalúa al leer. Con la fecha, la fila es inmutable y el "estado" es una función pura de `publish_at`, `expires_at` y el reloj. Es el mismo argumento con el que la spec 06 D-2 descartó la confirmación automática por tiempo |
| **AN-5** | El borrado es **soft delete** (`deleted_at = now()`), sin `DELETE` físico, y solo lo ejecuta `ADMIN` | `DELETE` físico; o que el autor borre lo suyo | El precedente de la matriz es "Eliminar incidencia = `ADMIN` (soft delete)". El histórico de "qué se comunicó y cuándo" es justo lo que hace útil un tablón cuando hay conflicto, y un `DELETE` físico arrastraría el aviso de la vista de todos sin dejar rastro. Que el autor no borre lo suyo tampoco: un aviso ya leído por la comunidad no vuelve a no haber existido |
| **AN-6** | `PUT /announcements/:id` es **reemplazo completo** de los siete campos del aviso | `PATCH` parcial | La arquitectura dice `PUT` (§6), igual que en incidencias y zonas. El aviso es un paquete coherente —título, cuerpo, tipo, prioridad, fijado, ventana—; un `PATCH` que permitiera cambiar `expiresAt` sin mirar `publishAt` abriría ventanas invertidas. Los campos que no son del aviso (`id`, `communityId`, `authorId`, `createdAt`, `updatedAt`) no se aceptan en el cuerpo (`.strict()`) |
| **AN-7** | El listado aplica la ventana de AN-4 **solo a `NEIGHBOR` y `PROVIDER`**: `PRESIDENT` y `ADMIN` ven además los programados y los caducados | Parámetro `?includeExpired=true` con 403 para el resto | El que gestiona tiene que ver lo que programó antes de que salga y tiene que poder encontrar lo caducado para borrarlo o reabrirlo —con la ventana aplicada a todos, un aviso caducado sería inalcanzable y su `PUT`/`DELETE` imposibles. Decidirlo por rol y no por parámetro deja el contrato sin un modo que la UI tenga que aprender a mandar, y evita un 403 que no protege nada: el dato es de su comunidad y ya lo ven completos cuando están vivos |
| **AN-8** | Orden `is_pinned desc, publish_at desc` (es el orden exacto del índice `announcements_community_publish_idx` que ya existe) y paginación como en incidencias: `page` ≥1, `limit` 1–100, `meta {page, limit, total, totalPages}` | Devolver el tablón entero sin paginar | El índice parcial de §3.2 ya define este orden para que lo fijado encabece el listado sin `order by` adicional; la paginación evita que una comunidad con dos años de avisos mande un JSON de megabytes a un móvil que solo pinta los diez primeros. Varios fijados conviven y se ordenan entre sí por `publish_at desc`: no hay límite de fijados |
| **AN-9** | `authorId` **no se acepta** en ningún cuerpo: lo escribe la función con `app_current_user_id()`, y el `PUT` **no lo toca** | Aceptar `authorId` del cliente, o que el `PUT` permita reasignar autoría | Mismo motivo que `reporterId` en I-5 (spec 04): la identidad del autor sale de la sesión, no del cuerpo. Y aunque se reasignara, no sería un ataque —el actor ya es `PRESIDENT` o `ADMIN`— sino una mentira histórica: el aviso lo publicó quien lo publicó |
| **AN-10** | `type: URGENT` **no dispara notificaciones** en este bloque | Acoplar un `insert` en `notifications` dentro de la función de creación | No existe el bloque de notificaciones: `notification_type` tiene tipos de reserva desde el esquema y ni siquiera ellos se usan aún (spec 06 §12 lo dejó pendiente). Escribir en una tabla cuyo modelo de entrega no está decidido es deuda; el día que exista, el disparo va dentro de `app_create_announcement()` y se decide entonces quién lo recibe |
| **AN-11** | **No hay `409` en este módulo**: sin índices únicos que pisar ni estados que transitar | Inventar un conflicto de títulos | El esquema no tiene `unique` sobre `announcements` —dos avisos pueden llamarse igual sin que nada se rompa— y AN-4 descarta los estados. Un `409` que no puede producirse es un código que los clientes escribirían contra un caso imposible |

---

## 3. Estado real del modelo de datos

Verificado contra `01_schema.sql` y `prisma/schema.prisma` hoy.

### 3.1 `announcements`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade`. Eje del aislamiento |
| `title` | `text not null` | **Sin `check` de longitud.** Este bloque lo añade (§4a) |
| `body` | `text not null` | **Sin `check` de longitud.** Este bloque lo añade (§4a) |
| `type` | `announcement_type not null default 'GENERAL'` | `GENERAL`, `URGENT`, `MAINTENANCE`, `MEETING` |
| `priority` | `announcement_priority not null default 'MEDIUM'` | `LOW`, `MEDIUM`, `HIGH` |
| `is_pinned` | `boolean not null default false` | AN-8: lo fijado sale primero |
| `publish_at` | `timestamptz not null default now()` | AN-4: el límite inferior de la ventana |
| `expires_at` | `timestamptz` | Nullable = no caduca. `check (expires_at > publish_at)` **ya existe** |
| `author_id` | `uuid → users(id)` | `on delete set null`: si el autor se borra, el aviso queda con autor nulo |
| `deleted_at` | `timestamptz` | AN-5: soft delete. Ninguna función de este bloque borra la fila |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `announcements_set_updated_at` (sección 6 de `04_verify.sql` ya lo comprueba para todas las tablas) |

### 3.2 Índices que ya existen

| Índice | Definición |
|---|---|
| `announcements_community_publish_idx` | `(community_id, is_pinned desc, publish_at desc) where deleted_at is null` — el orden de AN-8 |
| `announcements_dates_valid` | `check (expires_at is null or expires_at > publish_at)` — la ventana de AN-4, ya protegida a nivel de fila |

### 3.3 Lo que este bloque cambia en el esquema

**Nada estructural.** `02h_announcements.sql` no crea tablas ni columnas: solo
funciones, políticas y permisos. La tabla ya viene completa en `01_schema.sql`
§4.9, con el `CHECK` de ventana y el índice que el orden del listado necesita.

Lo único que se añade son los dos `CHECK` de longitud de §4a, con `not valid`
como en los bloques 04 y 05.

---

## 4. El problema del arranque

### a) `title` y `body` no tienen longitud

El `not null` impide el vacío implícito, pero no el `''` ni el título de un
carácter ("·"). Se añade, con el mismo criterio que en el bloque 04:

```sql
alter table announcements
  add constraint announcements_title_length
  check (char_length(title) between 3 and 120) not valid;

alter table announcements
  add constraint announcements_body_length
  check (char_length(body) between 1 and 5000) not valid;
```

`not valid` aplica a filas nuevas sin fallar sobre las que ya haya; validar es
un paso posterior. El esquema de zod del backend pone los mismos rangos de
forma independiente, igual que `title` en incidencias. 120 de título es de
tablón —cabe en un aviso de móvil— y 5000 de cuerpo admite el comunicado
entero sin adjunto (los adjuntos son de la spec 08).

### b) La política `announcements_write_leadership` no es suficiente

`02_rls.sql` §5.9 ya restringe la escritura a `app_is_member_of(community_id)
and app_role_in(community_id) in ('ADMIN', 'PRESIDENT')`. Parece exactamente
lo que decide AN-1, y lo es como guardia gruesa. El problema es lo que **no**
puede hacer:

- **Distinguir `DELETE` de `UPDATE`.** Es un `for all`: concede las dos cosas
  al mismo rol, y AN-5 dice que borrar es solo de `ADMIN`.
- Exigir el `PUT` completo de AN-6 campo a campo, ni impedir que el cuerpo
  toque `author_id` o `community_id` (AN-9): RLS mira la fila **resultante**,
  no el camino que tomó hasta ahí.
- Devolver un error legible: una ventana invertida (`expires_at <=
  `publish_at`) salta el `CHECK` con un `23514` crudo, sin sentinel, y una
  validación de longitud con un `23514` idéntico no se distingue de la otra.
- Aplicar la ventana de AN-4 al **listado** con el rol del llamante: RLS
  evaluaría `now()` por fila, pero el listado lo pide con paginación, orden y
  filtros que una política no expresa.

La solución es la de los bloques 03, 04 y 05: **`announcements` se queda sin
política de `INSERT`, `UPDATE` ni `DELETE`, y `app_runtime` pierde esos
permisos.** Toda escritura entra por funciones `SECURITY DEFINER`. El `SELECT`
se queda tal cual (`announcements_select_member` ya es la guarda gruesa
correcta: miembro activo y no caducado); el predicado completo de lectura vive
en la función de AN-3, porque una función `SECURITY DEFINER` corre como su
dueña y la política ni siquiera se le aplica.

### c) Las rutas de aviso no llevan `communityId` en la URL

`PUT /api/v1/announcements/:id` y `DELETE /api/v1/announcements/:id` no tienen
comunidad en el camino. Es la misma situación que la spec 05 §4c resolvió con
`requireCommonArea()`, y aquí se repite idéntica:

```sql
create or replace function app_announcement_community(p_announcement uuid) returns uuid
```

Devuelve el `community_id` **solo si el aviso existe, no está borrado y el
actor es miembro activo** de su comunidad, y `NULL` si no.
`requireAnnouncement()` la llama y traduce `NULL` → `404`. Mismo criterio C-8:
un `403` confirmaría que ese id existe. Va en
`backend/src/announcements/middleware.ts`, no en `auth/middleware.ts` (ese
archivo es del bloque 01 y la spec 03 decidió no tocarlo).

Nótese lo que **no** filtra: la función no mira la ventana de AN-4. Un aviso
caducado o programado sigue siendo visible para su `PUT` y su `DELETE`, porque
gestionar es exactamente lo que hay que hacer con esos. Quien sí aplica la
ventana es el listado (§5.2).

---

## 5. Funciones

Todas `SECURITY DEFINER`, todas con `set search_path = public, pg_temp`,
todas con `revoke execute` a `PUBLIC` y `grant execute` a `app_runtime`
solamente. Ninguna acepta un usuario como parámetro: el actor sale de
`app_current_user_id()`.

### 5.1 `app_announcement_community(p_announcement uuid) returns uuid`

- Devuelve `announcements.community_id` si el aviso existe, `deleted_at is
  null` y el actor es miembro **activo** de esa comunidad (`app_is_member_of`);
  si no, `NULL`.
- No filtra la ventana (§4c): los programados y los caducados se gestionan.

Se usa en `requireAnnouncement()`, y de ahí en las dos rutas por id.

### 5.2 `app_list_announcements(p_community_id uuid, p_announcement uuid, p_type announcement_type, p_q text, p_limit integer, p_offset integer) returns table (...)`

> Aclaración de implementación (2026-10-07, al aprobar la spec): la firma de
> este encabezado era el resumen, no el contrato completo. Los cuatro filtros de
> §7.3 (`type`, `q`, paginación) y el relectura-por-id de AN-3 necesitan
> parámetros, y todos van **aquí** y no en una sexta función: la alternativa de
> `app_get_announcement()` (el precedente `app_get_common_area()`) se descarta
> porque AN-3 dice que *toda* lectura pasa por `app_list_announcements()`, y un
> segundo lector tendría que duplicar la ventana de AN-4. Los seis parámetros
> después de `p_community_id` son todos `default null` salvo `p_limit` (20) y
> `p_offset` (0). `p_announcement is not null` restringe el listado a ese id: es
> cómo el `POST` y el `PUT` releen la fila con `authorName` (§7.1) sin romper
> AN-3. Sigue habiendo cinco funciones.

- Guarda: `app_is_member_of(p_community_id)`, si no → `42501`.
- Columnas: `id`, `title`, `body`, `type`, `priority`, `is_pinned`,
  `publish_at`, `expires_at`, `author_id`, `author_name` (de `users.full_name`
  con `left join`, AN-3), `created_at`, `updated_at`.
- **Filtro de ventana (AN-4) aplicado por rol (AN-7)**: para todo el mundo,
  `deleted_at is null` y `publish_at <= now()`; para `NEIGHBOR` y `PROVIDER`,
  además (`expires_at is null or expires_at > now()`). `PRESIDENT` y `ADMIN`
  ven también los caducados —los necesitan para borrarlos o reabrirlos— y los
  programados —los necesitan para revisarlos antes de que salgan—. Los campos
  `publishAt`/`expiresAt` de la respuesta permiten al cliente dibujar cada
  aviso con su estado real; el filtro es sobre quién ve, no sobre qué es.
- Orden: `is_pinned desc, publish_at desc` (AN-8), el mismo que su índice.
- Los borrados (`deleted_at is not null`) no salen **para nadie**, roles de
  gestión incluidos: borrado es borrado (AN-5).
- Filtros (§7.3): `p_type` compara exacta, `p_q` hace `ilike` sobre `title` y
  `body`, y `limit`/`offset` se recortan en el servidor a 1–100 y ≥0 — zod ya
  lo hizo en la entrada, la función no se fía del parámetro. `total_count` sale
  de `count(*) over ()` sobre el conjunto filtrado, como en incidencias.

### 5.3 `app_create_announcement(p_community_id uuid, p_title text, p_body text, p_type announcement_type, p_priority announcement_priority, p_is_pinned boolean, p_publish_at timestamptz, p_expires_at timestamptz) returns uuid`

- Guarda: hay sesión, si no → `42501` `sin contexto de usuario`.
- Guarda: `app_role_in(p_community_id) in ('ADMIN', 'PRESIDENT')`, si no →
  `42501` (`forbidden_role`). Un `NEIGHBOR` o un `PROVIDER` recibe `403`
  aquí (AN-1), igual que en el `PUT`.
- `p_title` y `p_body` obligatorios → `22023` si nulos. Longitud la ponen los
  `CHECK` de §4a.
- La ventana (`p_expires_at > p_publish_at`) la garantiza el `CHECK` de la
  tabla (`announcements_dates_valid`, ya existente); su violación sale como
  `23514` y el backend la traduce a `400` (§7.5). Zod la adelanta en la capa
  de entrada con el mismo resultado.
- `author_id = app_current_user_id()` (AN-9). `community_id` es el parámetro,
  no del cuerpo.
- Devuelve el `id`.

### 5.4 `app_update_announcement(p_announcement uuid, p_title text, p_body text, p_type announcement_type, p_priority announcement_priority, p_is_pinned boolean, p_publish_at timestamptz, p_expires_at timestamptz) returns setof announcements`

- Guarda: aviso visible por §5.1 (existe y no borrado), si no →
  `announcement_not_found`.
- Guarda: rol `ADMIN` o `PRESIDENT`, si no → `42501` (`forbidden_role`). Un
  `NEIGHBOR` que tiene el id recibe `403`, no `404`: el `404` es para no
  pertenecer a la comunidad, el `403` para no poder gestionarla.
- Es un `PUT`: los ocho parámetros son el valor nuevo completo (AN-6).
  `p_expires_at` nulo caduca nunca. `p_publish_at` en el futuro reprograma:
  el aviso vuelve a estar programado, sin cambiar de estado porque no lo hay
  (AN-4).
- **No toca `author_id` ni `community_id`** (AN-9): el autor es el que firmó
  la publicación original, aunque otro dirigente la corrija después.
- Devuelve la fila leída al final, que ya pasa por el mismo `where` de §5.1.

### 5.5 `app_delete_announcement(p_announcement uuid) returns void`

- Guarda: aviso visible por §5.1, si no → `announcement_not_found`.
- Guarda: `app_role_in(...) = 'ADMIN'`, si no → `42501`
  (`announcement_requires_admin`). Un `PRESIDENT` recibe `403` (AN-5): puede
  fijar y corregir, no destruir.
- `deleted_at = now()`. **No borra la fila** y no toca nada más: los avisos no
  tienen slots, ni comentarios, ni nada que arrastrar.
- Borrar dos veces es `404` en la segunda: la primera dejó el aviso fuera del
  `where` de §5.1. No hay `409` "ya borrado" (AN-11), igual que no lo hay en
  incidencias.

---

## 6. Políticas RLS

`02h_announcements.sql` deja `announcements` así:

| Comando | Cómo |
|---|---|
| `SELECT` | **No se toca.** `announcements_select_member` (miembro + no caducado) queda como guarda gruesa. El predicado completo —ventana por rol, `deleted_at`— vive en `app_list_announcements()` (§5.2), que corre como dueña y ni la lee |
| `INSERT` | **Se elimina** `announcements_write_leadership` (§4b) |
| `UPDATE` | **Se elimina** `announcements_write_leadership` (§4b) |
| `DELETE` | **Se elimina** `announcements_write_leadership` (§4b), y además `app_runtime` no tiene `DELETE` desde hace bloques: el soft delete lo escribe la función como dueña |

Y deja los permisos así:

| Permiso | Antes | Después |
|---|---|---|
| `select` on `announcements` | ✓ | ✓ |
| `insert` on `announcements` | ✓ | **✗** |
| `update` on `announcements` | ✓ | **✗** |
| `delete` on `announcements` | ✓ | **✗** |

El `revoke insert, update, delete on announcements from app_runtime` es
indispensable y no decorativo, por el mismo motivo que en los bloques 03, 04 y
05: quitarlo de la lista de `grant` de `02_rls.sql` no deshace un `GRANT` ya
aplicado. Se repite también contra `anon, authenticated` por simetría con
`02e_incidents.sql`.

La política de `SELECT` que queda es **más débil que la ventana de AN-4**: no
filtra `publish_at` futuro ni `deleted_at`. Esa diferencia es deliberada y está
documentada en §11: ninguna ruta de lectura hace `SELECT` directo, y el día
que alguien lo escriba, será un bug que los tests de integración de §10
descubren.

`02_rls.sql` **no se modifica** (el `drop policy if exists` va dentro de
`02h_announcements.sql`, como el de zonas comunes).

---

## 7. Contrato HTTP

### 7.1 El recurso

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "title": "Corte de agua el jueves",
  "body": "El jueves de 9:00 a 14:00 habrá corte de agua en los portales A y B.",
  "type": "MAINTENANCE",
  "priority": "HIGH",
  "isPinned": true,
  "publishAt": "2026-10-06T09:00:00.000Z",
  "expiresAt": "2026-10-10T00:00:00.000Z",   // null = no caduca
  "authorId": "uuid",                          // null si el autor se dio de baja
  "authorName": "Ana Ruiz Delgado",            // null si el autor se dio de baja
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

`authorName` viene de `users.full_name`, que AN-3 explica por qué solo se
puede leer desde una función. `email` no sale: para un tablón no hace falta.

### 7.2 Rutas

Las cuatro de `ARCHITECTURE.md` §6, sin añadir ninguna:

```
GET    /api/v1/communities/:communityId/announcements    ?type&q&page&limit
POST   /api/v1/communities/:communityId/announcements
PUT    /api/v1/announcements/:id
DELETE /api/v1/announcements/:id
```

Tampoco hay `GET /announcements/:id`, igual que no lo hay en zonas comunes: el
listado **es** la lectura, y la arquitectura no lo lista. Un aviso se
localiza en su tablón.

### 7.3 Guardas y cuerpos

| Ruta | Guardas |
|---|---|
| `GET /communities/:communityId/announcements` | `requireAuth`, `requireCommunity()` |
| `POST /communities/:communityId/announcements` | `requireAuth`, `requireCommunity()`, `requireCommunityRole('PRESIDENT', 'ADMIN')` |
| `PUT /announcements/:id` | `requireAuth`, `requireAnnouncement()` |
| `DELETE /announcements/:id` | `requireAuth`, `requireAnnouncement()` |

**`requireAnnouncement()` va en `backend/src/announcements/middleware.ts`
(§4c)**, siempre después de `requireAuth`. No lleva `requireCommunityRole`: el
rol lo resuelve la función con la fila delante, igual que
`requireIncident()` y `requireCommonArea()`.

El `POST` sí lleva `requireCommunityRole('PRESIDENT', 'ADMIN')` como chequeo
groso, igual que el `POST` de incidencias. La función lo repite dentro de la
transacción: si el guard se olvidara, el endpoint seguiría siendo seguro.

Cuerpos, todos `.strict()`:

| Ruta | Campos | Regla |
|---|---|---|
| `POST` | `title` 3–120 y `body` 1–5000 obligatorios; `type` enum, `priority` enum, `isPinned` booleano, `publishAt` ISO-8601 con offset, `expiresAt` ISO-8601 con offset o `null` — todos opcionales | Los ausentes usan el default de la columna (`GENERAL`, `MEDIUM`, `false`, `now()`, `null`). `expiresAt > publishAt` si ambos van; `authorId` y `communityId` **no** se aceptan (AN-9) |
| `PUT` | Los mismos ocho campos, **todos obligatorios** (`expiresAt` admite `null` explícito) (AN-6) | Reemplazo completo. `expiresAt ≤ publishAt` → `400`. `id`, `authorId`, `createdAt` en el cuerpo → `400` por `.strict()` |
| `GET` lista | `type` enum, `q` ≤100, `page` ≥1, `limit` 1–100 | `limit` por defecto 20. `q` busca en `title` y `body` (`ilike`) |

No hay `PATCH` y no lo habrá: la arquitectura dice `PUT`.

### 7.4 Códigos de error

| Situación | HTTP | `code` |
|---|---|---|
| Cuerpo mal formado, `type` fuera de enum, `title` corto, `expiresAt ≤ publishAt`, `q` o `page` inválidos, uuid no válido en la ruta | 400 | `VALIDATION_ERROR` |
| Sin sesión | 401 | `UNAUTHORIZED` |
| `NEIGHBOR` o `PROVIDER` en el `POST`; `NEIGHBOR`, `PROVIDER` o `PRESIDENT` en el `DELETE`; rol insuficiente dentro de la función | 403 | `FORBIDDEN` |
| El aviso no existe, está borrado, o es de otra comunidad / actor sin membresía activa | 404 | `NOT_FOUND` |

**No hay `422` y no hay `409`.** `422` no existe en este proyecto (spec 04
§7.4); `409` no puede producirse aquí: no hay índice único que pisar ni
estados que transitar (AN-11). Un caso sin `409` no lleva `409`.

### 7.5 Traducción de los errores de PL/pgSQL

`backend/src/announcements/errors.ts`, mismo patrón que `incidents/errors.ts`
y `common-areas/errors.ts`: se exige **el par** de `errcode` y sentinel, no
solo el sentinel. Un sentinel es una cadena, y cualquier valor que venga del
cliente puede acabar dentro de un mensaje de PostgreSQL; con el par, un título
que se llamase `announcement_not_found` no puede convertirse en un `404`.

| Sentinel | `errcode` | HTTP |
|---|---|---|
| `announcement_not_found` | `P0002` | 404 |
| `forbidden_role` | `42501` | 403 |
| `announcement_requires_admin` | `42501` | 403 |
| `sin contexto de usuario` | `42501` | 401 |
| — (`22P02`, uuid o enum inválido) | `22P02` | 400 |
| — (`23514`, CHECK de longitud o de ventana) | `23514` | 400 |

Un `42501` desconocido cae en `403`, por el mismo motivo que en los bloques
anteriores: una política que se cierra de más debe dar un `403` y no un `500`
que nadie sabe mirar. `announcement_requires_admin` y `forbidden_role` comparten
`errcode` y se distinguen por el sentinel: el primero es "el rol puede
gestionar este módulo pero no borrar" y el segundo, "este rol no gestiona
nada aquí".

---

## 8. Estructura de archivos

```
supabase/sql/02h_announcements.sql                          NUEVO
backend/src/announcements/middleware.ts                     NUEVO   requireAnnouncement()
backend/src/announcements/validators.ts                     NUEVO
backend/src/announcements/errors.ts                         NUEVO
backend/src/announcements/repository.ts                     NUEVO
backend/src/announcements/service.ts                        NUEVO
backend/src/announcements/controller.ts                     NUEVO
backend/src/announcements/routes.ts                         NUEVO
backend/src/announcements/__tests__/validators.unit.test.ts       NUEVO
backend/src/announcements/__tests__/errors.unit.test.ts           NUEVO
backend/src/__tests__/announcements.api.integration.test.ts        NUEVO

backend/prisma/apply-sql.ts        MODIFICADO   añade '02h_announcements.sql'
backend/prisma/seed.ts             MODIFICADO   apartado 8/8: avisos de ejemplo
backend/src/app.ts                 MODIFICADO   monta el router de avisos
supabase/sql/04_verify.sql         MODIFICADO   sección 15 (numeración en §10)
docs/API.md                        MODIFICADO   sección "Avisos"
docs/SECURITY.md                   MODIFICADO   funciones, permisos, 40 endpoints
docs/README.md                     MODIFICADO   fila de avisos en la tabla de estados
```

`02h_announcements.sql` va en la lista de `apply-sql.ts` **después** de
`02g_reservations.sql` y **antes** de `03_storage.sql`: no depende de nadie ni
nadie depende de él, y el orden alfabético de los bloques es el de los specs.

El seed gana un apartado —los siete actuales pasan de `n/7` a `n/8`— con tres
avisos: uno fijado (`MEETING`), uno caducado (`URGENT`, `expires_at` en el
pasado) y uno programado (`publish_at` en el futuro). Los tres cubren los tres
campos de la ventana de AN-4 en la primera ejecución, y el `wipe()` del seed
ya borra `announcements` (línea 123): no hace falta tocarlo.

Los tests unitarios van junto al módulo y la integración en
`backend/src/__tests__/`, dos convenciones que los bloques 02–06 ya fijaron.

---

## 9. Variables de entorno

Ninguna. Este bloque no introduce secretos ni variables nuevas.

---

## 10. Criterios de aceptación

### Permisos

- Un `NEIGHBOR` lista los avisos de su comunidad: `200`.
- Un `NEIGHBOR` que hace `POST` recibe `403`, y la función no escribe nada.
- Un `PRESIDENT` crea (`201`) y edita (`200`), pero su `DELETE` recibe `403`
  (AN-5) y la fila sigue viva.
- Un `ADMIN` borra: `200`, y el aviso desaparece del listado **para todos**,
  incluidos los `ADMIN`. Un segundo `DELETE` es `404`.
- Un `PROVIDER` no crea ni edita (`403` en `POST` y `PUT`), pero sí lista
  (`200`): la matriz §5 pone "Ver avisos" ✅ a los cuatro roles.
- Un miembro de la comunidad A no lee ni gestiona avisos de la B: `403` en el
  listado de B, `404` en el `PUT` y el `DELETE` de un id de B.
- Un `ADMIN_SA` que no es miembro recibe `403` en las dos rutas de comunidad y
  `404` en las de aviso, mismo criterio que en bloques 04 y 05.
- Un miembro **suspendido** recibe `403` en el listado y `404` en el `PUT`/`DELETE`.
- `app_runtime` **no** tiene `INSERT`, `UPDATE` ni `DELETE` sobre
  `announcements`.
- `announcements` **no** tiene política de `INSERT`, `UPDATE` ni `DELETE`.

### Ventana (AN-4, AN-7)

- Un aviso con `publishAt` en el futuro **no aparece** en el listado de un
  `NEIGHBOR`, y **sí aparece** en el de un `ADMIN` de la misma comunidad (con
  su `publishAt` real, para que el cliente lo marque como programado).
- Un aviso con `expiresAt` en el pasado **no aparece** para el `NEIGHBOR` ni
  para el `PROVIDER`, y **sí aparece** para `PRESIDENT` y `ADMIN`.
- Un aviso sin `expiresAt` nunca caduca: sigue en el listado de todos dentro
  de su ventana de publicación.
- Un aviso con `expiresAt ≤ publishAt` es `400` en el `POST` y en el `PUT`
  (zod), y la función lo rechazaría igual con el `CHECK` de la tabla.
- Los avisos borrados no aparecen para **nadie**, roles de gestión incluidos.

### Gestión

- El `PUT` sin un campo obligatorio es `400`, por `.strict()` y por el
  esquema: no hay `PATCH`.
- El `PUT` con `authorId`, `communityId`, `id` o `createdAt` en el cuerpo es
  `400`.
- Un `PUT` hecho por un `PRESIDENT` distinto del autor devuelve `200` y
  **`authorId`/`authorName` sin cambiar**: el autor es el de la publicación
  original (AN-9).
- Un `PUT` que pone `publishAt` en el futuro reprograma: el aviso sale del
  listado del `NEIGHBOR` sin cambiar de estado (porque no lo hay).
- El `DELETE` de un aviso ya borrado es `404`, no `409` ni `200`.
- `updated_at` lo pone el servidor; mandarlo es `400` por `.strict()`.

### Listado

- El orden es fijados primero y, dentro de cada grupo, `publish_at` descendente.
- `?type=MEETING` filtra por tipo; `?type=CUALQUIERA` es `400`.
- `?q=reunión` busca en título y cuerpo, case-insensitive.
- La paginación devuelve `meta = { page, limit, total, totalPages }`; `?page=0`
  y `?limit=101` son `400`.
- Un parámetro desconocido (`?pinned=true`) es `400`: los filtros son los de
  §7.3 y ninguno más.

### Contrato

- El sobre es `{ data }` en éxito y `{ error: { code, message, details? } }`
  en fallo, sin excepciones.
- Todo `4xx` lleva un `code` de la lista de §7.4, y no hay `409` ni `422` en
  el módulo.
- Los mensajes van en castellano.

### Verificación

- `npm run typecheck` sin errores.
- `npm run test:unit` verde, incluidos los unitarios de los esquemas de zod y
  de la traducción de errores.
- `npm run test:integration` verde (con `.env` y base de datos disponibles).
- `npm run check:db` y `npm run db:verify` verdes, con una sección nueva de
  avisos (numeración **15**, desplazando "INFORME" a **16**):
  - `announcements` sin política de `INSERT`, `UPDATE` ni `DELETE`.
  - `app_runtime` sin `INSERT`, `UPDATE` ni `DELETE` sobre `announcements`.
  - Las cinco funciones existen, son `SECURITY DEFINER`, tienen
    `search_path = public, pg_temp`, `execute` para `app_runtime` y **no** para
    `PUBLIC`.
  - Existen `announcements_title_length` y `announcements_body_length`
    (`not valid`), e informa de si están validados.
  - `announcements_community_publish_idx` existe (índice de AN-8) y el
    `CHECK announcements_dates_valid` existe (ventana de AN-4) — ambos ya se
    cubrían en las secciones 1 y 5 de `04_verify.sql`; se reiteran aquí por
    ser el soporte directo de este bloque.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Que una lectura directa con Prisma muestre un aviso programado o borrado: la política de `SELECT` no filtra `publish_at` ni `deleted_at` | Ninguna ruta lee `announcements` con Prisma —todas pasan por `app_list_announcements()` (AN-3)— y los tests de §10 cubren la ventana por rol contra la API. Si algún día se escribe un `findMany`, lo primero que verá es que el aviso borrado aparece: es un bug de código, y esta sección es su advertencia |
| Un `DELETE` de `ADMIN` sobre un aviso ya fijado en la home de todo el mundo, sin historial visible | Es el comportamiento pedido por la matriz (precedente incidencias) y el soft delete conserva la fila: la recuperación es un `update deleted_at = null` con privilegio, no una restauración desde backup. La UI debe confirmar antes de borrar, eso es de frontend |
| `publish_at` futuro manipulado hacia atrás para "publicar ya" | No es un ataque, es una decisión del que ya puede publicar (AN-1). El `PUT` es legítimamente reprogramable; el riesgo no existe porque el rol ya tiene ese poder |
| Un `NEIGHBOR` que recibe el id de un aviso programado por otra vía y prueba el `PUT` | `requireAnnouncement()` solo exige membresía activa; el `403` de rol lo pone la función con la fila delante, y es `403` y no `404` (§5.4): el aviso es de su comunidad, y saber que existe no le dice nada que no pueda ver cuando se publique |

---

## 12. Decisiones del desarrollador

Las tres fueron propuestas y **quedaron aprobadas con la spec** (cabecera,
2026-10-07). Las tres miran al mismo sitio: la política de escritura que el
esquema trajo por defecto no basta, y hay que decidir hasta dónde llega la
función en su lugar.

| # | Decisión | Alternativa descartada | Consecuencia técnica |
|---|---|---|---|
| **D-1** | Se **quitan** las políticas de escritura de `announcements` y se revocan los permisos a `app_runtime` | Dejar `announcements_write_leadership` y validar en la capa HTTP | §4b y §6. Mismo patrón que bloques 03, 04 y 05: las funciones son la frontera. Además, la política `for all` actual concede `DELETE` al `PRESIDENT`, que AN-5 restringe a `ADMIN`: sin eliminarla, el backend sería la única defensa y la base de datos quedaría abierta por otro camino |
| **D-2** | La ventana de visibilidad se aplica **en el listado, por rol**: `NEIGHBOR` y `PROVIDER` ven lo publicado y vivo; `PRESIDENT` y `ADMIN` ven además programados y caducados | Aplicar la ventana a todo el mundo y dar un `?includeExpired=true`; o meter estados en la fila | §5.2 y AN-7. Con la ventana universal, un aviso caducado sería inalcanzable y su `PUT`/`DELETE` imposibles: el que tiene que borrarlo no puede ni verlo. Con estados en la fila haría falta un reloj que los conmute (AN-4 descarta exactamente eso). El filtro por rol no cuesta ni un parámetro y no expone nada fuera de la comunidad |
| **D-3** | El `DELETE` es de `ADMIN` único (soft delete), no del autor ni del `PRESIDENT` | Que borre el autor; que borren ambos roles | AN-5. La matriz §5 no tiene fila "eliminar avisos" —es una laguna como las que los specs 05 y 06 cerraron para reservas—, y el precedente más cercano es "Eliminar incidencia = `ADMIN`". El `PRESIDENT` del tablón es redactor, no archivista: fija, corrige y caduca, pero el registro de lo que la comunidad ya se dijo no se destruye desde un rol que no es el último de la cadena |

### Pendiente, y no bloquea

**Notificaciones y auditoría.** Que `URGENT` genere una notificación y que
crear, editar y borrar dejen rastro en `audit_logs` son las dos cosas que este
bloque deja fuera (AN-10 y §13). Ninguna de las dos se escribe aquí: son
decisiones aparte, y escribirlas dentro de las funciones es lo único que
garantiza que no falten.

---

## 13. Fuera de alcance

- Notificaciones push/email por avisos (`URGENT` incluido) → bloque de
  notificaciones, cuando exista.
- Adjuntos de archivos a un aviso → `08-documents.md`.
- Tools `get_announcements()` / `get_announcement(id)` de MCP → specs 11 y 12.
- Comentarios o encuestas sobre un aviso → no existen en el modelo; si algún
  día existen, es una spec nueva.
- Cualquier UI: este repo es backend + SQL + docs.

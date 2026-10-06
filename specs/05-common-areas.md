# Spec 05 — Zonas comunes

> **Estado: IMPLEMENTED.** Las tres decisiones de §12 (D-1 a D-3)
> están tomadas, y CA-1 a CA-11 de §2 están cerradas.
> **Fase:** 5 (áreas comunes + reservas). Precedida de `01-authentication`,
> `02-communities`, `03-members` y `04-incidents`.
> **Base de datos:** `supabase/sql/01_schema.sql` (la tabla `common_areas` ya
> existe), `02_rls.sql` (dos políticas ya existen) y `02f_common_areas.sql`
> (archivo nuevo, en este bloque).
> **Backend:** `backend/src/common-areas/`.
> **Compañera de bloque:** `06-reservations.md`. Las dos specs son un mismo
> bloque de implementación (decisión de `ARCHITECTURE.md` §16: la fase 5 cubre
> spec 05–06 porque las reservas sin zonas no significan nada).
>
> Esta spec define el **catálogo**: quién crea y configura las zonas, cómo se
> lee su disponibilidad y qué reglas de rejilla sostienen el modelo de slots.
> El estado de las reservas, su visibilidad y su cancelación son de la spec 06.

---

## 1. Objetivo

Que la comunidad tenga un catálogo de zonas comunes —piscina, sala, gimnasio,
terraza— configurado por su administrador, y que cualquier miembro pueda mirar
qué huecos quedan libres un día dado sin tener que leer la tabla de reservas
fila a fila.

La zona común es la **unidad de configuración** de las reservas: su
`slot_minutes` es la rejilla sobre la que se discretiza el tiempo, su horario
`open_time`/`close_time` es el marco dentro del cual se puede reservar, y su
`requires_approval` decide (spec 06) si una reserva nace confirmada o pendiente.
Por eso esta spec va antes en el bloque, y por eso sus decisiones de rejilla
condicionan a la spec 06.

Fuera de alcance: crear, confirmar, cancelar y listar reservas
(`06-reservations.md`); fotos y planos de la zona (bloque de documentos);
notificaciones.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **CA-1** | El **CRUD de zonas es solo de `ADMIN`** de la comunidad. La **lectura** es de cualquier miembro activo | Incluir `PRESIDENT` en la escritura | `ARCHITECTURE.md` §5 da a `PRESIDENT` un "—" en "Gestionar zonas comunes". Es coherente con el bloque 04: el `PRESIDENT` gestiona avisos y votaciones; configurar la rejilla de reservas de la piscina es gestión con consecuencias económicas y operativas, y va al `ADMIN` |
| **CA-2** | El **nombre es único por comunidad**, sin distinguir mayúsculas (`lower(name)`, índice `common_areas_community_name_uidx` que ya existe) | Nombre libre con duplicados permitidos | Dos zonas "Piscina" y "piscina" en la misma comunidad producen dos calendarios distintos con el mismo nombre en la UI. El índice ya está en `01_schema.sql` §4.6; este bloque no lo necesita crear, solo traducir su violación a un `409` con mensaje claro |
| **CA-3** | **No hay `DELETE` físico.** La baja es `PUT` con `is_active: false` | Endpoint `DELETE /common-areas/:id` | Coherente con comunidades (C-5): `ARCHITECTURE.md` §6 no lista ningún `DELETE` de zona. Y un borrado físico arrastraría por `on delete cascade` todas las reservas y slots de la zona, borrando el histórico de uso. La baja lógica deja de admitir reservas nuevas (spec 06 R-7) y conserva las existentes, que se pueden cancelar |
| **CA-4** | El `PUT /common-areas/:id` es **reemplazo completo** de la configuración, como el `PUT` de incidencias | `PATCH` parcial | La arquitectura dice `PUT`. La configuración de una zona es un paquete coherente —horario, rejilla, límites—; un `PATCH` que permitiera cambiar `slot_minutes` sin mirar el horario abriría configuraciones incoherentes. Los campos que no son de configuración (`id`, `communityId`, `createdAt`, `updatedAt`, `createdBy`) no se aceptan en el cuerpo (`.strict()`) |
| **CA-5** | Las reservas se alinean a la **rejilla de `slot_minutes` desde medianoche local** (la timezone de la comunidad): `starts_at` y `ends_at` caen en múltiplos enteros de `slot_minutes` | Rejilla libre (cualquier minuto) | Es la condición que hace que `area_slots_no_overlap_uidx` signifique "sin solapes" y no solo "sin colisión exacta". Con rejilla libre, la reserva A 10:00–11:00 y la B 10:30–11:30 (solapadas) generan slots con claves `10:00` y `10:30`: distintas, y el índice no revienta. Alineadas, cualquier solape comparte al menos una clave. El chequeo vive en `app_create_reservation()` (spec 06), no en un `CHECK` de la tabla, porque la timezone está en `communities` y no en `common_areas` |
| **CA-6** | Las **escrituras** pasan por funciones `SECURITY DEFINER` (`app_create_common_area`, `app_update_common_area`); se elimina la política `areas_admin_write` y se revoca `insert, update, delete` sobre `common_areas` a `app_runtime` | Dejar el `for all` de `areas_admin_write` y escribir con Prisma | Mismo argumento que `02e_incidents.sql` §4a y `02d_members.sql`: una política que filtra por rol no puede validar nombre único con mensaje claro, ni el `PUT` completo, ni que `slot_minutes` esté en el enum de rejilla. Y el `grant insert, update, delete` de `02_rls.sql` §5.19 hay que revocarlo explícitamente: quitarlo de la lista no deshace un `GRANT` ya aplicado |
| **CA-7** | La **disponibilidad** se lee de `area_slots`: un slot del día está `OCCUPIED` si existe una fila de `area_slots` que lo solape, y `FREE` en caso contrario | Calcularlo uniendo `reservations` con filtro de estado | Los slots solo existen para reservas `CONFIRMED` (spec 06 R-2: las `PENDING` no escriben slots). Es decir que `area_slots` **ya es** el calendario de ocupación, sin join y sin interpretar estados. Una sola verdad, y la misma que defiende el índice único |
| **CA-8** | `requires_approval` lo **escribe** este bloque (columna de `common_areas`) y lo **usa** la spec 06 | Mantener la columna muerta, o inventar el flujo aquí | La columna ya existe en `01_schema.sql` con `default false`. Este bloque la expone en el `POST`/`PUT` de la zona; qué hace con ella una reserva es decisión de la spec 06 (D-1 allí) |
| **CA-9** | Cambiar `slot_minutes` **no reescribe** los `area_slots` ya escritos: la rejilla nueva afecta a reservas nuevas | Recalcular slots al cambiar la rejilla | Los slots son filas históricas de "quién tenía la zona a las 10:00". Recalcularlos con otra rejilla destruiría la ocupación pasada y haría imposible saber qué pasó. El `PUT` que cambia `slot_minutes` con reservas confirmadas futuras es legítimo y queda documentado: esas reservas conservan sus slots tal cual |
| **CA-10** | `capacity`, `max_daily_reservations` y `description` son **anulables**; `null` = sin límite / sin descripción | Rellenarlos con valores por defecto arbitrarios | Un `capacity` de "0 por defecto" bloquearía reservas; un `100 inventado` sería una mentira. `null` ya es el default real de la columna. Se validan al reservar (spec 06 R-7), no al crear la zona: una zona puede darse de alta incompleta y configurarse después |
| **CA-11** | No hay reservas que **crucen medianoche** en este bloque: `ends_at` local debe quedar en el mismo día calendario que `starts_at` | Franjas nocturnas | El horario `open_time`/`close_time` es diario y el `CHECK common_areas_hours_valid` exige `close_time > open_time`. Una franja 23:00–00:30 necesitaría un modelo de horario por día de la semana que no existe. Si algún día hace falta, es un cambio de modelo, no una columna más |

---

## 3. Estado real del modelo de datos

Verificado contra `01_schema.sql` y `prisma/schema.prisma` hoy.

### 3.1 `common_areas`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade`. Eje del aislamiento |
| `name` | `text not null` | **Sin `check` de longitud.** Este bloque lo añade (§4a) |
| `type` | `common_area_type not null default 'OTHER'` | `SWIMMING_POOL`, `PADEL_COURT`, `COMMUNITY_ROOM`, `GYM`, `TERRACE`, `PLAYGROUND`, `GARAGE`, `OTHER` |
| `description` | `text` | Nullable |
| `capacity` | `integer` | Nullable (CA-10) |
| `slot_minutes` | `integer not null default 60` | `check (slot_minutes in (30, 60, 90, 120))` — **ya existe** |
| `open_time` | `time not null default '08:00'` | Sin timezone: es hora local de la comunidad |
| `close_time` | `time not null default '22:00'` | `check (close_time > open_time)` — **ya existe** |
| `max_daily_reservations` | `integer` | Nullable (CA-10) |
| `requires_approval` | `boolean not null default false` | CA-8. Efecto en la spec 06 |
| `is_active` | `boolean not null default true` | CA-3 |
| `created_by` | `uuid → users(id)` | `on delete set null` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `common_areas_set_updated_at` |

### 3.2 Índices que ya existen

| Índice | Definición |
|---|---|
| `common_areas_community_name_uidx` | `unique (community_id, lower(name))` — CA-2 |
| `common_areas_community_idx` | `(community_id)` |

### 3.3 Lo que este bloque cambia en el esquema

**Nada.** `02f_common_areas.sql` no crea tablas ni columnas: solo funciones,
políticas y permisos. Es la primera spec del proyecto que no toca el modelo de
datos, y no es un olvido: `01_schema.sql` ya trae la tabla completa, con los
dos `CHECK` que hacen falta y el índice único del nombre.

El único `alter` que se plantea es el `CHECK` de longitud de `name` de §4a, y
va con `not valid` como en el bloque 04.

---

## 4. El problema del arranque

### a) `name` no tiene longitud mínima

El índice único protege contra duplicados, no contra el vacío. Un `name` de un
carácter ("·") es técnicamente válido y no debería serlo. Se añade:

```sql
alter table common_areas
  add constraint common_areas_name_length
  check (char_length(name) between 2 and 80) not valid;
```

Mismo criterio que en el bloque 04: `not valid` aplica a filas nuevas sin
fallar sobre las que ya haya; validar es un paso posterior. El esquema de zod
del backend pone 2–80 de forma independiente, igual que title en incidencias.

### b) La política `areas_admin_write` no es suficiente

`02_rls.sql` §5.6 ya restringe la escritura de `common_areas` a
`app_is_admin_of(community_id)`. Parece correcto, y lo es como guardia gruesa.
El problema es lo que **no** puede hacer:

- Traducir la violación de `common_areas_community_name_uidx` a un `409` con
  mensaje. Un `UPDATE` directo que pisa el nombre de otra zona revienta con un
  `23505` crudo.
- Validar que `slot_minutes` esté en `{30, 60, 90, 120}`: el `CHECK` de la
  tabla devuelve `23514` sin contexto.
- Asegurar el `PUT` completo: RLS no distingue un `UPDATE` de un campo de un
  `UPDATE` de todos.

La solución es la de los bloques 03 y 04: **`common_areas` se queda sin
política de `INSERT`, `UPDATE` ni `DELETE`, y `app_runtime` pierde esos
permisos.** Toda escritura entra por funciones `SECURITY DEFINER`. El
`SELECT` se queda tal cual (`areas_select_member` ya es correcto para CA-1).

### c) Las rutas de zona no llevan `communityId` en la URL

`PUT /api/v1/common-areas/:id` y `GET /api/v1/common-areas/:id/availability`
no tienen comunidad en el camino. Es el caso que la spec 04 §4c dejó anotado
como **riesgo abierto para el bloque 05**: "cada módulo con rutas sin
`communityId` necesita su propio `require*()`".

Se resuelve igual que `requireIncident()`:

```sql
create or replace function app_common_area_community(p_area uuid) returns uuid
```

Devuelve el `community_id` **solo si la zona es visible para el actor**
(miembro activo de su comunidad), y `NULL` si no. `requireCommonArea()` la
llama y traduce `NULL` → `404`. Mismo criterio C-8: un `403` confirmaría que
ese id existe. Va en `backend/src/common-areas/middleware.ts`, no en
`auth/middleware.ts`.

---

## 5. Funciones

Todas `SECURITY DEFINER`, todas con `set search_path = public, pg_temp`, todas
con `revoke execute` a `PUBLIC` y `grant execute` a `app_runtime` solamente.
Ninguna acepta un usuario como parámetro: el actor sale de
`app_current_user_id()`.

### 5.1 `app_common_area_community(p_area uuid) returns uuid`

- Devuelve `common_areas.community_id` si el actor es miembro **activo** de esa
  comunidad (`app_is_member_of`), si no `NULL`.
- No filtra por `is_active`: una zona dada de baja sigue siendo consultable por
  su comunidad (CA-3), y `PUT` es justo lo que la reactiva.

Se usa en `requireCommonArea()`, y de ahí en las cuatro rutas del módulo.

### 5.2 `app_list_common_areas(p_community_id uuid) returns table (...)`

- Guarda: `app_is_member_of(p_community_id)`, si no → `42501`.
- Devuelve **todas** las zonas de la comunidad, `is_active` incluido, orden
  `name asc`. Las dadas de baja aparecen con `isActive: false`: el `ADMIN`
  necesita verlas para reactivarlas, y al vecino no le hace daño saber que la
  sala cerró. Quien decide qué reservas admite una zona dada de baja es la
  spec 06, no este listado.

### 5.3 `app_get_common_area(p_area uuid) returns table (...)`

Una fila con el mismo predicado de §5.1. No encontrarla y no verla son el
mismo `404`. La API no expone `GET /common-areas/:id` como endpoint aparte
(`ARCHITECTURE.md` §6 no lo lista): el `PUT` responde con la zona leída por
esta función, y el listado de comunidad es la forma de leerla.

### 5.4 `app_get_area_availability(p_area uuid, p_date date) returns table (...)`

La función que sostiene `GET /common-areas/:id/availability?date`.

- Guarda: zona visible (§5.1), si no → `area_not_found` (`P0002`).
- Genera la rejilla del día: desde `open_time` hasta `close_time` en pasos de
  `slot_minutes`, en la **timezone de la comunidad** (`communities.timezone`,
  CA-D3 de §12). El instante de cada slot se calcula como "medianoche local de
  `p_date` + n × `slot_minutes`".
- Marca `OCCUPIED` los slots cuyo intervalo se solape con alguna fila de
  `area_slots` de esa zona, `FREE` los demás. **No une `reservations`:** los
  slots solo existen para reservas confirmadas (CA-7), así que la existencia
  de la fila de slot ya es la ocupación.
- No devuelve `userId`, `userName` ni `notes`: la disponibilidad dice "libre u
  ocupado", no "de quién". El detalle está en el listado de reservas (spec 06
  R-5), que es donde se decide qué se muestra de cada reserva.
- La zona dada de baja **sí** devuelve su rejilla (200): la disponibilidad es
  informativa. La prohibición de reservar sobre ella está en la spec 06.

Devuelve también `slotMinutes`, `openTime`, `closeTime` y `date` para que el
cliente dibuje la rejilla sin otra llamada.

### 5.5 `app_create_common_area(p_community_id uuid, p_name text, p_type common_area_type, p_description text, p_capacity integer, p_slot_minutes integer, p_open_time time, p_close_time time, p_max_daily_reservations integer, p_requires_approval boolean, p_is_active boolean) returns uuid`

- Guarda: hay sesión, si no → `42501` `sin contexto de usuario`.
- Guarda: `app_is_admin_of(p_community_id)`, si no → `42501` (`forbidden_role`).
  Un `PRESIDENT` recibe `403` aquí (CA-1), igual que en el `PUT`.
- `p_name` obligatorio → `22023` si nulo. Longitud la pone el `CHECK` (§4a).
- El nombre duplicado revienta con `23505` sobre
  `common_areas_community_name_uidx`; la función lo deja pasar y la traducción
  a `409` es del backend (§7.4), igual que el slug en el bloque 02.
- `created_by = app_current_user_id()`.
- Devuelve el `id`.

### 5.6 `app_update_common_area(p_area uuid, p_name text, p_type common_area_type, p_description text, p_capacity integer, p_slot_minutes integer, p_open_time time, p_close_time time, p_max_daily_reservations integer, p_requires_approval boolean, p_is_active boolean) returns setof common_areas`

- Guarda: zona visible (§5.1), si no → `area_not_found`.
- Guarda: `app_is_admin_of(...)`, si no → `42501` (`forbidden_role`).
- Es un `PUT`: los once parámetros son el valor nuevo completo. `p_description`
  nulo borra la descripción. No acepta ni `community_id` ni `created_by`.
- `slot_minutes` nuevo no reescribe slots (CA-9); la función no toca
  `area_slots`.
- Devuelve la fila leída al final, que ya pasa por el mismo `where` de
  visibilidad.

---

## 6. Políticas RLS

`02f_common_areas.sql` deja `common_areas` así:

| Comando | Cómo |
|---|---|
| `SELECT` | **No se toca.** `areas_select_member` ya es el predicado de CA-1 |
| `INSERT` | **Se elimina** `areas_admin_write` (§4b) |
| `UPDATE` | **Se elimina** `areas_admin_write` (§4b) |
| `DELETE` | **Se elimina** `areas_admin_write` (§4b). No hay endpoint y no lo habrá (CA-3) |

Y deja los permisos así:

| Permiso | Antes | Después |
|---|---|---|
| `select` on `common_areas` | ✓ | ✓ |
| `insert` on `common_areas` | ✓ | **✗** |
| `update` on `common_areas` | ✓ | **✗** |
| `delete` on `common_areas` | ✓ | **✗** |

El `revoke insert, update, delete on common_areas from app_runtime` es
indispensable y no decorativo, por el mismo motivo que en los bloques 03 y 04:
quitarlo de la lista de `grant` de `02_rls.sql` no deshace un `GRANT` ya
aplicado. Se repite también contra `anon, authenticated` por simetría con
`02e_incidents.sql`.

`02_rls.sql` **no se modifica**.

---

## 7. Contrato HTTP

### 7.1 El recurso

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "name": "Piscina",
  "type": "SWIMMING_POOL",
  "description": "Climatizada, 25 m",   // null
  "capacity": 30,                         // null = sin límite
  "slotMinutes": 60,
  "openTime": "08:00",
  "closeTime": "22:00",
  "maxDailyReservations": 2,             // null = sin límite
  "requiresApproval": false,
  "isActive": true,
  "createdBy": "uuid",                    // null si el autor se dio de baja
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

Los horarios van como cadena `HH:MM` (la hora local de la comunidad), no como
timestamp: son hora de pared, y un timestamp UTC las mostraría desplazadas en
verano.

### 7.2 Rutas

Las cuatro de `ARCHITECTURE.md` §6, sin añadir ninguna:

```
GET    /api/v1/communities/:communityId/common-areas
POST   /api/v1/communities/:communityId/common-areas
PUT    /api/v1/common-areas/:id
GET    /api/v1/common-areas/:id/availability?date
```

### 7.3 Guardas y cuerpos

| Ruta | Guardas |
|---|---|
| `GET /communities/:communityId/common-areas` | `requireAuth`, `requireCommunity()` |
| `POST /communities/:communityId/common-areas` | `requireAuth`, `requireCommunity()`, `requireCommunityRole('ADMIN')` |
| `PUT /common-areas/:id` | `requireAuth`, `requireCommonArea()` |
| `GET /common-areas/:id/availability` | `requireAuth`, `requireCommonArea()` |

**`requireCommonArea()` va en `backend/src/common-areas/middleware.ts`** (§4c),
siempre después de `requireAuth`. No lleva `requireCommunityRole`: el rol lo
resuelve la función con la fila delante, igual que `requireIncident()`.

El `POST` sí lleva `requireCommunityRole('ADMIN')` como chequeo grueso, igual
que el `POST` de incidencias. La función lo repite dentro de la transacción:
si el guard se olvidara, el endpoint seguiría siendo seguro.

Cuerpos, todos `.strict()`:

| Ruta | Campos | Regla |
|---|---|---|
| `POST` | `name` 2–80 obligatorio; `type` enum, `description` ≤500, `capacity` ≥1, `slotMinutes` ∈ {30,60,90,120}, `openTime`/`closeTime` `HH:MM` con `close > open`, `maxDailyReservations` ≥1, `requiresApproval`, `isActive` — todos opcionales | Los ausentes usan el default de la columna (§3.1). `communityId` no se acepta: va en la URL |
| `PUT` | Los mismos once campos, **todos obligatorios** (CA-4) | Reemplazo completo. `description: null` borra. `slotMinutes` fuera del enum → `400` |
| `GET` lista | Ninguno | — |
| `GET` availability | `date` obligatoria, `YYYY-MM-DD`, fecha real | Formato estricto: `2026-2-5` es `400`, no se normaliza |

### 7.4 Códigos de error

| Situación | HTTP | `code` |
|---|---|---|
| Cuerpo o ruta mal formados, `date` inválida, `slotMinutes` fuera de enum, `close ≤ open` | 400 | `VALIDATION_ERROR` |
| Sin sesión | 401 | `UNAUTHORIZED` |
| Rol insuficiente en la comunidad (`POST`/`PUT` por un no-`ADMIN`) | 403 | `FORBIDDEN` |
| La zona no existe **o no es visible** | 404 | `NOT_FOUND` |
| Nombre duplicado en la comunidad (`23505` sobre el índice) | 409 | `CONFLICT` |

Sin `422` y sin códigos nuevos de `ErrorCode`: la validación de este proyecto
es `400 VALIDATION_ERROR` (spec 04 §7.4).

### 7.5 Traducción de los errores de PL/pgSQL

`backend/src/common-areas/errors.ts`, mismo patrón que `members/errors.ts` e
`incidents/errors.ts`: se exige **el par** de `errcode` y sentinel.

| Sentinel | `errcode` | HTTP |
|---|---|---|
| `area_not_found` | `P0002` | 404 |
| `area_name_taken` | `23505` | 409 `CONFLICT` |
| `forbidden_role` | `42501` | 403 |
| `sin contexto de usuario` | `42501` | 401 |
| — (`22P02`, uuid o enum inválido) | `22P02` | 400 |
| — (`23514`, CHECK de nombre o de horas) | `23514` | 400 |

Un `23505` sin sentinel conocido cae en `409` y un `42501` desconocido en
`403`, por el mismo motivo que en los bloques anteriores.

---

## 8. Estructura de archivos

```
supabase/sql/02f_common_areas.sql                   NUEVO
backend/src/common-areas/middleware.ts              NUEVO   requireCommonArea()
backend/src/common-areas/validators.ts              NUEVO
backend/src/common-areas/errors.ts                  NUEVO
backend/src/common-areas/repository.ts              NUEVO
backend/src/common-areas/service.ts                 NUEVO
backend/src/common-areas/controller.ts              NUEVO
backend/src/common-areas/routes.ts                  NUEVO
backend/src/common-areas/__tests__/validators.unit.test.ts       NUEVO
backend/src/common-areas/__tests__/errors.unit.test.ts           NUEVO
backend/src/__tests__/common-areas.api.integration.test.ts        NUEVO

backend/prisma/apply-sql.ts        MODIFICADO   añade '02f_common_areas.sql'
backend/src/app.ts                 MODIFICADO   monta los dos routers
supabase/sql/04_verify.sql         MODIFICADO   sección 13 (numeración en §10)
docs/API.md                        MODIFICADO
docs/SECURITY.md                   MODIFICADO
```

`02f_common_areas.sql` va en la lista de `apply-sql.ts` **después** de
`02e_incidents.sql` y **antes** de `02g_reservations.sql` (que es del bloque,
spec 06): las funciones de reservas leen `common_areas` y su rejilla.

Los tests unitarios van junto al módulo y la integración en
`backend/src/__tests__/`, dos convenciones que los bloques 02–04 ya fijaron.

---

## 9. Variables de entorno

Ninguna. Este bloque no introduce secretos ni variables nuevas.

---

## 10. Criterios de aceptación

### Permisos

- Un `NEIGHBOR` lista las zonas de su comunidad: `200`.
- Un `NEIGHBOR` que hace `POST` o `PUT` recibe `403`, y el `PUT` no toca la
  base de datos.
- Un `ADMIN` de la comunidad A no ve ni configura zonas de la B: `404` en el
  `PUT` y en la disponibilidad, `0 filas`/lista vacía en el listado de B.
- Un `ADMIN_SA` que no es miembro recibe `403` en las dos rutas de comunidad y
  `404` en las dos de zona, mismo criterio que en incidencias (spec 04 §10).
- `app_runtime` **no** tiene `INSERT`, `UPDATE` ni `DELETE` sobre
  `common_areas`.
- `common_areas` **no** tiene política de `INSERT`, `UPDATE` ni `DELETE`.

### Nombre

- Dos zonas con el mismo nombre en la misma comunidad, en distinto caso
  ("Piscina" / "piscina"), es `409` en el segundo `POST` o `PUT`.
- El mismo nombre en **otra** comunidad es `201`: el único es por comunidad.
- `name` de un carácter es `400` (CHECK de longitud o zod, según la capa).

### Configuración

- El `PUT` sin un campo obligatorio es `400`, por `.strict()` y por el
  esquema: no hay `PATCH`.
- `slotMinutes: 45` es `400`. `slotMinutes: 30|60|90|120` es `200`.
- `PUT` con `closeTime` menor o igual que `openTime` es `400`.
- `PUT` que pone `isActive: false` devuelve la zona con `isActive: false`, y
  esa zona deja de admitir reservas nuevas (spec 06 R-7), sin romper las que
  ya tenía.
- `PUT` que cambia `slotMinutes` con reservas confirmadas futuras devuelve
  `200` y **no** reescribe los `area_slots` existentes (CA-9).
- `updated_at` lo pone el servidor; mandarlo es `400` por `.strict()`.

### Disponibilidad

- `GET .../availability?date=2026-10-06` sobre una zona de 08:00 a 22:00 con
  `slotMinutes: 60` devuelve **14** slots, de 08:00 a 22:00.
- Todos `FREE` si no hay reservas.
- Tras crear una reserva confirmada de 10:00 a 11:00 (spec 06), el slot
  10:00–11:00 pasa a `OCCUPIED` y los demás siguen `FREE`.
- Una reserva `PENDING` (zona con `requiresApproval: true`) **no** marca ningún
  slot como `OCCUPIED` (CA-7 + spec 06 R-2).
- Los `slotMinutes`, `openTime` y `closeTime` de la respuesta coinciden con los
  de la zona, y los instantes de la rejilla caen en la timezone de la
  comunidad.
- `date` no válida (`2026-13-40`, `06/10/2026`) es `400`.
- La disponibilidad de una zona de otra comunidad es `404`.

### Contrato

- El sobre es `{ data }` en éxito y `{ error: { code, message, details? } }` en
  fallo, sin excepciones.
- Todo `4xx` lleva un `code` de la lista de §7.4.
- Los mensajes van en castellano.

### Verificación

- `npm run typecheck` sin errores.
- `npm test` verde, incluidos los unitarios de los esquemas de zod.
- `npm run test:integration` verde.
- `npm run check:db` y `npm run db:verify` verdes, con una sección nueva de
  zonas comunes (numeración **13**, desplazando "INFORME" a 15; la de
  incidencias se queda en 10 y la de storage en 11):
  - `common_areas` sin política de `INSERT`, `UPDATE` ni `DELETE`.
  - `app_runtime` sin `INSERT`, `UPDATE` ni `DELETE` sobre `common_areas`.
  - Las seis funciones existen, son `SECURITY DEFINER`, tienen
    `search_path = public, pg_temp`, `execute` para `app_runtime` y **no** para
    `PUBLIC`.
  - Existe `common_areas_name_length` (`not valid`), e informa de si está
    validado.
  - Existe `common_areas_community_name_uidx` (ya se comprobaba en la sección 5
    de `04_verify.sql`; se mantiene).

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| `requireCommonArea()` sin usar en una de las dos rutas sin comunidad y perder el `communityId` | Es el riesgo que la spec 04 §11 dejó abierto para este bloque. Los tests de §10 lo cubren para las dos rutas, y `04_verify.sql` no puede comprobarlo: la frontera es TypeScript |
| Cambiar `slot_minutes` con reservas futuras y confundir al cliente sobre la rejilla | CA-9 lo documenta y la función no toca slots. El cliente que dibuje el calendario debe leer la zona, no asumir la rejilla anterior |
| Que la disponibilidad muestre un slot `FREE` que en realidad está reservado | No puede: el slot solo existe si la reserva está confirmada, y la confirmación escribe el slot en la misma transacción (spec 06 R-6). La carrera entre "mirar disponibilidad" y "reservar" no existe como concepto: reservar es insertar slots, y el índice único es quien decide |
| `02f_common_areas.sql` se aplica en un orden distinto al de §8 (p. ej. antes de `02_rls.sql`) y falla o nace sin `app_role_in()` | El orden en el `FILES` de `apply-sql.ts` es explícito: `02_rls.sql` → … → `02e_incidents.sql` → `02f_common_areas.sql`, antes de `02g_reservations.sql`. `db:verify` corre al final |
| El `NOT VALID` del `CHECK` de nombre se queda sin validar | `db:verify` lo informa en cada ejecución |

---

## 12. Decisiones del desarrollador

Las tres están tomadas. Ninguna queda abierta.

| # | Decisión | Alternativa descartada | Consecuencia técnica |
|---|---|---|---|
| **D-1** | Se **quitan** las políticas de escritura de `common_areas` y se revocan los permisos a `app_runtime` | Dejar `areas_admin_write` y validar en la capa HTTP | §4b y §6. Mismo patrón que bloques 03 y 04: las funciones son la frontera. Sin el `revoke`, el `GRANT` de `02_rls.sql` sigue vivo aunque la política desaparezca |
| **D-2** | La disponibilidad se calcula **solo desde `area_slots`**, sin unir `reservations` | Unir `reservations` y filtrar `status in ('PENDING','CONFIRMED')` | §5.4 y CA-7. Los slots solo existen para reservas confirmadas, así que el join es redundante y añade un segundo criterio que puede divergir del índice único. Con una sola verdad no hay nada que sincronizar |
| **D-3** | La rejilla de disponibilidad se calcula en la **timezone de la comunidad** (`communities.timezone`) | Timezone del servidor o UTC | §5.4 y CA-5. `open_time`/`close_time` son hora de pared: a las 10:00 de Valencia la piscina está abierta aunque en UTC sean las 08:00. El servidor puede estar en cualquier sitio; la comunidad no |

### Pendiente, y no bloquea

**Auditoría.** Crear y reconfigurar zonas son acciones de administración que
dejarían rastro en `audit_logs`, igual que en el bloque 04. No se escriben en
este bloque: es una decisión aparte, y escribirlas dentro de las funciones es
lo único que garantiza que no falten.

---

## 13. Fuera de alcance

- Reservas, slots, estados, cancelación y aprobación → `06-reservations.md`.
- Fotos, planos y documentación de la zona → bloque `08-documents`.
- Horarios por día de la semana o por festivos → cambio de modelo (CA-11).
- Recursos adjuntos a la zona, precios o tarifas → no están en el esquema.
- Notificaciones al dar de alta o de baja una zona.
- Búsqueda de zonas por tipo o texto.

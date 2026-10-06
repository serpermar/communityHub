# Spec 06 — Reservas

> **Estado: IMPLEMENTED.** Las cuatro decisiones de §12 (D-1 a D-4)
> están tomadas —las tres lagunas de `ARCHITECTURE.md` §5 y la aprobación por
> zona—, y R-1 a R-12 de §2 están cerradas.
> **Fase:** 5 (áreas comunes + reservas). Precedida de `01-authentication`,
> `02-communities`, `03-members` y `04-incidents`, y de `05-common-areas.md`,
> que define la rejilla sobre la que se apoya todo lo de aquí.
> **Base de datos:** `supabase/sql/01_schema.sql` (las tablas `reservations` y
> `area_slots` ya existen), `02_rls.sql` (cuatro políticas ya existen) y
> `02g_reservations.sql` (archivo nuevo, en este bloque).
> **Backend:** `backend/src/reservations/`.
>
> El eje de esta spec es **el modelo de slots**: una reserva es N filas de
> `area_slots`, el índice único `area_slots_no_overlap_uidx` es quien impide el
> solape, y toda la carrera entre dos peticiones simultáneas se resuelve en el
> motor, sin "comprobar y luego insertar". Lo demás —estados, quién ve qué,
> quién cancela— se decide alrededor de ese eje.

---

## 1. Objetivo

Que un vecino reserve una zona común de su comunidad sin que nadie pueda
reservar dos veces el mismo hueco, aunque lo intenten a la vez; que el
administrador pueda aprobar las zonas que lo requieran y cancelar lo que haga
falta; y que el resto de la comunidad pueda mirar la agenda sin leer los
motivos particulares de cada reserva.

Es el primer módulo del proyecto con **condición de carrera real**: dos
POST simultáneos sobre la piscina a la misma hora. `ARCHITECTURE.md` §14 lo
enumera como caso de prueba obligatorio, y §17 como riesgo técnico de impacto
alto. La mitigación ya está en el esquema (`area_slots` + índice único); esta
spec es la que la convierte en comportamiento garantizado por API.

Fuera de alcance: las zonas comunes como catálogo (`05-common-areas.md`);
notificaciones; reasignación o edición de reservas (solo cancelación);
reservas recurrentes; pago o fianza.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **R-1** | Reservan `NEIGHBOR`, `PRESIDENT` y `ADMIN` **activos** de la comunidad. Un `PROVIDER` no reserva | Incluir a `PROVIDER` | `ARCHITECTURE.md` §5 da a `PROVIDER` un "—" en "Reservar zona común", y el enunciado lo apoya: el proveedor no vive en la comunidad. La suspensión cuenta igual que en incidencias: `app_role_in()` solo devuelve rol de miembro `ACTIVE`, y la función lo exige además con `app_is_member_of` |
| **R-2** | El estado de una reserva **nace de la zona**: si `common_areas.requires_approval` es `false` (default), nace `CONFIRMED` y ocupa sus `area_slots` en la misma transacción; si es `true`, nace `PENDING` **sin slots** | Un flujo de aprobación fijo, o quitar `PENDING` del enum | Es la pregunta que `ARCHITECTURE.md` §5 dejó como la más pesada: "o la reserva se confirma sola y `PENDING` no existe, o no significa nada". Las dos cosas no caben a la vez, y el esquema ya traía la respuesta: la columna `requires_approval` en `common_areas`. Con ella, `PENDING` significa exactamente "esta zona pide aprobación y aún no la tiene". La alternativa de **quitar** `PENDING` del enum descartada porque `01_schema.sql` lo define, el `default` de la columna es `CONFIRMED`, y una migración de enum para eliminar un valor que el diseño ya preveía sería borrotar el modelo, no simplificarlo |
| **R-3** | **Confirma solo `ADMIN`**, con `POST /api/v1/reservations/:id/confirm`. Confirmar inserta los slots de la reserva; si el índice único revienta, el `409` y la reserva **sigue `PENDING`** | Confirmación por `PRESIDENT`; confirmación automática; que la reserva se confirme sola al crear (ignorando `requires_approval`) | "Gestionar zonas comunes" es de `ADMIN` único en la matriz (CA-1 de la spec 05), y aprobar una reserva es la gestión con más consecuencias de todas. El precedente del bloque 04 es claro: el `PRESIDENT` no mueve estados con consecuencias (D-4 allí). La confirmación **automática** por tiempo descartada porque no hay módulo de reloj, ni caducidad, ni tarea programada en este bloque: sería una garantía que nadie puede hacer cumplir. Y confirmar al crear saltándose `requires_approval` convertiría la columna en mentira |
| **R-4** | **Cancela el dueño su reserva y `ADMIN` la de cualquiera** (también una `PENDING`, que es su forma de rechazarla). El `PRESIDENT` no cancela ajenas ni propias como gestión. Cancelar es `status = 'CANCELLED'`, `cancelled_at = now()` y **borrado de sus `area_slots`**. No hay `DELETE` físico ni endpoint de borrado | Solo el dueño cancela; el `PRESIDENT` también; `DELETE` físico | Es la tercera laguna de `ARCHITECTURE.md` §5: "la intuición es que solo quien la crea la cancela, y que `ADMIN` puede, pero intuir no es decidir". Se decide aquí. El `PRESIDENT` queda fuera por el mismo motivo que en R-3: cancelar una reserva ajena es gestión con consecuencias. El borrado de slots es **obligatorio**, no un detalle: `area_slots_no_overlap_uidx` no tiene condición (`(common_area_id, starts_at)` a secas), así que un slot vivo es un slot ocupado para siempre. Si los slots no se borraran, cancelar sería un `status` sin efecto sobre el calendario. Y no hay `DELETE` físico porque el histórico de "quién reservó qué y cuándo canceló" es lo que hace útil el registro cuando hay un conflicto, y `ARCHITECTURE.md` §6 no lista ningún `DELETE` de reserva |
| **R-5** | **Cualquier miembro activo lista las reservas de su comunidad**: el calendario de uso es información comunitaria (en la washing machine el horario ocupado de la Finca se cuenta en el portal). Pero `notes` **no** sale a otros vecinos: va `null` salvo para el **dueño**, `ADMIN` y `PRESIDENT`. `GET /reservations/me` devuelve las propias del llamante en todas sus comunidades, con `notes` | Que un vecino solo vea las suyas (como incidencias I-1); o que todos vean también `notes` | Es la segunda laguna, y la propia `ARCHITECTURE.md` §5 ya da la pista: "el horario ocupado de la Finca es información que todo el mundo ve de todas formas, pero el motivo por el que lo reservas no lo es". La comparación con incidencias no encaja: una incidencia por filtraciones en el 3ºB es contenido sensible; saber que la piscina está ocupada el sábado por la tarde no lo es, y de hecho es el dato sin el cual la reserva es inútil para el vecino que quiere saber si queda hueco. El comentario de `02_rls.sql` §5.7 lo dice literalmente: "mostrar el nombre del vecino que reservó es información razonable dentro de la comunidad". `notes` se privatiza en la **función de lectura**, no en RLS: RLS no redacta columnas, y la API no expone PostgREST |
| **R-6** | El **solape se resuelve en el índice único**, nunca con un `SELECT` previo: `app_create_reservation` inserta la reserva y sus slots en la misma transacción, y un `23505` sobre `area_slots_no_overlap_uidx` se traduce a `409` | Comprobar disponibilidad y luego insertar | Es el diseño que `01_schema.sql` §4.8 ya describe y `ARCHITECTURE.md` §3 llama "la solución robusta frente al clásico check-then-insert". Un `SELECT` entre dos `INSERT` deja una ventana en la que dos peticiones ven el hueco libre; el índice no tiene ventana. La confirmación de una `PENDING` entra por el mismo camino: insertar slots, y si alguien se le adelantó, `409` |
| **R-7** | Toda reserva nueva se valida en `app_create_reservation`: zona **activa**, rol de R-1, `starts_at` en el futuro, alineación a la rejilla (CA-5 de la spec 05), `ends_at > starts_at`, dentro de `open_time`/`close_time` **locales**, `attendees ≤ capacity` si `capacity` no es nulo, y no más de `max_daily_reservations` **CONFIRMED** esa día local si el límite no es nulo | Validar solo en el esquema de zod; contar también `PENDING` en el límite diario | El prompt del proyecto (§7.3) pide impedir reservas duplicadas, fuera de horario y de usuarios no autorizados. El `CHECK` de la tabla solo cubre `ends_at > starts_at` y `attendees > 0`; el horario, la rejilla y la capacidad son reglas de negocio que viven en la función. El límite diario cuenta **solo `CONFIRMED`**: una `PENDING` no ocupa nada, y hacer que espere la aprobación ya es un límite de facto. Es además coherente con R-2 y con CA-7 de la spec 05 |
| **R-8** | Toda **lectura** pasa por funciones `SECURITY DEFINER` (`app_list_community_reservations`, `app_list_user_reservations`, `app_get_reservation`), y las respuestas llevan `userName` y `commonAreaName` | `SELECT` de Prisma con `where` | Tres cosas que un `where` en TypeScript no puede fijar a la vez: (a) el predicado de visibilidad de R-5, (b) la **redacción de `notes`** que también es R-5 y que depende del rol del llamante fila a fila, y (c) los nombres, que salen de `users` y `common_areas` y `users_select_self` no deja leer. Es la misma excepción acotada que abrieron los bloques 03 y 04 (`app_get_community_member`, `app_get_incident`) |
| **R-9** | La política `reservations_select_scoped` se **recrea**: cualquier miembro activo de la comunidad puede hacer `SELECT`. Se **eliminan** las políticas de `INSERT`, `UPDATE` y `DELETE`, y se revoca `insert, update, delete` sobre `reservations` y `area_slots` a `app_runtime` | Dejar las políticas de `02_rls.sql` §5.7 tal cual | La política actual solo deja ver al dueño y a `ADMIN`/`PRESIDENT`, y es justo lo contrario de R-5 para el vecino. Se estrecha o se ensancha hasta que la política coincida con el contrato, como en el bloque 04 con `incidents_select_scoped` y `deleted_at`. Y las escrituras van por funciones (§4a), con el `revoke` explícito de siempre. `area_slots` queda sin política de `INSERT`: solo las funciones de este bloque las escriben |
| **R-10** | `GET /communities/:id/reservations` ordena **`starts_at asc`** y pagina como incidencias (`page` ≥1, `limit` 1–100, `meta` con `total` real). Por defecto devuelve `PENDING` y `CONFIRMED`; `?status=CANCELLED` incluye las canceladas. `GET /reservations/me` usa el mismo orden y los mismos filtros, sin comunidad en la URL | Ordenar por `created_at desc` como el resto de listados | El orden natural de una agenda es el temporal: lo que viene primero. Un `created_at desc` mezclaría pasadas y futuras sin criterio útil. Y exponer las canceladas solo bajo petición evita que la agenda principal parezca un cementerio; el dueño que quiere su historial lo pide con `?status=CANCELLED` |
| **R-11** | `notes` acepta como máximo **1000 caracteres** y `""` se guarda como `null` | Sin límite; o `""` literal | El texto es opcional y su longitud es un asunto de UI, no de dominio; 1000 es holgado para "cumpleaños de Lucía". La conversión `"" → null` es el mismo criterio que C-6 del bloque 02: la cadena vacía significa "no hay", y dejarla como `""` obliga al frontend a tratar dos nulos distintos |
| **R-12** | Los errores de negocio se levantan con **sentinel + `errcode`** y se traducen en `backend/src/reservations/errors.ts` exigiendo **el par** | Traducir solo por sentinel o solo por errcode | Mismo patrón que `members/errors.ts` e `incidents/errors.ts` (spec 04 §7.5). Un sentinel es texto que viaja dentro del mensaje de PostgreSQL, y cualquier valor del cliente puede acabar ahí; con el par, un `notes` que se llamase `reservation_slot_taken` no puede convertirse en un `409` |

---

## 3. Estado real del modelo de datos

Verificado contra `01_schema.sql` y `prisma/schema.prisma` hoy.

### 3.1 `reservations`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade` |
| `common_area_id` | `uuid not null → common_areas(id)` | `on delete cascade` |
| `user_id` | `uuid not null → users(id)` | `on delete cascade`. El dueño (R-5) |
| `starts_at` | `timestamptz not null` | Alineado a la rejilla (CA-5, R-7) |
| `ends_at` | `timestamptz not null` | `check (ends_at > starts_at)` — ya existe |
| `status` | `reservation_status not null default 'CONFIRMED'` | `PENDING`, `CONFIRMED`, `CANCELLED`. R-2 |
| `attendees` | `integer` | Nullable; `check (attendees is null or attendees > 0)` — ya existe |
| `notes` | `text` | Nullable. R-5: redacción al leer |
| `cancelled_at` | `timestamptz` | Nullable. Lo pone la cancelación (R-4) |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `reservations_set_updated_at` |

### 3.2 `area_slots`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `common_area_id` | `uuid not null → common_areas(id)` | `on delete cascade` |
| `reservation_id` | `uuid not null → reservations(id)` | `on delete cascade`. Al cancelar, el `DELETE` de slots lo hace la función (R-4): la cascada solo salta con borrado físico de la reserva, y esta no se borra |
| `starts_at` | `timestamptz not null` | Empiezo del bloque de `slot_minutes` |
| `ends_at` | `timestamptz not null` | `starts_at + slot_minutes` |

Índice que sostiene todo el bloque:

| Índice | Definición |
|---|---|
| `area_slots_no_overlap_uidx` | `unique (common_area_id, starts_at)` — **sin condición**. R-6 |
| `area_slots_reservation_idx` | `(reservation_id)` |
| `area_slots_lookup_idx` | `(common_area_id, starts_at)` |

### 3.3 Índices de `reservations` que ya existen

| Índice | Definición |
|---|---|
| `reservations_community_start_idx` | `(community_id, starts_at desc)` — R-10 |
| `reservations_user_idx` | `(user_id, starts_at desc)` — `/me` |
| `reservations_area_idx` | `(common_area_id, starts_at)` |

### 3.4 Lo que este bloque cambia en el esquema

**Nada.** `02g_reservations.sql` no crea tablas ni columnas: solo funciones,
políticas y permisos. `status` con `default 'CONFIRMED'`, `cancelled_at`,
`notes`, `requires_approval` y el índice único de slots ya están en
`01_schema.sql`. No hace falta `npx prisma db pull`: `schema.prisma` ya tiene
los modelos `Reservations` y `AreaSlots` con sus columnas.

---

## 4. El problema del arranque

### a) La política de `INSERT` no puede validar el horario ni la rejilla

`reservations_insert_self` de `02_rls.sql` §5.7 exige solo que el actor sea
miembro activo y que `user_id` sea el suyo. El propio comentario del archivo lo
dice: "la comprobación de horarios, capacidad y disponibilidad NO está aquí:
eso lo hace la aplicación. RLS no puede validar reglas de negocio complejas sin
volverse inmanejable".

Y no es solo eso: con el `grant insert, update on reservations, area_slots` de
`02_rls.sql` §5.19, cualquier conexión que hable con PostgREST como
`app_runtime` puede escribir **cualquier columna**: montar una reserva
`CONFIRMED` ajenas con `user_id` de otro, o con `status` inventado, o insertar
`area_slots` sueltos que bloqueen la piscina sin reserva detrás.

La solución de los bloques 03 y 04, otra vez: **`reservations` y `area_slots`
se quedan sin políticas de `INSERT`, `UPDATE` ni `DELETE`, y `app_runtime`
pierde esos permisos.** Las tres operaciones de escritura —crear, confirmar,
cancelar— son funciones `SECURITY DEFINER`. El `SELECT` sí se queda, recreado
para R-5.

### b) Cancelar no puede ser solo un `UPDATE` de `status`

El esquema ya contempla la cancelación (`status`, `cancelled_at`), pero la
carrera de R-6 vive en `area_slots`. Un `UPDATE reservations set status =
'CANCELLED'` que no toque los slots deja la reserva "cancelada" en el calendario
para siempre: la piscina seguiría bloqueada, y ni el `ADMIN` ni el dueño
podrían reservar ese hueco aunque la app dijera que está libre. Es el fallo
silencioso más caro de todo el bloque.

Por eso la cancelación es **una sola función**, `app_cancel_reservation`, que
en la misma transacción pone el `status`, el `cancelled_at` y hace `delete from
area_slots where reservation_id = ...`. No hay forma de llegar al `UPDATE` por
la API, porque `app_runtime` ya no tiene permiso de `UPDATE`.

### c) Las rutas de reserva no llevan `communityId` en la URL

`PATCH /reservations/:id/cancel` y `POST /reservations/:id/confirm` no tienen
comunidad en el camino. Es el mismo caso que la spec 05 §4c, resuelto con la
misma pieza: `app_reservation_community(p_reservation uuid) returns uuid`,
devuelve la comunidad **solo si la reserva es visible para el actor** según R-5
(miembro activo de su comunidad), y `NULL` si no. `requireReservation()` la
llama y traduce `NULL` → `404`. Va en `backend/src/reservations/middleware.ts`.

`GET /reservations/me` **no** lo necesita: no hay recurso que resolver, y el
ámbito lo pone la propia función (`user_id = app_current_user_id()`).

---

## 5. Funciones

Todas `SECURITY DEFINER`, todas con `set search_path = public, pg_temp`, todas
con `revoke execute` a `PUBLIC` y `grant execute` a `app_runtime` solamente.
Ninguna acepta un usuario como parámetro.

### 5.1 El predicado de visibilidad, en un solo sitio

R-5 aparece en tres sitios —listado de comunidad, `/me`, detalle— y si se
escribiera tres veces, tres veces podría divergir. La parte de "¿puede ver
esta fila?" se escribe una vez:

```sql
-- Devuelve true si el actor puede ver la reserva `target`.
create or replace function app_can_see_reservation(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from reservations r
     where r.id = target
       and app_is_member_of(r.community_id)
  )
$$;
```

Es más ancho que el de incidencias, y a propósito: R-5 no filtra por dueño
para la **visibilidad de la fila**, solo para la **redacción de `notes`**, que
es una capa aparte (§5.6). Se usa en `app_get_reservation`,
`app_cancel_reservation`, `app_confirm_reservation` y
`app_reservation_community`.

### 5.2 `app_reservation_community(p_reservation uuid) returns uuid`

Devuelve `reservations.community_id` si el actor puede ver la reserva (§5.1),
`NULL` si no. Es la pieza de §4c, y se comporta como `app_incident_community`:
un `NULL` se traduce en `404`, nunca en `403`.

### 5.3 `app_create_reservation(p_common_area uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_attendees integer, p_notes text) returns uuid`

La función más densa del bloque. Guardas, en este orden, porque cada una es
más específica que la anterior y el error que ve quien llama debe ser el más
informativo:

1. **Contexto:** hay sesión, si no → `42501` `sin contexto de usuario`.
2. **Zona visible:** `app_common_area_community(p_common_area)` no es `NULL`,
   si no → `area_not_found` (`P0002`).
3. **Zona activa:** `common_areas.is_active`, si no →
   `reservation_area_inactive` (`22023`, 400). CA-3 de la spec 05 se cumple
   aquí, no en la política.
4. **Rol:** `app_role_in(...) in ('NEIGHBOR', 'PRESIDENT', 'ADMIN')`, si no →
   `42501` (`forbidden_role`). Un `PROVIDER` o un suspendido recibe `403`
   (R-1). `app_role_in` ya exige membresía `ACTIVE`.
5. **Tiempo:** `p_starts_at >= now()`, si no → `reservation_in_the_past`
   (`22023`, 400).
6. **Orden:** `p_ends_at > p_starts_at`, si no → `22023`. El `CHECK` de la tabla
   también lo cubre, pero llegar a él es un `23514` sin contexto.
7. **Rejilla:** `p_starts_at` y `p_ends_at` caen en múltiplos enteros de
   `slot_minutes` desde medianoche **local** (la timezone de la comunidad), y
   con segundos y microsegundos a cero, si no → `reservation_misaligned`
   (`22023`, 400). CA-5 de la spec 05: sin esto, el índice único no detecta
   solapes parciales.
8. **Horario:** la hora local de `p_starts_at` es ≥ `open_time` y la hora local
   de `p_ends_at` es ≤ `close_time`, si no → `reservation_outside_hours`
   (`22023`, 400). Con la alineación de 7, una franja que cruciese medianoche
   local ya ha caído antes: sus horas locales no caen dentro del día.
9. **Capacidad:** `p_attendees` no nulo y `capacity` de la zona no nulo y
   `p_attendees > capacity` → `reservation_capacity_exceeded` (`22023`, 400).
10. **Límite diario:** si `max_daily_reservations` no es nulo, contar
    `reservations` de esa zona con `status = 'CONFIRMED'` cuyo `starts_at` caiga
    en el día local de `p_starts_at`; si el contador es ≥ el límite →
    `reservation_daily_limit` (`22023`, 400). Cuenta solo `CONFIRMED` (R-7).
11. **Estado inicial:** `status = 'CONFIRMED'` si `requires_approval` es
    `false`, `'PENDING'` si es `true` (R-2). El cliente no manda `status` y no
    existe parámetro para ello.
12. **Slots:** solo si el estado es `CONFIRMED`, insertar una fila de
    `area_slots` por cada bloque de `slot_minutes` entre `starts_at` y
    `ends_at`. Si el `INSERT` revienta con `23505` sobre
    `area_slots_no_overlap_uidx`, la transacción entera revienta y la reserva
    no existe: `reservation_slot_taken` (`23505`, 409). Es R-6, y es la única
    forma en que dos reservas pueden disputar el mismo hueco.
13. `user_id = app_current_user_id()` y `community_id =` el de la zona. No hay
    parámetro para ninguno de los dos.
14. Devuelve el `id`. La API responde con una lectura posterior
    (`app_get_reservation`), que ya pasa por la redacción de R-5.

### 5.4 `app_confirm_reservation(p_reservation uuid) returns void`

- Guarda: `app_can_see_reservation(p_reservation)`, si no →
  `reservation_not_found` (`P0002`).
- Guarda: `app_is_admin_of(...)` sobre la comunidad de la reserva, si no →
  `42501` (`forbidden_role`). Solo `ADMIN` (R-3). El `PRESIDENT` recibe `403`
  aunque sea su comunidad y aunque la reserva sea suya.
- Guarda: `status = 'PENDING'`, si no → `reservation_not_pending` (`22023`,
  409). Confirmar una `CONFIRMED` o una `CANCELLED` es un `409`, no un no-op
  silencioso ni un `404`: la reserva es visible para el actor (es de su
  comunidad), así que esconderla detrás de un `404` sería mentir.
- Inserta los slots como en §5.3 paso 12, desde la `starts_at` de la reserva
  con la rejilla de su zona. `23505` → `reservation_slot_taken` (409) y la
  reserva **sigue `PENDING`**: el `ADMIN` puede cancelarla o esperar a que el
  otro hueco se libere. No se auto-cancela, porque quien decide es quien
  aprobó.
- `status = 'CONFIRMED'`. `updated_at` lo pone el trigger.

### 5.5 `app_cancel_reservation(p_reservation uuid) returns void`

- Guarda: `app_can_see_reservation(p_reservation)`, si no →
  `reservation_not_found`.
- Guarda: el actor es el dueño, o `app_is_admin_of(...)`, si no → `42501`
  (`forbidden_role`). Un `PRESIDENT` recibe `403` en los dos casos (R-4).
- Guarda: `status <> 'CANCELLED'`, si no → `reservation_not_cancelled`-aún-no:
  en la práctica, `reservation_not_pending` no encaja aquí, así que el sentinel
  es `reservation_already_cancelled` (`22023`, 409). Cancelar dos veces es un
  `409`, no un no-op: la segunda no cambia nada, y un `200` sin efecto es peor
  que un error que lo dice.
- `status = 'CANCELLED'`, `cancelled_at = now()`.
- `delete from area_slots where reservation_id = p_reservation` (§4b). Este
  `DELETE` lo ejecuta la función como propietaria de los datos, no
  `app_runtime`: el permiso está revocado.
- Se puede cancelar una reserva `PENDING`: es el rechazo del `ADMIN` (R-4).

### 5.6 Lecturas

Todas `SECURITY DEFINER` por R-8. Las tres incluyen `user_name` (de
`users.full_name`) y `common_area_name` (de `common_areas.name`).

**`app_list_community_reservations(p_community_id uuid, p_common_area uuid, p_date date, p_status reservation_status, p_limit integer, p_offset integer) returns table (...)`**

- El `where` combina `app_is_member_of(p_community_id)` con los filtros
  opcionales. **El `community_id` de la ruta va en el `where`**: en el listado
  no es una comprobación, es el ámbito.
- `p_date` filtra por el **día local** de la comunidad
  (`starts_at at time zone timezone` cae en `p_date`), no por el día UTC: a
  las 23:00 de Valencia ya es otro día en UTC, y la agenda es local.
- `p_status` nulo devuelve `PENDING` y `CONFIRMED` (R-10). Pasar
  `'CANCELLED'` devuelve canceladas; no hay combinaciones de varios estados en
  una misma llamada, y no hacen falta: el cliente que quiera las dos cosas hace
  dos llamadas.
- **Redacción de `notes`:** la columna sale como `r.notes` solo si
  `app_role_in(r.community_id) in ('ADMIN', 'PRESIDENT')` o
  `r.user_id = app_current_user_id()`; para el resto va `null`. Es R-5, y vive
  aquí porque RLS no redacta columnas.
- Orden `starts_at asc` (R-10). `p_limit` se acota a 100 en la función, no solo
  en el esquema.
- Última columna `total_count bigint` con el total **antes** de paginar.

**`app_list_user_reservations(p_status reservation_status, p_limit integer, p_offset integer) returns table (...)`**

`GET /reservations/me`. Mismo esquema que el anterior, pero sin `community_id`
en el `where`: el ámbito es `r.user_id = app_current_user_id()`, y las
comunidades salen en la respuesta (`community_id`, `community_name` vía join
con `communities`, que es legible para cualquier miembro). Incluye
`common_area_name`. `notes` sale siempre: el llamante es el dueño de todas las
filas. Orden `starts_at asc`, mismo acote de `p_limit`, misma `total_count`.

**`app_get_reservation(p_reservation uuid) returns table (...)`**

Una fila con el predicado de §5.1. Redacción de `notes` idéntica a la del
listado de comunidad: dueño, `ADMIN` y `PRESIDENT` ven el texto; un tercero
recibiría `null`, aunque en la práctica las rutas de escritura (§5.4, §5.5)
solo las alcanzan el dueño y el `ADMIN`. Devuelve también `community_name` y
`common_area_name`. No encontrarla y no verla son el mismo `404`.

---

## 6. Políticas RLS

`02g_reservations.sql` deja las tablas así:

**`reservations`**

| Comando | Cómo |
|---|---|
| `SELECT` | Se **recrea** `reservations_select_scoped`: `app_is_member_of(community_id)`, sin más (R-5, R-9) |
| `INSERT` | **Se elimina** `reservations_insert_self` (§4a) |
| `UPDATE` | **Se elimina** `reservations_update_scoped` (§4a) |
| `DELETE` | **Se elimina** `reservations_delete_admin` (§4a). No hay endpoint (R-4) |

**`area_slots`**

| Comando | Cómo |
|---|---|
| `SELECT` | Se **recrea** `slots_via_reservation`: existe la reserva de esa fila y el actor es miembro activo de su comunidad |
| `INSERT` | **Se elimina** `slots_insert_own_reservation` (§4a) |
| `UPDATE`/`DELETE` | No hay políticas, y no las hay ahora tampoco |

Y deja los permisos así:

| Permiso | Antes | Después |
|---|---|---|
| `select` on `reservations` | ✓ | ✓ |
| `insert`, `update`, `delete` on `reservations` | ✓ | **✗** |
| `select` on `area_slots` | ✓ | ✓ |
| `insert`, `update` on `area_slots` | ✓ | **✗** |

El `revoke insert, update, delete on reservations, area_slots from app_runtime`
es indispensable, y se repite contra `anon, authenticated`. La recreación de
`reservations_select_scoped` **estrecha el `SELECT` de RLS para nadie y lo
ensancha para el vecino**: antes solo veía las suyas y las de `ADMIN`/
`PRESIDENT`; ahora ve todas las de su comunidad, que es el contrato de R-5. La
redacción de `notes` no está en la política (no puede): está en las funciones
de §5.6, que son las únicas vías de lectura de la API.

`02_rls.sql` **no se modifica**.

---

## 7. Contrato HTTP

### 7.1 El recurso

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "commonAreaId": "uuid",
  "commonAreaName": "Piscina",
  "userId": "uuid",
  "userName": "Marta Ruiz",
  "startsAt": "2026-10-06T08:00:00.000Z",
  "endsAt": "2026-10-06T09:00:00.000Z",
  "status": "CONFIRMED",       // PENDING | CONFIRMED | CANCELLED
  "attendees": 4,               // null
  "notes": "Cumpleaños de Lucía",  // null si no se dijo, o si no es tuya (R-5)
  "cancelledAt": null,
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

`notes` en una lista donde el llamante no es dueño, `ADMIN` ni `PRESIDENT` es
`null`, y es `null` también cuando no se rellenó: la API no distingue "no hay
notas" de "no te las enseño", porque la distinción solo beneficiaría a un
atacante que quiera saber si hay texto oculto.

### 7.2 Rutas

Las seis de `ARCHITECTURE.md` §6, **sin añadir ninguna**: cuatro ya estaban
(`POST /common-areas/:id/reservations`, los dos listados y `PATCH /cancel`), y
`GET /reservations/:id` y `POST /reservations/:id/confirm` entraron al cerrar
las lagunas de §5. El `GET /:id` es además el recurso canónico al que apunta el
`Location` del `POST` y al que la UI necesita acceder en detalle:

```
POST   /api/v1/common-areas/:id/reservations
GET    /api/v1/communities/:communityId/reservations    ?commonAreaId&date&status&page&limit
GET    /api/v1/reservations/me                          ?status&page&limit
GET    /api/v1/reservations/:id
PATCH  /api/v1/reservations/:id/cancel
POST   /api/v1/reservations/:id/confirm
```

### 7.3 Guardas y cuerpos

| Ruta | Guardas |
|---|---|
| `POST /common-areas/:id/reservations` | `requireAuth`, `requireCommonArea()`, `requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN')` |
| `GET /communities/:communityId/reservations` | `requireAuth`, `requireCommunity()` |
| `GET /reservations/me` | `requireAuth` |
| `GET /reservations/:id` | `requireAuth`, `requireReservation()` |
| `PATCH /reservations/:id/cancel` | `requireAuth`, `requireReservation()` |
| `POST /reservations/:id/confirm` | `requireAuth`, `requireReservation()` |

**`requireReservation()` va en `backend/src/reservations/middleware.ts`** (§4c),
siempre después de `requireAuth`.

`GET /reservations/:id`, `PATCH /cancel` y `POST /confirm` **no** llevan
`requireCommunityRole`, ni siquiera el confirm un `requireCommunityRole('ADMIN')`.
Es la decisión que la spec 04 §7.3 ya tomó para incidencias y que aquí se
repite: el rol lo decide la función, dentro de la transacción, con la fila
delante. Un guard en la ruta daría el mismo `403` con un mensaje peor, y si el
guard se olvidara el endpoint seguiría seguro; al revés —si la comprobación
viviera solo en el guard— el mismo endpoint sería un agujero por PostgREST.

Cuerpos, todos `.strict()`:

| Ruta | Campos | Regla |
|---|---|---|
| `POST` | `startsAt` y `endsAt` ISO 8601 obligatorios; `attendees` ≥1 opcional; `notes` ≤1000 opcional | `status`, `userId` y `communityId` **no** se aceptan (R-2, R-6). `""` en `notes` se guarda como `null` (R-11) |
| `PATCH /cancel` | Cuerpo vacío `{}` o ausente | No hay campos que cambiar: cancelar es cancelar |
| `POST /confirm` | Cuerpo vacío `{}` o ausente | Ídem |
| `GET` lista | `commonAreaId` uuid, `date` `YYYY-MM-DD` real, `status` enum, `page` ≥1, `limit` 1–100 | `limit` por defecto 20 |
| `GET /me` | `status`, `page`, `limit` | Sin `commonAreaId`: el ámbito es el usuario |
| `GET /:id` | Ninguno | — |

### 7.4 Códigos de error

| Situación | HTTP | `code` |
|---|---|---|
| Cuerpo o ruta mal formados; horario fuera de la zona; alineación de rejilla; reserva en el pasado; zona inactiva; capacidad o límite diario excedidos; `attendees ≤ 0` | 400 | `VALIDATION_ERROR` |
| Sin sesión | 401 | `UNAUTHORIZED` |
| Rol que no reserva (`PROVIDER`, suspendido); `PRESIDENT` que confirma o cancela ajena; no miembro | 403 | `FORBIDDEN` |
| La reserva no existe **o no es visible**; el `:id` de zona no es visible en el `POST` | 404 | `NOT_FOUND` |
| Solape de slot (`23505`); confirmar una reserva que no está `PENDING`; cancelar una ya cancelada | 409 | `CONFLICT` |

Sin `422` y sin códigos nuevos de `ErrorCode` (spec 04 §7.4).

### 7.5 Traducción de los errores de PL/pgSQL

`backend/src/reservations/errors.ts`, mismo patrón que los anteriores: se exige
**el par** de `errcode` y sentinel (R-12).

| Sentinel | `errcode` | HTTP |
|---|---|---|
| `reservation_not_found` | `P0002` | 404 |
| `reservation_not_pending` | `22023` | 409 `CONFLICT` |
| `reservation_already_cancelled` | `22023` | 409 `CONFLICT` |
| `reservation_slot_taken` | `23505` | 409 `CONFLICT` |
| `reservation_outside_hours` | `22023` | 400 |
| `reservation_misaligned` | `22023` | 400 |
| `reservation_in_the_past` | `22023` | 400 |
| `reservation_area_inactive` | `22023` | 400 |
| `reservation_capacity_exceeded` | `22023` | 400 |
| `reservation_daily_limit` | `22023` | 400 |
| `forbidden_role` | `42501` | 403 |
| `sin contexto de usuario` | `42501` | 401 |
| — (`22P02`, uuid o enum inválido) | `22P02` | 400 |
| — (`23514`, CHECK de la tabla) | `23514` | 400 |

Las tres de negocio de `409` y las seis de `400` comparten `errcode` entre sí y
con los de la spec 05; los sentinels las distinguen, y el par (errcode,
sentinel) es lo que impide que un valor del cliente se cuelgue en la
traducción. Un `23505` sin sentinel conocido cae en `409` y un `42501`
desconocido en `403`.

---

## 8. Estructura de archivos

```
supabase/sql/02g_reservations.sql                   NUEVO
backend/src/reservations/middleware.ts              NUEVO   requireReservation()
backend/src/reservations/validators.ts              NUEVO
backend/src/reservations/errors.ts                  NUEVO
backend/src/reservations/repository.ts              NUEVO
backend/src/reservations/service.ts                 NUEVO
backend/src/reservations/controller.ts              NUEVO
backend/src/reservations/routes.ts                  NUEVO
backend/src/reservations/__tests__/validators.unit.test.ts       NUEVO
backend/src/reservations/__tests__/errors.unit.test.ts           NUEVO
backend/src/__tests__/reservations.api.integration.test.ts        NUEVO

backend/prisma/apply-sql.ts        MODIFICADO   añade '02g_reservations.sql'
backend/prisma/seed.ts             MODIFICADO   zonas y reservas de demostración
backend/src/app.ts                 MODIFICADO   monta los dos routers
supabase/sql/04_verify.sql         MODIFICADO   sección 14 (numeración en §10)
docs/API.md                        MODIFICADO
docs/SECURITY.md                   MODIFICADO
```

`02g_reservations.sql` va en `apply-sql.ts` **después** de
`02f_common_areas.sql` y **antes** de `03_storage.sql`: lee `common_areas` y
su rejilla, y se apoya en `app_role_in()` y `app_is_member_of()` de
`02_rls.sql`.

El **test de concurrencia** (§10) va en
`backend/src/__tests__/reservations.api.integration.test.ts`: dos `POST`
simultáneos con `Promise.all` sobre el mismo hueco, esperando un `201` y un
`409`. Es el caso que `ARCHITECTURE.md` §14 exige y §17 mitiga.

`seed.ts` ya borra `areaSlots`, `reservations` y `commonAreas` en su `wipe()`;
este bloque añade la parte de altas: una zona de `requires_approval: false` y
otra de `true` por comunidad, con dos o tres reservas repartidas para que la
demo no empiece vacía.

---

## 9. Variables de entorno

Ninguna. Este bloque no introduce secretos ni variables nuevas.

---

## 10. Criterios de aceptación

### Seguridad y aislamiento

- Un miembro de la comunidad A **no** reserva en zonas de la B: el `POST` es
  `404` (la zona no es visible), no `403`.
- Un miembro de la comunidad A **no** ve ninguna reserva de la B: `0 filas` en
  el listado de A sobre una zona de B, y `404` al abrir por id una reserva de
  B.
- Un `PROVIDER` que intenta reservar recibe `403`.
- Un miembro **suspendido** no reserva: `403` (R-1).
- `app_runtime` **no** tiene `INSERT`, `UPDATE` ni `DELETE` sobre
  `reservations` ni sobre `area_slots`.
- `reservations` **no** tiene política de `INSERT`, `UPDATE` ni `DELETE`;
  `area_slots` tampoco de `INSERT`.
- Un `ADMIN_SA` que no es miembro recibe `403` en la ruta de listado de la
  comunidad y `404` en las cuatro rutas de reserva, mismo criterio que en
  incidencias.

### Solapes y concurrencia (el test central del bloque)

- Dos reservas del mismo hueco, la segunda intentada después de la primera:
  `409` en la segunda, y la primera sigue intacta.
- Dos `POST` **simultáneos** (`Promise.all`) sobre el mismo hueco: exactamente
  uno devuelve `201` y el otro `409`. Nunca los dos `201`, nunca un `500`.
- Un solape **parcial** (10:00–11:00 contra 10:30–11:30, rejilla de 30) es
  `409`: es la consecuencia directa de la alineación de CA-5. Sin alineación,
  este criterio fallaría y nadie lo vería hasta que dos vecinos chocaran en la
  piscina.
- Confirmar una `PENDING` cuyo hueco se ocupó entretanto es `409`, y la
  reserva **sigue `PENDING`**, visible para el `ADMIN` en el listado.
- Cancelar una reserva libera sus slots: después de cancelar, el mismo hueco
  se puede reservar de nuevo (`201`).
- Cancelar y reservar a la vez dos veces el mismo hueco liberado: una sola
  gana, igual que en el primer criterio.

### Horario, rejilla y límites

- Reserva fuera de `open_time`/`close_time` (locales) → `400`.
- `starts_at` no alineado a `slot_minutes` (p. ej. 10:15 con rejilla de 60) →
  `400`.
- `starts_at` en el pasado → `400`.
- Zona con `isActive: false` → `400` al reservar; las reservas ya hechas
  siguen visibles y cancelables.
- `attendees` mayor que `capacity` de la zona → `400`.
- Superar `max_daily_reservations` con reservas `CONFIRMED` del día local →
  `400`; las `PENDING` **no** cuentan.
- Una reserva de 09:00 a 11:00 en zona de 60 minutos inserta **dos** filas de
  `area_slots`.

### Estados y aprobación (R-2 y R-3)

- Zona sin `requiresApproval` → la reserva nace `CONFIRMED` y su slot aparece
  ocupado en la disponibilidad.
- Zona con `requiresApproval: true` → la reserva nace `PENDING`, **no** ocupa
  slots en la disponibilidad, y `POST /reservations/:id/confirm` la pasa a
  `CONFIRMED` ocupándolos.
- `POST` con `status` en el cuerpo es `400`, por `.strict()`.
- Confirmar una `CONFIRMED` es `409`. Confirmar una `CANCELLED` es `409`.
- Confirmar por un `PRESIDENT` es `403`, aunque la reserva sea suya.
- Confirmar por un `NEIGHBOR` es `403`.
- Confirmar una reserva de otra comunidad es `404`.

### Cancelación (R-4)

- El dueño cancela la suya: `200`, `status: "CANCELLED"`, `cancelledAt` con
  valor, y el slot libre.
- Un `ADMIN` cancela la de un vecino: `200`.
- Un `PRESIDENT` cancela la suya: `403`. La de otro: `403`.
- Un `NEIGHBOR` intenta cancelar la de otro vecino de su comunidad: `403` (la
  ve, porque R-5 es de visibilidad, pero no es suya ni es `ADMIN`).
- Cancelar dos veces: la segunda es `409`, no un `200` sin efecto ni un `404`.
- Cancelar una `PENDING` es `200` (el rechazo del `ADMIN`).
- No hay `DELETE /reservations/:id`: la ruta es `404` de endpoint, y la
  cancelación no borra la fila.

### Visibilidad (R-5)

- Un `NEIGHBOR` lista las reservas de su comunidad y ve las de otros vecinos,
  con `userName`, sin `notes` (`null`).
- El **dueño** ve su propia reserva con `notes` en el listado, en `/me` y en
  el `GET /:id`.
- Un `ADMIN` y un `PRESIDENT` ven `notes` de las ajenas.
- `GET /reservations/me` devuelve solo reservas del llamante, de **todas** sus
  comunidades, con `notes`.
- El listado de comunidad, por defecto, **no** incluye canceladas;
  `?status=CANCELLED` las incluye. El orden es `starts_at asc`.
- `GET /communities/:id/reservations?date=...` filtra por el **día local** de
  la comunidad.
- Paginación: `meta` con `page`, `limit`, `total`, `totalPages`, y `total` sin
  paginar. `limit: 1000` es `400`.

### Disponibilidad

- La disponibilidad de la zona marca `OCCUPIED` los slots de una reserva
  `CONFIRMED` y los deja `FREE` tras cancelarla.
- Una reserva `PENDING` no aparece en la disponibilidad.
- La disponibilidad no devuelve `userName` ni `notes` de nadie.

### Contrato

- El sobre es `{ data }` en éxito y `{ error: { code, message, details? } }` en
  fallo, sin excepciones.
- Todo `4xx` lleva un `code` de la lista de §7.4.
- Los mensajes van en castellano.
- El `POST` de reserva responde `201` con `Location: /api/v1/reservations/{id}`,
  y ese `GET` devuelve la reserva.

### Verificación

- `npm run typecheck` sin errores.
- `npm test` verde, incluidos los unitarios de los esquemas de zod.
- `npm run test:integration` verde, **con el test de concurrencia**.
- `npm run check:db` y `npm run db:verify` verdes, con una sección nueva de
  reservas (numeración **14**, desplazando "INFORME" a 15):
  - `reservations` y `area_slots` sin políticas de `INSERT`, `UPDATE` ni
    `DELETE` (en `area_slots`, sin política de `INSERT`).
  - `app_runtime` sin `INSERT`, `UPDATE` ni `DELETE` sobre las dos tablas.
  - Las ocho funciones existen, son `SECURITY DEFINER`, tienen
    `search_path = public, pg_temp`, `execute` para `app_runtime` y **no** para
    `PUBLIC`.
  - `reservations_select_scoped` menciona `app_is_member_of` y no filtra por
    `user_id` ni por rol: es el predicado de R-5.
  - `area_slots_no_overlap_uidx` sigue existiendo y es `unique (common_area_id,
    starts_at)` **sin** cláusula `where`: con una condición parcial, dos
    reservas `CANCELLED` con slots huérfanos no chocarían, y el modelo de R-4
    dependería de que nadie olvide borrar slots.
  - `reservations.status` tiene `default 'CONFIRMED'` y el enum contiene los
    tres valores.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Solape de reservas bajo concurrencia (el riesgo nº 1 del proyecto en esta zona) | `area_slots` + índice único sin condición; nunca check-then-insert (R-6); test de concurrencia obligatorio en §10. Si el índice aparece con `where` en algún día, `db:verify` lo detecta |
| Que alguien escriba `area_slots` a mano y bloquee una zona sin reserva detrás | `app_runtime` sin permiso de `INSERT` sobre la tabla; solo las tres funciones del bloque la tocan |
| Cancelar sin borrar slots y dejar la zona bloqueada para siempre | La cancelación es una única función que hace las dos cosas (§4b); `app_runtime` no tiene `UPDATE` ni `DELETE` con los que escaparse |
| `notes` filtrado por la función pero visible por RLS para quien hablara con PostgREST como `postgres` | Aceptado y documentado: el único cliente de la API es `app_runtime`, y `anon`/`authenticated` no tienen grants sobre `reservations`. La redacción es contrato de la API, no de la BD |
| Cambiar `slot_minutes` de una zona con reservas futuras y desalinear la rejilla | CA-9 de la spec 05: los slots existentes no se reescriben y las reservas futuras se validan contra la rejilla **al momento de crearlas**, no al cambiar la zona. Una reserva creada antes de cambiar la rejilla conserva sus slots |
| El límite diario contando en timezone equivocada y dejando reservas "de más" a medianoche | El conteo usa el día **local** de la comunidad, igual que el filtro `date` del listado. Es la misma decisión D-3 de la spec 05 aplicada al recuento |
| `02g_reservations.sql` se aplica en un orden distinto al de §8 (p. ej. antes de `02_rls.sql`) y las funciones nacen sin `app_role_in()` o `app_is_member_of()` —el fallo llegaría en el primer uso, no al crearlas | El orden en el `FILES` de `apply-sql.ts` es explícito: `02_rls.sql` → … → `02e_incidents.sql` → `02f_common_areas.sql` → `02g_reservations.sql`, antes de `03_storage.sql`. `db:verify` corre al final y comprueba que las ocho funciones existen |
| Dos `PATCH /cancel` simultáneos del dueño y del `ADMIN` | Uno entra y el otro recibe `409` (`reservation_already_cancelled`), por el mismo argumento que dos `PATCH /status` de incidencias: nunca los dos `200` |

---

## 12. Decisiones del desarrollador

Las cuatro están tomadas. Ninguna queda abierta. Las tres primeras son literalmente las lagunas que `ARCHITECTURE.md` §5
dejó escritas para el bloque 05; la cuarta cierra la que el propio esquema ya
había dejado a medio decidir.

| # | Decisión | Alternativa descartada | Consecuencia técnica |
|---|---|---|---|
| **D-1** | `PENDING` **existe y se usa** si y solo si la zona tiene `requires_approval = true`. Si no, la reserva nace `CONFIRMED` y ocupa slots al instante | (a) Quitar `PENDING` del enum y confirmar siempre sola. (b) Un flujo de aprobación fijo para todas las zonas | §2 R-2 y §5.3. Con (a), la columna `requires_approval` del esquema quedaría sin uso y una futura zona que necesite aprobación no tendría dónde apoyarse; con (b), la reserva de sala comunitaria esperaría al admin para reservar la sala comunitaria, que es lo contrario de utilizable. La opción elegida ya está diseñada en `01_schema.sql`: este bloque no inventa el modelo, lo cierra |
| **D-2** | Confirma **solo `ADMIN`**, con `POST /reservations/:id/confirm`; la confirmación inserta slots y un `23505` deja la reserva `PENDING` | Confirmación por `PRESIDENT`; confirmación automática por tiempo; confirmar al crear saltándose la columna | §2 R-3 y §5.4. El `PRESIDENT` queda fuera por la matriz de `ARCHITECTURE.md` §5 y el precedente D-4 del bloque 04. La confirmación automática exigiría un reloj y una caducidad que este bloque no tiene: una garantía que nadie puede hacer cumplir es peor que una fila `PENDING` a la vista |
| **D-3** | Cancelan el **dueño** y el **`ADMIN`** (de cualquier reserva de su comunidad, `PENDING` incluida). El `PRESIDENT` no. Cancelar borra los slots; no hay `DELETE` físico | Solo el dueño; también el `PRESIDENT`; `DELETE` físico de la fila | §2 R-4 y §5.5. El dueño necesita deshacer lo suyo sin pedir permiso; el `ADMIN` necesita poder rechazar una `PENDING` y deshacer una hecha por error. El `PRESIDENT` no gestiona zonas (CA-1 de la spec 05). Y borrar la fila en vez de cancelarla destruiría el histórico que hace útil el registro cuando hay un conflicto |
| **D-4** | El listado de comunidad lo ve **cualquier miembro activo**, con `userName`; `notes` solo para dueño, `ADMIN` y `PRESIDENT`. `/me` es la lectura propia, en todas las comunidades | Vecino solo ve las suyas (patrón de incidencias); o todos ven también `notes` | §2 R-5 y §5.6. La agenda de uso es información que el edificio ya maneja en el pasillo; el motivo de cada reserva no. La comparación con incidencias I-1 no encaja porque lo sensible de una incidencia es su contenido, y lo sensible de una reserva es su `notes`, que se redacta en la función de lectura |

### Lo que las cuatro dejan fuera del `PRESIDENT`

Juntas producen un rol que **ve** la agenda completa de su comunidad con
nombres y notas, **crea** reservas como cualquier vecino, y no puede confirmar
ni cancelar las ajenas. Es coherente con la matriz de `ARCHITECTURE.md` §5, où
"Gestionar zonas comunes" es de `ADMIN` único, y con el bloque 04, donde el
`PRESIDENT` tampoco mueve estados: ve y corrige, pero no gestiona con
consecuencias.

Si algún día hace que el presidente pueda aprobar reservas, la vía no es un
`PATCH` de estado: es habilitar el rol en la guarda de `app_confirm_reservation`,
un cambio de una línea que además tiene test.

### Pendiente, y no bloquea

**Auditoría y notificaciones.** Cancelar y confirmar son acciones sensibles que
dejarían rastro en `audit_logs`, y los vecinos deberían enterarse de que su
reserva fue rechazada (`notification_type` ya tiene tipos de reserva, si los
hay; si no, se añaden en su bloque). Ninguna de las dos cosas se escribe aquí:
son decisiones aparte, y escribirlas dentro de las funciones es lo único que
garantiza que no falten.

**Edición de reservas.** No hay `PUT`/`PATCH` de contenido: mover una reserva
es cancelarla y crear otra, que es además lo único compatible con el modelo de
slots. Un endpoint de "mover" tendría que liberar y ocupar en la misma
transacción, que es exactamente cancelar + crear con dos nombres distintos.

---

## 13. Fuera de alcance

- Zonas comunes como catálogo, rejilla y disponibilidad → `05-common-areas.md`.
- Notificaciones de reserva creada, confirmada o cancelada.
- Auditoría de las acciones de este bloque en `audit_logs`.
- Reservas recurrentes (cada semana a las 10:00) y multi-día.
- Pago, fianza o tarifas por zona.
- Realtime de disponibilidad (Supabase Realtime sobre `area_slots`).
- Caducidad automática de las `PENDING` y de las reservas pasadas.
- Límite de reservas por usuario más allá de `max_daily_reservations`.
- Adjuntos o fotos en una reserva.

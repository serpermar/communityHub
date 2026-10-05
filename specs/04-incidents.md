# Spec 04 — Incidencias

> **Estado: IMPLEMENTED.**
> Las cuatro decisiones de §12 (D-1 a D-4) están tomadas.
> **Fase:** 4 (incidencias). Precedida de `01-authentication`, `02-communities`
> y `03-members`.
> **Base de datos:** `supabase/sql/01_schema.sql` (tablas `incidents` e
> `incident_comments` ya existen), `02_rls.sql` (políticas base) y
> `02e_incidents.sql` (archivo nuevo de este bloque).
> **Backend:** `backend/src/incidents/`.
>
> Sin la aprobación de esta spec no se escribe código de incidencias.
>
> **Esta versión corrige el borrador anterior.** Los errores queCorrige están
> listados en §14, y son la razón de que el borrador no se pueda aprobar tal
> cual: varios nombres de columna no existen en el esquema.

---

## 1. Objetivo

Que un vecino pueda reportar un problema en su comunidad, seguirlo hasta que se
resuelva, y que el resto de roles (presidente, administrador y proveedor) lo
gestione sin que nadie vea lo que no le corresponde.

Es el primer módulo del proyecto que combina **tres públicos distintos sobre la
misma tabla**: el vecino que solo ve lo suyo, el presidente y el administrador que
ven todo lo de su comunidad, y el proveedor que solo ve lo que tiene asignado. El
aislamiento ya no es solo por comunidad (bloque 02) sino **por rol dentro de la
comunidad**. Ese es el eje de esta spec.

Fuera de alcance: la asistencia de IA para clasificar incidencias
(`10-ai-assistant.md`), las notificaciones, y los adjuntos binarios (van al bloque
de documentos).

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **I-1** | Un `NEIGHBOR` solo ve **sus propias** incidencias (las que reportó). Un `ADMIN` y un `PRESIDENT` ven todas las de su comunidad. Un `PROVIDER` solo las que tiene **asignadas** | Que un vecino vea todas las de su comunidad | El portal comunitario tiene contenido sensible: una incidencia por filtraciones en el 3ºB o por una disputa entre vecinos no es información para todo el edificio. El vecino ve lo suyo; quien administra ve todo. Es la fila "Ver incidencias propias" / "Ver todas las incidencias" de la matriz de `ARCHITECTURE.md` §5 |
| **I-2** | El **estado** cambia con transiciones explícitas, no con un `PATCH` libre | `PATCH { status }` sin restricciones | Un `PATCH` libre permite `OPEN → RESOLVED` saltándose `IN_PROGRESS`, o `CANCELLED → OPEN`. `RESOLVED` significa que alguien trabajó en ello, y no se puede llegar sin pasar por ahí |
| **I-3** | El **reporter** no cambia el estado, ni de su propia incidencia, y el `PRESIDENT` tampoco (D-4) | Dejar que el reporter cancele | Cerrar "porque ya no me pasa" borra el histórico. `ARCHITECTURE.md` §5 da a `NEIGHBOR` y a `PRESIDENT` un "—" explícito en "Cambiar estado de incidencia". Si algún día se quiere auto-cancelación, es una transición más, no un cambio de modelo |
| **I-4** | Solo `ADMIN` **asigna** y solo a un `PROVIDER` **activo de esa comunidad**. Asignar a `NULL` desasigna | Asignación libre por id de usuario | Un `assigned_to_id` con un UUID de fuera de la comunidad sería un agujero: el proveedor ajeno recibiría el trabajo y tendría RLS activo sin ser miembro. La función valida contra `community_members` en la misma transacción que escribe |
| **I-5** | El **`reporter_id`** es siempre el actor; no se crea una incidencia "en nombre de" | `reporterId` en el cuerpo | Un `ADMIN` que crea una incidencia para un vecino debe aparecer como autor. Evita suplantación y simplifica la auditoría |
| **I-6** | El **borrado es lógico** (`deleted_at`), solo `ADMIN`, responde `204`, y una incidencia borrada **desaparece de todas las listas y de todos los GET** | Borrado físico | Coherente con comunidades (C-5) y miembros (M-4). El histórico es lo que hace útil el registro cuando hay un conflicto. Que "borrada" signifique además "invisible" es lo que hace que el borrado sea de verdad un borrado |
| **I-7** | Los **comentarios** los puede escribir cualquiera que **vea** la incidencia (I-1), y no se editan ni se borran en este bloque | Comentarios internos solo para ADMIN; `PATCH` del `body` | El portal es transparente. El borrador anterior proponía un `PATCH /comments/:id` que no existe ni en `ARCHITECTURE.md` §6 ni en este bloque: una corrección de un comentario es un `DELETE` + uno nuevo, y eso es un cambio de modelo |
| **I-8** | El **`priority`** lo fija quien crea al reportar, y **solo `ADMIN` lo cambia después** | Que el reporter lo cambie siempre | El priority es operativo: determina el orden de trabajo y las escaladas. Si el reporter puede subirlo a `CRITICAL` cuando quiere, `CRITICAL` deja de significar nada. Lo decide `app_set_incident_priority()`, no el `PUT` |
| **I-9** | Una **`CRITICAL` creada por `NEIGHBOR`** se marca `needs_review = true`. Una `CRITICAL` creada por `PRESIDENT` o `ADMIN` no, porque quien la escala es quien la revisa | Prohibir `CRITICAL` al vecino | El enunciado pide que "una incidencia CRITICAL requiere revisión", no que sea imposible. Prohibirla empuja al vecino a declarar `HIGH` y el dato se pierde; marcarla deja la revisión pendiente y visible. La columna no existía y este bloque la añade (§4e). **D-1** |
| **I-10** | `ADMIN` o `PRESIDENT` pueden editar el contenido (`title`, `description`, `category`, `location`) de cualquier incidencia de su comunidad; el reporter, solo la suya; un `PROVIDER` no edita contenido | Solo `ADMIN` edita | `ARCHITECTURE.md` §5 da a `PRESIDENT` lectura completa de las incidencias de su comunidad y le reserva la gestión con consecuencias al `ADMIN`. Editar el texto de una incidencia no es gestionar: es corregir una descripción. **D-3** |
| **I-11** | Toda **lectura** de incidencias pasa por una función `SECURITY DEFINER` (`app_list_incidents`, `app_get_incident`, `app_list_incident_comments`), y las respuestas llevan `reporterName` y `assignedToName` | Un `SELECT` de Prisma con `where` | Tres cosas que un `where` en TypeScript no puede fijar a la vez: (a) el predicado de visibilidad **por rol** de I-1, (b) `deleted_at is null` de I-6, y (c) el nombre del reporter, que sale de `users` y que `users_select_self` no deja leer. Es la misma excepción acotada a `users_select_self` que ya abrió el bloque 03 en `app_get_community_member()`. **D-2** |
| **I-12** | El **`PATCH /incidents/:id/status`** es un endpoint aparte, no un campo del `PUT` | Meter `status` en el `PUT` | El `PUT` es para el contenido y para los dos campos con permiso propio (I-4, I-8). El estado tiene su grafo de transiciones y su propio permiso, y separarlo hace trivial saber quién puede qué |
| **I-13** | La **`resolved_at`** la mantiene `app_transition_incident()`: se pone al entrar en `RESOLVED` y se limpia al salir | Que la calcule la aplicación | El dashboard (fase 10) necesita saber cuánto se tarda en resolver. `updated_at` cambia por cualquier edición; `resolved_at` no |
| **I-14** | El listado se ordena por **`created_at DESC`** y nada más | Ordenar por `status` y `priority` | Los dos son ENUM, y ordenar un ENUM es ordenarlo por su **declaración**, no por su importance: `priority desc` daría `CRITICAL, MEDIUM, LOW, HIGH`, y `status asc` daría `CANCELLED` primero. Ninguno de los dos es un orden que significe algo para quien lee la lista |
| **I-15** | `reference_code` lo genera el servidor como `INC-<año>-<6 dígitos>` desde una secuencia, y es único **por comunidad** | Que lo pone el cliente | Es `not null` sin default, así que sin generarlo el `INSERT` falla. Y si lo pusiera el cliente, un `ADMIN` podría crear `INC-2026-000001`, que es el código que un vecino está leyendo en la pantalla de al lado |
| **I-16** | Los **assets** (fotos, planos) no están en esta spec | Incluirlos ahora | Van al bloque de documentos (`08-documents.md`) con su ACL. Meterlos aquí obliga a duplicar el modelo de archivos o a acoplarlo antes de tiempo |

---

## 3. Estado real del modelo de datos

Esta sección describe lo que hay en `01_schema.sql` **hoy**, verificado contra el
fichero. El borrador anterior se equivocó en cinco puntos (§14).

### 3.1 `incidents`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade`. Es el eje del aislamiento |
| `reference_code` | `text not null` | **Sin default.** Único por comunidad (I-15) |
| `title` | `text not null` | `check (char_length(title) between 5 and 200)` — el máximo es **200**, no 120 |
| `description` | `text not null` | Sin `check` en la base de datos. Este bloque lo añade (§4f) |
| `category` | `incident_category not null default 'OTHER'` | `ELEVATOR`, `ELECTRICITY`, `PLUMBING`, `CLEANING`, `SECURITY`, `HEATING`, `OTHER` |
| `priority` | `incident_priority not null default 'MEDIUM'` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `status` | `incident_status not null default 'OPEN'` | `OPEN`, `IN_PROGRESS`, `RESOLVED`, `CANCELLED` |
| `location` | `text` | Nullable. Dónde ocurre: planta, puerta, zona |
| `reporter_id` | `uuid not null → users(id)` | `on delete restrict`. El autor (I-5) |
| `assigned_to_id` | `uuid → users(id)` | Nullable. `on delete set null`. Se llama **`assigned_to_id`**, no `assigned_to` |
| `created_via` | `incident_created_via not null default 'MANUAL'` | `MANUAL`, `AI_SUGGESTION`. Este bloque solo escribe `MANUAL`; el bloque 10 escribirá el otro |
| `ai_confidence` | `numeric(4,3)` | Nullable. Bloque 10 |
| `resolved_at` | `timestamptz` | Nullable (I-13) |
| `deleted_at` | `timestamptz` | Nullable (I-6) |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `incidents_set_updated_at` |

**No existe `needs_review`.** Este bloque la añade (§4e).

### 3.2 `incident_comments`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | |
| `incident_id` | `uuid not null → incidents(id)` | `on delete cascade` |
| `author_id` | `uuid not null → users(id)` | `on delete restrict` |
| `body` | `text not null` | Sin `check`. Este bloque lo añade (§4f) |
| `deleted_at` | `timestamptz` | **Sí existe.** El borrador anterior afirmaba lo contrario. Este bloque **no lo usa** (I-7): queda como columna disponible para cuando haga falta |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `incident_comments_set_updated_at` |

### 3.3 Índices que ya existen

| Índice | Definición |
|---|---|
| `incidents_reference_code_uidx` | `unique (community_id, reference_code)` |
| `incidents_community_status_idx` | `(community_id, status) where deleted_at is null` |
| `incidents_community_priority_idx` | `(community_id, priority) where deleted_at is null` |
| `incidents_reporter_idx` | `(reporter_id)` |
| `incidents_assigned_idx` | `(assigned_to_id) where assigned_to_id is not null` |
| `incidents_title_trgm_idx` | `gin (title gin_trgm_ops)` — es el que sostiene el parámetro `q` |
| `incident_comments_incident_idx` | `(incident_id, created_at)` |

Los tres índices con `where deleted_at is null` presuponen que el filtro por
`deleted_at` va en la consulta. I-6 lo pone en la función de lectura (§5.8).

### 3.4 Lo que este bloque cambia en el esquema

Todo lo siguiente va en `02e_incidents.sql`, y todo es idempotente:

| Cambio | Por qué |
|---|---|
| `alter table incidents add column if not exists needs_review boolean not null default false` | I-9. Es la única forma de dejar constancia de que una `CRITICAL` espera revisión |
| `add constraint incidents_description_length check (char_length(description) between 10 and 4000) not valid` | §4f |
| `add constraint incident_comments_body_length check (char_length(body) between 1 and 2000) not valid` | §4f |
| `create sequence if not exists incident_reference_code_seq` | I-15 |

`not valid` a propósito: el `CHECK` se aplica a las filas nuevas sin fallar sobre
las que ya haya, y `04_verify.sql` (§10) informa de si está validado. Validarlo es
un paso manual posterior, no parte de este bloque.

Añadir `needs_review` obliga a regenerar `backend/prisma/schema.prisma` con
`npx prisma db pull`. El modelo `Incidents` gana el campo y eso es todo: los
nombres de campo de Prisma siguen en `snake_case` porque el modelo no usa `@map`.

---

## 4. El problema del arranque

### a) La política de `UPDATE` se salta todas las reglas del dominio

Esta es la razón de ser de `02e_incidents.sql`.

`02_rls.sql` §5.4 define `incidents_update_scoped` con la misma terna que el
`SELECT`: `ADMIN`/`PRESIDENT` sobre cualquier fila, el reporter sobre la suya, y
el proveedor asignado sobre la suya. Y `app_runtime` tiene `grant insert, update on
incidents`.

Con las dos cosas a la vez, cualquiera de los tres puede escribir **cualquier
columna** de la fila que puede leer:

- El **vecino** hace `update incidents set status = 'RESOLVED' where id = ...` y se
  salta `IN_PROGRESS` (I-2).
- El **vecino** hace `set assigned_to_id = <uuid>` y se asigna la incidencia a sí
  mismo, o a un miembro de otra comunidad (I-4).
- El **vecino** hace `set deleted_at = now()` y se borra su propia incidencia sin
  ser `ADMIN` (I-6).
- El **ADMIN** o el **PRESIDENT** pueden reescribir `reporter_id` a quien quieras, y
  `with check` se lo permite porque para ellos la condición se cumple siempre. Eso
  rompe I-5 sin escribir ni un `UPDATE` raro.

Ninguna de las cuatro es un descuido de código de aplicación: son consultas que se
ejecutan con la misma conexión que la API, con el mismo contexto, y las políticas
las dejan pasar.

La solución es la del bloque 03 aplicada a otra tabla: **`incidents` se queda sin
política de `INSERT` ni de `UPDATE`, y `app_runtime` pierde esos permisos.** Todas
las escrituras entran por funciones `SECURITY DEFINER`, que son `SECURITY DEFINER` y
no pasan por RLS, así que las guardas viven dentro y son las que valen.

Los índices de §3.3 se quedan: no necesitan permiso de escritura.

El mismo argumento aplica a `incident_comments`, pero **no se aplica**: un
comentario no tiene ningún invariante más allá de "quien puede ver la incidencia
puede comentar", y eso ya lo dice `comments_insert_author`. Se deja el `INSERT` por
política y el `grant` como están.

### b) `reference_code` es `not null` y no tiene `default`

Un `INSERT` directo sin él revienta con `23502`. Y no basta con poner un default
en el `INSERT`: el código tiene que ser **único por comunidad**, y
`incidents_reference_code_uidx` es único por `(community_id, reference_code)`.

`nextval()` sobre una secuencia **global** cumple las dos cosas sin bloqueos: dos
comunidades distintas pueden tener la misma incidencia `000001`, y dentro de una
comunidad nunca se repite porque la secuencia no se comparte. Un
`count(*) + 1` por comunidad sí tendría carrera entre dos altas simultáneas, y esa
carrera se manifestaría como un `23505` en un `POST` que el vecino no ha hecho
nada malo.

### c) Las rutas de incidencia no llevan `communityId` en la URL

`GET /api/v1/incidents/:id` no tiene comunidad en el camino, y `requireCommunity()`
no tiene contra qué trabajar. Sin resolverla, el servicio no sabe qué valor poner
en `app.current_community_id`, y todas las políticas que comparan con
`app_current_community_id()` —más las de `communities`, `community_members` y
`expenses`— se quedan sin contexto.

No es un detalle de las incidencias: es el mismo problema para documentos,
reservas, gastos y votaciones. Por eso la solución es un middleware
**reutilizable**, no un caso especial de este bloque.

`app_incident_community(p_incident uuid) returns uuid` devuelve el `community_id`
**solo si la incidencia es visible para el actor** según el predicado de I-1, y
`NULL` si no lo es. `requireIncident()` la llama, y si sale `NULL` responde `404`.

Que devuelva `NULL` y no `42501` es deliberado: un `403` confirmaría que ese id
existe. Es el mismo criterio que C-8.

Y no filtra: quien ve la incidencia ya tiene su `community_id` en la fila que está
viendo.

### d) El borrado lógico no está en la política de `SELECT`

`incidents_select_scoped` no menciona `deleted_at`. Es decir que hoy una
incidencia borrada lógicamente **sigue siendo visible**: el `ADMIN` la ve en el
listado, el vecino la ve si es suya, y el proveedor la ve si tiene el
`assigned_to_id`. I-6 dice que borrarla es hacerla desaparecer, así que la
política se recrea con `deleted_at is null`, y el predicado de I-1 se queda igual.

Esto **estrecha** el acceso, nunca lo amplía: una fila que era visible pasa a no
serlo, y ninguna que no lo era pasa a serlo.

### e) `CRITICAL` no tiene dónde marcarse para revisión

I-9 necesita un sitio donde decir "esta `CRITICAL` la pidió un vecino y espera
revisión". No existe en `incidents`. Lo más parecido es
`incident_drafts.needs_human_review`, pero esa tabla es del **borrador** que la IA
propone y que todavía no es una incidencia: un vecino que escribe a mano no pasa
por ahí, y enlazar los dos sería un acoplamiento con el bloque 10.

**Decidido por el desarrollador: se añade la columna `needs_review`.** La
alternativa era **prohibir** `CRITICAL` al `NEIGHBOR` con un `403`, y se descartó
porque empuja al vecino a declarar `HIGH` y el dato se pierde: una emergencia
real acaba registrada como prioridad media. Con la columna, el vecino la reporta
tal cual y queda a la vista de quien administre que alguien tiene que mirarla.

Es el único cambio de esquema de este bloque, y es idempotente:
`alter table incidents add column if not exists needs_review boolean not null default false`.
En PostgreSQL 11 o posterior el `default` se materializa sin reescribir la tabla,
así que el `alter` es instantáneo incluso con incidencias ya dadas de alta.

Obliga a regenerar `backend/prisma/schema.prisma` con `npx prisma db pull`. El
modelo `Incidents` gana el campo y nada más: los nombres de Prisma siguen en
`snake_case` porque el modelo no usa `@map`. El diff de `schema.prisma` se revisa
antes de commitear (§11).

### f) Las longitudes solo están en la aplicación

`title` tiene `check` en la base de datos y es la única columna de las tres con
longitud que lo tiene. `description` y `incident_comments.body` no la tienen, así
que el límite viviría solo en el esquema de zod. Eso ya es un invariante de
seguridad: el mismo `INSERT` se puede hacer por PostgREST y saltarse el esquema.

Se añaden los dos `CHECK` en §3.4, con `not valid` por el motivo ya dicho.

---

## 5. Funciones

Todas `SECURITY DEFINER`, todas con `set search_path = public, pg_temp`, todas con
`revoke execute` a `PUBLIC` y `grant execute` a `app_runtime` solamente. Es el
patrón de `02d_members.sql` §5 y se repite porque las funciones **son** la
frontera de seguridad de este bloque.

Ninguna acepta un usuario como parámetro. Todas leen el actor de
`app_current_user_id()`, que sale de la variable de sesión: una función
`SECURITY DEFINER` que admitiera "este es admin" sería escalada de privilegios en
una llamada.

### 5.1 El predicado de visibilidad, en un solo sitio

I-1 aparece en tres sitios distintos —el `SELECT` de la API, el `UPDATE` de
contenido y el contexto de la ruta— y si se escribiera tres veces, tres veces
podría divergir. Se escribe una vez:

```sql
-- Devuelve true si el actor puede ver la incidencia `target`.
create or replace function app_can_see_incident(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from incidents i
     where i.id = target
       and i.deleted_at is null
       and app_is_member_of(i.community_id)
       and (
         app_role_in(i.community_id) in ('ADMIN', 'PRESIDENT')
         or i.reporter_id = app_current_user_id()
         or app_is_assigned_provider(i.id)
       )
  )
$$;
```

Es el mismo predicado que ya tiene `incidents_select_scoped` en `02_rls.sql`, con
dos añadidos: `deleted_at is null` (I-6) y el `exists` sobre la fila concreta en
lugar de sobre la fila que se está evaluando.

El `app_is_member_of` no es opcional aunque `app_role_in` ya exija `ACTIVE`:
`app_role_in` solo cubre la rama de los gestores. Sin él, las otras dos ramas
—`reporter_id = ...` y `app_is_assigned_provider`— seguirían dando acceso a un
miembro **suspendido**, que es exactamente lo que la suspensión tiene que quitar.
Es un forgetting fácil, porque `app_is_member_of` parece redundante al leerlo.

Se usa en `app_get_incident`, `app_update_incident_content`, `app_set_incident_priority`,
`app_assign_incident`, `app_transition_incident`, `app_soft_delete_incident`,
`app_incident_community` y `app_list_incident_comments`. **Ocho funciones, un
predicado.** Si mañana cambia I-1, se cambia aquí.

Y en `app_list_incidents`, con el predicado en línea y no con esta función: el
listado no tiene una fila concreta de la que partir, y envolver cada fila del
listado en una llamada a función sería una función por fila. El predicado está
copiado ahí, y el riesgo de que diverja se acepta **a cambio** de que el listado
siga siendo una sola consulta con `limit` y `offset` reales en el motor. La
comprobación de que las dos copias siguen iguales es de `db:verify`.

### 5.2 `app_create_incident(p_community_id uuid, p_title text, p_description text, p_category incident_category, p_priority incident_priority, p_location text) returns uuid`

- Guarda: hay sesión, si no → `42501` `sin contexto de usuario`.
- Guarda: `app_is_member_of(p_community_id)` y `app_role_in(p_community_id) in
  ('NEIGHBOR', 'PRESIDENT', 'ADMIN')`, si no → `42501`. Un `PROVIDER` no crea
  incidencias (`ARCHITECTURE.md` §5, "Crear incidencia: PROVIDER —").
- `p_title`, `p_description` y `p_category` obligatorios → `22023`.
- El `check` de longitud de `title` y `description` lo pone la tabla (§4f); si
  saltara, saldría con su propio `23514`.
- `reference_code` se genera aquí (§4b).
- `reporter_id = app_current_user_id()`, siempre (I-5).
- `needs_review = (p_priority = 'CRITICAL' and app_role_in(...) = 'NEIGHBOR')`
  (I-9).
- `created_via = 'MANUAL'`.
- Devuelve el `id`. La API responde con una lectura posterior, que ya pasa por
  `app_get_incident` y por tanto por I-1.

### 5.3 `app_update_incident_content(p_incident uuid, p_title text, p_description text, p_category incident_category, p_location text) returns setof incidents`

- Guarda: `app_can_see_incident(p_incident)`, si no → `incident_not_found` (`P0002`).
- Guarda: el actor es el reporter, o `app_role_in` en `('ADMIN', 'PRESIDENT')`, si
  no → `42501`. El `PRESIDENT` entra por **D-3**; un `PROVIDER` nunca entra, tenga
  o no la incidencia asignada.
- **No acepta `priority`, ni `assigned_to_id`, ni `status`.** No es que los ignore:
  es que no existen en su lista de parámetros, así que un `UPDATE` directo que los
  tocara no tiene por dónde colarse.
- Es un `PUT`: los cuatro parámetros son el valor nuevo completo. `p_location` nulo
  borra la ubicación, que es lo que significa `location: null` en el cuerpo.

### 5.4 `app_set_incident_priority(p_incident uuid, p_priority incident_priority) returns void`

- Guarda: `app_can_see_incident(p_incident)`, si no → `incident_not_found`.
- Guarda: `app_is_admin_of(...)`, si no → `42501` (I-8).
- `priority` obligatorio → `22023`.
- Al escribir, `needs_review = false`: **la revisión ocurre al cambiar la
  prioridad**, y no hace falta una columna más para decirlo.

Que un `ADMIN` suba a `CRITICAL` no pone `needs_review` porque él es quien decide
que la revisión ya está hecha. Que un `NEIGHBOR` la creara sí, y por eso I-9
necesitaba la columna.

### 5.5 `app_assign_incident(p_incident uuid, p_provider_user_id uuid) returns void`

- Guarda: `app_can_see_incident(p_incident)`, si no → `incident_not_found`.
- Guarda: `app_is_admin_of(...)`, si no → `42501` (I-4).
- `p_provider_user_id is null` → desasigna, y ya está.
- Si no es `NULL`, tiene que existir una membresía en la **misma** comunidad con
  `role = 'PROVIDER'` y `status = 'ACTIVE'`. Si no → `incident_assignee_not_provider`
  (`22023`, 400).

La comprobación y el `UPDATE` van en la misma transacción, que es el punto: entre
el `SELECT` de la membresía y el `UPDATE` de la incidencia no puede colarse una
suspensión del proveedor. Un proveedor suspendido **desaparece** de la lista de
asignables sin necesidad de que nadie reasigne.

### 5.6 `app_transition_incident(p_incident uuid, p_new_status incident_status) returns setof incidents`

El grafo, y quién puede recorrer cada arista:

| De | A | Quién |
|---|---|---|
| `OPEN` | `IN_PROGRESS` | `ADMIN`, o el `PROVIDER` **asignado** |
| `IN_PROGRESS` | `RESOLVED` | `ADMIN`, o el `PROVIDER` **asignado** |
| `RESOLVED` | `OPEN` | solo `ADMIN` (reapertura) |
| `OPEN` \| `IN_PROGRESS` \| `RESOLVED` | `CANCELLED` | solo `ADMIN` |
| `CANCELLED` | — | estado final |

El `PRESIDENT` no aparece en ninguna fila, por **D-4**. Un `PROVIDER` solo
recorre las dos primeras aristas y solo si `assigned_to_id` es el suyo.

- Guarda: `app_can_see_incident(p_incident)`, si no → `incident_not_found`.
- Guarda de actor: `ADMIN` o proveedor asignado, si no → `42501` (`forbidden_role`).
  **Va antes que la del grafo**, y por un motivo concreto: un `NEIGHBOR` que pide
  una transición que además sería inválida tiene que recibir `403`, no `409`. Si el
  grafo se comprobara primero, todo `403` de este endpoint acabaría siendo `409` y
  el cliente no podría distinguir "no puedes" de "eso no se puede".
- Guarda de "esta arista es solo del ADMIN": `RESOLVED → OPEN` y `→ CANCELLED` (desde
  cualquiera de los otros tres) → `42501` (`forbidden_role`). Es **otra** guarda, y no
  un `v_is_admin` dentro de la arista, por el mismo motivo que la anterior pero al
  revés: con el requisito de `ADMIN` dentro del grafo, un `PROVIDER` asignado que
  intenta reabrir caería en `incident_invalid_transition` y recibiría un `409` ("no se
  puede"), cuando lo que falta no es una arista sino un permiso. Con un `409` el
  cliente ofrece elegir otro estado destino, y no hay ninguno que sirva.
  La guarda mira **el origen también**, no solo el destino: `OPEN` solo es destino
  válido desde `RESOLVED`, y si mirara solo el destino convertiría el `OPEN → OPEN` de
  un proveedor (que es `409` por ser una transición al estado actual) en un `403`.
- Guarda de grafo, y aquí ya no hay nada de roles dentro: si
  `(status_actual, p_new_status)` no está en la tabla → `incident_invalid_transition`
  (`22023`, 409).
- `p_new_status = status_actual` es una transición inválida, no un no-op: un `PATCH`
  que devuelve `200` sin haber cambiado nada es peor que un `409`.
- `resolved_at`: `now()` al entrar en `RESOLVED`, `null` al salir (I-13). Lo pone
  la función, no la aplicación.

La estructura del cuerpo es: guarda de contexto, visibilidad, actor, arista de solo
`ADMIN`, grafo, escritura. En ese orden, porque cada guarda es más específica que la
anterior y el error que ve quien llama debe ser el más informativo.

### 5.7 `app_soft_delete_incident(p_incident uuid) returns void`

- Guarda: `app_can_see_incident(p_incident)`, si no → `incident_not_found`.
- Guarda: `app_is_admin_of(...)`, si no → `42501` (I-6).
- `deleted_at = now()`.

`app_can_see_incident` ya filtra `deleted_at is null`, así que llamar dos veces no
es un no-op silencioso: la segunda da `404`. Idempotente desde fuera, que es lo que
pide un `DELETE`.

### 5.8 Lecturas

Tres, y las tres `SECURITY DEFINER` por I-11.

**`app_list_incidents(p_community_id uuid, p_status incident_status, p_priority incident_priority, p_category incident_category, p_q text, p_limit integer, p_offset integer) returns table (...)`**

Las columnas de salida incluyen `reporter_name` y `assigned_name`, y una última
columna `total_count bigint` con el total **antes** de paginar.

Filtros, todos opcionales: `p_status`, `p_priority`, `p_category`, y `p_q` como
`i.title ilike '%' || p_q || '%'`, que es lo que puede usar
`incidents_title_trgm_idx`. El orden es `created_at desc` y nada más (I-14).

El `where` combina `app_is_member_of(p_community_id)` con la terna de I-1. **El
`community_id` de la ruta sí va en el `where`**, a diferencia del argumento de I-11:
en el listado no es una comprobación, es el ámbito, y `app_can_see_incident` no
aplica porque no hay una fila concreta.

`p_limit` se acota a 100 en la función, no solo en el esquema: un `limit` de
`1000000` enviado por el cliente sin tope es una forma de que un vecino pida la
tabla entera.

**`app_get_incident(p_incident uuid) returns table (...)`**

Mismo predicado que `app_list_incidents`, por una fila. No devuelve `null`: no
encontrarla y no verla son el mismo `404` por el mismo motivo que en §4c.

**`app_list_incident_comments(p_incident uuid) returns table (...)`**

`exists (select 1 from incidents i where i.id = p_incident and app_can_see_incident(i.id))`
como guarda, y luego los comentarios de esa incidencia por `created_at asc`, con
`author_name`.

El `exists` es lo que hereda el alcance: un vecino no lee comentarios de una
incidencia ajena, y no necesita ver la incidencia para que el permiso sea
coherente.

### 5.9 El orden

`app_can_see_incident` se crea **antes** que todo lo demás, y las políticas se
recrean **después**. El orden de un `02e_incidents.sql` no es arbitrario: una
política que llama a una función que todavía no existe falla al crearse, y un
`grant execute` sobre una función que no existe falla al aplicarse.

---

## 6. Políticas RLS

`02e_incidents.sql` deja `incidents` así:

| Comando | Cómo |
|---|---|
| `SELECT` | Se **recrea** `incidents_select_scoped` con `deleted_at is null` y la terna de I-1 |
| `INSERT` | **Se elimina** `incidents_insert_member` (§4a) |
| `UPDATE` | **Se elimina** `incidents_update_scoped` (§4a) |
| `DELETE` | No hay política, y no la hay ahora tampoco. No existe el borrado físico |

Y deja los permisos así:

| Permiso | Antes | Después |
|---|---|---|
| `select` on `incidents` | ✓ | ✓ |
| `insert` on `incidents` | ✓ | **✗** |
| `update` on `incidents` | ✓ | **✗** |

`incident_comments` no se toca. Sus tres políticas ya son correctas para I-1 e I-7,
salvo por un detalle: `comments_select_via_incident` tampoco filtra
`deleted_at`, y con I-7 los comentarios no se borran, así que **no importa** y se
deja como está. Tocar una política que funciona para arreglar un problema que no
existe es ruido en el diff.

El `revoke insert, update on incidents from app_runtime` es indispensable y no
decorativo: quitarlo de la lista de `grant` de `02_rls.sql` no deshace un `GRANT`
ya aplicado en la base de datos. Por eso `02e` lo repite explícitamente, igual que
hizo `02d_members.sql` con `community_members`.

`02_rls.sql` **no se modifica**. Es la base, y este bloque se apoya en ella.

---

## 7. Contrato HTTP

### 7.1 El recurso

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "referenceCode": "INC-2026-000001",
  "title": "Fuga de agua en el pasillo del 3º",
  "description": "Empieza el martes...",
  "category": "PLUMBING",
  "priority": "HIGH",
  "status": "IN_PROGRESS",
  "location": "Pasillo 3º",
  "reporterId": "uuid",
  "reporterName": "Marta Ruiz",
  "assignedToId": "uuid | null",
  "assignedToName": "ManoloProveedor | null",
  "needsReview": false,
  "createdVia": "MANUAL",
  "resolvedAt": null,
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

`reporterName` y `assignedToName` vienen de `users.full_name`, que I-11 explica por
qué solo se pueden leer desde una función. `email` **no** sale: para una lista de
incidencias no hace falta, y `app_list_community_members()` ya es la excepción
acotada que expone emails de miembros (spec 03 §4b).

El recurso de comentario es `{ id, incidentId, authorId, authorName, body, createdAt }`.

### 7.2 Rutas

Las ocho de `ARCHITECTURE.md` §6, sin añadir ninguna:

```
GET    /api/v1/communities/:communityId/incidents    ?status&priority&category&q&page&limit
POST   /api/v1/communities/:communityId/incidents
GET    /api/v1/incidents/:id
PUT    /api/v1/incidents/:id
PATCH  /api/v1/incidents/:id/status
DELETE /api/v1/incidents/:id
GET    /api/v1/incidents/:id/comments
POST   /api/v1/incidents/:id/comments
```

El borrador anterior añadía un noveno endpoint, `PATCH /incidents/:id/assignee`.
No está en la arquitectura y no hace falta: la asignación va en el `PUT` (§7.3).

### 7.3 Guardas y cuerpos

| Ruta | Guardas |
|---|---|
| `GET /communities/:communityId/incidents` | `requireAuth`, `requireCommunity()` |
| `POST /communities/:communityId/incidents` | `requireAuth`, `requireCommunity()`, `requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN')` |
| `GET /incidents/:id` | `requireAuth`, `requireIncident()` |
| `PUT /incidents/:id` | `requireAuth`, `requireIncident()` |
| `PATCH /incidents/:id/status` | `requireAuth`, `requireIncident()` |
| `DELETE /incidents/:id` | `requireAuth`, `requireIncident()` |
| `GET /incidents/:id/comments` | `requireAuth`, `requireIncident()` |
| `POST /incidents/:id/comments` | `requireAuth`, `requireIncident()` |

**`requireIncident()` va en `backend/src/incidents/middleware.ts`, no en
`auth/middleware.ts`.** Ese archivo es del bloque 01 y la spec 03 ya decidió no
tocarlo; la convención del proyecto es validar en el módulo. Va siempre **después**
de `requireAuth`, porque necesita `req.auth`.

`requireIncident()` no lleva `requireCommunityRole`. El rol lo consulta
`app_role_in()` dentro de `app_incident_community`, y quien decide es la función.
Una ruta con `requireCommunityRole('ADMIN')` aquí mentiría: no hay comunidad en el
camino, y el rol se resuelve después, contra la fila.

Cuerpos, todos `.strict()`:

| Ruta | Campos | Regla |
|---|---|---|
| `POST` | `title` 5–200, `description` 10–4000, `category` enum, `priority` enum, `location` opcional ≤200 | `reporterId` **no** se acepta (I-5) |
| `PUT` | `title`, `description`, `category`, `location` obligatorios; `priority` y `assignedToId` opcionales | `priority` o `assignedToId` presentes y actor no `ADMIN` → `403`. No se ignoran en silencio |
| `PATCH /status` | `status` enum | Un solo campo |
| `POST /comments` | `body` 1–2000 | Un solo campo |
| `GET` lista | `status`, `priority`, `category`, `q` ≤100, `page` ≥1, `limit` 1–100 | `limit` por defecto 20 |

Sobre `PUT`: el `PUT` es de **reemplazo completo** del contenido y de ajuste de los
dos campos con permiso propio. Un `PATCH` parcial sería más coherente con el nombre,
pero la arquitectura dice `PUT` y el cliente ya está escrito contra eso. Lo que no
se negocia es que `status` no se toque por aquí (I-12).

Cuando el `PUT` lleva `priority` o `assignedToId`, el servicio llama a
`app_update_incident_content` **y** a `app_set_incident_priority` o
`app_assign_incident`, dentro del **mismo** `withContext`. Varias llamadas a
funciones en una petición son una sola transacción, porque `withContext` abre una
sola: o se aplican las tres cosas o no se aplica ninguna.

### 7.4 Códigos de error

| Situación | HTTP | `code` |
|---|---|---|
| Cuerpo o ruta mal formados, enum inválido, `assignedToId` no es un `PROVIDER` activo | 400 | `VALIDATION_ERROR` |
| Sin sesión | 401 | `UNAUTHORIZED` |
| Rol insuficiente en la comunidad, transición por un actor que no puede, `priority` por alguien que no es `ADMIN` | 403 | `FORBIDDEN` |
| La incidencia no existe **o no es visible** | 404 | `NOT_FOUND` |
| Transición que el grafo no permite, transición al mismo estado | 409 | `CONFLICT` |

**No hay `422` y no hay `INVALID_TRANSITION`.** `ErrorCode`
(`backend/src/http/errors.ts`) tiene `CONFLICT` y no tiene un código para
transiciones; añadir uno obliga a tocar el contrato de error de todo el proyecto
para un caso que `CONFLICT` ya describe. Y **no hay `422`**: la validación de este
proyecto es `400 VALIDATION_ERROR` en los tres bloques anteriores, y un enum
inválido es la misma clase de fallo que un título demasiado corto.

### 7.5 Traducción de los errores de PL/pgSQL

`backend/src/incidents/errors.ts` es el único sitio que sabe traducirlos, y es el
mismo patrón que `members/errors.ts`: se exige **el par** de `errcode` y sentinel,
no solo el sentinel. Un sentinel es una cadena, y cualquier valor que venga del
cliente puede acabar dentro del mensaje de un error de PostgreSQL; con el par, un
título que se llamase `incident_invalid_transition` no puede convertirse en un 409.

| Sentinel | `errcode` | HTTP |
|---|---|---|
| `incident_not_found` | `P0002` | 404 |
| `incident_invalid_transition` | `22023` | 409 `CONFLICT` |
| `incident_assignee_not_provider` | `22023` | 400 |
| `incident_priority_required` | `22023` | 400 |
| `forbidden_role` | `42501` | 403 |
| `incident_requires_admin` | `42501` | 403 |
| `sin contexto de usuario` | `42501` | 401 |
| — (`22P02`, uuid o enum inválido) | `22P02` | 400 |
| — (`23514`, CHECK de longitud de la base) | `23514` | 400 |

Dos decisiones que no son obvias y que conviene escribir para que nadie las
"arregle" después:

**La transición inválida es `22023`, no `23514`.** El borrador de esta tabla decía
`23514`, y es un error: `23514` es también lo que salta cuando el título es
demasiado corto o la descripción demasiado larga, porque en este bloque la
longitud se comprueba en la base de datos (§4f). Con las dos cosas en `23514`, un
título de tres letras y una transición imposible se distinguen solo por el sentinel
dentro del mensaje, y si un día Prisma reescribe ese mensaje el título corto se
devolvería como un 409 en lugar de un 400. Con `22023` los dos casos ocupan
`errcode` distintos y son inequívocos aunque el sentinel se pierda.

**El `23514` sin sentinel es un 400, no un 409 ni un 500.** Es el único `errcode`
que aquí no lleva sentinel propio, y llegar a él significa que un CHECK de la
tabla saltó: eso es un formulario mal rellenado.

Un `42501` desconocido cae en `403` y un `23505` desconocido en `409`, por el mismo
motivo que en el bloque 03: una política que se cierra de más debe dar un 403 y no
un 500 que nadie sabe mirar.

---

## 8. Estructura de archivos

```
supabase/sql/02e_incidents.sql                    NUEVO
backend/src/incidents/middleware.ts               NUEVO   requireIncident()
backend/src/incidents/validators.ts               NUEVO
backend/src/incidents/errors.ts                   NUEVO
backend/src/incidents/repository.ts               NUEVO
backend/src/incidents/service.ts                  NUEVO
backend/src/incidents/controller.ts               NUEVO
backend/src/incidents/routes.ts                   NUEVO
backend/src/incidents/__tests__/validators.unit.test.ts        NUEVO
backend/src/incidents/__tests__/errors.unit.test.ts            NUEVO
backend/src/__tests__/incidents.api.integration.test.ts         NUEVO

backend/prisma/apply-sql.ts        MODIFICADO   añade '02e_incidents.sql'
backend/prisma/schema.prisma       MODIFICADO   `npx prisma db pull`, gana needs_review
backend/src/app.ts                 MODIFICADO   monta los dos routers
supabase/sql/04_verify.sql         MODIFICADO   sección nueva antes del INFORME
docs/API.md                        MODIFICADO
docs/SECURITY.md                   MODIFICADO
```

`errors.ts` en plural y no `error.ts`, como en `members/` y `communities/`. El
borrador anterior lo llamó `error.ts` y lo importaba como `./errors`: un módulo
que no resuelve, que solo falla al compilar.

`02e_incidents.sql` va en la lista de `apply-sql.ts` **después** de
`02d_members.sql` y **antes** de `03_storage.sql`: recrea políticas que existen en
`02_rls.sql` y usa `app_role_in()`, que aparece en `02_rls.sql`.

Y una corrección de este listado frente al borrador: el test de integración **no** va
en `src/incidents/__tests__/`, sino en `src/__tests__/`, que es donde ya están los
otros tres `*.api.integration.test.ts`. Los unitarios sí van junto al módulo, como los
de `members/` y `communities/`. Son dos convenciones distintas y la que se rompe al
inventarse una tercera es la que luego cuesta. `helpers.ts` no se toca: el fixture de
incidencia que ya existía (`makeIncident`) ha servido, y `makeProvider()` no hizo
falta porque los escenarios de este bloque necesitan un `PROVIDER` con sesión, que es
`makeMember(u, c, 'PROVIDER')` más un login.

---

## 9. Variables de entorno

Ninguna. Este bloque no introduce secretos ni variables nuevas.

---

## 10. Criterios de aceptación

### Seguridad

- Un miembro de la comunidad A **no** ve ninguna incidencia de la B, ni al listar ni
  al abrirla por id, ni sus comentarios. `0 filas` y `404` respectivamente.
- Un `PROVIDER` no ve ninguna incidencia de su comunidad que no tenga asignada, ni
  sus comentarios.
- Un `NEIGHBOR` ve las suyas y **solo** las suyas. No ve las de otro vecino aunque
  las dos sean de la misma comunidad.
- `app_runtime` **no** tiene `INSERT` ni `UPDATE` sobre `incidents`.
- `incidents` **no** tiene política de `INSERT` ni de `UPDATE`.
- Un `NEIGHBOR` no puede cambiar el estado de su incidencia por API.
- Un `ADMIN` no puede asignar a un usuario que no es `PROVIDER` activo de esa
  comunidad, y el intento es un `400`, no un `403`: el rol del objetivo no es
  información oculta sobre el usuario.
- Un `PROVIDER` **suspendido** desaparece de la lista de asignables, y lo que tenía
  asignado deja de verlo.
- `ADMIN_SA` que no es miembro recibe `403` en las **dos** rutas de comunidad
  (listado y alta) y `404` en las **seis** de incidencia. No es una discrepancia: la
  comunidad existe y que no seas miembro de ella se puede decir sin filtrar nada,
  mientras que la incidencia no es visible para ti y un `403` confirmaría que ese id
  existe (C-8). Este criterio decía antes `403` en las ocho rutas.
- Un `NEIGHBOR` que intenta editar la incidencia de **otro vecino** de su misma
  comunidad recibe `404`, no `403`: no la ve, así que el permiso de escribir en ella
  ni siquiera llega a plantearse. Y el mismo vecino, sobre **su** incidencia, recibe
  `403`, que es el caso en el que la regla de rol es la que decide.
- La traducción de un error de PL/pgSQL exige el par (errcode, sentinel). Se comprueba
  en `incidents/__tests__/errors.unit.test.ts` y **no** por la API: el mensaje de un
  `CHECK` reventado no lleva los datos de la fila, así que no se puede hacer llegar un
  sentinel de cliente hasta el mensaje de error por la vía normal. El criterio decía
  antes "un título que se llame `incident_invalid_transition` produce un `400`", que
  además es falso: ese título tiene 27 caracteres y es perfectamente válido, así que
  el `POST` devuelve `201`.

### Visibilidad

- El listado de un `ADMIN` y el de un `PRESIDENT` incluyen incidencias de vecinos
  que ellos no han reportado, y ambos ven la misma lista.
- El listado de un `PROVIDER` incluye solo las asignadas.
- El listado filtra por `status`, `priority`, `category` y `q`, combinados, y `q`
  encuentra por fragmento de título con acentos y mayúsculas.
- Paginación: `meta` trae `page`, `limit`, `total` y `totalPages`, y `total` es el
  total **sin** paginar.
- `limit: 1000` es un `400`, no un `100`: el contrato de §7.3 fija `limit` entre 1 y
  100, y el recorte a 100 de `app_list_incidents()` es la segunda capa, para quien
  llame a la función sin pasar por el esquema (§5.8). Este criterio decía antes "se
  acota a 100", que es lo que hace la función y no la API, y contradecía a §7.3. Se
  mantiene el contrato: un `4xx` que nombra el campo es mejor que un `200` con una
  página de tamaño distinto del pedido.

### Transiciones

- `OPEN → IN_PROGRESS → RESOLVED`, hecho por el `ADMIN` y hecho por el `PROVIDER`
  asignado.
- `OPEN → RESOLVED` directo es `409`.
- `RESOLVED → OPEN` por `ADMIN` reabre; por el `PROVIDER` asignado es `403`, **no**
  `409`. Es la razón de que `app_transition_incident()` tenga una guarda de "esta
  arista es solo del ADMIN" separada de la guarda de grafo (§5.6): si el requisito de
  `ADMIN` estuviera dentro de la arista, el proveedor caería en
  `incident_invalid_transition` y el cliente le ofrecería elegir otro estado destino,
  cuando no existe ninguno que sirva.
- `→ CANCELLED` por `ADMIN` desde los tres estados; por el `PROVIDER` asignado es
  `403`, por el mismo motivo.
- `OPEN → OPEN` de un `PROVIDER` asignado sigue siendo `409` ("transición al estado
  actual"), no `403`: `OPEN` solo es destino válido desde `RESOLVED`, y la guarda de
  "solo del ADMIN" mira también el origen por eso.
- `CANCELLED → CANCELLED` es `409` también para el `PROVIDER`, porque `CANCELLED` no
  es origen de ninguna arista y lo que le falta no es un permiso sino una arista.
- Desde `CANCELLED` no se sale: cualquier transición es `409`.
- Una transición al estado actual es `409`.
- `resolved_at` tiene valor al entrar en `RESOLVED` y es `null` al reabrir.
- Dos `PATCH /status` simultáneos desde el mismo estado: uno entra y el otro recibe
  `409`, nunca los dos `200`.

### Quién puede hacer qué (D-2 y D-3)

Estas seis fijan D-2 y D-3, que son las dos decisiones donde el documento y
`ARCHITECTURE.md` no coinciden del todo.

- Un `PRESIDENT` **cambia el estado**: `403`, aunque la transición sea válida y
  aunque sea la incidencia de un vecino. Reabrir y cancelar también.
- Un `PRESIDENT` **cambia la prioridad**: `403`, y el `PUT` con `priority` o con
  `assignedToId` es `403` antes de tocar la base de datos.
- Un `PRESIDENT` **edita el contenido**: `200`. Título, descripción, categoría y
  ubicación, de cualquier incidencia de su comunidad.
- Un `PRESIDENT` **borra**: `403`, como un `NEIGHBOR`.
- Un `PRESIDENT` **crea** y **comenta**: `200`.
- Un `NEIGHBOR` edita el contenido de la suya y `403` en la de otro.

### Asignación

- Solo `ADMIN` asigna. `PRESIDENT`, `NEIGHBOR` y `PROVIDER` reciben `403`.
- `assignedToId: null` desasigna.
- Asignar a un `PROVIDER` activo de la comunidad, desde el `PUT`, devuelve la
  incidencia con `assignedToId` y `assignedToName` puestos.
- Asignar a un `PROVIDER` de **otra** comunidad es `400`, y no deja la incidencia
  asignada.
- Cambiar la prioridad la hace `ADMIN` y pone `needs_review` a `false`.

### Creación y contenido

- `referenceCode` tiene el formato `INC-<año>-<6 dígitos>`.
- Dos incidencias seguidas en la misma comunidad no repiten `referenceCode`.
- Un `NEIGHBOR` que crea `CRITICAL` recibe `needsReview: true`; un `ADMIN` que crea
  `CRITICAL` recibe `needsReview: false`.
- Un `PROVIDER` que intenta crear una incidencia recibe `403`.
- `POST` con `reporterId` en el cuerpo es `400`, por `.strict()`.
- El `POST` responde `201` con `Location: /api/v1/incidents/:id`.
- Editar el contenido por `PUT` sin `priority` ni `assignedToId` **no** cambia ni el
  estado ni el `assignedToId` ni la prioridad.
- Un reporter que manda `priority` en su `PUT` recibe `403`, no un `200` que lo
  ignoró.

### Borrado

- `DELETE` responde `204`, y la incidencia desaparece del listado y del `GET` por id
  para **todos** los roles, incluido su reporter y su proveedor asignado.
- `DELETE` por un `NEIGHBOR` o un `PRESIDENT` es `403`.
- `DELETE` dos veces: la segunda es `404`, no `204` ni un error raro.
- Tras el borrado, los comentarios de esa incidencia tampoco se listan.

### Comentarios

- `POST` un comentario devuelve `201` con el recurso y su `authorName`.
- Un `PROVIDER` asignado puede comentar; uno no asignado recibe `404`.
- Un `NEIGHBOR` no puede comentar en la incidencia de otro.
- El listado sale en `created_at asc`.

### Contrato

- El sobre es `{ data }` en éxito y `{ error: { code, message, details? } }` en
  fallo, sin excepciones.
- Todo `4xx` lleva un `code` de la lista de §7.4.
- Los mensajes van en castellano.

### Verificación

- `npm run typecheck` sin errores.
- `npm test` verde, incluidos los unitarios de los esquemas de zod de este bloque.
- `npm run test:integration` verde.
- `npm run check:db` y `npm run db:verify` verdes, con una sección nueva de
  incidencias (numeración **10**, desplazando "Buckets de Storage" a 11 e
  "INFORME" a 12):
  - `incidents` sin política de `INSERT` ni de `UPDATE`.
  - `app_runtime` sin `INSERT` ni `UPDATE` sobre `incidents`.
  - Las once funciones existen, son `SECURITY DEFINER`, tienen
    `search_path = public, pg_temp`, `execute` para `app_runtime` y **no** para
    `PUBLIC`.
  - `incidents_select_scoped` menciona `deleted_at`.
  - Existe el índice único de `reference_code`.
  - Informa de si los dos `CHECK` de longitud están validados.
  - `incidents` tiene la columna `needs_review` (D-1), `boolean`, `not null`, con
    `default false`.
  - La terna de visibilidad de `app_can_see_incident` y la de `app_list_incidents`
    siguen citando las mismas tres condiciones (§5.1). Es una comprobación de texto
    sobre `pg_get_functiondef`, y es aceptable porque las dos copias del predicado existen
    por un motivo justificado en §5.1: la alternativa sería una función por fila en el
    listado.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Perder de vista el `communityId` en las siete rutas sin comunidad y equivocarse de contexto | `requireIncident()` es el único camino y `04_verify.sql` no lo comprueba, pero los tests de §10 lo cubren para las siete. El riesgo abierto es el bloque 05 en adelante: **cada módulo con rutas sin `communityId` necesita su propio `require*()`** |
| `02e_incidents.sql` se aplica antes que `02_rls.sql` y falla | El orden en `apply-sql.ts` es explícito, y `db:verify` corre al final |
| `prisma db pull` sobrescribe `schema.prisma` con cambios de alguien más | Se revisa el diff de `schema.prisma` antes de commitear; el único cambio esperado es `needs_review` |
| Un `23505` al crear por `reference_code` | No puede ocurrir: la secuencia es global y no se puede repetir. Si aparece, es que `reference_code` lo pone alguien a mano, que es justo lo que I-15 impide |
| El `NOT VALID` de los dos `CHECK` se queda sin validar y un dia se encuentra una fila corta | `db:verify` lo informa en cada ejecución, así que salta a la vista |
| Que `needs_review` Resultara redundante y se quitara en el bloque 10 | Se reutiliza tal cual: es el mismo concepto que `incident_drafts.needs_human_review`, en la tabla de la incidencia ya creada |

---

## 12. Decisiones del desarrollador

Las cuatro están tomadas. Ninguna queda abierta.

| # | Decisión | Alternativa descartada | Consecuencia técnica |
|---|---|---|---|
| **D-1** | Se **añade** `incidents.needs_review` | Prohibir `CRITICAL` a `NEIGHBOR` con `403` | Un `alter table ... add column if not exists`, un `npx prisma db pull` y dos comprobaciones más en `04_verify.sql`. I-9, §4e |
| **D-2** | Las respuestas llevan **`reporterName` y `assignedToName`**, leídos desde funciones `SECURITY DEFINER` | No devolverlos y que el cliente los busque por su cuenta | I-11. Los `JOIN` con `users` se hacen dentro de `app_list_incidents`, `app_get_incident` y `app_list_incident_comments`. Sin ellos, una lista de incidencias no dice quién las reportó, que es justo el dato de I-1 |
| **D-3** | `PRESIDENT` **edita el contenido**: `title`, `description`, `category`, `location` | Solo `ADMIN` edita | I-10. `app_update_incident_content` acepta reporter, `ADMIN` y `PRESIDENT`. Sigue sin poder tocar prioridad, estado, asignación ni borrado |
| **D-4** | `PRESIDENT` **no cambia el estado**, ni siquiera en incidencias ajenas | Que pueda, como en el borrador anterior | §5.6. `ARCHITECTURE.md` §5 le da un "—" explícito en "Cambiar estado de incidencia", y se sigue el documento. Un `403`, no un `409` |

### Lo que D-3 y D-4 dejan fuera del `PRESIDENT`

D-3 y D-4 juntas producen un rol que puede **ver** todas las incidencias de su
comunidad, **corregir el texto** de cualquiera, crear, comentar y poco más: no
mueve el estado, no prioriza, no asigna y no borra.

Es coherente con la matriz de `ARCHITECTURE.md` §5, donde el `PRESIDENT` tiene
lectura completa y escritura de contenido, y la gestión con consecuencias
—estado, dinero, roles— es del `ADMIN`. Pero conviene decirlo porque
"presidente de la comunidad" se lee como "alguien que puede gestionarlo", y aquí
no puede: puede corregir la descripción de una filtración y nada más.

Si algún día hace falta que el presidente abra un parte, la vía no es darle
permiso sobre `status`: es una transición más para otro rol, o un endpoint de
"reasignar a la comunidad" que aparte el concepto de "empezar a trabajar en
ello".

### Pendiente, y no bloquea

**Comentarios.** Este bloque no los edita ni los borra (I-7), y
`comments_update_author` se queda como está, sin endpoint que la use. Corregir un
comentario es otro endpoint y otra decisión, y hasta entonces el `PATCH`
correspondiente sería un `400` por `.strict()`.

---

## 13. Fuera de alcance

- Clasificación por IA y `incident_drafts` (`10-ai-assistant.md`).
- Notificaciones por `INCIDENT_CREATED` / `INCIDENT_UPDATED` / `INCIDENT_COMMENT`.
  Los tres tipos ya están en el enum `notification_type`, y se emiten cuando exista
  el módulo de notificaciones.
- `audit_logs`. `app_runtime` ya puede insertar ahí, y transicionar, asignar y borrar
  son acciones de administración que dejarían rastro. Si se quiere, es una decisión
  aparte: escribirlas dentro de las funciones es lo único que garantiza que no
  falten.
- Adjuntos y `location` como puntos en un plano. `location` es texto en esta spec.
- Búsqueda por texto en la descripción. `incidents_title_trgm_idx` solo cubre el
  título.
- Moderación de comentarios. Los comentarios no tienen ninguna ACL más allá
  de poder ver la incidencia.

---

## 14. Errores corregidos respecto al borrador anterior

Se listan porque un spec que se corrige sin decir qué se corrigió no se puede
revisar contra el anterior.

| # | En el borrador | Realidad |
|---|---|---|
| 1 | `assigned_to` | La columna es **`assigned_to_id`** |
| 2 | `needs_review boolean not null` "ya existe" | **No existe.** Este bloque la añade (§4e) |
| 3 | `incident_comments` sin `deleted_at` | **Sí tiene `deleted_at`** |
| 4 | `title` "5–120 caracteres" | El `CHECK` es de **5 a 200** |
| 5 | Índices `incidents_reporter_idx (reporter_id, created_at desc) where deleted_at is null` | Es `(reporter_id)` a secas, y hay dos índices más que el borrador no recogía |
| 6 | `reference_code` sin mention | Es `not null` **sin default**: sin generarlo, todo alta falla |
| 7 | §4 proponía **reemplazar** las políticas de `incidents` porque "probablemente son de cualquier miembro" | `02_rls.sql` §5.4 **ya** implementa la terna de I-1 con `app_is_assigned_provider`. El problema real es el otro: la política de `UPDATE` y el `grant` de escritura (§4a) |
| 8 | `PATCH /incidents/:id/assignee` como endpoint propio | No está en `ARCHITECTURE.md` §6. La asignación va en el `PUT` |
| 9 | `INVALID_TRANSITION` como código de error | `ErrorCode` no lo tiene. Es `CONFLICT` (§7.4) |
| 10 | `422 VALIDATION_ERROR` para enums inválidos y para el asignado que no es `PROVIDER` | Este proyecto valida con `400`. Los bloques 01–03 no usan `422` en ningún sitio (§7.4) |
| 11 | "`PRESIDENT` puede cambiar el estado" | `ARCHITECTURE.md` §5 le da un "—" explícito. La spec le excluye y lo marca como pendiente (§12.4) |
| 12 | Ordenación por `status asc, priority desc` | Ordenar un ENUM es ordenarlo por su declaración: daría `CANCELLED` primero y `CRITICAL, MEDIUM, LOW, HIGH` para la prioridad (§I-14) |
| 13 | "`PATCH` al `body` del comentario" en I-7, sin endpoint que lo atienda | I-7 ahora dice que no se editan |
| 14 | La política de `SELECT` propuesta filtraba `deleted_at is null`, pero el `UPDATE` se quedaba como estaba | El `UPDATE` se **elimina**, que es lo que cierra el agujero (§4a) |
| 15 | `error.ts` importado como `./errors` | Módulo inexistente. Se llama `errors.ts` |
| 16 | El fichero se cortaba a mitad de la frase en §4a | Completo |
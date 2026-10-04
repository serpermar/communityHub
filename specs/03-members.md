# Spec 03 — Miembros

> **Estado: APPROVED.** Aprobada por el desarrollador el 2026-10-05. Decisiones
> que van dentro de la aprobación, tal cual están descritas aquí: **M-1**
> (entrada por código de invitación, sin alta directa), **M-3** (el último ADMIN
> bloqueado, sin prohibición de auto-cambiarse), **M-9** (la invitación no tiene
> columna `role`), **M-10** (el canje es una ruta aparte y el registro no cambia),
> **M-11** (se anula una invitación sin usar con `DELETE`) y **§4a** (se quitan las
> tres políticas de escritura de `community_members`, para que el invariante de
> M-3 viva en la función y no en la capa HTTP).
>
> **Bloque 03**, precedido de `01-authentication` y `02-communities`.
> **Base de datos:** `supabase/sql/01_schema.sql` (la tabla `community_members`
> ya existe), `02_rls.sql` (cuatro políticas ya existen) y `02d_members.sql`
> (archivo nuevo, en este bloque).
> **Backend:** `backend/src/members/`.
>
> **Decidido por el desarrollador el 2026-10-05.** M-1 a M-4 en la primera
> ronda, M-5 a M-11 en la segunda.

---

## 1. Objetivo

Que un vecino entre en la comunidad que le corresponde, salga cuando toca, y que
el rol que tiene dentro de ella sea verdad en todas partes.

La pertenencia es el eje del aislamiento del proyecto entero. `app_is_member_of()`
la leen las políticas de RLS de incidencias, reservas, documentos, finanzas,
votaciones y avisos. Una fila en `community_members` mal puesta no es un dato
sucio: es una puerta abierta o una cerrada de más.

Este bloque **no** toca incidencias, reservas ni nada más. Solo la lista de quién
está en la comunidad, con qué rol, y cómo se entra y se sale.

### Qué queda fuera

| Fuera | Por qué |
|---|---|
| Registro de usuarios | `01-authentication`. Aquí solo se usa su cuenta existente |
| Compartir documentos | `08-documents`. El ACL propio va en su bloque |
| Enviar correo a los miembros | Sin SMTP no hay correo (§12) |
| GDPR: borrar la fila de un miembro | M-4. Se conserva el histórico |
| Migrar una membresía entre comunidades | Cada comunidad es independiente |

---

## 2. Decisiones

### 2.1 Ronda 1

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **M-1** | La entrada es por **código de invitación opaco** que el ADMIN comparte por el canal que sea (WhatsApp, en persona, un cartel) | Alta directa por email | Sin SMTP no se puede enviar nada. Un código opaco y caducable es verificable por cualquier canal. El alta directa tiene dos problemas: cualquiera con una cuenta puede ser añadido a una comunidad sin saberlo, y el ADMIN necesitaría un buscador de usuarios para hacerlo |
| **M-2** | Solo `ADMIN` invita, cambia roles y suspende | También `PRESIDENT` | Coherente con el bloque 02, donde el `PATCH` de configuración ya es de `ADMIN`. Un `PRESIDENT` gestiona avisos y votaciones; quién entra al portal es otra cosa. Ampliarlo después es un cambio pequeño; quitarlo después es reescribir el bloque |
| **M-3** | El **último ADMIN no puede degradarse ni irse**: 409 diciendo que hay que promover a otro primero | Permitir y avisar por correo | Sin `DELETE` de comunidad y con `ADMIN_SA` sin lectura sobre comunidades ajenas (C-12), una comunidad sin ADMIN es ingobernable y sin arreglo por API. El aviso por correo no existe sin SMTP, así que "permitir y avisar" es permitir y no avisar |
| **M-4** | La salida es `SUSPENDED` (reversible) o `LEFT` (estado final). **Nunca se borra la fila de una membresía** | Añadir `DELETE` físico | `SUSPENDED` es para un impago o una disputa, y se levanta. `LEFT` es que se va. Borrar la fila pierde quién estuvo y cuándo, que es justo lo que hace falta cuando hay un problema. Coherente con la baja lógica de comunidades (C-5) |

### 2.2 Ronda 2

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **M-5** | El `role` es **cambiable** entre los cuatro valores, y `status` es **independiente** del `role` | `status` derivado del `role` | Un `ADMIN` suspendido sigue siendo `ADMIN` en la fila y no administra nada. Separarlos permite suspender sin perder el rol para cuando se levante, que es el caso real |
| **M-6** | El código es de **un solo uso** y para **una sola comunidad** | Reutilizable, o válido en varias | Un código reutilizable es un enlace permanente al portal. Y un código válido en varias comunidades convierte al que lo tiene en `ADMIN_SA` de hecho, sin ninguna de las garantías de `app_is_global_admin()` |
| **M-7** | El código **caduca a los 7 días** | Sin caducidad | Sin caducidad, un código se queda pegado a un grupo de WhatsApp indefinidamente. Siete días da tiempo de sobra para pasarlo por cualquier canal |
| **M-8** | El **email es obligatorio** en la invitación y se compara en el canje | Invitación sin email, entra quien tenga el código | Con el email, el código solo sirve a quien el ADMIN quiso invitar. Sin él, cualquiera que lo intercepte entra |
| **M-9** | Quien entra por invitación es **siempre `NEIGHBOR`** | Elegir el rol al invitar | Invitar a alguien como `ADMIN` es darle control de la comunidad por un canal que no se audita. El rol se cambia después, desde dentro, con registro y por la API. Por eso la invitación **no tiene columna `role`** |
| **M-10** | El canje es una **ruta aparte y autenticada**: `POST /api/v1/invitations/redeem` | `invitationCode` opcional dentro de `POST /auth/register` | El registro del bloque 01 no se toca. El canje es una función atómica que ya tiene sesión, y así el recién registrado y el que llevaba años usan el mismo camino. Meterlo en el registro obligaba a definir qué pasa si el alta funciona y el código no: o se deshace la cuenta, o se devuelve 400 con la cuenta ya creada |
| **M-11** | Se puede **anular una invitación sin usar** con `DELETE`; las usadas se conservan | `revoked_at`, o nada | El código filtrado por WhatsApp es una puerta abierta **ahora**, mientras que un miembro que se va es un hecho pasado. El borrado físico se limita a la invitación que nunca se usó, que es justo la que no tiene valor histórico |

### Sobre M-2 y la matriz de roles

`PROVIDER` sigue siendo un rol más de `community_members` y se cambia por el
mismo `PATCH` que los demás. Lo que cambia es que **nadie entra como `PROVIDER`
por invitación**: el proveedor de confianza entra como vecino y se le degrada
después. Un `PROVIDER` ve los trabajos que tiene asignados, y asignarlos es una
decisión operativa del bloque `04-incidents`, no del momento de dar de alta a
alguien.

### Un detalle de M-9 que conviene no perder de vista

Un vecino que se fue (`LEFT`) y vuelve a entrar con una invitación nueva lo hace
como `NEIGHBOR`, aunque antes fuera `ADMIN`. El rol se le vuelve a dar desde
dentro, con registro. Es la consecuencia de que la invitación no lleve rol, no un
efecto secundario buscado, pero hay que saberlo.

---

## 3. Modelo de datos

### `community_members` — ya existe, la estructura no se toca

```sql
id            uuid primary key
community_id  uuid not null references communities (id) on delete cascade
user_id       uuid not null references users (id) on delete cascade
role          member_role not null default 'NEIGHBOR'   -- NEIGHBOR, PRESIDENT, ADMIN, PROVIDER
status        member_status not null default 'ACTIVE'   -- ACTIVE, SUSPENDED, LEFT
unit_number   text              -- portal, 3ºB. Sin uso en este bloque (§11)
invited_by    uuid references users (id) on delete set null
joined_at     timestamptz not null default now()
created_at    timestamptz not null default now()
updated_at    timestamptz not null default now()

unique (community_id, user_id)
```

Los índices ya están: `community_members_scope_uidx` (el único por comunidad y
usuario, que es lo que hace idempotente la inscripción) y
`community_members_lookup_idx` (por comunidad y rol, parcial sobre `ACTIVE`).

**`unique (community_id, user_id)` tiene una consecuencia que hay que entender
antes de escribir el canje.** No puede haber dos filas para el mismo par. Un
vecino que se va y vuelve **no crea una fila nueva**: se le actualiza el `status`
de vuelta a `ACTIVE`. Es lo que hace el `on conflict` de `app_redeem_invitation()`.

### `community_invitations` — tabla nueva

```sql
id            uuid primary key default gen_random_uuid()
community_id  uuid not null references communities (id) on delete cascade
email         text        not null   -- a quién se invita, siempre en minúsculas
code_hash     text        not null   -- SHA-256 del código. Nunca el código
invited_by    uuid not null references users (id) on delete cascade
expires_at    timestamptz not null
accepted_at   timestamptz,           -- NULL mientras no se ha usado
accepted_by   uuid references users (id) on delete set null,
created_at    timestamptz not null default now()

unique (community_id, code_hash)
```

**No hay columna `role`** (M-9): un campo que solo puede valer una cosa es ruido
que después alguien lee como si fuera configurable.

**Se guarda el hash, no el código.** Es el mismo criterio que las sesiones del
bloque 01: si alguien lee la tabla, con el hash no puede entrar en nada. Si el
código estuviera en claro, una lectura de la tabla sería una lista de puertas
abiertas de todas las comunidades.

`email` se guarda en minúsculas para que la comparación del canje sea un `=`
directo, igual que hace `users_email_lower_uidx` con las cuentas.

`expires_at` lo rellena el servidor a 7 días (M-7). El cliente no lo manda, igual
que no manda `created_at`.

`accepted_at` no es un `status`: es una fecha o nada. Una invitación usada se
queda en la tabla, porque "este ADMIN invitó a este vecino el día tal" es
información que un administrador necesita y borrarla la destruye (M-4, M-11).

Índices:

- `unique (community_id, code_hash)`, ya en la definición.
- Parcial sobre las vivas, para que "solo una invitación viva por email y
  comunidad" se pueda garantizar con un índice y no solo con la función:
  `community_invitations_live_uidx on community_invitations (community_id, email) where accepted_at is null`.
- `community_invitations_lookup_idx on community_invitations (community_id, created_at desc)`.

---

## 4. El problema del arranque

Tres cosas no se pueden expresar con las políticas que ya hay, y una se arregla
quitando políticas en vez de añadiéndolas.

### a) Tres políticas sobran y una puerta está abierta

Las políticas actuales de `community_members` son:

```sql
members_select_own_community  for select using (app_is_member_of(community_id))
members_insert_self           for insert with check (user_id = app_current_user_id() or app_is_admin_of(community_id))
members_update_admin          for update using (app_is_admin_of(community_id))
members_delete_admin          for delete using (app_is_admin_of(community_id))
```

Las tres últimas sobran, y una está rota de verdad:

- **`members_insert_self`**: la mitad `app_is_admin_of(community_id)` permite que
  un `ADMIN` inserte la fila de **cualquier** `user_id` con el `role` que quiera.
  Incluido `ADMIN`. Como el alta directa por email ya no existe (M-1), no queda
  ningún camino legítimo que la necesite.
- **`members_update_admin`**: con ella, un `ADMIN` puede cambiar `role` y `status`
  sin pasar por el invariante de M-3. El invariante estaría en la capa HTTP, y
  la capa HTTP no es la frontera de seguridad: el mismo hueco se puede abrir con
  PostgREST o desde cualquier consulta que llegue a la base de datos. El
  invariante tiene que vivir en la función, que es lo único que ve el motor.
- **`members_delete_admin`**: contradice M-4. Nadie borra una membresía.

**Este bloque quita las tres** y deja la de `SELECT`. Con eso:

- No hay política de `INSERT` ni de `UPDATE` en `community_members`. Las únicas
  entradas son `app_create_community()` (que crea el primer ADMIN) y las funciones
  de este bloque, todas `SECURITY DEFINER`, que no pasan por RLS.
- No se toca `users_select_self`, así que `users` sigue siendo solo lectura
  propia para cualquier consulta directa.

Coste: si algún día hace falta una escritura de membresía que no sea ninguna de
las funciones, hay que añadirla explícitamente. Preferible a lo contrario.

### b) Ver el nombre y el email de los vecinos

`community_members` **no tiene `full_name` ni `email`**, y `users_select_self`
(02_rls.sql) solo deja leer la propia fila. El comentario de 02_rls.sql:231 dice
que la comunidad expone "nombre y número de unidad vía community_members", pero
la tabla no tiene ninguno de los dos campos: ese comentario se quedó corto y hay
que corregirlo en `docs/SECURITY.md` al cerrar este bloque.

Dos formas de resolverlo:

- **Denormalizar `full_name` y `email` a `community_members`.** Barato de leer,
  pero duplica el dato: el vecino cambia su nombre en el bloque 01 y el listado
  muestra el viejo hasta que alguien lo reescriba. Es una fuente de verdad
  divergent.
- **Una función `SECURITY DEFINER` que hace el `join`.** `users` no cambia, la
  política no cambia, y el dato es siempre el bueno.

Se elige la segunda. Es el único punto de todo el proyecto donde se leen filas de
`users` ajenas, y por eso está concentrado en una función con guarda
explícita y con un `select` de dos columnas, no un `select *`.

### c) Invitar requiere escribir en una tabla que todavía no se puede leer

Para crear una invitación hay que insertar en `community_invitations`. Con
`communityId` fijado, `app_is_admin_of()` es cierta y una política bastaría. Pero
una política de `INSERT` dejaría que el cliente eligiera `expires_at` (y romper
M-7) y que escribiera `accepted_at` (y simular una invitación ya usada). Por eso
el `INSERT` **no** tiene política: la genera la función, que pone la caducidad,
pone `accepted_at = null` y genera el código.

El `SELECT` y el `DELETE` sí van por política, porque no tienen ningún campo que
el cliente pueda usar para saltarse una regla.

### d) El invariante del último ADMIN necesita contar

"Es el último" es un `count` sobre `community_members`, y un `UPDATE` no puede
llevar la cuenta dentro de la misma sentencia sin disparador. Con
`SECURITY DEFINER` la cuenta se hace dentro de la función, en la misma
transacción que el cambio, y es imposible que alguien se cuelgue entre el `count`
y el `UPDATE`.

### e) Canjear es una operación de dos pasos

Marcar `accepted_at` y crear la membresía tienen que ser la misma transacción. Con
dos escrituras sueltas, un fallo entre medias deja un código marcado como usado
sin membresía, y el vecino ha perdido la invitación.

---

## 5. Funciones

Todas `SECURITY DEFINER`, todas con `set search_path = public, pg_temp`, todas
con `revoke execute` a `PUBLIC` y `grant execute` a `app_runtime` solamente. El
patrón es el de `app_create_community()` (02c) y se repite aquí porque las
funciones son la frontera de seguridad de este bloque.

### Sobre el código y su hash

```sql
-- 64 hex chars, 244 bits de entropía. Dos gen_random_uuid(), no
-- gen_random_bytes(): con `search_path = public, pg_temp` las funciones de
-- pgcrypto pueden no resolver, porque en Supabase las extensiones viven en el
-- esquema `extensions`. gen_random_uuid() está en pg_catalog (PG 13+) y el
-- sha256() también, así que no dependemos del search_path.
v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
v_hash := encode(sha256(convert_to(v_code, 'utf8')), 'hex');
```

El código se genera entero en el servidor. **Nunca lo recibe el cliente**: si lo
recibiera, un `ADMIN` podría poner un código predecible y adivinar invitaciones
ajenas, porque el hash es lo único que se compara.

### `app_invite_to_community(p_community_id uuid, p_email text) returns text`

Devuelve el **código en claro**, porque hay que poder enseñárselo al vecino.

- Guarda: `app_is_admin_of(p_community_id)`, si no → `42501`.
- Email obligatorio y con forma, en minúsculas (M-8). Vacío o sin `@` → `22023`.
- Si ya hay una invitación **viva** para ese email en esa comunidad → `invitation_already_live`
  (409). No se pisa la anterior: el ADMIN que la ha perdido la anula con `DELETE`
  y genera otra, y así queda en el registro que la hubo.
- Inserta con `expires_at = now() + interval '7 days'` y `accepted_at = null`.
- Devuelve el código. Único punto del sistema donde el código en claro existe.

### `app_redeem_invitation(p_code text) returns table (member_id uuid, community_id uuid)`

- Guarda: hay sesión (`app_current_user_id()` no es null), si no → `42501`.
- Busca por `sha256(p_code)` entre las no usadas y no caducadas.
- Si no encuentra ninguna, distingue las dos causas para el error: `invitation_used`
  o `invitation_expired` (400). Caducada y usada son el mismo `400 VALIDATION_ERROR`
  desde fuera, pero el mensaje interno las distingue, que es lo que permite
  escribir dos tests distintos sin inventarse un código de error nuevo.
- Comprueba que el email de la cuenta **coincide** con el de la invitación (M-8).
  Si no → `invitation_email_mismatch` (403, §6).
- Si ya era miembro `ACTIVE` de esa comunidad → `member_already_joined` (409).
- Inserta la membresía como `NEIGHBOR` con `invited_by` = el del código. Si la fila
  existía en `SUSPENDED` o `LEFT`, el `on conflict (community_id, user_id) do
  update` la devuelve a `ACTIVE` y a `NEIGHBOR` (§2.2).
- Marca `accepted_at` y `accepted_by`.
- Todo en una transacción: o entra con membresía, o no entra.

**La comparación de email en SQL, no en TypeScript.** El `UPDATE` y el `INSERT`
tienen que quedar en la misma transacción que la comprobación contra la fila; si
se comparara en la aplicación primero, un segundo canje simultáneo con el mismo
código por parte de otra persona podría colarse entre medias.

La carrera entre dos canjes concurrentes **del mismo usuario con códigos
distintos** de la misma comunidad termina con la membresía `ACTIVE` en los dos
casos y un código consumido de más. Es inofensiva y no merece un bloqueo: el
`unique` impide el estado imposible, que es tener dos filas.

### `app_set_member_role(p_community_id uuid, p_member_id uuid, p_role member_role)`

- Guarda: `app_is_admin_of(p_community_id)`, si no → `42501`.
- La membresía tiene que existir **en esa** comunidad → `member_not_found` (404).
  Comprobarlo con `community_id` en el `where` y no solo por `id` es lo que
  impide que un ADMIN de A toque a un miembro de B diciendo un `memberId` de B.
- Si el objetivo es el **último `ADMIN` activo** y el rol nuevo no es `ADMIN` →
  `member_last_admin` (409).

### `app_set_member_status(p_community_id uuid, p_member_id uuid, p_status member_status)`

Idéntica, y el invariante es el simétrico: si el objetivo es el último `ADMIN`
activo y el estado nuevo no es `ACTIVE` → `member_last_admin` (409).

**"Último ADMIN" se cuenta sobre `status = 'ACTIVE'`.** Un ADMIN suspendido ya no
administra nada (`app_role_in()` filtra por estado activo), así que si queda un
ADMIN suspendido y el otro se va, la comunidad se queda sin nadie. La cuenta mira
solo filas activas, no solo filas con `role = 'ADMIN'`.

**Y no hay una prohibición de cambiarse a sí mismo.** M-3 habla del último ADMIN,
y el criterio es ese: con dos ADMIN, uno puede degradarse o irse. Añadir un
"nunca te cambies a ti mismo" sería una regla distinta, más restrictiva, y haría
que el mensaje de error fuera "no puedes hacer eso" en un caso que sí se puede.

---

## 6. Contrato HTTP

### Modelo del miembro

```jsonc
{
  "id": "uuid",              // el id de la membresía, no el del usuario
  "userId": "uuid",
  "fullName": "Marta Ruiz",
  "email": "marta@ejemplo.test",
  "unitNumber": null,
  "role": "NEIGHBOR",
  "status": "ACTIVE",
  "joinedAt": "2026-10-05T10:00:00.000Z",
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

**El email y el `fullName` salen porque quien lista ya es miembro de esa
comunidad** y los ve en cualquier pantalla del portal. No es una fuga: la
comunidad es el ámbito cerrado. Vienen de la función de lectura (§5b), no de una
política nueva sobre `users`.

### Modelo de la invitación

```jsonc
{
  "id": "uuid",
  "email": "marta@ejemplo.test",
  "expiresAt": "2026-10-12T10:00:00.000Z",
  "acceptedAt": null,        // fecha si se usó
  "createdAt": "2026-10-05T10:00:00.000Z"
}
```

El `code` está **solo** en la respuesta de creación. No se puede recuperar
después: lo que se guarda es el hash.

### Rutas

```
GET    /api/v1/communities/:communityId/members
GET    /api/v1/communities/:communityId/members/:memberId
PATCH  /api/v1/communities/:communityId/members/:memberId

POST   /api/v1/communities/:communityId/invitations
GET    /api/v1/communities/:communityId/invitations
DELETE /api/v1/communities/:communityId/invitations/:invitationId

POST   /api/v1/invitations/redeem
```

Siete endpoints. **No hay alta directa** (`POST .../members`) porque M-1 la
descartó, y **el registro no cambia**: el canje va por su propia ruta (M-10).

`GET /invitations` devuelve también las ya usadas, para que el ADMIN vea a quién
ha invitado y cuándo entró.

### Guardas

| Ruta | Guardias |
|---|---|
| Listar miembros | `requireAuth` + `requireCommunity()` |
| Ver un miembro | `requireAuth` + `requireCommunity()` |
| Cambiar rol o estado | `requireAuth` + `requireCommunity()` + `requireCommunityRole('ADMIN')` |
| Invitar, ver invitaciones, anular | `requireAuth` + `requireCommunity()` + `requireCommunityRole('ADMIN')` |
| Canjear un código | `requireAuth` |

**Listar miembros es de cualquier miembro de la comunidad.** Es el caso de uso
principal ("¿el técnico ya tiene acceso?"), y el `PROVIDER` necesita ver a quién
esperar. El `PROVIDER` ve la lista, que es lo mismo que ver los nombres de su
portal, pero **no** ve los trabajos asignados a otros (`04-incidents`).

El listado incluye a los `SUSPENDED` y a los `LEFT`, con su `status` a la vista:
`SUSPENDED` es visible, no secreto, y el histórico es el punto de M-4. Filtrar por
estado, si hace falta, es cosa del frontend.

### El `PATCH` acepta un campo, no dos

`{ role }` o `{ status }`, nunca los dos y nunca ninguno.

Mandar los dos sería dos llamadas a dos funciones y por tanto dos transacciones:
el vecino se quedaría a mitad de camino si la segunda fallara. No vale la pena
para ahorrar un `PATCH`. Un cuerpo con los dos, o con ninguno, es un `400`.

### Códigos

| Situación | HTTP | `code` |
|---|---|---|
| `:communityId` no es un UUID | 400 | `VALIDATION_ERROR` |
| `:memberId` no es un UUID | 400 | `VALIDATION_ERROR` |
| `:invitationId` no es un UUID | 400 | `VALIDATION_ERROR` |
| Cuerpo que no valida | 400 | `VALIDATION_ERROR` |
| `PATCH` sin campo, o con los dos | 400 | `VALIDATION_ERROR` |
| No es miembro de la comunidad | 403 | `FORBIDDEN` |
| Quiere invitar, listar invitaciones o anular sin ser `ADMIN` | 403 | `FORBIDDEN` |
| No existe esa membresía en esa comunidad | 404 | `NOT_FOUND` |
| No existe esa invitación en esa comunidad | 404 | `NOT_FOUND` |
| Ya es miembro activo de esa comunidad | 409 | `CONFLICT` |
| Ya hay una invitación viva para ese email | 409 | `CONFLICT` |
| Es el último ADMIN y quiere degradarse o irse | 409 | `CONFLICT` |
| Código caducado | 400 | `VALIDATION_ERROR` (el campo es el código) |
| Código ya usado | 400 | `VALIDATION_ERROR` |
| Código válido pero para otro email | 403 | `FORBIDDEN` |
| Anular una invitación ya usada | 409 | `CONFLICT` |

**El último `ADMIN` da 409 y no 403.** No es un problema de permiso: tiene
permiso, lo que le falta es otro ADMIN. Un 403 diría "no puedes", que no es cierto,
y el cliente mostraría un error sin acción posible en vez de "promociona a otro
primero".

**El código válido pero de otro email da 403 y no 400**, por el mismo motivo que
en el bloque 02: un 400 con "este código es de otro email" confirmaría que el
código existe, que es información sobre la comunidad ajena.

**Anular una invitación usada da 409 y no 404.** La fila existe y es visible; lo
que no se puede es deshacer un canje (M-11).

---

## 7. Variables de entorno

Ninguna. La caducidad de 7 días y el formato del código viven en SQL, que es
donde están las demás invariantes de RLS.

---

## 8. Estructura de archivos

```
supabase/sql/02d_members.sql        NUEVO. tabla, funciones, políticas
supabase/sql/04_verify.sql          + la tabla nueva y las políticas de este bloque
backend/prisma/apply-sql.ts         + registrar 02d_members.sql
backend/prisma/schema.prisma        + modelo community_invitations

backend/src/members/validators.ts    NUEVO
backend/src/members/repository.ts    NUEVO
backend/src/members/service.ts       NUEVO
backend/src/members/controller.ts    NUEVO
backend/src/members/routes.ts        NUEVO
backend/src/members/errors.ts        NUEVO. Mapeo de los sentinel de PL/pgSQL
backend/src/members/__tests__/validators.unit.test.ts   NUEVO
backend/src/app.ts                  + montar las rutas

backend/src/__tests__/members.api.integration.test.ts   NUEVO
backend/src/__tests__/helpers.ts     + makeMember, makeAdmin, listMembers

specs/03-members.md                  este archivo
docs/API.md                          + las rutas
docs/SECURITY.md                     + M-3, el hash, y el comentario de 02_rls.sql:231 corregido
```

`backend/src/auth/*` **no se toca**. El canje va en su propia ruta y por eso el
registro del bloque 01 se queda como está.

### Errores de PL/pgSQL

Las funciones levantan los errores de negocio con un sentinel en el mensaje
(`member_last_admin`, `member_not_found`, `member_already_joined`,
`invitation_live`, `invitation_used`, `invitation_expired`,
`invitation_email_mismatch`) y un `errcode` de Postgres. Es el mismo camino que ya
usa `communities/service.ts` para el slug duplicado: el `errcode` real
(`23505`) más un dato que lo identifica, y el mapeo a HTTP vive en el servicio,
no dentro del mensaje de la base de datos.

---

## 9. Criterios de aceptación

### Seguridad

- Un `NEIGHBOR` de A que pide `/communities/B/members` recibe 403.
- Un `NEIGHBOR` que intenta **invitar** recibe 403 (M-2).
- Un `PRESIDENT` que intenta cambiar un rol recibe 403 (M-2).
- Un `PRESIDENT` que intenta crear una invitación recibe 403.
- Un `ADMIN` de A que intenta cambiar un miembro de B recibe 404 por `memberId` de B
  (no 403: la membresía no existe **en esa** comunidad).
- Un `ADMIN` que lee el código de una invitación y lo usa con **otro email**
  recibe 403 (M-8).
- **`community_members` no tiene política de `INSERT` ni de `UPDATE`.** Un
  `ADMIN_SA` o un `ADMIN` que escriba a la tabla por una vía que no sea la función
  recibe `42501` de RLS.
- No hay política de `DELETE` en `community_members`: nadie borra una membresía
  (M-4).
- **`users_select_self` no se toca.** Una consulta directa a `users` desde
  `app_runtime` sigue devolviendo solo la fila propia; el nombre y el email de los
  vecinos salen solo por la función de lectura.
- `public`, `anon` y `authenticated` no pueden ejecutar ninguna de las seis
  funciones de este bloque.
- La tabla de invitaciones **no contiene el código en claro**.

### Invitaciones

- Un `ADMIN` invita a un email y recibe el código en claro **una sola vez**.
- Un segundo `POST /invitations` para el mismo email da 409 mientras la anterior
  siga viva; tras anularla con `DELETE`, da 201 con un código nuevo.
- El código caducado da 400, no 403.
- Un código usado da 400 en el segundo uso (M-6).
- Un código válido da de alta al vecino como `NEIGHBOR` (M-9, M-10).
- Un vecino que ya es `ADMIN` de otra comunidad entra en esta como `NEIGHBOR`.
- Un vecino que estaba `SUSPENDED` en esta comunidad y canjea un código nuevo
  vuelve a `ACTIVE`, como `NEIGHBOR`.
- La invitación usada se queda en la tabla con `accepted_at`.
- Anular una invitación usada da 409 y **no** la borra (M-11).
- `GET /invitations` de un `NEIGHBOR` da 403.

### Roles y estado

- El `ADMIN` cambia un rol y el efecto se ve en la fila.
- El último `ADMIN` no puede degradarse: 409 y su fila sigue intacta (M-3).
- El último `ADMIN` no puede suspenderse: 409.
- Con **dos** ADMIN, uno sí puede degradarse (el invariante es del último).
- Un `ADMIN` **suspendido no administra**: no puede cambiar roles ni invitar,
  porque `app_role_in()` filtra por estado activo.
- Levantar la suspensión devuelve a alguien a su rol anterior (M-5).
- El cuerpo `{ role, status }` a la vez da 400 y no cambia nada.

### Contrato

- Los siete endpoints responden con el envelope.
- `:memberId` mal formado → 400.
- El listado de comunidades **sigue** sin incluir miembros: `GET /api/v1/communities`
  no ha cambiado.
- `GET /members/:memberId` de un miembro de otra comunidad da 404.
- El canje no aparece en el registro: `POST /api/v1/auth/register` sigue igual que
  en el bloque 01.

### Verificación

| Comprobación | Resultado esperado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run test:unit` | verde, sin base de datos |
| `npm run test:integration` | verde, contra Supabase real |
| `npm run check:db` | en verde |
| `npm run db:apply -- --verify` | `02d_members.sql` aplicado, `04_verify.sql` sin excepciones |
| `npm run smoke` | sin regresiones en autenticación |

---

## 10. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El código viaja por un canal que el ADMIN no controla | Alguien que lo intercepte entra como vecino | M-8 (el email debe coincidir) + caducidad de 7 días + poder anularlo |
| `PRESIDENT` necesita meter a alguien y no puede | Work-around en la práctica: se pide al ADMIN | M-2. Se revisa cuando aparezca el caso real |
| Suspender es reversible y queda en la fila | Alguien ve la lista y pregunta por qué está suspendido | La lista muestra `status`. `SUSPENDED` es visible, no secreto |
| El listado expone el email de los vecinos | Que quede registrado en un sitio que no lo merezca | La comunidad es el ámbito cerrado y el email ya se usa para las invitaciones. Alternativa descartada: no exponerlo |
| Se acumula una fila por invitación, incluidas las usadas | Tabla grande con muchas comunidades | Índice parcial sobre `accepted_at is null`. El histórico es el punto (M-4, M-11) |
| `ADMIN_SA` sin lectura sobre comunidades ajenas no puede "arreglar" una comunidad sin ADMIN | Ningún support sin ir a SQL | M-3 evita que la situación llegue a existir. Si ocurre, es por SQL y es excepcional |
| Quitar `members_update_admin` rompe algo de un bloque posterior | Un `PATCH` de miembros que se escriba en TS en vez de en SQL | La alternativa era dejar el invariante de M-3 solo en la capa HTTP, que es donde no debe estar. Si hace falta, se añade una función |

---

## 11. Pendientes

Decisiones que se dejan **ditas** aquí para que no se olviden, porque dependen de
bloques posteriores:

- **`unit_number` (portal)**: la columna existe y este bloque **no** la escribe.
  No hay datos de portales en ninguna parte del sistema todavía, y meter un campo
  más en el `PATCH` obliga a decidir qué es "borrarlo" (`null` explícito) frente
  a "no mandarlo", que en un solo `PATCH` son cosas distintas. Se rellena cuando
  haya reservas (`06-reservations`) o cuando el ADMIN tenga datos reales.
- **Notificar al miembro de su cambio de rol**: no se hace, porque no hay SMTP.
  Cuando lo haya, el sitio es un `after()` del `PATCH`, no la transacción: un
  correo no debe poder tumbar el cambio.
- **Trasladar una membresía entre comunidades**: no existe. La comunidad es el
  ámbito. Un vecino que cambia de portal entra con una invitación nueva.
- **`ADMIN_SA` leyendo cualquier comunidad**: sigue sin leer (C-12). Este bloque
  no lo abre y por eso el riesgo de "comunidad sin ADMIN" hay que resolverlo con
  M-3 antes de que ocurra.

---

## 12. Fuera de alcance

- Correo electrónico, y con él: notificaciones, verificación de dirección y
  recuperación de contraseña.
- Exportar la lista de miembros a CSV.
- Foto de perfil y datos de contacto ampliados (son de `users`, bloque 01).
- Grupos dentro de una comunidad.
- Historial de cambios de rol: `updated_at` dice cuándo, no quién ni de qué a qué.
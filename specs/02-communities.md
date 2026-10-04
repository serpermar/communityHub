# Spec 02 — Comunidades

> **Estado: DRAFT.** Sin la aprobación de esta spec no se escribe código.
>
> **Fase:** 3 (comunidades). Precedida de `01-authentication`, que sigue siendo
> quien resuelve la identidad.
> **Base de datos:** `supabase/sql/01_schema.sql`, `02_rls.sql`, y
> `02c_communities.sql` (archivo nuevo, en este bloque).
> **Backend:** `backend/src/communities/`.

---

## 1. Objetivo

Que un vecino pueda ver las comunidades a las que pertenece, que la plataforma
pueda dar de alta una comunidad nueva con su primer administrador, y que solo ese
administrador pueda cambiar su configuración.

Es el módulo donde se demuestra el requisito central del proyecto: **el
aislamiento entre comunidades**. En autenticación el aislamiento era "solo ves
lo tuyo"; aquí es "solo ves lo de tu comunidad, y hay otra comunidad real al lado
para comprobar que no se cuela". Por eso la spec insiste tanto en el test
adversarial entre dos comunidades.

Fuera de alcance: los miembros, las invitaciones y los roles. Viven en
`03-members.md`. Aquí `community_members` solo se toca para el alta del primer
administrador, y nada más.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| C-1 | El alta la hace `app_create_community()`, función `SECURITY DEFINER` que crea la comunidad y su primer ADMIN en una transacción | Una política que deja a `ADMIN_SA` insertar el primer miembro con el rol que quiera | Es atómico, y la excepción vive en un solo sitio auditable en vez de repartida entre políticas de `communities` y de `community_members` |
| C-2 | Política `INSERT` en `communities` para `ADMIN_SA`, con `created_by` forzado al actor | Sin política, delegando todo en la función | RLS es la segunda capa. Si alguien inserta sin pasar por la función, la política lo frena igual |
| C-3 | `app_is_global_admin()` compara contra `app_current_user_id()` y **no acepta** ningún usuario como parámetro | `app_is_admin_of(user_id, community_id)` con el id como parámetro | Una función `SECURITY DEFINER` que acepta un `userId` libre es escalada de privilegios con una llamada. El predicado va fijado al contexto de sesión |
| C-4 | Los miembros no entran en este bloque | Incluirlos aquí | `03-members.md` es un bloque propio. Mezclarlos dejaría la spec sin un criterio claro de qué está aprobado |
| C-5 | Sin endpoint de borrado. La baja es `PATCH { isActive: false }` | `DELETE /communities/:id` | `deleted_at` y su índice parcial ya existen para baja lógica. Un borrado físico por API sería el primero del proyecto y `communities` no tiene política `DELETE` a propósito |
| C-6 | El `slug` se normaliza a minúsculas y es inmutable tras el alta | Dejarlo editable | `communities_slug_uidx` es único pero **sensible a mayúsculas**: "Barrio Alto" y "barrio-alto" coexistirían y la URL dependería de cómo lo escribió cada uno |
| C-7 | `latitude` y `longitude` son obligatorias en el alta | Ser opcionales y geocodificar | La columna es `not null`. El autocompletado por Photon llega en el bloque de integraciones; para entonces se relaxarán a opcionales |
| C-8 | Quien no es miembro recibe **403**, y un UUID inexistente también | 404 para ambos | 403 uniforme es lo que ya hace `requireCommunity`. Un 403 no distingue "no existe" de "no eres miembro", así que no hay oráculo de existencia |
| C-9 | Un `:communityId` mal formado es **400**, no 403 | Dejar el 403 actual | Es un error de forma del cliente, no de permisos. `requireCommunity` mezcla hoy los dos casos |
| C-10 | "Métricas" no entra aquí | Un `/communities/:id/summary` | El módulo `dashboard` es el sitio de los agregados, y hacerlo dos veces garantiza que no divergan |
| C-11 | Toda lectura y escritura va dentro de `withContext` con el `communityId` ya resuelto | Consultar con solo el `userId` | Con el `communityId` en el contexto, las políticas pueden compararlo y no dependen solo de `app_is_member_of` |
| C-12 | `ADMIN_SA` puede ser miembro de varias comunidades, y su rol global **no** le da lectura sobre datos de ninguna | Tratar `ADMIN_SA` como omnisciente | El staff de la plataforma crea comunidades; no lee las incidencias de un vecino. El aislamiento también se le aplica a él |
| C-13 | No existe descubrimiento de comunidades ni auto-alta. `GET /communities` devuelve solo las propias, y nadie se une a una comunidad por su cuenta | Listado público de comunidades y botón de "unirme" | El producto es un espacio privado por comunidad de vecinos: se entra con una invitacion o un alta del administrador, no recorriendo un catalogo. La pertenencia se concede, no se solicita |

---

## 3. Modelo de datos

No hay ninguna tabla nueva en este bloque. Se usa lo que `01_schema.sql` ya
definió y `02_rls.sql` ya protege.

### `communities`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `name` | `text not null` | Lo que ve el vecino |
| `slug` | `text not null` | Único, se normaliza a minúsculas (C-6) |
| `description` | `text` | Opcional |
| `address_line1` | `text not null` | |
| `city` | `text not null` | Indexado: se buscan por ciudad |
| `province`, `postal_code` | `text` | Opcionales |
| `country` | `text not null` | Por defecto `'ES'` |
| `latitude`, `longitude` | `numeric(9,6) not null` | Obligatorias en el alta (C-7) |
| `timezone` | `text not null` | Por defecto `'Europe/Madrid'` |
| `registration_number` | `text` | Opcional |
| `is_active` | `boolean not null` | `false` es la baja lógica (C-5) |
| `created_by` | `uuid → users.id` | `on delete set null`; lo fija el actor (C-2) |
| `created_at`, `updated_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` | Reservado para baja lógica; se filtra en lectura (C-5) |

Índices: `communities_slug_uidx` (único), `communities_city_idx`,
`communities_deleted_at_idx` (parcial, `where deleted_at is null`).

### `community_members`

Solo se lee, para resolver el rol, y se inserta **una** fila: el primer ADMIN.
Tiene `community_members_scope_uidx` único en `(community_id, user_id)`, que es
lo que impide que el mismo usuario entre dos veces.

---

## 4. El problema del arranque

Es lo que no está resuelto en la base de datos y hay que resolver antes de
escribir el endpoint.

Hoy, con el rol `app_runtime`:

| Operación | Política | Resultado |
|---|---|---|
| `SELECT` en `communities` | `communities_select_member` | Solo de las que soy miembro |
| `UPDATE` en `communities` | `communities_update_admin` | Solo si soy ADMIN de esa comunidad |
| `INSERT` en `communities` | **ninguna** | **Nadie puede crear una comunidad** |
| `DELETE` en `communities` | ninguna | Borrado físico imposible (correcto, C-5) |

`02_rls.sql:238` describe la política de `INSERT` que nunca se creó.

Y aunque existiera, habría un segundo problema: una comunidad recién creada **no
tiene miembros**, así que `app_is_member_of` y `app_is_admin_of` son falsas para
todo el mundo, incluido quien la acaba de crear. El `INSERT` en
`community_members` que hace falta para darle el papel de ADMIN requiere
`app_is_admin_of(community_id)`, que es falsa. Nadie puede añadir al primer
administrador, y la comunidad queda inutilizable.

### La solución

Una función `SECURITY DEFINER` que hace las dos inserciones en el mismo cuerpo:

```
app_create_community(nombre, slug, dirección, ciudad, lat, lon, …) → uuid
```

Dentro de la función:

1. Se comprueba que el actor es `ADMIN_SA`. Si no, `raise exception … errcode
   '42501'` (insufficient_privilege). **La comprobación va dentro**, no solo en la
   política: la función se ejecuta como su propietario y no pasa por RLS, así que
   si la guarda viviera únicamente en RLS, llamarla saltaría el filtro.
2. Se inserta la comunidad con `created_by` = actor.
3. Se inserta el miembro con `role = 'ADMIN'`, `status = 'ACTIVE'`.
4. Se devuelve el `id`.

Es una transacción: o existe la comunidad con su administrador, o no existe.

### Por qué además una política `INSERT`

Porque la función es un camino privilegiado, y un camino privilegiado sin red de
seguridad es una decisión que se acaba lamentando. La política

```sql
create policy communities_insert_admin_sa on communities
  for insert with check (app_is_global_admin() and created_by = app_current_user_id());
```

cierra la puerta directa: si mañana alguien escribe un `prisma.communities.create`
en el servicio en vez de llamar a la función, RLS lo rechaza igual. Las dos capas
juegan a favor, y la prueba de que la función no es la única vía es justamente que
la vía directa está cerrada.

### Permisos

`grant execute … to app_runtime` y `revoke execute … from public`, con
`set search_path = public, pg_temp` fijo, igual que en `02b_auth.sql`. Y un bloque
de autocomprobación al final del archivo que verifica que la función existe, que es
`SECURITY DEFINER`, que su `search_path` está fijado y que `public` no puede
ejecutarla: es lo mismo que ya hace `02b_auth.sql`, y `04_verify.sql` lo exigirá
también.

---

## 5. Flujos

### 5.1 Listar mis comunidades

`GET /api/v1/communities`, `requireAuth`.

Dentro de `withContext({ userId, communityId: null })` se leen las comunidades
donde `app_is_member_of(id)`. La política `communities_select_member` ya hace ese
filtro en el motor, así que la consulta **no lleva** un `where` de pertenencia
redundante: si se añadiera, y la política cambiara, el `where` enmascararía el
fallo y volveríamos a creer que el aislamiento funciona cuando solo funciona el
`where`.

Se añade `deleted_at is null` y, por C-5, `is_active = true`. RLS no filtra
soft-deletes; lo hace el módulo.

Cada elemento incluye `memberRole`: el rol que tiene el que pregunta.

### 5.2 Ver una comunidad

`GET /api/v1/communities/:communityId`, `requireAuth` + `requireCommunity`.

`requireCommunity` resuelve `app_role_in(community_id)` y responde 403 si no hay
rol. A partir de ahí la lectura por id la resuelve la política, y un id que no
existe también dio 403 antes de tocar la tabla (C-8).

### 5.3 Crear una comunidad

`POST /api/v1/communities`, `requireAuth` + `requireGlobalAdmin`.

El guard de rol global comprueba `app_is_global_admin()` **en la capa de
aplicación**, para poder devolver 403 con un mensaje claro. Después se llama a
`app_create_community(...)` dentro de `withContext({ userId, communityId: null })`.

Respuesta `201` con la comunidad creada y `memberRole: 'ADMIN'`, porque quien la
crea es su administrador y la interfaz lo necesita para pintar la interfaz de
gestión desde el primer momento.

### 5.4 Actualizar la configuración

`PATCH /api/v1/communities/:communityId`, `requireAuth` + `requireCommunity` +
`requireCommunityRole('ADMIN')`.

Actualización parcial: solo se escriben los campos presentes en el cuerpo.

El chequeo de rol vive **antes** de la escritura y da 403. Sin él, un `NEIGHBOR`
llegaría al `UPDATE`, la política `communities_update_admin` afectaría cero filas,
Prisma lanzaría `P2025` y el middleware lo traduciría a **404**: un miembro
recibiría un 404 por intentar editar, que es un código equivocado y además
confuso. RLS sigue estando detrás como red de seguridad.

El `slug` no se acepta en el `PATCH`. Si viene, 400 con un mensaje que lo diga
(C-6). `updated_at` lo mueve el servicio, no el cliente.

### 5.5 Baja lógica

`PATCH /api/v1/communities/:communityId` con `{ "isActive": false }`. Mismo camino
y mismos permisos que 5.4. No hay `DELETE`.

---

## 6. Contrato HTTP

| Método | Ruta | Permiso |
|---|---|---|
| `GET` | `/api/v1/communities` | cualquier autenticado |
| `POST` | `/api/v1/communities` | `ADMIN_SA` global |
| `GET` | `/api/v1/communities/:communityId` | miembro activo |
| `PATCH` | `/api/v1/communities/:communityId` | `ADMIN` de esa comunidad |

Convenciones heredadas de la spec 01: prefijo `/api/v1`, envelope `{ data, meta }`,
errores `{ error: { code, message, details? } }`, mensajes en castellano.

`POST` responde `201` con `Location: /api/v1/communities/{id}`.

### Códigos de error

| Situación | HTTP | `code` |
|---|---|---|
| `:communityId` no es un UUID | 400 | `VALIDATION_ERROR` |
| Cuerpo que no valida | 400 | `VALIDATION_ERROR` |
| Sin access token, o sesión revocada | 401 | `UNAUTHORIZED` / `TOKEN_REVOKED` |
| No es miembro de esa comunidad | 403 | `FORBIDDEN` |
| Rol insuficiente en la comunidad | 403 | `FORBIDDEN` |
| No es `ADMIN_SA` y quiere crear una comunidad | 403 | `FORBIDDEN` |
| `slug` ya usado | 409 | `CONFLICT` |
| Método o ruta inexistente | 404 | `NOT_FOUND` |

`slug` duplicado llega como `P2002` de Prisma y el middleware de errores ya lo
traduce a 409. No hace falta capturarlo en el servicio.

### Forma del recurso

```jsonc
{
  "id": "uuid",
  "name": "Comunidad del Bairro Alto",
  "slug": "bairro-alto",
  "description": "…" ,
  "addressLine1": "Calle Mayor 1",
  "city": "Valencia",
  "province": "Valencia",
  "postalCode": "46001",
  "country": "ES",
  "latitude": 39.474,
  "longitude": -0.379,
  "timezone": "Europe/Madrid",
  "registrationNumber": null,
  "isActive": true,
  "createdAt": "2026-10-03T00:00:00.000Z",
  "updatedAt": "2026-10-03T00:00:00.000Z",
  "memberRole": "ADMIN"
}
```

`latitude` y `longitude` son `Decimal` de Prisma y se serializan a `number`: son
coordenadas, y convertirlas a texto las haría inútiles para un mapa.

**Esto no se extiende a los importes.** En `finance` (fase 8) el `Decimal` se
devuelve como `string` y se opera con decimal, nunca con coma flotante. La regla
no es "el Decimal se convierte", sino "cada tipo se convierte como lo que es".

`memberRole` solo aparece cuando hay contexto de comunidad: en el listado es el
rol del que pregunta, en el detalle el de esa comunidad.

---

## 7. Variables de entorno

Ninguna nueva. Este módulo no habla con ningún servicio externo: ni geocoding, ni
meteorología, ni OpenAI. El límite de peticiones global ya lo aplica `app.ts`.

---

## 8. Estructura de archivos

```
supabase/sql/02c_communities.sql     nuevo: app_create_community + permisos + autocomprobación
supabase/sql/02_rls.sql              añade app_is_global_admin() y communities_insert_admin_sa
supabase/sql/04_verify.sql           comprueba la función, la política y el search_path
backend/prisma/apply-sql.ts          añade 02c_communities.sql a FILES

backend/src/communities/
  service.ts                         alta, listado, detalle, configuración
  repository.ts                      las consultas
  controller.ts                      HTTP sin lógica
  routes.ts                          rutas, middleware y orden
  validators.ts                      zod, .strict()
  __tests__/validators.unit.test.ts  slug, coordenadas, cuerpo del PATCH

backend/src/auth/middleware.ts      añade requireGlobalAdmin, junto a los otros guards
backend/src/__tests__/helpers.ts    añade makeAdminSa(): fixture de rol global
backend/prisma/seed.ts              añade un usuario ADMIN_SA de demo
backend/src/__tests__/communities.api.integration.test.ts
```

El `ADMIN_SA` falta hoy en el seed: los cinco usuarios de demo son `NEIGHBOR`.
Sin uno, `POST /api/v1/communities` no se puede ejercitar de punta a punta, ni
tampoco en la demo. Se añade uno de demo al seed y un `makeAdminSa()` a los
helpers para los tests, que es lo mismo que ya hacen `makeUser` y
`makeCommunity` con su limpieza.

Decisión de colocación: `requireGlobalAdmin` **no** va en un archivo nuevo, sino
en `src/auth/middleware.ts`, junto a `requireCommunity` y `requireCommunityRole`,
que ya existen.

Lo natural sería crear `src/scope.ts` para los guards transversales, y se
descartó. Si el guard de comunidad viviera en `scope.ts` y los otros dos en
`auth/middleware.ts`, los módulos de gastos, documentos y votaciones tendría que
importar los guards de comunidad de dos sitios distintos, y con el tiempo nadie
sabría cuál era el canónico. Además, la ampliación de `Express.Request`
(`req.auth`, `req.community`) ya está declarada en `auth/middleware.ts`, y ahí es
donde se lee y se escribe.

`requireCommunity` y `requireCommunityRole` no se mueven ni se modifican más allá
del 400 del UUID mal formado (C-9). Este bloque es su primer consumidor.

---

## 9. Criterios de aceptación

### Seguridad

- Un `NEIGHBOR` autenticado que hace `POST /api/v1/communities` recibe 403.
- Un `ADMIN` de la comunidad 1 que hace `PATCH` sobre la comunidad 2 recibe 403.
- Un `ADMIN_SA` puede crear una comunidad y el resultado es que ya es `ADMIN` de
  ella, sin segundo paso.
- Un `ADMIN_SA` **sin membresía** recibe 403 al pedir la comunidad de otro: el rol
  global crea comunidades, no las lee (C-12).
- El seed trae un `ADMIN_SA` usable, para que la demo tenga una comunidad creada
  desde la API y no solo desde SQL.
- Un insert directo con `app_runtime` que no pasa por la función se rechaza por
  RLS.
- `app_create_community` con un actor que no es `ADMIN_SA` falla con 42501 y no
  deja ni la comunidad ni el miembro.
- `public`, `anon` y `authenticated` no pueden ejecutar `app_create_community`.
- Un miembro suspendido (`status = 'SUSPENDED'`) recibe 403: `app_is_member_of`
  filtra por `status = 'ACTIVE'`.

### RLS

- **El test central del proyecto:** un `NEIGHBOR` de la comunidad A que pide
  `GET /api/v1/communities/{id-de-la-B}` recibe 403 y no recibe ningún dato de B.
- La misma comprobación hecha a nivel de base de datos, sin pasar por HTTP: la
  política `communities_select_member` no devuelve la fila ajena.
- `communities` sigue con las cuatro tablas cubiertas y `force row level security`
  activo.
- `04_verify.sql` pasa sin excepciones.

### Contrato

- Los cuatro endpoints responden con el envelope y los códigos de la sección 6.
- `:communityId` mal formado → 400, no 403 (C-9).
- `slug` en el `PATCH` → 400.
- `slug` con mayúsculas o espacios → 400, y se guarda en minúsculas.
- Cuerpo con clave desconocida → 400, porque los esquemas son `.strict()`.

### Verificación

| Comprobación | Resultado esperado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run test:unit` | verde, sin base de datos |
| `npm run test:integration` | verde, contra Supabase real |
| `npm run check:db` | en verde |
| `db:apply --verify` | `02c_communities.sql` aplicado y `04_verify.sql` sin excepciones |
| `npm run smoke` | sin regresiones en autenticación |
| `npm run audit` | sin vulnerabilidades altas nuevas |

---

## 10. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| `app_create_community` es el único camino privilegiado de escritura y se ejecuta saltándose RLS | Crítico | Guarda `ADMIN_SA` **dentro** de la función, política `INSERT` como segunda capa, `search_path` fijo, `execute` restringido a `app_runtime`, y test que la llama con un actor normal y comprueba que no escribe nada |
| La excepción del arranque se reimplementa en el servicio y diverge de la función | Alto | El servicio solo llama a la función; no hay `INSERT` en el repository de communities |
| El soft delete no lo aplica RLS | Medio | El módulo filtra `deleted_at is null` en todas las lecturas, y hay test de que una comunidad dada de baja no aparece en el listado |
| `ADMIN_SA` termina leyendo datos de un vecino porque se le trata como privilegiado | Alto | `communities_select_member` no mira el rol global (C-12), y hay test de que un `ADMIN_SA` sin membresía no ve la comunidad de otro |
| Normalizar el `slug` en dos sitios (validador y servicio) y que se desincronicen | Bajo | Se normaliza en el validador con `transform`, que es el único punto por el que pasan los datos |
| El índice único del `slug` choca con el seed si dos comunidades se parecen | Bajo | El seed usa slugs distintos y explícitos; `db:seed` es idempotente |

---

## 11. Fuera de alcance

- Miembros, invitaciones, roles, suspensión y unidades → `03-members.md`.
- Dashboard y métricas agregadas → bloque 10.
- Meteorología y mapa → bloque 11.
- Documentos y el bucket de Storage por comunidad → `07-documents.md`.
- Editar `community_members` desde este módulo, con una sola excepción: la fila
  del primer ADMIN, y solo dentro de `app_create_community`.
- Multi-idioma, invitaciones por correo, y verificación de propiedad del dominio
  del correo para validar que quien se registra es del barrio.

---

## 12. Decidido por el desarrollador, y pendientes

### Ya decidido (no era una pregunta)

**No hay descubrimiento ni auto-alta de comunidades** (C-13). Confirmado por el
producto: cada comunidad de vecinos tiene su propio espacio privado y nadie se
une a otras. Consecuencias que quedan fijadas:

- `GET /api/v1/communities` devuelve únicamente las comunidades donde el usuario
  es miembro activo. No hay endpoint público, ni buscador, ni "unirme".
- La pertenencia se **concede**: la crea un `ADMIN_SA` al dar de alta la
  comunidad, o un `ADMIN` de esa comunidad en `03-members.md`.
- Eso cierra el círculo del arranque sin huecos: `app_create_community` nombra al
  primer ADMIN, y ese ADMIN incorpora al resto. Nadie necesita auto-alta.
- Un usuario **sí** puede pertenecer a varias comunidades a la vez (el único
  índice es `(community_id, user_id)`, no `user_id`). Es el caso de quien tiene
  dos viviendas. Por eso `GET /communities` devuelve una lista y cada elemento
  lleva su `memberRole`, y el frontend necesitará un selector de "comunidad
  activa" (`CommunityContext`). Este bloque no lo implementa: solo entrega los
  datos que ese selector necesitará.

Los cuatro roles del producto son exactamente los del enum `member_role` que ya
existe en la base de datos, sin nada que añadir:

| Producto | `member_role` |
|---|---|
| 👤 Vecino | `NEIGHBOR` |
| 👨‍💼 Presidente | `PRESIDENT` |
| 🔧 Administrador | `ADMIN` |
| 🛠️ Proveedor | `PROVIDER` |

Y las secciones del espacio de cada comunidad —Dashboard, Vecinos, Incidencias,
Reservas, Avisos, Documentos, Gastos, Facturas, Votaciones, Configuración— son
los módulos que ya enumera `ARCHITECTURE.md`. De ellas, **Configuración** es la
única que entra en este bloque, vía `PATCH /api/v1/communities/:communityId`
reservado a `ADMIN`.

### Pendientes de decidir

1. **Coordenadas por dirección postal.** Mientras tanto son obligatorias. Si el
   bloque de integraciones no llega, el alta manual con coordenadas es incómoda
   pero funcional; la alternativa (coordenadas opcionales con `null`) choca con el
   `not null` de la columna y exigiría una migración.
2. **`is_active` frente a `deleted_at`.** Hay dos columnas para la baja y este
   bloque solo usa `is_active`. La alternativa sería usar `deleted_at` y dejar
   `is_active` para una suspensión comercial futura. Se decide usar `is_active`
   como interruptor y dejar `deleted_at` sin tocar.

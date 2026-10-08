# Spec 08 — Documentos

> **Estado: IMPLEMENTED.** Las catorce decisiones DN-1 a DN-14 de §2 están
> cerradas; de §12, D-1 a D-3 y D-5 a D-7 están tomadas y D-4 (el job de
> limpieza) queda como deuda de bloque. Este spec usa la nomenclatura
> **DN-1 a DN-14** para los documentos.
> **Fase:** 8 (documentos). Precedida de `01-authentication`, `02-communities`,
> `03-members`, `04-incidents`, `05-common-areas`, `06-reservations` y
> `07-announcements`.
> **Base de datos:** `supabase/sql/01_schema.sql` (las tablas `documents` y
> `document_acl` ya existen), `02_rls.sql` (cinco políticas ya existen),
> `03_storage.sql` (bucket y políticas de Storage ya existen) y
> `02i_documents.sql` (archivo nuevo, en este bloque).
> **Backend:** `backend/src/documents/`.
>
> Este spec define el **repositorio de documentos** de la comunidad: quién
> sube, quién lee, quién descarga, qué significa `min_role`, `is_public` y la
> ACL fina por usuario, y por qué `PROVIDER` no ve nada por defecto en la
> matriz de `ARCHITECTURE.md` §5. Es el primer bloque que toca **Supabase
> Storage**: el binario nunca vive en la base de datos.

---

## 1. Objetivo

Que una comunidad guarde y comparta sus **documentos permanentes** —actas,
estatutos, facturas, presupuestos, documentación de mantenimiento (prompt
§7.5)— sin que el binario viva en la base de datos y sin que "ser miembro"
implique "verlo todo".

El modelo tiene **tres capas de visibilidad** que se evalúan en orden:

1. `ADMIN` ve **todo** (matriz §5: "Ver documentos — ✅ (todos)").
2. El documento declara una visibilidad general con `min_role` y `is_public`,
   que se aplica a `NEIGHBOR` y `PRESIDENT` por el **orden de la enumeración**
   (`NEIGHBOR < PRESIDENT < ADMIN < PROVIDER`, ver §4c).
3. La tabla `document_acl` concede **visibilidad fina por usuario**, por
   encima del `min_role` general ("Implementar permisos para controlar qué
   usuarios pueden acceder a cada documento", prompt §7.5).

La asimetría es la de los avisos pero al revés: ver es un privilegio, no la
norma. Lo que para el aviso era "escriben pocos, leen todos", aquí es
"**sube `ADMIN`, lee quien coincide con la ACL del documento**".

Fuera de alcance: versionado de archivos (cada `storage_path` es inmutable; el
bloque 09 de finanzas lo usa tal cual); adjuntos a avisos o a incidencias
(spec 04 I-16 los remite aquí, pero **suscribir** un adjunto a una entidad es
un cruce de modelo que este bloque no hace); notificaciones de "nuevo
documento"; documentos entre **comunidades distintas**; cualquier UI.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **DN-1** | **Subir, reconfigurar y borrar** es solo de `ADMIN`; **leer y descargar** sigue la ACL del documento | Que `PRESIDENT` gestione documentos (es un cargo de gobierno) | La matriz §5 da "Gestionar documentos" solo a `ADMIN` y "Ver documentos" va por ACL. Igual que en avisos (AN-1), el `PRESIDENT` puede ver lo que la ACL le alcanza —según `min_role`/`is_public`— pero no decide qué se publica. El documento es una decisión de la administración, no de la presidencia |
| **DN-2** | **Toda lectura pasa por funciones `SECURITY DEFINER`**; se eliminan las políticas de escritura de `documents` y `document_acl` y se revoca `insert, update, delete` sobre ambas a `app_runtime` | Dejar las políticas y escribir con Prisma | Mismo argumento que AN-2 (spec 07), CA-6 (spec 05) y §4a de `02e_incidents.sql`: las políticas de escritura no pueden (a) imponer el `can_download` fino de la ACL, (b) devolver un error con sentinel en vez de un `23514`/`23505` crudo, ni (c) comprobar el orden `min_role` correcto excluyendo a `PROVIDER`. Y el `grant insert, update, delete` de `02_rls.sql` hay que revocarlo explícitamente: quitarlo de la lista no deshace un `GRANT` ya aplicado |
| **DN-3** | **El binario vive en Supabase Storage**, bucket `community-documents` privado; la BD guarda solo metadatos y `storage_path` (la clave dentro del bucket) | `bytea` en la base de datos | `ARCHITECTURE.md` §3 y §9 lo fijan: el plan Free da 1 GB de Storage y 500 MB de BD, y "los documentos van a Supabase Storage, no a la BD. La ruta se guarda en `documents.storage_path`". Un acta en `bytea` consumiría la BD y haría imposible generar URLs firmadas |
| **DN-4** | El `storage_path` empieza siempre por **`<community_id>/`**, carpeta estructural en el storage | Una ruta plana con solo el uuid | `03_storage.sql` §3.1 ya hace que la política de lectura directa compare `(storage.foldername(name))[1]` contra la comunidad del actor. Con la carpeta por delante, el aislamiento es **estructural en el storage**, no solo en la BD: ni siquiera una URL firmada de otra carpeta puede resolver |
| **DN-5** | `PROVIDER` **no accede a ningún documento por defecto**, ni siquiera con `min_role = 'NEIGHBOR'` | Tratar a `PROVIDER` como un miembro más en la comparación `>=` | La matriz §5 da "Ver documentos — — ✅ (todos) —": en la columna `PROVIDER` es `—`. El problema es que el **orden real** de la enumeración (`01_schema.sql:41`) es `NEIGHBOR < PRESIDENT < ADMIN < PROVIDER` —no el `NEIGHBOR < PROVIDER < PRESIDENT < ADMIN` que afirma el comentario de `02_rls.sql:551`—, con lo que `app_role_in() >= min_role` **incluye a `PROVIDER` en cualquier umbral, incluso `min_role = 'ADMIN'`**, y una lectura por orden de enumeración filtra mal. La función excluye `PROVIDER` explícitamente para la visibilidad general; la **ACL explícita sí puede concederle** un documento concreto (DN-9), porque la matriz manda por rol, no por documento |
| **DN-6** | La lista y el detalle son **una sola función** (`app_list_documents()`), como el listado de avisos | `app_get_document()` separada | Es la misma relación que AN-3/AN-4 y `app_list_announcements()`: una función para listar con los filtros y parámetros de paginación, y el **mismo predicado** para el detalle por id. Dos lectores serían dos copias del predicado de visibilidad que pueden discrepar |
| **DN-7** | Se ordena por **`created_at desc`** y se pagina como en incidencias (`page` ≥ 1, `limit` 1–100, `meta {page, limit, total, totalPages}`) | `title asc`, o sin paginar | El índice `documents_community_idx` ya existe para recorrer la comunidad; el orden natural de un repositorio es antigüedad descendente (lo último arriba), igual que el `created_at desc` del resto de listados. La paginación evita que un repositorio con años de actas mande un JSON enorme a un móvil |
| **DN-8** | `uploaded_by` **no se acepta** en el cuerpo: lo escribe la función con `app_current_user_id()` | Aceptar `uploadedBy` del cliente | Mismo argumento que AN-9 y I-5: la autoría sale de la sesión, no del cuerpo. Un `ADMIN` podría firmar "subido por" otro, y eso sería una mentira histórica en una tabla pensada para auditoría |
| **DN-9** | `min_role`, `is_public` y la **ACL** (`[{ userId, canView, canDownload }]`) se fijan **en el alta** y no tienen ruta de edición posterior | Endpoints `PUT /documents/:id` y rutas dedicadas de ACL | `ARCHITECTURE.md` §6 lista **exactamente cinco rutas** para documentos (listar, crear, detalle, descarga, borrar) y ninguna de edición. Un documento es una **instantánea**: para cambiarlo públicamente se borra y se vuelve a subir. Cubre el caso de la prompt ("controlar qué usuarios pueden acceder") sin añadir una superficie de mutación que la arquitectura no contempla |
| **DN-10** | `GET /documents/:id/download` devuelve `{ url, expiresIn }` con una **signed URL de corta duración** generada por el backend con la clave de servicio | Redirigir (`302`) o hacer de proxy de bytes | `ARCHITECTURE.md` §3: "La descarga pasa por el backend, que valida permisos y genera una signed URL de corta duración". Devolver el JSON permite al frontend controlar el momento y el destino (etiqueta `<a download>`, `window.open`, caché). Un proxy de bytes haría pasar todo el egress de la comunidad por el proceso del backend |
| **DN-11** | El borrado es **soft delete** (`deleted_at = now()`) en la BD, más la **eliminación del objeto** del bucket, en ese orden | Solo soft delete; o solo borrado físico del objeto | Soft delete en la BD para conservar el histórico de qué existió (mismo criterio que AN-5 y I- del bloque 04). Y el objeto se elimina del bucket **después** del soft delete, porque es el binario el que ocupa los 1 GB del plan Free: una fila borrada con el objeto vivo es un residuo que nadie ve pero que consume almacenamiento. Si la eliminación del objeto falla, el soft delete ya se ha hecho: no hay fila nueva que devolver, solo un residuo que un job de limpieza puede recoger |
| **DN-12** | `checksum` se calcula en el backend (SHA-256) al subir y se guarda como metadato de integridad | No calcularlo; o hash del cliente | Sirve para verificar que lo que se descarga es lo que se subió, sin depender de las cabeceras HTTP del bucket. Para un repositorio de actas el valor es la tranquilidad de que el objeto no se corrompió, no un requisito forense |
| **DN-13** | `size_bytes` se toma de **bytes reales del fichero número a número**, y el límite de 10 MB se aplica en el backend **y** en el bucket (`file_size_limit`, ya configurado en `03_storage.sql`) | Confiar solo en el límite del bucket | Si el backend rechaza antes que Storage, el error es un 400 del contrato, no un `storage/object-too-large` del proveedor. El `CHECK documents_size_positive` de la tabla complementa. La doble capa es barata y hace el fallo predecible |
| **DN-14** | `category` se valida contra el enum (`MINUTES, STATUTES, INVOICE, BUDGET, MAINTENANCE, OTHER`) y `OTHER` es el default | Libre de texto | La columna es un enum en `01_schema.sql`; un texto libre obligaría a un cast que puede dar `22P02` si nadie lo traduce. El default `OTHER` cubre el caso de "un PDF que no es nada de lo anterior" |

---

## 3. Estado real del modelo de datos

Verificado contra `01_schema.sql`, `02_rls.sql`, `03_storage.sql` y
`prisma/schema.prisma` hoy.

### 3.1 `documents`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade`. Eje del aislamiento |
| `title` | `text not null` | **Sin `check` de longitud.** Este bloque lo añade (§4a) |
| `description` | `text` | Nullable. **Sin `check` de longitud.** Este bloque lo añade (§4a) |
| `category` | `document_category not null default 'OTHER'` | `MINUTES, STATUTES, INVOICE, BUDGET, MAINTENANCE, OTHER` |
| `storage_path` | `text not null` | Clave dentro del bucket. **`unique` global** (`documents_storage_path_uidx`) |
| `mime_type` | `text not null` | De la lista permitida en `03_storage.sql` |
| `size_bytes` | `bigint not null` | `check (size_bytes > 0)` ya existe |
| `checksum` | `text` | DN-12: SHA-256 del binario, calculado en el backend |
| `min_role` | `member_role not null default 'NEIGHBOR'` | DN-5: la visibilidad general se evalúa con este umbral |
| `is_public` | `boolean not null default false` | `true` = visible para todo miembro activo, sin importar el rol |
| `uploaded_by` | `uuid → users(id)` | `on delete set null`: si el usuario se borra, el documento queda sin autor |
| `deleted_at` | `timestamptz` | DN-11: soft delete. Ninguna función de este bloque borra la fila |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger `documents_set_updated_at` (sección 6 de `04_verify.sql`) |

### 3.2 `document_acl`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `document_id` | `uuid not null → documents(id)` | `on delete cascade` |
| `user_id` | `uuid not null → users(id)` | `on delete cascade` |
| `can_view` | `boolean not null default true` | DN-9: ver el metadato y la lista |
| `can_download` | `boolean not null default true` | DN-10: obtener la signed URL |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

`document_acl_uidx` (única `(document_id, user_id)`) y `document_acl_user_idx`
`(user_id)` ya existen.

### 3.3 Nada se crea en el esquema

`02i_documents.sql` no crea tablas ni columnas: solo funciones, permisos y los
dos `CHECK` de longitud de §4a. Las tablas, el enum, los índices y el bucket
ya vienen completos en los archivos anteriores, que se aplicaron en los
bloques 01 a 07 (`03_storage.sql` se aplica en el bloque 07 con `db:verify`,
pero el bucket `community-documents` ya está creado).

---

## 4. El problema del arranque

### a) `title` y `description` no tienen longitud

El `not null` impide el vacío implícito pero no el `''` en `title`. Se añaden
los `CHECK` con `not valid`, el mismo criterio que `announcements_title_length`
(bloque 07) y `incidents_description_length` (bloque 04):

```sql
alter table documents
  add constraint documents_title_length
  check (char_length(title) between 1 and 120) not valid;

alter table documents
  add constraint documents_description_length
  check (character_length(description) between 1 and 1000) not valid;
```

`not valid` aplica a filas nuevas sin fallar sobre las que ya haya; validar es
un paso posterior. Los rangos los repite el zod del backend de forma
independiente. 120 de título es de repositorio (un acta cabe) y 1000 de
descripción separa "qué es" de "el contenido en sí".

### b) Las políticas de escritura no distinguen `can_view` de `can_download`

`02_rls.sql` §5.10 da a `documents` una política de `insert`, `update` y
`delete` para `app_is_admin_of(community_id)`, y §5.11 da a `document_acl` un
`acl_write_admin`. Como guardia gruesa es correcta. El problema es lo que **no**
puede hacer:

- Exigir que la ACL que se escribe **coincida** con la visibilidad del
  documento: RLS mira la fila resultante, no el conjunto.
- Devolver un error legible: un `documents_storage_path_uidx` revienta con un
  `23505` crudo, sin sentinel.
- Aplicar DN-9 (la ACL solo en el alta) con garantía: nada impide un `INSERT`
  directo sobre `document_acl` como `postgres`.

La solución es la de los bloques 03, 04, 05 y 07: **`documents` y
`document_acl` se quedan sin políticas de escritura, y `app_runtime` pierde
esos permisos.** Toda escritura entra por funciones `SECURITY DEFINER`. El
`SELECT` de `documents` se queda tal cual (`documents_select_scoped` es la
guarda gruesa de lectura); el predicado fino —el que excluye a `PROVIDER`
(DN-5) y distingue `can_view` de `can_download`— vive en las funciones.

### c) La visibilidad por defecto de RLS no excluye a `PROVIDER`

La política `documents_select_scoped` (line 554, `02_rls.sql`) resuelve:

```sql
app_role_in(community_id) >= min_role
```

El **orden real** de la enumeración es el orden de la declaración de
`01_schema.sql:41`:

```sql
create type member_role as enum ('NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER');
```

que produce `NEIGHBOR < PRESIDENT < ADMIN < PROVIDER`. El comentario de
`02_rls.sql:551` afirma "NEIGHBOR < PROVIDER < PRESIDENT < ADMIN", pero **no
corresponde al enum declarado**: en PostgreSQL el orden de un `enum` es el de
su declaración. Con el orden real, esa comparación **incluye a `PROVIDER` en
cualquier umbral**: para cualquier `min_role <= PROVIDER` (y `PROVIDER` es el
valor más alto, así que vale para todo `min_role`, incluido `'ADMIN'`). Es una
laguna del `02_rls.sql` original, escrita además sobre un comentario del orden
que no se cumple. La función de lectura no reutiliza la política: reescribe el
predicado y excluye `PROVIDER` explícitamente. La política queda como guarda
gruesa "documentada como más débil", igual que la de avisos frente a AN-4.

> **Nota de seguridad (apunta a `02_rls.sql:551`):** el comentario
> "NEIGHBOR < PROVIDER < PRESIDENT < ADMIN" no refleja el enum. El spec 08 no
> lo toca —cambiar el orden de un `enum` ya aplicado exige una migración
> delicada (`ALTER TYPE ... RENAME VALUE` reorganiza a medias y las filas
> existentes se compararían distinto)—, pero se documenta aquí porque la
> versión actual **subestima** la vista de `PROVIDER` en los documentos.

### d) El binario no vive en la BD, pero el backend necesita hablar con Storage

El backend no tiene todavía un cliente de Storage: `package.json` no trae
`@supabase/supabase-js` y `env.ts` no valida las dos claves (la anónima y la
de servicio). Este bloque introduce:

- `@supabase/supabase-js` como dependencia de runtime.
- `backend/src/documents/storage/` con una **adaptadora** `StorageGateway`
  y dos implementaciones: `supabase` (dev y producción, con la clave de
  servicio) y `local` (tests, carpeta en disco). El motivo de la segunda:
  un bloque que depende de un bucket remoto no puede probarse contra el
  vacío, y la suite debe ser **hermética** — en `NODE_ENV=test` el driver es
  siempre `local`, pase lo que pase en `.env` (§9, D-6), para que ningún
  test suba fixtures al bucket real ni dependa de red para estar en verde.
- La clave de servicio **solo vive en el backend**: si aparece en el frontend,
  cualquiera con la anónima o la de servicio escribe en el bucket (03 dice
  "Service role. SOLO en el backend").

---

## 5. Funciones

Las cinco de `02i_documents.sql`, todas `SECURITY DEFINER` con `search_path =
public, pg_temp`, no ejecutables por `PUBLIC`, con `execute` para
`app_runtime`:

### 5.1 `app_document_community(p_document uuid) returns uuid`

Devuelve el `community_id` **solo si el documento existe, no está borrado y el
actor es miembro activo** de su comunidad, y `NULL` si no. Mismo contrato que
`app_announcement_community` (spec 07) y `app_common_area_community` (spec 05).
Quien la llama dentro de SQL es `app_delete_document()` (§5.4): `NULL` →
`document_not_found` → 404.

En Express no hay `requireDocument()`: las rutas por id no necesitan el dato
antes de la transacción. El detalle traduce a 404 con el predicado de §5.2
(`app_list_documents()` con `p_document`), la descarga con
`app_document_storage_path(id, false)`, y el borrado lo dice la propia
`app_delete_document`. No hay envoltura TS de esta función en
`repository.ts`: su único consumidor es `app_delete_document()`, dentro de
SQL (los demás bloques tienen la suya porque su `middleware.ts` la usa;
documentos no tiene middleware, por diseño).

Nótese lo que **no** filtra: no mira la visibilidad del documento ni la ACL.
Un documento invisible seguirá "existiendo" para su borrado —gestionar es lo
que hay que hacer con esos. Quien decide si una lectura es legítima es el
predicado de `app_list_documents()` (§5.2).

`SELECT` en lugar de `EXCEPTION`, por el mismo motivo que sus hermanas: se usa
desde consultas que pueden no encontrar nada, y un 404 como excepción
PostgreSQL aborta la transacción en curso salvo que el backend la capture.

```sql
create or replace function app_document_community(p_document uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select d.community_id
    from documents d
   where d.id = p_document
     and d.deleted_at is null
     and app_is_member_of(d.community_id)
$$;
```

### 5.2 `app_list_documents(p_community_id uuid, p_document uuid, p_category document_category, p_q text, p_limit integer, p_offset integer) returns table(...)`

**La única lectura de documentos.** Tres responsabilidades en una firma, como
`app_list_announcements`: el listado de la comunidad (con filtros y
paginación), el detalle por id (cuando `p_document` no es null) y el `total`
real vía `count(*) over ()`. Su predicado es **el predicado de visibilidad**,
escrito una sola vez:

- `deleted_at is null` — borrado es borrado, para nadie (DN-11).
- `app_is_member_of(p_community_id)` en el listado — un no miembro recibe 403,
  no una lista vacía: decir "no hay documentos" confirmaría que la comunidad
  existe (criterio C-8, como avisos).
- `ADMIN` ve todos (matriz §5, "✅ (todos)").
- Para el resto de rol **activo y no `PROVIDER`**: `is_public` **o** el orden
  `app_role_in(community_id) >= min_role` **o** la ACL explícita `can_view`
  (DN-5, DN-9).
- `PROVIDER` pasa **solo** si está en la ACL explícita del documento (DN-5).

Añade `uploaded_by` + `uploaded_by_name`, que sale de `users` con un
`left join` —la misma excepción acotada de los bloques 03 a 07: `users` no
deja leer su `full_name` al backend, y el detalle de un documento debe
mostrar quién lo subió.

El detalle por id **no** distingue `can_view` de `can_download`; eso lo
decide la función §5.5. Aquí `can_view` significa "el metadato aparece en la
lista".

```sql
create or replace function app_list_documents(
  p_community_id uuid,
  p_document     uuid              default null,
  p_category     document_category default null,
  p_q            text              default null,
  p_limit        integer           default 20,
  p_offset       integer           default 0
)
returns table (
  id               uuid,
  community_id     uuid,
  title            text,
  description      text,
  category         document_category,
  mime_type        text,
  size_bytes       bigint,
  checksum         text,
  min_role         member_role,
  is_public        boolean,
  uploaded_by      uuid,
  uploaded_by_name text,
  created_at       timestamptz,
  updated_at       timestamptz,
  total_count      bigint
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if p_document is null and not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select d.id, d.community_id, d.title, d.description, d.category,
         d.mime_type, d.size_bytes, d.checksum, d.min_role, d.is_public,
         d.uploaded_by, u.full_name, d.created_at, d.updated_at,
         count(*) over ()
    from documents d
    left join users u on u.id = d.uploaded_by     -- on delete set null
   where d.deleted_at is null
     and (p_document is null or d.id = p_document)
     and (p_community_id is null or d.community_id = p_community_id)
     and (p_category is null or d.category = p_category)
     and (p_q is null or d.title ilike '%' || p_q || '%'
                       or d.description ilike '%' || p_q || '%')
     and (
       -- DN-1: ADMIN ve todos
       app_is_admin_of(d.community_id)
       or (
         -- ACL explícita: vale para cualquier rol, incluido PROVIDER (DN-9).
         -- Filtrar por ACTIVE aquí: un miembro suspendido pierde la ACL.
         app_is_member_of(d.community_id)
         and exists (
           select 1 from document_acl a
            where a.document_id = d.id
              and a.user_id = app_current_user_id()
              and a.can_view
         )
       )
       or (
         -- DN-5: la visibilidad por rol excluye a PROVIDER
         app_is_member_of(d.community_id)
         and app_role_in(d.community_id) <> 'PROVIDER'
         and (d.is_public or app_role_in(d.community_id) >= d.min_role)
       )
     )
   order by d.created_at desc               -- DN-7: lo último arriba
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end
$$;
```

Nótese que el predicado **reutiliza** las piezas de RLS: `app_is_member_of`,
`app_is_admin_of`, `app_role_in` y el orden de la enumeración ya existen y
hacen lo mismo. Lo que cambia es la composición completa (excluye `PROVIDER`
cuando no hay ACL, distingue `can_view` de `can_download` en §5.5).

### 5.3 `app_create_document(p_community_id uuid, p_title text, p_description text, p_category document_category, p_storage_path text, p_mime_type text, p_size_bytes bigint, p_checksum text, p_min_role member_role, p_is_public boolean, p_acl jsonb) returns uuid`

DN-9 vive aquí: las **nueve** piezas del documento y la ACL explícita se
escriben en una **única transacción**. Guardas, en orden:

1. `app_current_user_id()` presente; si no, `42501`.
2. Rol `ADMIN` de la comunidad; si no, `forbidden_role` (`42501`) — el backend
   ya pone `requireCommunityRole('ADMIN')`, esta es la red.
3. `p_title` y `p_storage_path` presentes — guarda interna, inalcanzable desde
   la API (el zod exige ambos), con `22023` para no chocar con un `not null`
   crudo que nada traduce.
4. `p_size_bytes > 0` — red para el `CHECK documents_size_positive` (23514).

Inserta la fila con `storage_path` y metadatos (`btrim` de título y
descripción, `coalesce(p_category, 'OTHER')`, los mismos `coalesce` que los
defaults de la columna), captura el `23505` de
`documents_storage_path_uidx` y lo re-lanza con sentinel
(`document_path_taken`) y **SQLSTATE `U0001`** (D-5). Después, si `p_acl` no
es null, inserta **una fila por entrada** en `document_acl` (mismo
`document_id`, `user_id`, `can_view`, `can_download`), ignorando duplicados
con `ON CONFLICT DO UPDATE` —si el mismo documento re-lista al mismo usuario,
lo actualiza en vez de romper en `document_acl_uidx`. Devuelve el `uuid` de
la fila.

El único `23505` del alta es el del path: es la clave real del sistema y el
backend genera paths con `uuid` v4, así que en la práctica es inalcanzable;
el sentinel es para que una colisión no salga como 500. El errcode es
`U0001` y no `23505` porque Prisma (P2010) reescribe cualquier `23505` a
«Unique constraint failed…» y se come el mensaje: sin el par
(`U0001`, sentinel) el traductor de `errors.ts` nunca vería la colisión. Un
`23505` que llegue sin sentinel sigue significando un bug del esquema y cae
en 500.

```sql
create or replace function app_create_document(
  p_community_id uuid,
  p_title        text,
  p_description  text,
  p_category     document_category,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   bigint,
  p_checksum     text,
  p_min_role     member_role,
  p_is_public    boolean,
  p_acl          jsonb default null
) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_ent  jsonb;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'forbidden_role: solo un ADMIN puede gestionar documentos'
      using errcode = '42501';
  end if;

  if p_title is null or p_storage_path is null then
    raise exception 'document_content_required: titulo y ruta son obligatorios'
      using errcode = '22023';
  end if;

  if p_size_bytes <= 0 then
    raise exception 'document_size_invalid: el archivo debe pesar mas de 0 bytes'
      using errcode = '22023';
  end if;

  begin
    insert into documents (
      community_id, title, description, category, storage_path,
      mime_type, size_bytes, checksum, min_role, is_public, uploaded_by
    ) values (
      p_community_id, btrim(p_title), btrim(p_description),
      coalesce(p_category, 'OTHER'), p_storage_path,
      p_mime_type, p_size_bytes, p_checksum,
      coalesce(p_min_role, 'NEIGHBOR'), coalesce(p_is_public, false),
      app_current_user_id()            -- DN-8: jamás de los parámetros
    )
    returning id into v_id;
  exception
    when unique_violation then
      if SQLERRM like '%documents_storage_path_uidx%' then
        raise exception 'document_path_taken: esa ruta ya esta ocupada en el bucket'
          using errcode = 'U0001';
      end if;
      raise;
  end;

  if p_acl is not null then
    for v_ent in select * from jsonb_array_elements(p_acl)
    loop
      insert into document_acl (document_id, user_id, can_view, can_download)
      values (
        v_id,
        (v_ent->>'userId')::uuid,
        coalesce((v_ent->>'canView')::boolean, true),
        coalesce((v_ent->>'canDownload')::boolean, true)
      )
      on conflict (document_id, user_id) do update
        set can_view = excluded.can_view,
            can_download = excluded.can_download,
            updated_at = now();
    end loop;
  end if;

  return v_id;
end
$$;
```

### 5.4 `app_delete_document(p_document uuid) returns void`

DN-11: soft delete en la BD, `ADMIN` único. Guardas en orden —primero, documenta
la guarda: un documento invisible para el actor no es "suyo de borrar"—

1. `app_document_community(p_document)` no devuelve `NULL`; si lo hace,
   `document_not_found` (`P0002` → 404). El documento invisible (no alcanzado
   por la ACL) sigue teniendo un `community_id` para el ADMIN: si no eres
   ADMIN, ni eso.
2. `app_is_admin_of(v_community)`; si no, `document_requires_admin` (`42501`
   → 403), con el mismo argumento de AN-5: el `PRESIDENT` no destruye el
   histórico.
3. `update ... set deleted_at = now() where id = p_document and deleted_at is
   null`; si `not found`, `P0002` (borrado dos veces = 404, como AN-11 en
   avisos).

El backend **después** elimina el objeto del bucket con la adaptadora de
Storage (DN-11): el soft delete es la operación de negocio; la limpieza del
binario es un efecto secundario que no debe abortar el 200. Si la eliminación
del objeto falla, se loguea y el job de limpieza futuro puede recogerlo.

```sql
create or replace function app_delete_document(p_document uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  v_community := app_document_community(p_document);

  if v_community is null then
    raise exception 'document_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_admin_of(v_community) then
    raise exception 'document_requires_admin: solo un ADMIN puede borrar documentos'
      using errcode = '42501';
  end if;

  update documents
     set deleted_at = now()
   where id = p_document
     and deleted_at is null;

  if not found then
    raise exception 'document_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;
end
$$;
```

### 5.5 `app_document_storage_path(p_document uuid, p_for_download boolean) returns text`

La única función que **devuelve la ruta dentro del bucket**. Nunca se expone
en el listado: un cliente no puede leer `storage_path` desde el detalle y
montarse él una URL. Devuelve la ruta **solo si el actor puede leer** (cuando
`p_for_download is false`) **o puede descargar** (cuando `true`); en cualquier
otro caso, `NULL`.

El predicado es **el de §5.2 más dos matices**:
- En `p_for_download = true`, la ACL explícita debe tener `can_download =
  true`, no basta `can_view`; y una ACL con `can_download = false` **veta** la
  descarga por rol (la fila de la tabla §7.4 "Visible pero can_download=false
  ⇝ 403").
- La ACL explícita vale **para cualquier rol, incluido `PROVIDER`** (DN-5: la
  matriz manda por rol, la ACL manda por documento).

```sql
create or replace function app_document_storage_path(
  p_document     uuid,
  p_for_download boolean
) returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select d.storage_path
    from documents d
   where d.id = p_document
     and d.deleted_at is null
     and (
       -- DN-1: ADMIN ve y descarga todo
       app_is_admin_of(d.community_id)
       -- ACL explícita: can_view para el metadato, can_download para la URL (DN-9)
       or exists (
         select 1 from document_acl a
          where a.document_id = d.id
            and a.user_id = app_current_user_id()
            and case when p_for_download then a.can_download else a.can_view end
       )
       or (
         -- DN-5: la visibilidad por rol excluye a PROVIDER
         app_is_member_of(d.community_id)
         and app_role_in(d.community_id) <> 'PROVIDER'
         and (d.is_public or app_role_in(d.community_id) >= d.min_role)
         -- DN-9: la ACL con can_download=false veta la descarga por rol (tabla §7.4 -> 403)
         and (
           not p_for_download
           or not exists (
             select 1 from document_acl a
              where a.document_id = d.id
                and a.user_id = app_current_user_id()
                and not a.can_download
           )
         )
       )
     )
$$;
```

El `p_for_download` está en la firma para que el llamante declare su intención
—ver ≠ descargar— y para que el backend no tenga que volver a leer el detalle
para distinguirlos. La distinción 404 vs 403 de la tabla §7.4 la hace el
**backend, en dos llamadas**:

1. `app_document_storage_path(id, false)`: si `NULL`, **404** —el documento no
   existe, está borrado o no es visible; no confirmar existencia.
2. `app_document_storage_path(id, true)`: si `NULL`, **403** —lo ve, pero no
   tiene `can_download`.

---

## 6. Políticas RLS

`02_rls.sql` deja **dos políticas** en `documents` y **una** en `document_acl`:

- `documents_select_scoped` (SELECT): se queda tal cual. Es la guarda gruesa
  de lectura por PostgREST; el predicado fino (excluir `PROVIDER`, distinguir
  `can_view` de `can_download`) vive en las funciones. Documentado en §4c como
  deliberadamente más débil.
- `documents_insert_admin`, `documents_update_admin`, `documents_delete_admin`
  (INSERT, UPDATE, DELETE): **se eliminan**. `app_runtime` pierde esos
  permisos (DN-2).
- `acl_select_scoped` (SELECT): se queda.
- `acl_write_admin` (ALL): **se elimina**. `app_runtime` pierde escritura
  sobre `document_acl` (DN-2).

El `revoke` es la pieza imprescindible, no decorativa: `02_rls.sql` §grant da
`insert, update, delete on documents` y `insert, update on document_acl` a
`app_runtime`, y eso hay que quitarlo explícitamente —quitar las líneas del
archivo no deshace un `GRANT` ya aplicado (mismo argumento que AN-2).

Quedan los grants de `execute` para `app_runtime` sobre las cinco funciones,
con `revoke` de `PUBLIC` (repetido sobre `anon`, `authenticated` por
simetría, y sobre el grupo `PUBLIC` para no acordarse de un cuarto rol).

---

## 7. Contrato HTTP

### 7.1 Las rutas — exactamente las cinco de `ARCHITECTURE.md` §6

```
GET    /api/v1/communities/:communityId/documents
POST   /api/v1/communities/:communityId/documents      (multipart)
GET    /api/v1/documents/:id
GET    /api/v1/documents/:id/download
DELETE /api/v1/documents/:id
```

Dos routers como en los bloques 05 a 07: el de comunidad (listar y crear) y el
de `/api/v1` (detalle, descarga, borrado). No hay `PUT`: DN-9 lo fija en el
alta.

### 7.2 Guardas

| Ruta | Guard |
|---|---|
| `GET /communities/:id/documents` | `requireAuth` + `requireCommunity()` (membresía activa); el predicado de §5.2 hace el resto. `NEIGHBOR`, `PRESIDENT` y `ADMIN`; `PROVIDER` listará solo lo que la ACL le conceda |
| `POST /communities/:id/documents` | `requireAuth` + `requireCommunity()` + `requireCommunityRole('ADMIN')` **antes de multer** (un `NEIGHBOR` no hace pasar su archivo para luego recibir el 403), + comprobación `ADMIN` dentro de la función (DN-2) |
| `GET /documents/:id` | `requireAuth` + id con forma de UUID (si no, 400). Sin `requireCommunity()` ni guard de rol: el detalle es `app_list_documents()` con `p_document` (§5.2) — sin fila, 404 (no existe, otra comunidad, borrado o rol sin umbral; los cuatro, el mismo 404 de C-8) |
| `GET /documents/:id/download` | `requireAuth` + id UUID; después dos llamadas §5.5: `false` → si `NULL`, 404; `true` → si `NULL`, 403 |
| `DELETE /documents/:id` | `requireAuth` + id UUID, **sin guard de rol en la ruta**: `app_delete_document` decide con la fila delante el 404 (no existe/borrado) y el 403 (`document_requires_admin`) |

### 7.3 Cuerpos y validación

`POST` es **multipart** (`multipart/form-data`). Primera vez en el proyecto —
los demás cuerpos son JSON—, y se separa deliberadamente del
`express.json({ limit: '1mb' })` de `app.ts`: las subidas van por una ruta
con su propio parseador (`multer`, en memoria) y su propio límite. El límite
de `app.ts` se queda para el JSON. Los `MulterError` (archivo mayor de 10 MB,
campo que no es `file`) los traduce un wrapper en la ruta a un `400` con
mensaje propio: multer invoca `next(error)` y el middleware de errores
genérico los habría devuelto como `500`.

Campos:

| Campo | Obligatorio | Reglas |
|---|---|---|
| `file` | sí | Archivo, ≤ 10 MB, `mime_type` en la lista de `03_storage.sql` |
| `title` | sí | 1–120 caracteres (DN §4a) |
| `description` | no | ≤ 1000 caracteres, `''` → `null` |
| `category` | no | enum de §2 DN-14, default `OTHER` |
| `minRole` | no | enum `member_role`, default `NEIGHBOR` |
| `isPublic` | no | booleano, default `false` |
| `acl` | no | JSON string: `[{ userId, canView?, canDownload? }]` |

`jsonb` de la función: el backend valida el string `acl` con zod (cada
`userId` es UUID, `canView`/`canDownload` booleanos) y lo pasa tal cual a
`app_create_document`; la función sola no revalida la forma —el zod es la
fuente única de validación, como en el resto de bloques— y se limita a
`coalesce` de los booleanos.

`GET /communities/:id/documents` acepta `?category=`, `?q=`, `?page=`,
`?limit=` con `.strict()` en el esquema de zod, igual que el listado de
reservas (spec 06). `q` con `.min(1)` (vacío → 400). Paginación `meta`
idéntico al resto.

### 7.4 Respuestas

| Caso | HTTP | `code` | Cuerpo |
|---|---|---|---|
| Listar | 200 | — | `{ data: [...], meta: { page, limit, total, totalPages } }` |
| Crear | 201 | — | `{ data: documento }` + `Location: /api/v1/documents/{id}` |
| Detalle | 200 | — | `{ data: documento }` |
| Descargar | 200 | — | `{ data: { url, expiresIn } }` con la signed URL y su validez en segundos |
| Borrar | 200 | — | `{ data: { id, deleted: true } }` |
| No miembro (listar/crear) | 403 | `FORBIDDEN` | — |
| No miembro (detalle/descargar) | 404 | `NOT_FOUND` | — |
| `PROVIDER` sin ACL (detalle) | 404 | `NOT_FOUND` | El predicado de §5.2 no devuelve la fila |
| `PROVIDER` sin ACL (descargar) | 404 | `NOT_FOUND` | idem, primera llamada |
| `PROVIDER` en ACL `can_view` (detalle) | 200 | — | — |
| `PROVIDER` en ACL `can_view=true` pero `can_download=false` (descargar) | 403 | `FORBIDDEN` | `false`→ruta, `true`→`NULL` |
| Visible pero `can_download=false` (descargar) | 403 | `FORBIDDEN` | idem |
| No existe / borrado | 404 | `NOT_FOUND` | — |
| `PRESIDENT` borrando | 403 | `FORBIDDEN` | — |
| Cuerpo/archivo inválido | 400 | `VALIDATION_ERROR` | `details` campo a campo |

### 7.5 Traducción de errores

| sentinel | errcode | HTTP | message |
|---|---|---|---|
| `forbidden_role` | 42501 | 403 | Tu rol en esta comunidad no permite esta acción. |
| `document_not_found` (no existe, no visible o borrado) | P0002 | 404 | Ese documento no existe o no es visible. |
| `document_requires_admin` | 42501 | 403 | Solo un administrador puede borrar documentos. |
| `document_path_taken` | U0001 | 409 | Ya existe un documento con esa ruta en el bucket. |
| `document_content_required` | 22023 | 400 | El título y el archivo son obligatorios. |
| `document_size_invalid` | 22023 | 400 | El archivo debe pesar más de 0 bytes. |
| `sin contexto de usuario` | 42501 | 401 | — |

Con **el par** sentinel + errcode, como en todos los módulos (R-12 de la spec
06): un `title` del cliente que contenga la cadena `document_not_found` no
puede fabricar un 404, porque la traducción exige ambos.

El errcode del único `409` es `U0001` y no `23505` (D-5): Prisma reescribe
cualquier `23505` a «Unique constraint failed…» y se come el mensaje, así que
el sentinel no llegaría nunca a `errors.ts`. Un `23505` sin sentinel no se
convierte en `409`: o es una colisión de path —imposible con uuid v4— o es
un bug del esquema, y disfrazar uno de lo otro lo escondería.

---

## 8. Estructura de archivos

```
backend/src/documents/
  routes.ts          # dos routers + multer (memoria, 10 MB, MulterError -> 400)
  controller.ts      # HTTP -> servicio (forma del cuerpo y límites del archivo)
  service.ts         # orquesta: validar -> subir -> insertar; signed URL; borrado
  repository.ts      # $queryRaw -> app_*("")
  validators.ts      # schemas zod (lista, alta multipart, acl)
  errors.ts          # P_tabla de traducción (sentinel + errcode, U0001)
  storage/
    gateway.ts       # interfaz StorageGateway
    index.ts         # factory: getStorageGateway() / resetStorageGateway()
    supabase.ts      # implementación Supabase
    local.ts         # implementación local (tests)
  __tests__/         # unitarios: validators, errors, storage-local
```

No hay `middleware.ts` ni `requireDocument()` (§7.2). `backend/scripts/` no
se toca. El seed añade la sección **9/9 Documentos**: tres filas + la ACL de
Manolo, y **sube los tres objetos al bucket** con supabase-js (`miniPdf()`
genera un PDF de una página determinista —mismo sha256 en cualquier máquina—
y `size_bytes`/`checksum` de cada fila salen del mismo buffer que se sube,
para que fila y objeto cuenten la misma historia). La subida va después del
`createMany` a propósito (D-7): un objeto sin fila es basura recuperable, una
fila sin objeto es un documento que no se baja. Sin clave o con driver
`local`, el seed avisa y salta: no finge haber subido nada.

---

## 9. Variables de entorno

```
SUPABASE_URL="https://TU_PROJECT_REF.supabase.co"
SUPABASE_ANON_KEY="..."          # la usa el frontend; el backend no la expone
SUPABASE_SERVICE_ROLE_KEY="..."  # SOLO backend
STORAGE_DRIVER="supabase"        # 'supabase' | 'local'
DOCUMENTS_BUCKET="community-documents"
DOCUMENTS_SIGNED_URL_EXPIRES_IN=300   # validez de la signed URL, en segundos
```

`env.ts` las valida con default:
- `STORAGE_DRIVER`: fuera de test, default `'supabase'`; el valor explícito
  cuenta para que un dev que quiera probar contra su bucket no tenga que
  editar nada más. **Dentro de `NODE_ENV=test` el driver es siempre `local`,
  pase lo que pase en `.env`** (D-6): la suite nunca sube fixtures al bucket
  real ni depende de red para estar en verde.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` solo se exigen cuando el driver
  es `supabase` (un valor `PENDING` cuenta como ausente); con `local` el
  backend arranca sin claves, que es lo que necesitan los tests.

---

## 10. Criterios de aceptación

### Permisos

- `ADMIN` sube / borra / ve todos los documentos de su comunidad.
- `NEIGHBOR` y `PRESIDENT` ven según `min_role`/`is_public` y listan.
- `PROVIDER` no ve nada por defecto, listando, detalle o descarga.
- `PROVIDER` en la ACL de un documento con `can_view=true` ve el metadato.
- `PROVIDER` en la ACL con `can_download=false` ve el metadato pero la
  descarga da 403.
- No miembro: listar da 403, detalle/descarga dan 404.
- Miembro suspendido: pierde la visibilidad (los `app_is_*` filtran por
  `ACTIVE`).

### Aislamiento

- Un vecino de la comunidad A no ve ni por detalle ni por `?q=` un documento
  de la comunidad B, aunque conozca el UUID.
- El `storage_path` nunca aparece en ninguna respuesta de listado ni de
  detalle.
- `POST` sin `ADMIN` da 403 aunque el cuerpo viaje como multipart.
- Borrado de un documento de otra comunidad da 404, no 403 (C-8).

### Descarga no autorizada (test que pide `ARCHITECTURE.md` §14)

> **7. Documents + ACL** — spec 08; **test de descarga no autorizada**.

- Un usuario con `can_view=true` pero `can_download=false` recibe 403 al
  pedir la signed URL.
- Un `PROVIDER` sin ACL recibe 404 al pedir la signed URL de un documento que
  `min_role` haría visible a un `NEIGHBOR`.
- La response de la descarga **no** contiene bytes ni `storage_path`: solo
  `{ url, expiresIn }`.

### Alta con ACL

- Subir con `acl: [{ userId: vecino, canView: true, canDownload: false }]`
  crea el documento, añade la fila en `document_acl` y el vecino ve el metadato
  pero no puede descargar.
- Re-subir el mismo documento (mismo `storage_path`) da 409, no 500.
- `title` vacío o de 121 caracteres → 400 con `details`.
- Un archivo de 10 MB + 1 byte → 400, no 500.
- Un `mime_type` fuera de la lista de `03_storage.sql` → 400.

### Contrato

- Toda respuesta es el sobre `{ data }` / `{ error: { code, message, details? } }`.
- `POST` devuelve 201 con `Location: /api/v1/documents/{id}`.
- La paginación trae `meta.total` real (página más allá del final con
  `count(*) over ()`, igual que en los bloques 04–07).
- En `NODE_ENV=test`, `db:verify` falla si falta cualquiera de las cinco
  funciones, si alguna no es `SECURITY DEFINER`, si `app_runtime` conserva
  escritura en `documents`/`document_acl`, o si las políticas
  `documents_insert_admin`, `documents_update_admin`, `documents_delete_admin`
  y `acl_write_admin` siguen presentes.

---

## 11. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Subir el objeto al bucket y fallar el `INSERT` -> objeto huérfano en Storage | Media | El servicio sube primero, inserta después, y **borra el objeto si el `INSERT` falla** (compensación en el mismo try). Los huérfanos residuales los recoge un job futuro |
| Borrar el documento y fallar la eliminación del objeto | Baja | DN-11: el soft delete no se revierte; el objeto queda como residuo que un job de limpieza puede recoger. Se loguea |
| Firmar URLs de larga duración y colar una en un sitio público | Media | `expiresIn` corto (5 min, configurable). El bucket es privado y la URL firmada caduca |
| La clave de servicio filtrada | Baja | Se exige que viva solo en el backend (§4d); se valida en `env.ts`; el `.env` está en `.gitignore` y el `.env.example` la marca como "PENDING" |
| Multi-lenguaje en el multipart (`multer` vs `express.json`) | Baja | Un solo router usa `multer`, con su propio límite; el resto de la app queda con el JSON de `app.ts` |
| `can_download=false` se ignora y todo el mundo descarga | Baja | Es la decisión DN-9 + §5.5: la ruta del bucket sale SOLO de `app_document_storage_path(p_document, true)`; el listado ni la menciona |

---

## 12. Decisiones del desarrollador

### D-1: Dos routers, como los bloques 05–07

Listar y crear cuelgan de `/api/v1/communities/:communityId`, detalle,
descarga y borrado de `/api/v1`. Razón: `ARCHITECTURE.md` §6 las lista tal
cual, y sigue el patrón de reservas (`createReservationsRouter` +
`createReservationRouter`) y avisos (`createAnnouncementsRouter` +
`createAnnouncementRouter`).

### D-2: El detalle y la lista comparten predicado

Se descarta una `app_get_document()` aparte, como AN-3/`app_list_announcements`.
Dos lectores serían dos copias de la visibilidad (incluida la exclusión de
`PROVIDER`) que pueden discrepar con el tiempo. El coste es que el detalle
trae `total_count` (una ventana sobre una fila, que devuelve `1` o `0` según
haya visto el documento; el backend lo ignora).

### D-3: `p_for_download` en `app_document_storage_path`

La alternativa era leer `can_download` por el listado y confiar en que el
backend no cambiara la ruta. Con el parámetro, el predicado de descendencia y
el de escritura viven juntos en la misma función y el backend no puede pedir el
`storage_path` "de gratis" olvidando la comprobación: si lo pide con `true`,
la función lo exige.

### D-4 (decisión abierta): ¿el borrado físico del objeto, o un job?

DN-11 deja el residuo del objeto al fallar la eliminación. La alternativa es un
job que barra `storage.objects` contra `documents.deleted_at` o contra
`documents` ausente. Es deuda de bloque: no hay jobs en el proyecto. Se
documenta en §11 y no bloquea.

### D-5: `document_path_taken` viaja con SQLSTATE `U0001`, no `23505`

Prisma (P2010) reescribe cualquier `23505` que reciba a «Unique constraint
failed: …» y descarta el mensaje original, así que el sentinel de la colisión
jamás llegaría a `errors.ts`: la pareja (sentinel, errcode) se perdería justo
en el único caso que la necesita. `U0001` es una clase propia sin significado
estándar, el mensaje viaja entero, y un `23505` que llegue sin sentinel sigue
significando un bug del esquema (un uuid v4 no colisiona) en vez de un 409.

### D-6: en test el driver de Storage es siempre `local`, y `.env` no manda

`env.ts` fija `STORAGE_DRIVER = 'local'` cuando `NODE_ENV = 'test'` **antes**
de mirar el entorno. La alternativa —respetar un `.env` con `supabase`—
haría que la suite subiera fixtures al bucket real (basura en el proyecto) y
dependiera de red para estar en verde. El valor explícito solo cuenta fuera
de test, para que un dev pueda probar contra su bucket sin tocar nada más.

### D-7: el seed sube los tres objetos al bucket real

Con el driver `supabase`, una fila sin objeto es un `500` en la descarga: el
endpoint responde, pero no hay nada que firmar. Por eso el seed crea las tres
filas y **después** sube sus tres objetos (DN-11 razona al revés: un objeto
sin fila es basura recuperable, una fila sin objeto es un documento que no se
baja). El contenido sale de `miniPdf()`, un PDF de una página determinista
(mismo sha256 en cualquier máquina), y `size_bytes`/`checksum` de las filas
se calculan del mismo buffer que se sube: fila y objeto cuentan la misma
historia. Sin clave o con driver `local`, el seed avisa y salta —no finge
haber subido nada—, y la verificación de la descarga queda para cuando haya
bucket.

---

## 13. Fuera de alcance

- **Adjuntos a avisos o incidencias**: no hay `parent_entity_id` en
  `documents`. La spec 07 y la 04 los remiten aquí como "con su ACL", pero
  suscribir un documento a entidades distintas es un cruce de modelo que este
  bloque no hace.
- **Edición posterior** (`PUT`) y **ACL posterior**: DN-9, fijado en el alta.
- **Notificaciones** de "nuevo documento".
- **Documentos entre comunidades** (compartir en dos listados a la vez).
- **Versionado**: cada documento es una fila + un objeto; reemplazar = borrar
  y subir.
- **UI** en general, y en particular el componente de "subir arrastrando".
- **Object storage de avatares** (`user-avatars`): es de la spec de perfil.
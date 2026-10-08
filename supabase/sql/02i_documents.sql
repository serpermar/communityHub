-- =============================================================================
-- 02i — Bloque 08: documentos
-- =============================================================================
--
-- El repositorio de documentos es el primer bloque que toca Supabase Storage:
-- el binario nunca vive en la base (solo `documents.storage_path`, la clave
-- dentro del bucket). La asimetría es la de los avisos pero al revés: en los
-- avisos escriben pocos y leen todos; aquí sube ADMIN y lee quien coincide con
-- la ACL del documento (spec 08 §1). Cada pieza traduce una decisión DN-*:
--
--   * DN-1: subir, reconfigurar y borrar es solo de ADMIN. Las políticas de
--     escritura de 02_rls.sql (documents_insert/update/delete_admin y
--     acl_write_admin) se eliminan.
--   * DN-2: toda lectura pasa por funciones SECURITY DEFINER; el predicado
--     fino que excluye a PROVIDER (DN-5) y distingue can_view de can_download
--     no cabe en una política (una política mira la fila resultante, no el
--     conjunto, y no devuelve errores con sentinel).
--   * DN-5: PROVIDER no accede a ningún documento por defecto. El enum
--     miembro_role está declarado como ('NEIGHBOR','PRESIDENT','ADMIN',
--     'PROVIDER'), así que el orden real es NEIGHBOR < PRESIDENT < ADMIN <
--     PROVIDER (el comentario de 02_rls.sql §5.10 afirmaba lo contrario), y un
--     `app_role_in(id) >= min_role` incluye a PROVIDER en CUALQUIER umbral,
--     incluso min_role='ADMIN'. Las lecturas excluyen a PROVIDER de la
--     visibilidad por rol; la ACL explícita sí puede concederle un documento
--     concreto (DN-5/DN-9, y el enum no se reordena: cambiar de orden un tipo
--     ya aplicado es una migración delicada y las funciones ya lo compensan).
--   * DN-9: min_role, is_public y la ACL se fijan en el alta (no hay PUT).
--   * DN-3/DN-4: el binario vive en el bucket privado community-documents, con
--     el storage_path prefijado por <community_id>/, de forma que el
--     aislamiento sea también estructural en el storage.
--   * DN-8: uploaded_by sale de app_current_user_id(), nunca del cuerpo.
--   * DN-11: el borrado es soft delete en la BD; la eliminación del objeto
--     del bucket la hace el backend después, sin abortar el 200.
--   * DN-12/DN-13: checksum SHA-256 y size_bytes los calcula el backend; aquí
--     solo se validan con CHECK y sentinels.
--
-- Orden interno: 1) CHECK de longitud  2) comunidad del documento  3) lecturas
--                 4) escrituras  5) ruta en el bucket  6) políticas RLS
--                 7) permisos  8) autocomprobación
--
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Longitudes de texto
-- ----------------------------------------------------------------------------
--
-- `title` y `description` son not null (el segundo nullable) pero no tienen
-- CHECK de longitud (spec §4a) —mismo criterio que announcements_title_length
-- y incidents_description_length: `not valid` aplica a filas nuevas sin
-- revalidar las que ya haya. Quien pone los rangos por dos veces —aquí y en el
-- zod del backend— es porque la capa de entrada se puede saltar con una
-- llamada directa a la base de datos.
do $$
begin
  alter table documents
    add constraint documents_title_length
    check (char_length(title) between 1 and 120) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table documents
    add constraint documents_description_length
    check (char_length(description) between 1 and 1000) not valid;
exception
  when duplicate_object then null;
end $$;

-- 120 de título es de repositorio (un acta cabe) y 1000 de descripción separa
-- "qué es" de "el contenido en sí".

-- ----------------------------------------------------------------------------
-- 2. La comunidad de un documento
-- ----------------------------------------------------------------------------
--
-- §7.2: GET y DELETE /documents/:id no llevan comunidad en la URL. La usa
-- app_delete_document() para resolver la comunidad antes de comprobar el rol:
-- NULL -> document_not_found (P0002), mismo criterio C-8 de los bloques 04, 05
-- y 07: un 403 confirmaría que ese id existe y que antes lo veías. Ningun
-- middleware de Express la llama: la visibilidad de las lecturas la decide el
-- predicado de app_list_documents() con p_document (sección 3), que es una
-- regla fina que no cabe en un middleware.
--
-- Devuelve el community_id SOLO si el documento existe, no está borrado y el
-- actor es miembro activo de su comunidad (app_is_member_of filtra por ACTIVE).
--
-- Nótese lo que NO filtra: no mira la visibilidad del documento ni la ACL.
-- Un documento invisible sigue "existiendo" para su borrado —gestionar es lo
-- que hay que hacer con esos. Quien decide si una lectura es legítima es el
-- predicado de app_list_documents() (sección 3). Y un documento de otra
-- comunidad es NULL para este llamante: no confirmar nada de él.
--
-- SELECT en lugar de EXCEPTION, por el mismo motivo que sus hermanas: se usa
-- desde consultas que pueden no encontrar nada, y un 404 como excepción
-- PostgreSQL aborta la transacción en curso salvo que el backend la capture.
create or replace function app_document_community(p_document uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.community_id
    from documents d
   where d.id = p_document
     and d.deleted_at is null
     and app_is_member_of(d.community_id)
$$;

-- ----------------------------------------------------------------------------
-- 3. Lecturas
-- ----------------------------------------------------------------------------
--
-- DN-6: TODA lectura pasa por esta función —el listado, y el detalle por id con
-- el MISMO predicado, para que no haya dos copias de la visibilidad que puedan
-- discrepar. Aquí vive la composición completa:
--
--   * ADMIN ve todos (matriz §5, "✅ (todos)").
--   * ACL explícita con can_view: vale para cualquier rol activo, INCLUIDO
--     PROVIDER (DN-5/DN-9). Un miembro suspendido pierde la ACL porque
--     app_is_member_of filtra por ACTIVE.
--   * Visibilidad por rol para miembro activo NO PROVIDER: is_public o
--     app_role_in(id) >= min_role. El >= funciona entre los tres roles reales
--     (NEIGHBOR < PRESIDENT < ADMIN); PROVIDER está excluido por el `<>`
--     explícito (DN-5).
--   * deleted_at is null: borrado es borrado, para nadie (DN-11).
--
-- Y el borde de no-miembro: si no pertenece a la comunidad recibe 403, no una
-- lista vacía —decir "no hay documentos" confirmaría que la comunidad existe
-- (criterio C-8, como avisos).
--
-- Añade uploaded_by + uploaded_by_name, que sale de users con un left join:
-- users_select_self no deja leer el full_name al backend, y el detalle de un
-- documento debe mostrar quién lo subió. Es la misma excepción acotada que
-- abrieron 02d, 02e, 02g y 02h.
--
-- storage_path NO está en las columnas devueltas: un cliente no puede leer la
-- ruta del bucket desde el listado y montarse él una URL. Solo
-- app_document_storage_path() (sección 5) la devuelve.
--
-- El total sale de `count(*) over ()` sobre el conjunto filtrado (la misma
-- técnica que 02e), y el detalle por id la trae igual: el backend la ignora.
create or replace function app_list_documents(
  p_community_id uuid,
  p_document     uuid               default null,
  p_category     document_category  default null,
  p_q            text               default null,
  p_limit        integer            default 20,
  p_offset       integer            default 0
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
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- El no-miembro no recibe lista vacía sino 403. El detalle por id no pasa
  -- por aquí (p_community_id viene null): su permiso lo decide el predicado.
  if p_document is null and not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select d.id, d.community_id, d.title, d.description, d.category,
         d.mime_type, d.size_bytes, d.checksum, d.min_role, d.is_public,
         d.uploaded_by, u.full_name, d.created_at, d.updated_at,
         count(*) over ()
    from documents d
    left join users u on u.id = d.uploaded_by   -- on delete set null: si el autor se dio de baja, null
   where d.deleted_at is null                    -- DN-11: borrado es borrado, para nadie
     and (p_document is null or d.id = p_document)
     and (p_community_id is null or d.community_id = p_community_id)
     and (p_category is null or d.category = p_category)
     and (p_q is null
          or d.title ilike '%' || p_q || '%'
          or d.description ilike '%' || p_q || '%')
     and (
       -- DN-1: ADMIN ve todos
       app_is_admin_of(d.community_id)
       -- DN-5/DN-9: ACL explícita, vale para cualquier rol activo
       or (
         app_is_member_of(d.community_id)
         and exists (
           select 1 from document_acl a
            where a.document_id = d.id
              and a.user_id = app_current_user_id()
              and a.can_view
         )
       )
       -- DN-5: la visibilidad por rol excluye a PROVIDER
       or (
         app_is_member_of(d.community_id)
         and app_role_in(d.community_id) <> 'PROVIDER'
         and (d.is_public or app_role_in(d.community_id) >= d.min_role)
       )
     )
   order by d.created_at desc                  -- DN-7: lo último arriba
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Escrituras
-- ----------------------------------------------------------------------------
--
-- La única puerta de entrada que queda: las políticas de escritura de 02_rls
-- (sección 5.10 y 5.11) desaparecen en la sección 6 y app_runtime pierde
-- INSERT/UPDATE/DELETE sobre documents y document_acl en la 7. Ninguna función
-- acepta un usuario como parámetro: el actor sale de app_current_user_id()
-- (DN-8).

-- ----------------------------------------------------------------------------
-- 4.1 Crear un documento
-- ----------------------------------------------------------------------------
--
-- DN-1: solo ADMIN. El backend pone además requireCommunityRole('ADMIN') como
-- guardia gruesa, pero el rol se repite DENTRO de la transacción: si el guard
-- se olvidara, el endpoint seguiría siendo seguro (el patrón de 02e/02g/02h).
--
-- DN-9: min_role, is_public y la ACL se fijan en el alta; no hay PUT. La ACL
-- llega como jsonb (una fila por entrada) y se inserta en la misma transacción
-- que el documento, con ON CONFLICT DO UPDATE para re-listas del mismo usuario
-- (document_acl_uidx único) en lugar de romper con un 23505.
--
-- El único 23505 del alta es el del storage_path: es la clave real del sistema
-- (documents_storage_path_uidx, única global). Se captura y se re-lanza con
-- sentinel document_path_taken; si el path no es el ese, `raise` deja pasar el
-- 23505 original al handler global.
--
-- POR QUÉ U0001 y no 23505: Prisma (P2010) traduce cualquier 23505 a su propio
-- mensaje genérico "Unique constraint failed: ..." y se come el texto del
-- sentinel. Con un SQLSTATE propio (clase U, sin significado estándar) el
-- mensaje llega íntegro al cliente y translate() puede exigir la pareja
-- (U0001, document_path_taken). Un 23505 que sí llegue al cliente sigue
-- significando un bug del esquema.
--
-- guards en orden: contexto -> rol -> campos obligatorios -> size_bytes.
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
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
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

  -- Guarda interna, inalcanzable desde la API (el zod exige título y archivo):
  -- existe para que una llamada directa a la función no choque con el not null
  -- crudo de la columna, que llegaría al backend como un 23502 que nada traduce.
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
      p_community_id, btrim(p_title), btrim(p_description), coalesce(p_category, 'OTHER'),
      p_storage_path, p_mime_type, p_size_bytes, p_checksum,
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

  -- La ACL viaja en la misma transacción: el documento y su visibilidad fina
  -- nacen juntos (DN-9) o no nace ninguno.
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
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.2 Borrar un documento (soft delete)
-- ----------------------------------------------------------------------------
--
-- DN-11: soft delete en la BD —el histórico de qué existió se conserva— y la
-- eliminación del objeto del bucket la hace el backend DESPUÉS, como efecto
-- secundario que no aborta el 200. Si la eliminación del objeto falla, se
-- loguea y un job de limpieza futuro puede recoger el residuo.
--
-- DN-1: solo ADMIN, con la guarda en este orden:
--   1. app_document_community() no devuelve NULL —un documento invisible para
--      el actor no es "suyo de borrar". Si no eres ADMIN ni eso.
--   2. app_is_admin_of(v_community); si no, document_requires_admin (403). El
--      PRESIDENT no destruye el histórico, igual que en avisos (AN-5).
--   3. update ... and deleted_at is null; si not found, P0002 (borrado dos
--      veces = 404, como AN-11 en avisos).
create or replace function app_delete_document(p_document uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
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
    -- Solo si otra transacción lo borró entre la guarda de arriba y este UPDATE.
    raise exception 'document_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. La ruta en el bucket
-- ----------------------------------------------------------------------------
--
-- La ÚNICA función que devuelve storage_path (DN-3). Nunca se expone en el
-- listado: un cliente no lee la ruta desde el detalle y no monta él una URL.
--
-- p_for_download true añade al predicado de §5.2 la exigencia de can_download:
--   * la ACL explícita debe traer can_download=true (no basta can_view);
--   * una ACL con can_download=false VETA la descarga por rol (fila §7.4
--     "Visible pero can_download=false -> 403");
--   * la ACL con can_download=true vale para cualquier rol, incluido PROVIDER.
--
-- El backend la llama DOS veces en GET /documents/:id/download (spec §5.5):
--   con false -> si NULL, 404 (no existe, no visible; no confirmar existencia)
--   con true  -> si NULL, 403 (lo ve, pero no puede descargar)
create or replace function app_document_storage_path(
  p_document     uuid,
  p_for_download boolean
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.storage_path
    from documents d
   where d.id = p_document
     and d.deleted_at is null
     and (
       -- DN-1: ADMIN ve y descarga todo
       app_is_admin_of(d.community_id)
       -- ACL explícita: can_view para el metadato, can_download para la URL
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
         -- DN-9/DN-11: la ACL con can_download=false veta la descarga por rol
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

-- ----------------------------------------------------------------------------
-- 6. Políticas RLS
-- ----------------------------------------------------------------------------
--
-- documents se queda SOLO con documents_select_scoped (SELECT) y document_acl
-- con acl_select_scoped. Las tres de escritura de documents y la de ALL de
-- document_acl se eliminan, y no se sustituyen por versiones más restrictivas:
-- sin permiso de escritura para app_runtime no hay nada que una política pueda
-- decidir (los grants siguen vivos, se revocan en la sección 7).
--
-- La de SELECT no se toca, pero es deliberadamente MÁS DÉBIL que el predicado
-- de la sección 3: usa app_role_in(id) >= min_role con el orden real del enum,
-- que incluye a PROVIDER en cualquier umbral (spec §4c). Esa diferencia está
-- asumida —ninguna ruta lee documents con Prisma, toda lectura pasa por
-- app_list_documents() (DN-6)— y la comprobación de la sección 8 es la
-- advertencia escrita en SQL.
drop policy if exists documents_insert_admin on documents;
drop policy if exists documents_update_admin on documents;
drop policy if exists documents_delete_admin on documents;
drop policy if exists acl_write_admin on document_acl;

-- ----------------------------------------------------------------------------
-- 7. Permisos
-- ----------------------------------------------------------------------------
--
-- El revoke es la pieza imprescindible, no decorativa: quitar documents y
-- document_acl de las listas de `grant insert, update[, delete]` de 02_rls.sql
-- (sección 5.19) no deshace un GRANT ya aplicado. Y se repite contra anon,
-- authenticated por simetría con 02e y 02f: revocar dos veces no cuesta nada y
-- el segundo revoke sobrevive a un `alter default privileges` futuro.
revoke insert, update, delete on documents from app_runtime;
revoke insert, update, delete on documents from anon, authenticated;

revoke insert, update on document_acl from app_runtime;
revoke insert, update on document_acl from anon, authenticated;

grant execute on function app_document_community(uuid) to app_runtime;
grant execute on function app_list_documents(uuid, uuid, document_category, text, integer, integer) to app_runtime;
grant execute on function app_create_document(uuid, text, text, document_category, text, text, bigint, text, member_role, boolean, jsonb) to app_runtime;
grant execute on function app_delete_document(uuid) to app_runtime;
grant execute on function app_document_storage_path(uuid, boolean) to app_runtime;

-- El revoke va de PUBLIC y no de anon/authenticated a propósito: revocar del
-- grupo PUBLIC los cubre a todos de una vez y no deja al autor acordarse de un
-- cuarto rol mañana. Mismo criterio que 02b a 02h.
revoke execute on function app_document_community(uuid) from public;
revoke execute on function app_list_documents(uuid, uuid, document_category, text, integer, integer) from public;
revoke execute on function app_create_document(uuid, text, text, document_category, text, text, bigint, text, member_role, boolean, jsonb) from public;
revoke execute on function app_delete_document(uuid) from public;
revoke execute on function app_document_storage_path(uuid, boolean) from public;

-- ----------------------------------------------------------------------------
-- 8. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Que este archivo se ejecute sin errores no demuestra nada: si alguien lo
-- reescribe y se le olvida el `security definer`, o se le olvida revocar un
-- permiso, o borra la línea del drop policy, el archivo se aplicaría igual de
-- limpio y el agujero se instalaría solo, en silencio. Estas comprobaciones son
-- las que fallan en `db:verify`.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las cinco funciones: SECURITY DEFINER, search_path fijo y no ejecutables
  -- por PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_document_community', 'app_list_documents',
         'app_create_document', 'app_delete_document',
         'app_document_storage_path'
       )
  loop
    if not r.prosecdef then
      v_fallos := v_fallos || ' ' || r.proname || ' ya no es SECURITY DEFINER;';
    end if;

    if r.proconfig is null
       or not exists (
         select 1 from unnest(r.proconfig) as c
          where c like 'search\_path=%'
       )
    then
      v_fallos := v_fallos || ' ' || r.proname || ' necesita search_path fijo;';
    end if;

    if exists (
      select 1
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = r.proname
         and grantee = 'PUBLIC'
    ) then
      v_fallos := v_fallos || ' ' || r.proname || ' sigue siendo ejecutable por PUBLIC;';
    end if;
  end loop;

  -- Y que las cinco estén. El bucle anterior no falla si no hay ninguna.
  for r in
    select unnest(array[
      'app_document_community', 'app_list_documents',
      'app_create_document', 'app_delete_document',
      'app_document_storage_path'
    ]) as fn
  loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = r.fn
    ) then
      v_fallos := v_fallos || ' falta ' || r.fn || '();';
    end if;
  end loop;

  -- documents y document_acl: solo lectura desde RLS. Cualquier política de
  -- escritura reabre el camino que DN-2 cierra.
  if exists (
    select 1
      from pg_policies
     where tablename = 'documents'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' documents tiene politica de escritura; deberia ser solo lectura;';
  end if;

  if exists (
    select 1
      from pg_policies
     where tablename = 'document_acl'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' document_acl tiene politica de escritura; deberia ser solo lectura;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'documents'
       and policyname = 'documents_select_scoped'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta documents_select_scoped de SELECT;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'document_acl'
       and policyname = 'acl_select_scoped'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta acl_select_scoped de SELECT;';
  end if;

  -- Y que el permiso de escritura no exista para nadie, no solo para
  -- app_runtime. Se excluyen postgres (owner) y service_role (recibe todos los
  -- privilegios por ALTER DEFAULT PRIVILEGIES de Supabase), igual que en 02e y
  -- 02f.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'documents'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' documents tiene INSERT/UPDATE/DELETE concedido a un rol que no debe;';
  end if;

  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'document_acl'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' document_acl tiene INSERT/UPDATE/DELETE concedido a un rol que no debe;';
  end if;

  -- Los dos CHECK de longitud de la sección 1.
  if not exists (
    select 1
      from pg_constraint
     where conname = 'documents_title_length'
       and conrelid = 'public.documents'::regclass
       and contype = 'c'
  ) then
    v_fallos := v_fallos || ' falta documents_title_length;';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'documents_description_length'
       and conrelid = 'public.documents'::regclass
       and contype = 'c'
  ) then
    v_fallos := v_fallos || ' falta documents_description_length;';
  end if;

  if exists (
    select 1
      from pg_constraint
     where conname in ('documents_title_length', 'documents_description_length')
       and conrelid = 'public.documents'::regclass
       and convalidated = false
  ) then
    raise notice 'AVISO: documents_title_length/documents_description_length existen pero siguen sin validar (not valid).';
  end if;

  -- El soporte del aislamiento y del orden de DN-7, ya cubiertos en 01_schema:
  -- se reiteran porque son el soporte directo de este bloque (spec §10).
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'documents_community_idx'
  ) then
    v_fallos := v_fallos || ' falta documents_community_idx;';
  end if;

  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'documents_storage_path_uidx'
  ) then
    v_fallos := v_fallos || ' falta documents_storage_path_uidx;';
  end if;

  -- DN-8 escrita en la función: uploaded_by sale de app_current_user_id(), no
  -- del cuerpo. Si alguien lo quita, el alta deja de firmar la autoría.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_create_document'
       and pg_get_functiondef(p.oid) like '%app_current_user_id()%'
  ) then
    v_fallos := v_fallos || ' el alta deberia firmar uploaded_by con app_current_user_id (DN-8);';
  end if;

  -- DN-5 escrita: la visibilidad por rol excluye a PROVIDER tanto en la lectura
  -- como en la ruta del bucket. Si se elimina el `<> ''PROVIDER''`, la matriz
  -- §5 deja de cumplirse para PROVIDER.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_list_documents'
       and pg_get_functiondef(p.oid) like '%<> ''PROVIDER''%'
  ) then
    v_fallos := v_fallos || ' el listado deberia excluir a PROVIDER de la visibilidad por rol (DN-5);';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_document_storage_path'
       and pg_get_functiondef(p.oid) like '%<> ''PROVIDER''%'
  ) then
    v_fallos := v_fallos || ' la ruta del bucket deberia excluir a PROVIDER de la visibilidad por rol (DN-5);';
  end if;

  -- DN-9 escrita: documents y document_acl se escriben en la misma transacción
  -- y la ACL es por fila. Si el ON CONFLICT desaparece, la re-lista del mismo
  -- usuario rompería en document_acl_uidx.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_create_document'
       and pg_get_functiondef(p.oid) like '%on conflict%'
  ) then
    v_fallos := v_fallos || ' el alta deberia insertar la ACL con ON CONFLICT (DN-9);';
  end if;

  -- DN-11 escrita: el borrado es soft delete (deleted_at) y no DELETE físico.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_delete_document'
       and pg_get_functiondef(p.oid) like '%deleted_at = now()%'
  ) then
    v_fallos := v_fallos || ' el borrado deberia ser soft delete con deleted_at (DN-11);';
  end if;

  -- DN-2 red de seguridad: la ruta del bucket sale SOLO de
  -- app_document_storage_path() y el listado no expone storage_path. Si alguien
  -- añade storage_path a las columnas del listado, se expone la clave del bucket.
  if pg_get_functiondef((
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_list_documents'
  )) like '%storage_path%' then
    v_fallos := v_fallos || ' el listado no deberia exponer storage_path (DN-3/DN-10);';
  end if;

  if v_fallos <> '' then
    raise exception 'Los documentos no son seguros:%', v_fallos;
  end if;

  raise notice 'OK: documents y document_acl solo lectura, una escritura por funcion, cinco funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC, PROVIDER excluido de la visibilidad por rol y storage_path solo tras can_download.';
end $$;
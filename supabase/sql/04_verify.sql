-- ============================================================================
-- CommunityHub · 04_verify.sql
-- ============================================================================
-- Ejecutar DESPUÉS de 01, 02 y 03.
--
-- Comprobaciones que deben salir todas en verde. Si algo falla, PARAR: el
-- esquema no está listo y construir encima produce errores confusos más tarde.
--
-- Cada comprobación lanza EXCEPTION si el resultado no es el esperado. Al
-- ejecutarlo entero desde el SQL Editor, un fallo detiene el script y te
-- localiza el problema en la línea exacta.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tablas creadas
-- ----------------------------------------------------------------------------
do $$
declare
  n integer;
  required text[] := array[
    'users', 'communities', 'community_members', 'incidents',
    'incident_comments', 'common_areas', 'reservations', 'area_slots',
    'announcements', 'documents', 'document_acl', 'expenses', 'invoices',
    'votes', 'vote_options', 'vote_responses', 'notifications', 'sessions',
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
    'incident_drafts', 'ai_usage', 'ai_cache'
  ];
  missing text;
begin
  select string_agg(t.name, ', ')
    into missing
  from unnest(required) as t(name)
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = t.name
      and table_type = 'BASE TABLE'
  );

  if missing is not null then
    raise exception 'FALTAN TABLAS: %', missing;
  end if;

  select count(*) into n from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';

  raise notice 'OK · % tablas creadas', n;
end $$;

-- ----------------------------------------------------------------------------
-- 2. ENUMs creados
-- ----------------------------------------------------------------------------
do $$
declare
  required text[] := array[
    'user_global_role', 'member_role', 'member_status',
    'incident_status', 'incident_priority', 'incident_category',
    'incident_created_via', 'common_area_type', 'reservation_status',
    'announcement_type', 'announcement_priority', 'document_category',
    'expense_category', 'invoice_status', 'vote_type', 'vote_status',
    'vote_result_visibility', 'notification_type', 'session_status'
  ];
  missing text;
begin
  select string_agg(e, ', ')
    into missing
  from unnest(required) as e
  where not exists (
    select 1 from pg_type t
    join pg_namespace ns on ns.oid = t.typnamespace
    where ns.nspname = 'public'
      and t.typname = e
      and t.typtype = 'e'
  );

  if missing is not null then
    raise exception 'FALTAN ENUMS: %', missing;
  end if;

  raise notice 'OK · % ENUMs creados', array_length(required, 1);
end $$;

-- ----------------------------------------------------------------------------
-- 3. RLS activo Y forzado en todas las tablas
-- ----------------------------------------------------------------------------
-- Se comprueban las dos cosas por separado. ENABLE activa la política y FORCE la
-- extiende al dueño de la tabla; con solo una de las dos el esquema queda
-- incompleto aunque RLS parezca configurada.
do $$
declare
  r record;
  offenders text := '';
begin
  for r in
    select c.relname,
           case when not c.relrowsecurity then 'sin ENABLE' else '' end ||
           case when not c.relforcerowsecurity then ' sin FORCE' else '' end as falta
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  loop
    offenders := offenders || r.relname || ' (' || r.falta || ') ';
  end loop;

  if offenders <> '' then
    raise exception 'RLS incompleta en: %', offenders;
  end if;

  raise notice 'OK · RLS activada y forzada en todas las tablas';
end $$;

-- ----------------------------------------------------------------------------
-- 4. Funciones de contexto disponibles
-- ----------------------------------------------------------------------------
do $$
declare
  required text[] := array[
    'app_current_user_id', 'app_current_community_id',
    'app_is_member_of', 'app_role_in', 'app_is_admin_of',
    'app_is_assigned_provider', 'set_updated_at', 'app_ai_cache_get', 'app_ai_cache_put'
  ];
  missing text;
begin
  select string_agg(f, ', ')
    into missing
  from unnest(required) as f
  where not exists (
    select 1 from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = f
  );

  if missing is not null then
    raise exception 'FALTAN FUNCIONES: %', missing;
  end if;

  raise notice 'OK · % funciones de contexto disponibles', array_length(required, 1);
end $$;

-- ----------------------------------------------------------------------------
-- 5. Índices únicos de integridad
-- ----------------------------------------------------------------------------
-- Estos índices son la base de tres invariantes. Si alguno falta, las garantías
-- dejan de depender de la aplicación y pasan a depender de que nadie cometa el
-- error.
do $$
declare
  required text[] := array[
    'community_members_scope_uidx',    -- un rol por usuario y comunidad
    'incidents_reference_code_uidx',   -- código único por comunidad
    'area_slots_no_overlap_uidx',       -- una reserva por slot (sin carrera)
    'vote_responses_unique_vote_uidx',  -- un voto por usuario
    'sessions_token_hash_uidx',         -- token único
    'documents_storage_path_uidx',      -- sin colisión en el bucket
    'invoices_community_number_uidx',   -- numero unico por comunidad
    'common_areas_community_name_uidx', -- nombre único por comunidad
    'vote_options_vote_position_uidx',  -- orden estable de opciones
    'ai_usage_user_date_uidx'           -- un contador por usuario y día
  ];
  missing text;
begin
  select string_agg(i, ', ')
    into missing
  from unnest(required) as i
  where not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = i
  );

  if missing is not null then
    raise exception 'FALTAN ÍNDICES ÚNICOS: %', missing;
  end if;

  raise notice 'OK · % índices de integridad presentes', array_length(required, 1);
end $$;

-- ----------------------------------------------------------------------------
-- 6. Triggers de updated_at
-- ----------------------------------------------------------------------------
do $$
declare
  n integer;
  expected integer := 16;
begin
  select count(*) into n
  from pg_trigger
  where not tgisinternal
    and tgname like '%\_set\_updated_at';

  if n < expected then
    raise exception 'Solo % triggers de updated_at (esperados >= %)', n, expected;
  end if;

  raise notice 'OK · % triggers de updated_at', n;
end $$;

-- ----------------------------------------------------------------------------
-- 7. audit_logs es append-only
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where not tgisinternal
      and tgname = 'audit_logs_no_update'
  ) then
    raise exception 'El trigger de inmutabilidad de audit_logs no existe';
  end if;

  raise notice 'OK · audit_logs protegido contra UPDATE y DELETE';
end $$;

-- ----------------------------------------------------------------------------
-- 8. Funciones de autenticación (02b_auth.sql)
-- ----------------------------------------------------------------------------
-- Son la superficie mas sensible del esquema: allow_from_user_by_email devuelve
-- el hash de contraseña a quien pueda ejecutarla. Por eso se comprueban las tres
-- cosas que la hacen segura, y no solo que existan.
--
--   SECURITY DEFINER -> se ejecuta como postgres, que si puede leer users
--   search_path fijo  -> sin esto, cualquiera que cree un objeto en el schema
--                        de busqueda puede sustituir la funcion
--   solo app_runtime  -> PUBLIC no debe poder ejecutarlas
do $$
declare
  r record;
  faltantes text := '';
  total integer := 0;
  sp text;
begin
  for r in
    select p.proname,
           p.prosecdef as is_security_definer,
           p.proconfig::text as config
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in (
        'app_auth_find_user_by_email',
        'app_auth_find_session_by_hash',
        'app_auth_revoke_family'
      )
  loop
    total := total + 1;

    -- Postgres guarda el search_path tal cual se escribio, con los espacios que
    -- puso el autor: 'search_path=public, pg_temp'. Comparar contra una cadena
    -- exacta da falso negativo por un espacio. Se eliminan los espacios antes de
    -- comparar, y se exige que terminal en pg_temp: sin eso, una funcion con
    -- 'search_path=public' (sin restringir pg_temp) pasaria el filtro.
    sp := coalesce(r.config, '');
    sp := replace(sp, ' ', '');

    if not r.is_security_definer then
      faltantes := faltantes || r.proname || ' (no es SECURITY DEFINER) ';
    elsif sp not like '%search_path=public,pg_temp%' then
      faltantes := faltantes || r.proname || ' (search_path sin fijar en public, pg_temp) ';
    else
      raise notice '  OK · %', r.proname;
    end if;
  end loop;

  if total < 3 then
    raise exception
      'Solo % de 3 funciones de auth existen. Falta ejecutar 02b_auth.sql', total;
  end if;

  if faltantes <> '' then
    raise exception 'Funciones de auth inseguras: %', faltantes;
  end if;

  raise notice 'OK · 3 funciones de auth seguras';
end $$;

-- Los permisos de ejecucion. Si anon o authenticated pueden llamar a
-- app_auth_find_user_by_email, cualquiera podria leer el hash de contraseña de
-- cualquier vecino con una llamada a la API.
do $$
declare
  filtrados text := '';
  r record;
begin
  for r in
    select grantee, count(*) as n
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'app_auth_find_user_by_email',
        'app_auth_find_session_by_hash',
        'app_auth_revoke_family'
      )
      and grantee <> 'app_runtime'
    group by grantee
  loop
    if r.grantee = 'PUBLIC' then
      filtrados := filtrados || 'PUBLIC ';
    elsif r.grantee in ('anon', 'authenticated') then
      filtrados := filtrados || r.grantee || ' ';
    end if;
  end loop;

  if filtrados <> '' then
    raise exception
      'Estas funciones de auth tambien se pueden ejecutar como: %', filtrados;
  end if;

  raise notice 'OK · solo app_runtime puede ejecutar las funciones de auth';
end $$;

-- ----------------------------------------------------------------------------
-- 8b. El alta de comunidades (spec 02, C-1 y C-2)
-- ----------------------------------------------------------------------------
-- Mismas tres cosas que se comprueban de las funciones de auth, y por el mismo
-- motivo: app_create_community() se ejecuta como su propietario y no pasa por
-- RLS, así que su seguridad no la sostiene ninguna política. Si alguien la
-- reescribe sin `security definer`, o con el `search_path` abierto, el resto del
-- esquema seguiría siendo correcto y el agujero se instalaría en silencio.
do $$
declare
  v_fn       record;
  v_fallos   text := '';
  v_sp       text;
begin
  select p.oid, p.prosecdef, p.proconfig::text as config
    into v_fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'app_create_community'
     and pg_get_function_identity_arguments(p.oid) =
         'p_name text, p_slug text, p_address_line1 text, p_city text, p_country text, p_description text, p_province text, p_postal_code text, p_latitude numeric, p_longitude numeric, p_timezone text, p_registration_number text';

  if v_fn.oid is null then
    raise exception 'app_create_community() no existe. Falta ejecutar 02c_communities.sql';
  end if;

  v_sp := replace(coalesce(v_fn.config, ''), ' ', '');

  if not v_fn.prosecdef then
    v_fallos := v_fallos || ' no es SECURITY DEFINER;';
  end if;

  if v_sp not like '%search_path=public,pg_temp%' then
    v_fallos := v_fallos || ' search_path sin fijar en public, pg_temp;';
  end if;

  -- La segunda capa de C-2. Si esta política desapareciera, el insert directo
  -- con app_runtime quedaría sin ninguna barrera y el alta dependería solo de la
  -- función.
  if not exists (
    select 1 from pg_policies
     where tablename = 'communities'
       and policyname = 'communities_insert_admin_sa'
       and cmd = 'INSERT'
  ) then
    v_fallos := v_fallos || ' falta la politica communities_insert_admin_sa de INSERT;';
  end if;

  -- Y que no se pueda borrar en cascada desde la API: sin politica de DELETE, un
  -- DELETE no puede tocar la fila ni siquiera siendo ADMIN.
  if exists (
    select 1 from pg_policies
     where tablename = 'communities' and cmd = 'DELETE'
  ) then
    v_fallos := v_fallos || ' communities tiene politica DELETE y deberia ser baja logica;';
  end if;

  -- C-7: las coordenadas tienen que admitir NULL, o el alta solo con direccion
  -- fallara con un not_null_violation en vez de con un 400.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'communities'
       and column_name in ('latitude', 'longitude')
       and is_nullable <> 'YES'
  ) then
    v_fallos := v_fallos || ' latitude/longitude siguen siendo NOT NULL;';
  end if;

  if v_fallos <> '' then
    raise exception 'El alta de comunidades no es segura:%', v_fallos;
  end if;

  raise notice 'OK · app_create_community() segura, con politica INSERT y sin DELETE';
end $$;

-- Los permisos de ejecucion de la funcion de alta. Si anon o authenticated
-- pudieran llamarla, cualquiera podria crear su propia comunidad desde el
-- navegador con la clave publica de Supabase, y ser su propio ADMIN.
do $$
declare
  filtrados text := '';
  r record;
begin
  for r in
    select grantee
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = 'app_create_community'
      and grantee <> 'app_runtime'
    group by grantee
  loop
    if r.grantee = 'PUBLIC' then
      filtrados := filtrados || 'PUBLIC ';
    elsif r.grantee in ('anon', 'authenticated') then
      filtrados := filtrados || r.grantee || ' ';
    end if;
  end loop;

  if filtrados <> '' then
    raise exception
      'app_create_community() tambien se puede ejecutar como: %', filtrados;
  end if;

  raise notice 'OK · solo app_runtime puede ejecutar app_create_community()';
end $$;

-- ----------------------------------------------------------------------------
-- 9. Buckets de Storage
-- ----------------------------------------------------------------------------
do $$
declare
  b record;
begin
  for b in
    select id, public from storage.buckets
    where id in ('community-documents', 'user-avatars')
  loop
    if b.public then
      raise exception 'El bucket % es PÚBLICO: los documentos quedarían expuestos', b.id;
    end if;
  end loop;

  if not exists (select 1 from storage.buckets where id = 'community-documents') then
    raise exception 'Falta el bucket community-documents';
  end if;
  if not exists (select 1 from storage.buckets where id = 'user-avatars') then
    raise exception 'Falta el bucket user-avatars';
  end if;

  raise notice 'OK · buckets creados y privados';
end $$;

-- ----------------------------------------------------------------------------
-- 10. INFORME
-- ----------------------------------------------------------------------------
-- Resumen legible del estado del esquema.
select 'Tablas'          as comprobacion, count(*)::text as valor
from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'ENUMs', count(*)::text
from pg_type t join pg_namespace ns on ns.oid = t.typnamespace
where ns.nspname = 'public' and t.typtype = 'e'
union all
select 'Índices', count(*)::text from pg_indexes where schemaname = 'public'
union all
select 'Tablas con RLS (enable)', count(*)::text
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
union all
select 'Tablas con RLS (force)', count(*)::text
from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
where ns.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
union all
select 'Grants a anon/authenticated (debe ser 0)', count(*)::text
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
union all
select 'Políticas', count(*)::text from pg_policies where schemaname = 'public'
union all
select 'Funciones', count(*)::text
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
union all
select 'Funciones de auth (debe ser 3)', count(*)::text
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.proname in (
    'app_auth_find_user_by_email',
    'app_auth_find_session_by_hash',
    'app_auth_revoke_family'
  )
union all
select 'Grants de auth a PUBLIC (debe ser 0)', count(*)::text
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name in (
    'app_auth_find_user_by_email',
    'app_auth_find_session_by_hash',
    'app_auth_revoke_family'
  )
  and grantee = 'PUBLIC'
union all
select 'Buckets', count(*)::text from storage.buckets
union all
select 'Versión Postgres', version();

-- ============================================================================
-- PRÓBASAS MANUALES DE RLS
-- ============================================================================
-- Lo anterior verifica que las políticas EXISTEN. Para verificar que FUNCIONAN,
-- hay que impersonar el rol de la aplicación con datos reales. Guárdalo como
-- archivo aparte (no lo ejecutes aquí: necesita datos de prueba).
--
-- Consulta de contexto rápido, desde la sesión postgres del SQL Editor.
-- Remember: como postgres tienes BYPASSRLS, así que aquí verás todas las filas.
-- Eso es lo esperado.
--
--   select
--     app_current_user_id()      as usuario_contexto,
--     app_current_community_id() as comunidad_contexto,
--     current_user               as rol_conexion;
--
-- Para probar de verdad:
--   1. npm run seed  (crea 2 comunidades con usuarios de cada rol)
--   2. Abrir una sesión psql y conectar con el usuario app_runtime
--   3. BEGIN;
--      SET LOCAL app.current_user_id      = '<uuid del vecino de la comunidad A>';
--      SET LOCAL app.current_community_id = '<uuid de la comunidad A>';
--      SELECT count(*) FROM incidents;        -- solo los de la A
--      SELECT count(*) FROM expenses;         -- 0: es ADMIN-only
--      COMMIT;
--   4. Repetir con un id de la comunidad B y comprobar que los recuentos no
--      se solapan.
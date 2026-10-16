-- =============================================================================
-- 02o — Bloque 14: Notificaciones
-- =============================================================================
--
-- Generacion de eventos (cross-cutting) para la campana de la aplicacion. Este
-- archivo NO crea tablas: `notifications` y el enum `notification_type` ya estan
-- en 01_schema.sql (§4.17 y §2) y su politica `notifications_own` en 02_rls
-- (§5.17). Aqui van SOLO las funciones que insertan.
--
-- Por que una funcion y no un INSERT desde el backend (NTF-1):
--
--   * La politica de `notifications` es `user_id = app_current_user_id()`: un
--     INSERT hecho por `app_runtime` solo puede crear notificaciones PARA SI
--     MISMO. Notificar a OTRO (al ADMIN cuando un vecino abre una incidencia)
--     es imposible por esa via, y esa es la mitad de los casos.
--   * Un `SECURITY DEFINER` corre como su propietario (el rol de migracion,
--     `postgres`). La RLS esta con ENABLE y FORCE, pero `force` solo somete al
--     dueño a las politicas; `postgres` tiene BYPASSRLS y las salta, asi que la
--     funcion puede insertar para cualquier usuario.
--   * Al vivir la llamada DENTRO de la funcion de escritura que ya existia
--     (app_create_incident, app_publish_vote...), la notificacion se inserta en
--     la MISMA transaccion que el hecho: o salen las dos cosas, o ninguna. No
--     hay notificaciones de incidencias que no llegaron a crearse.
--
-- Por que `volatile` (y no `stable` como el dashboard): estas funciones
-- ESCRIBEN. Declararlas `stable` las romperia en tiempo de ejecucion con 0A000
-- en cuanto se llamaran. La autocomprobacion de abajo lo exige, por la leccion
-- de los bloques 11 y 12.
--
-- Audiencia (NTF-4): *direccion* = ADMIN + PRESIDENT activos; *difusion* = todos
-- los miembros ACTIVE con rol distinto de PROVIDER (un proveedor no es un vecino,
-- mismo criterio que DSH-8). El actor se excluye siempre via p_exclude_user_id.
--
-- Orden interno: 1) funciones  2) permisos  3) autocomprobacion.
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. La primitiva: una notificacion
-- ----------------------------------------------------------------------------
-- `p_user_id` nullable a proposito: las funciones de abajo recorren conjuntos y
-- puede tocarles un nulo (p. ej. una incidencia sin reportero). En vez de
-- obligar a cada llamante a comprobarlo, el nulo se convierte aqui en "no
-- notifiques" y se devuelve null. Un destinatario nulo nunca es un error.
create or replace function app_notify(
  p_user_id      uuid,
  p_community_id uuid,
  p_type         notification_type,
  p_title        text,
  p_body         text default null,
  p_payload      jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  insert into notifications (user_id, community_id, type, title, body, payload)
  values (
    p_user_id,
    p_community_id,
    p_type,
    btrim(p_title),
    nullif(btrim(p_body), ''),
    p_payload
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Direccion (ADMIN + PRESIDENT activos)
-- ----------------------------------------------------------------------------
-- Una fila por destinatario, saltando a `p_exclude_user_id` (el actor). Devuelve
-- el numero de notificaciones creadas, que es lo que comprueban los tests.
create or replace function app_notify_leadership(
  p_community_id    uuid,
  p_type            notification_type,
  p_title           text,
  p_body            text default null,
  p_payload         jsonb default null,
  p_exclude_user_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  r       record;
begin
  for r in
    select m.user_id
      from community_members m
     where m.community_id = p_community_id
       and m.status = 'ACTIVE'
       and m.role in ('ADMIN', 'PRESIDENT')
       and (p_exclude_user_id is null or m.user_id <> p_exclude_user_id)
  loop
    perform app_notify(r.user_id, p_community_id, p_type, p_title, p_body, p_payload);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Difusion (todos los ACTIVE menos PROVIDER)
-- ----------------------------------------------------------------------------
create or replace function app_notify_community(
  p_community_id    uuid,
  p_type            notification_type,
  p_title           text,
  p_body            text default null,
  p_payload         jsonb default null,
  p_exclude_user_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  r       record;
begin
  for r in
    select m.user_id
      from community_members m
     where m.community_id = p_community_id
       and m.status = 'ACTIVE'
       and m.role <> 'PROVIDER'
       and (p_exclude_user_id is null or m.user_id <> p_exclude_user_id)
  loop
    perform app_notify(r.user_id, p_community_id, p_type, p_title, p_body, p_payload);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Permisos
-- ----------------------------------------------------------------------------
-- `app_runtime` ejecuta las tres; `PUBLIC` ninguna. Normalmente se llaman desde
-- otras funciones SECURITY DEFINER (que ya corren como `postgres`), pero el
-- EXECUTE a `app_runtime` se concede igual: mantiene el patron del proyecto y no
-- expone nada que la RLS no acote ya (app_notify solo INSERTA, no lee).
grant execute on function app_notify(uuid, uuid, notification_type, text, text, jsonb) to app_runtime;
grant execute on function app_notify_leadership(uuid, notification_type, text, text, jsonb, uuid) to app_runtime;
grant execute on function app_notify_community(uuid, notification_type, text, text, jsonb, uuid) to app_runtime;

revoke execute on function app_notify(uuid, uuid, notification_type, text, text, jsonb) from public;
revoke execute on function app_notify_leadership(uuid, notification_type, text, text, jsonb, uuid) from public;
revoke execute on function app_notify_community(uuid, notification_type, text, text, jsonb, uuid) from public;

-- ----------------------------------------------------------------------------
-- 5. Autocomprobacion
-- ----------------------------------------------------------------------------
-- Aplicar sin error no demuestra nada: sin `security definer`, declaradas
-- `stable` (romperian con 0A000 al escribir) o concedidas a PUBLIC, el archivo
-- se aplicaria igual de limpio y el fallo entraría en silencio.
do $$
declare
  v_fallos text := '';
  v_nombre text;
  r        record;
begin
  foreach v_nombre in array array[
    'app_notify', 'app_notify_leadership', 'app_notify_community'
  ]
  loop
    select p.prosecdef, p.proconfig, p.provolatile
      into r
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nombre
     limit 1;

    if r is null then
      v_fallos := v_fallos || ' falta ' || v_nombre || '();';
      continue;
    end if;

    if not r.prosecdef then
      v_fallos := v_fallos || ' ' || v_nombre || ' ya no es SECURITY DEFINER;';
    end if;

    if r.proconfig is null
       or not exists (
         select 1 from unnest(r.proconfig) as c where c like 'search\_path=%'
       )
    then
      v_fallos := v_fallos || ' ' || v_nombre || ' necesita search_path fijo;';
    end if;

    -- Escriben: tienen que ser VOLATILE. `s` (stable) o `i` (immutable) aqui
    -- seria el bug de 0A000 de los bloques 11 y 12.
    if r.provolatile <> 'v' then
      v_fallos := v_fallos || ' ' || v_nombre || ' debe ser VOLATILE (escribe);';
    end if;
  end loop;

  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('app_notify', 'app_notify_leadership', 'app_notify_community')
       and grantee = 'PUBLIC'
  ) then
    v_fallos := v_fallos || ' alguna funcion de notificaciones sigue siendo ejecutable por PUBLIC;';
  end if;

  if v_fallos <> '' then
    raise exception 'El bloque de notificaciones no es seguro:%', v_fallos;
  end if;

  raise notice 'OK · Notificaciones: app_notify, app_notify_leadership y app_notify_community SECURITY DEFINER, VOLATILE, con search_path fijo y no ejecutables por PUBLIC.';
end $$;

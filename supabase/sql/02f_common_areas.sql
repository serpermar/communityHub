-- =============================================================================
-- 02f — Bloque 05: zonas comunes
-- =============================================================================
--
-- El catálogo. Aquí NO se cambia el modelo: `01_schema.sql` ya trae la tabla
-- completa, con los dos CHECK que hacen falta (`slot_minutes` en el enum de
-- rejilla y `close_time > open_time`) y el índice único del nombre por
-- comunidad. Lo único que se añade es el CHECK de longitud de `name`.
--
-- La decisión de fondo de este archivo es la misma que la de 02e, y por los
-- mismos motivos:
--
--   * La política `areas_admin_write` de 02_rls.sql comprueba que el actor es
--     ADMIN, y eso es lo único que comprueba. No puede traducir la violación
--     de `common_areas_community_name_uidx` a un 409 con mensaje, no puede
--     validar el enum de `slot_minutes` con un error legible, y no distingue
--     un PUT completo de un UPDATE de un campo.
--   * El `grant insert, update, delete on common_areas` de 02_rls.sql (5.19)
--     sigue vivo aunque la política desaparezca: quitarlo de la lista no
--     deshace un GRANT ya aplicado.
--
-- Por eso: la política de escritura se borra, el permiso se revoca, y las dos
-- escrituras (crear, reconfigurar) entran por funciones SECURITY DEFINER. El
-- SELECT se queda tal cual: `areas_select_member` ya es exactamente el
-- predicado de CA-1 (lee cualquier miembro activo).
--
-- Orden interno:  1) CHECK de longitud  2) contexto y lecturas  3) escrituras
--                 4) políticas  5) permisos  6) autocomprobación
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Longitud del nombre
-- ----------------------------------------------------------------------------
--
-- El índice único protege contra duplicados, no contra el vacío: un name de un
-- carácter ("·") es técnicamente válido y no debería serlo.
--
-- `not valid` a propósito, mismo criterio que el bloque 04: no revalida las
-- filas existentes, lo que permite añadir la restricción con la tabla llena, y
-- a partir de ahí toda fila nueva pasa por el CHECK. El backend lo duplica en
-- zod (2-80) porque no puede leer las constraints; si los dos sitios dijeran
-- números distintos, el que fallara primero sería el que se comprueba antes.
do $$
begin
  alter table common_areas
    add constraint common_areas_name_length
    check (char_length(name) between 2 and 80) not valid;
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Contexto de la ruta
-- ----------------------------------------------------------------------------

-- A qué comunidad pertenece una zona, o NULL si el actor no puede verla.
--
-- Es la pieza que necesitan `PUT /common-areas/:id` y
-- `GET /common-areas/:id/availability`: dos rutas sin `communityId` en la URL,
-- el caso que la spec 04 §11 dejó anotado como riesgo abierto para este bloque.
--
-- No filtra por `is_active`: una zona dada de baja sigue siendo consultable por
-- su comunidad (CA-3), y el PUT es justo lo que la reactiva. El NULL se
-- traduce en 404 y nunca en 403, por el mismo motivo que C-8: un 403
-- confirmaría que ese id existe.
--
-- SELECT en lugar de EXCEPTION para no abortar la transacción: se usa desde
-- consultas que pueden no encontrar nada, y una excepción PostgreSQL aborta la
-- transacción en curso salvo que el backend la capture con un savepoint.
create or replace function app_common_area_community(p_area uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.community_id
    from common_areas a
   where a.id = p_area
     and app_is_member_of(a.community_id)
$$;

-- ----------------------------------------------------------------------------
-- 3. Lecturas
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 3.1 Listado de las zonas de una comunidad
-- ----------------------------------------------------------------------------
--
-- Cualquier miembro activo lee, sin filtro de rol (CA-1). Devuelve TODAS las
-- zonas, `is_active` incluido: el ADMIN necesita ver las dadas de baja para
-- reactivarlas, y al vecino no le hace daño saber que la sala cerró. Quien
-- decide qué reservas admite una zona dada de baja es la spec 06 (R-7), no
-- este listado.
create or replace function app_list_common_areas(p_community_id uuid)
returns table (
  id                     uuid,
  community_id           uuid,
  name                   text,
  type                   common_area_type,
  description            text,
  capacity               integer,
  slot_minutes           integer,
  open_time              time,
  close_time             time,
  max_daily_reservations integer,
  requires_approval      boolean,
  is_active              boolean,
  created_by             uuid,
  created_at             timestamptz,
  updated_at             timestamptz
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

  -- Un miembro de otra comunidad recibe 403 y no una lista vacía: decir
  -- "no hay zonas" a quien no es miembro confirmaría que esa comunidad existe.
  if not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select a.id, a.community_id, a.name, a.type, a.description,
         a.capacity, a.slot_minutes, a.open_time, a.close_time,
         a.max_daily_reservations, a.requires_approval, a.is_active,
         a.created_by, a.created_at, a.updated_at
    from common_areas a
   where a.community_id = p_community_id
   order by a.name asc, a.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3.2 Detalle de una zona
-- ----------------------------------------------------------------------------
--
-- Una fila con el mismo predicado que app_common_area_community: no encontrarla
-- y no verla son el mismo 404 (C-8). La API no expone GET /common-areas/:id
-- como endpoint aparte —ARCHITECTURE.md §6 no lo lista—; este sirve para que
-- el PUT responda con la zona leída y para los tests.
create or replace function app_get_common_area(p_area uuid)
returns table (
  id                     uuid,
  community_id           uuid,
  name                   text,
  type                   common_area_type,
  description            text,
  capacity               integer,
  slot_minutes           integer,
  open_time              time,
  close_time             time,
  max_daily_reservations integer,
  requires_approval      boolean,
  is_active              boolean,
  created_by             uuid,
  created_at             timestamptz,
  updated_at             timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.community_id, a.name, a.type, a.description,
         a.capacity, a.slot_minutes, a.open_time, a.close_time,
         a.max_daily_reservations, a.requires_approval, a.is_active,
         a.created_by, a.created_at, a.updated_at
    from common_areas a
   where a.id = p_area
     and app_common_area_community(a.id) is not null
$$;

-- ----------------------------------------------------------------------------
-- 3.3 Disponibilidad de un día
-- ----------------------------------------------------------------------------
--
-- La función que sostiene GET /common-areas/:id/availability?date (CA-7, D-2).
--
-- LA REGLA CENTRAL: el estado de un slot sale de `area_slots`, sin unir
-- `reservations` y sin interpretar estados. Los slots solo existen para
-- reservas confirmadas (spec 06 R-2: las PENDING no escriben slots), así que
-- la existencia de la fila de slot YA es la ocupación. Una sola verdad, la
-- misma que defiende el índice único, y no hay nada que sincronizar.
--
-- La rejilla se calcula en la TIMEZONE DE LA COMUNIDAD (D-3): open_time y
-- close_time son hora de pared, y a las 10:00 de Valencia la piscina está
-- abierta aunque en UTC sean las 08:00. Cada slot es "medianoche local de
-- p_date + open_time + n × slot_minutes".
--
-- Devuelve también slot_minutes, open_time, close_time y date para que el
-- cliente dibuje la rejilla sin una segunda llamada a la zona: sin ellos, un
-- frontend tendría que abrir dos peticiones por cada día que mire.
--
-- No devuelve userId, userName ni notes de nadie: la disponibilidad dice "libre
-- u ocupado", no "de quién". El detalle está en el listado de reservas.
--
-- La zona dada de baja SÍ devuelve su rejilla (200): la disponibilidad es
-- informativa; la prohibición de reservar sobre ella está en la spec 06.
create or replace function app_get_area_availability(
  p_area uuid,
  p_date date
)
returns table (
  slot_start   timestamptz,
  slot_end     timestamptz,
  status       text,
  slot_minutes integer,
  open_time    time,
  close_time   time,
  date         date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_slot      integer;
  v_open      time;
  v_close     time;
  v_tz        text;
  v_midnight  timestamptz;
  v_open_ts   timestamptz;
  v_close_ts  timestamptz;
  v_step      interval;
begin
  v_community := app_common_area_community(p_area);

  if v_community is null then
    raise exception 'area_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if p_date is null then
    raise exception 'area_date_required: la fecha es obligatoria' using errcode = '22023';
  end if;

  select a.slot_minutes, a.open_time, a.close_time, c.timezone
    into v_slot, v_open, v_close, v_tz
    from common_areas a
    join communities c on c.id = a.community_id
   where a.id = p_area;

  -- Medianoche local de p_date convertida a instante. `p_date::timestamp at
  -- time zone v_tz` interpreta la fecha como hora local de esa zona y devuelve
  -- timestamptz, que es lo que necesita el resto de los cálculos.
  v_midnight := p_date::timestamp at time zone v_tz;
  v_open_ts  := v_midnight + v_open::interval;
  v_close_ts := v_midnight + v_close::interval;
  v_step     := v_slot * interval '1 minute';

  -- CA-11 garantiza close > open (CHECK de la tabla), así que v_close_ts > v_open_ts
  -- siempre y el generate_series no puede salirse al revés.
  return query
  select
    s.ts,
    s.ts + v_step,
    case
      when exists (
        select 1
          from area_slots sl
         where sl.common_area_id = p_area
           and sl.starts_at < s.ts + v_step
           and sl.ends_at   > s.ts
      ) then 'OCCUPIED'
      else 'FREE'
    end,
    v_slot,
    v_open,
    v_close,
    p_date
    from generate_series(v_open_ts, v_close_ts - v_step, v_step) as s(ts);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Escrituras
-- ----------------------------------------------------------------------------
--
-- Las dos pasan por funciones porque la política `areas_admin_write` solo
-- comprueba el rol (§ cabecera). Ambas exigen ADMIN DENTRO de la transacción:
-- el guard de la ruta es la primera capa, la función es la que manda.

-- ----------------------------------------------------------------------------
-- 4.1 Crear una zona
-- ----------------------------------------------------------------------------
--
-- CA-1: solo ADMIN de la comunidad. Un PRESIDENT recibe 403 aquí, igual que en
-- el PUT, porque "Gestionar zonas comunes" es de ADMIN único en la matriz de
-- ARCHITECTURE.md §5.
--
-- El nombre duplicado NO se comprueba con un SELECT previo: se deja pasar y la
-- violación de common_areas_community_name_uidx (23505) la traduce el backend
-- a un 409, igual que el slug en el bloque 02. Entre el SELECT y el INSERT de
-- dos altas simultáneas cabría una carrera, y el índice único es el que no la
-- tiene.
create or replace function app_create_common_area(
  p_community_id           uuid,
  p_name                   text,
  p_type                   common_area_type,
  p_description            text,
  p_capacity               integer,
  p_slot_minutes           integer,
  p_open_time              time,
  p_close_time             time,
  p_max_daily_reservations integer,
  p_requires_approval      boolean,
  p_is_active              boolean
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
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'forbidden_role: solo un ADMIN puede gestionar las zonas comunes'
      using errcode = '42501';
  end if;

  if p_name is null then
    raise exception 'area_name_required: el nombre es obligatorio' using errcode = '22023';
  end if;

  insert into common_areas (
    community_id, name, type, description, capacity, slot_minutes,
    open_time, close_time, max_daily_reservations, requires_approval,
    is_active, created_by
  )
  values (
    p_community_id,
    btrim(p_name),
    coalesce(p_type, 'OTHER'),
    nullif(btrim(p_description), ''),
    p_capacity,
    coalesce(p_slot_minutes, 60),
    coalesce(p_open_time, '08:00'::time),
    coalesce(p_close_time, '22:00'::time),
    p_max_daily_reservations,
    coalesce(p_requires_approval, false),
    coalesce(p_is_active, true),
    app_current_user_id()
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    -- El nombre duplicado llega del indice, y aqui es donde se le pone cara
    -- (spec 05 7.5): un 23505 sin sentinel seria un 409 generico que no dice
    -- que campo ha chocado. Solo si choca ESTE indice; cualquier otro 23505 se
    -- propaga para no enmascarar un bug como si fuera un nombre repetido.
    if SQLERRM like '%common_areas_community_name_uidx%' then
      raise exception 'area_name_taken: ya existe una zona con ese nombre en esta comunidad'
        using errcode = '23505';
    end if;
    raise;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.2 Reconfigurar una zona (PUT)
-- ----------------------------------------------------------------------------
--
-- CA-4: reemplazo completo de la configuración, como el PUT de incidencias.
-- Los once parámetros son el valor nuevo; p_description nulo borra la
-- descripción. Ni community_id ni created_by se aceptan: la comunidad la decide
-- la zona (se lee de la fila) y el autor no se reescribe.
--
-- CA-9: el slot_minutes nuevo NO reescribe area_slots. Los slots son filas
-- históricas de "quién tenía la zona a las 10:00"; recalcularlos con otra
-- rejilla destruiría la ocupación pasada. Este UPDATE ni siquiera menciona la
-- tabla de slots, y esa es toda la garantia que hace falta.
create or replace function app_update_common_area(
  p_area                    uuid,
  p_name                    text,
  p_type                    common_area_type,
  p_description             text,
  p_capacity                integer,
  p_slot_minutes            integer,
  p_open_time               time,
  p_close_time              time,
  p_max_daily_reservations  integer,
  p_requires_approval       boolean,
  p_is_active               boolean
)
returns setof common_areas
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  v_community := app_common_area_community(p_area);

  if v_community is null then
    raise exception 'area_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_admin_of(v_community) then
    raise exception 'forbidden_role: solo un ADMIN puede gestionar las zonas comunes'
      using errcode = '42501';
  end if;

  if p_name is null then
    raise exception 'area_name_required: el nombre es obligatorio' using errcode = '22023';
  end if;

  update common_areas
     set name                   = btrim(p_name),
         type                   = p_type,
         description            = nullif(btrim(p_description), ''),
         capacity               = p_capacity,
         slot_minutes           = p_slot_minutes,
         open_time              = p_open_time,
         close_time             = p_close_time,
         max_daily_reservations = p_max_daily_reservations,
         requires_approval      = p_requires_approval,
         is_active              = p_is_active
   where id = p_area;

  -- La fila leída al final pasa por el mismo predicado de visibilidad, así que
  -- la respuesta es la verdad y no una suposicion construida con los
  -- parametros de entrada.
  return query
  select a.* from common_areas a where a.id = p_area;
exception
  when unique_violation then
    -- Mismo traductor que en el alta: el PUT puede chocar contra el mismo
    -- indice unico del nombre, y el par (sentinel, errcode) es lo que permite
    -- al backend devolver un 409 que nombra el campo.
    if SQLERRM like '%common_areas_community_name_uidx%' then
      raise exception 'area_name_taken: ya existe una zona con ese nombre en esta comunidad'
        using errcode = '23505';
    end if;
    raise;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Políticas RLS
-- ----------------------------------------------------------------------------
--
-- common_areas se queda SOLO con la de SELECT. La de escritura se borra, y no
-- se sustituye por una versión más restrictiva: sin permiso de INSERT, UPDATE
-- ni DELETE para app_runtime no hay nada que una política pueda decidir, y
-- dejarla puesta daría la sensación de que el rol ya está cubierto.
--
-- La política de SELECT no se toca: areas_select_member ya es el predicado de
-- CA-1 (cualquier miembro activo, sin distinguir rol).
drop policy if exists areas_admin_write on common_areas;

-- ----------------------------------------------------------------------------
-- 6. Permisos
-- ----------------------------------------------------------------------------
--
-- El revoke es la pieza imprescindible, no decorativa: 02_rls.sql (5.19) dio
-- `insert, update, delete on ... common_areas ...` a app_runtime y ese GRANT
-- sigue vivo aunque la política desaparezca. Quitarlo de la lista de 02_rls no
-- lo deshace; hay que revocarlo. Y se repite contra anon, authenticated por
-- simetría con 02e (aunque 02_rls ya les haya quitado todo: revocar dos veces
-- no cuesta nada y el segundo revoke sobrevive a un `alter default privileges`
-- futuro que pudiera re conceder algo).
revoke insert, update, delete on common_areas from app_runtime;
revoke insert, update, delete on common_areas from anon, authenticated;

grant execute on function app_common_area_community(uuid) to app_runtime;
grant execute on function app_list_common_areas(uuid) to app_runtime;
grant execute on function app_get_common_area(uuid) to app_runtime;
grant execute on function app_get_area_availability(uuid, date) to app_runtime;
grant execute on function app_create_common_area(uuid, text, common_area_type, text, integer, integer, time, time, integer, boolean, boolean) to app_runtime;
grant execute on function app_update_common_area(uuid, text, common_area_type, text, integer, integer, time, time, integer, boolean, boolean) to app_runtime;

-- El revoke va de PUBLIC y no de anon/authenticated a propósito: revocar del
-- grupo PUBLIC los cubre a todos de una vez. Mismo criterio que 02b, 02c, 02d
-- y 02e.
revoke execute on function app_common_area_community(uuid) from public;
revoke execute on function app_list_common_areas(uuid) from public;
revoke execute on function app_get_common_area(uuid) from public;
revoke execute on function app_get_area_availability(uuid, date) from public;
revoke execute on function app_create_common_area(uuid, text, common_area_type, text, integer, integer, time, time, integer, boolean, boolean) from public;
revoke execute on function app_update_common_area(uuid, text, common_area_type, text, integer, integer, time, time, integer, boolean, boolean) from public;

-- ----------------------------------------------------------------------------
-- 7. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Que este archivo se ejecute sin errores no demuestra nada: si alguien lo
-- reescribe y se le olvida el `security definer` o se le olvida revocar un
-- permiso, el archivo se aplicaría igual de limpio y el agujero se instalaría
-- solo. Estas comprobaciones son las que fallan en `db:verify`.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las seis funciones: SECURITY DEFINER, search_path fijo y no ejecutables
  -- por PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_common_area_community', 'app_list_common_areas',
         'app_get_common_area', 'app_get_area_availability',
         'app_create_common_area', 'app_update_common_area'
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

  -- Y que las seis estén. El bucle anterior no falla si no hay ninguna.
  for r in
    select unnest(array[
      'app_common_area_community', 'app_list_common_areas',
      'app_get_common_area', 'app_get_area_availability',
      'app_create_common_area', 'app_update_common_area'
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

  -- common_areas: solo lectura desde RLS. Cualquier política de escritura
  -- reabre el camino que D-1 cierra.
  if exists (
    select 1
      from pg_policies
     where tablename = 'common_areas'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' common_areas tiene politica de escritura; deberia ser solo lectura;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'common_areas'
       and policyname = 'areas_select_member'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta areas_select_member de SELECT;';
  end if;

  -- Y que el permiso de escritura no exista para nadie, no solo para
  -- app_runtime. Se excluyen postgres (owner) y service_role (recibe todos los
  -- privilegios por ALTER DEFAULT PRIVILEGES de Supabase), igual que en 02e.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'common_areas'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' common_areas tiene INSERT/UPDATE/DELETE concedido a un rol que no debe;';
  end if;

  -- El CHECK de longitud de la sección 1, y si alguien lo validó ya.
  if not exists (
    select 1
      from pg_constraint
     where conname = 'common_areas_name_length'
       and conrelid = 'public.common_areas'::regclass
       and contype = 'c'
  ) then
    v_fallos := v_fallos || ' falta common_areas_name_length;';
  end if;

  if exists (
    select 1
      from pg_constraint
     where conname = 'common_areas_name_length'
       and conrelid = 'public.common_areas'::regclass
       and convalidated = false
  ) then
    raise notice 'AVISO: common_areas_name_length existe pero sigue sin validar (not valid).';
  end if;

  -- El índice único del nombre (CA-2). Ya se comprobaba en la sección 5 de
  -- 04_verify.sql; se repite aquí para que la autocomprobación del archivo sea
  -- completa por sí sola.
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'common_areas_community_name_uidx'
       and i.indisunique
  ) then
    v_fallos := v_fallos || ' falta common_areas_community_name_uidx unico;';
  end if;

  if v_fallos <> '' then
    raise exception 'Las zonas comunes no son seguras:%', v_fallos;
  end if;

  raise notice 'OK: common_areas solo lectura, dos escrituras por funcion, seis funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC.';
end $$;

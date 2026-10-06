-- =============================================================================
-- 02g — Bloque 06: reservas
-- =============================================================================
--
-- El corazón del modelo de reservas. Tres ideas, ya decididas en la spec 06:
--
--   * R-6 — El solape NO se comprueba. No hay `select ... where overlaps` antes
--     del `insert`: entre ese select y ese insert caben dos peticiones
--     concurrentes en la piscina, y la segunda entraría creyendo que el hueco
--     está libre. La única autoridad es `area_slots_no_overlap_uidx`
--     (`unique (common_area_id, starts_at)` SIN condición): dos reservas que
--     disputen el mismo bloque revientan en el motor, una gana y la otra
--     recibe 409. Es el patrón de "dejar que el índice decida".
--
--   * R-4 — Cancelar no es `update status`. Los slots son el calendario: si la
--     cancelación no los borra, la piscina queda bloqueada para siempre. Por eso
--     crear, confirmar y cancelar son TRES funciones, y `app_runtime` pierde
--     insert/update/delete sobre `reservations` y `area_slots`. No hay forma de
--     llegar a un `UPDATE` de status por la API.
--
--   * R-5 — El SELECT de RLS se recrea más ancho (todas las filas de la
--     comunidad, no solo las propias) porque la API de listado lo pide, y la
--     redacción de `notes` vive en las funciones de lectura: RLS no redacta
--     columnas, solo filas.
--
-- Orden interno:  1) visibilidad  2) escrituras  3) lecturas  4) políticas
--                 5) permisos  6) autocomprobación
--
-- Requiere 02f (app_common_area_community) y 02_rls (app_is_member_of,
-- app_role_in, app_is_admin_of, app_current_user_id) ejecutados antes.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. El predicado de visibilidad, en un solo sitio
-- ----------------------------------------------------------------------------
--
-- R-5 aparece en tres lecturas y en las dos escrituras por id. Escrito tres
-- veces, podría divergir; escrito una vez, no.

-- true si el actor puede ver la reserva `target`.
--
-- Es MÁS ANCHO que app_can_see_incident, y a propósito: R-5 no filtra por
-- dueño para la visibilidad de la fila (cualquier miembro ve las reservas de
-- su comunidad), solo para la redacción de notes, que es una capa aparte
-- (sección 3). El filtro por autor viviría en dos sitios y se olvidaría del
-- tercero.
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

-- La comunidad de la reserva, solo si es visible para el actor; NULL si no.
--
-- Es la pieza de PATCH /reservations/:id/cancel, POST .../confirm y
-- GET /reservations/:id: tres rutas sin comunidad en la URL (spec 06 §4c).
-- Se comporta como app_incident_community: NULL → 404, nunca 403, porque un
-- 403 confirmaría que ese id existe.
create or replace function app_reservation_community(p_reservation uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.community_id
    from reservations r
   where r.id = p_reservation
     and app_can_see_reservation(r.id)
$$;

-- ----------------------------------------------------------------------------
-- 2. Escrituras
-- ----------------------------------------------------------------------------
--
-- Las tres devuelven void o el id, nunca la fila: la respuesta se construye
-- con app_get_reservation() después, dentro de la misma transacción, para que
-- solo haya UNA forma de leer una reserva (y esa forma ya redacta notes).

-- ----------------------------------------------------------------------------
-- 2.1 Crear una reserva
-- ----------------------------------------------------------------------------
--
-- La función más densa del bloque. Las guardas van de la más genérica a la más
-- específica, para que quien llama vea siempre el error más informativo: un
-- PROVIDER que intenta reservar a la vez que pone una hora pasada debe recibir
-- el 403 del rol, no el 400 de la hora.
--
-- No hay parámetro para user_id ni community_id: el usuario es el de la sesión
-- y la comunidad la decide la zona. Tampoco para status: nace de
-- requires_approval de la zona (R-2), y aceptar status del cliente sería
-- saltarse el flujo de aprobación por un JSON.
create or replace function app_create_reservation(
  p_common_area uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_attendees   integer,
  p_notes       text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community     uuid;
  v_active        boolean;
  v_capacity      integer;
  v_slot          integer;
  v_open          time;
  v_close         time;
  v_max_daily     integer;
  v_requires      boolean;
  v_tz            text;
  v_role          member_role;
  v_local_start   timestamp;
  v_local_end     timestamp;
  v_sec_start     numeric;
  v_sec_end       numeric;
  v_local_day     date;
  v_daily_count   integer;
  v_status        reservation_status;
  v_id            uuid;
  v_step          interval;
  v_slots         integer;
begin
  -- 1. Sesión. Sin ella no hay app_current_user_id() y TODAS las guardas de
  -- abajo devolverían "no encontrado" o "prohibido", que es mentir.
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- 2. Zona visible. Un id de otra comunidad o inexistente es el mismo 404:
  -- no se puede distinguir "no existe" de "no es tuya" sin sonar un 403 que
  -- confirmaría que existe.
  v_community := app_common_area_community(p_common_area);

  if v_community is null then
    raise exception 'area_not_found: la zona no existe o no es visible' using errcode = 'P0002';
  end if;

  select a.is_active, a.capacity, a.slot_minutes, a.open_time, a.close_time,
         a.max_daily_reservations, a.requires_approval, c.timezone
    into v_active, v_capacity, v_slot, v_open, v_close,
         v_max_daily, v_requires, v_tz
    from common_areas a
    join communities c on c.id = a.community_id
   where a.id = p_common_area;

  -- 3. Zona activa (CA-3 de la spec 05). La política no lo comprueba, y debe
  -- seguir siendo consultable, así que la prohibición vive aquí.
  if not v_active then
    raise exception 'reservation_area_inactive: la zona está dada de baja' using errcode = '22023';
  end if;

  -- 4. Rol (R-1): solo NEIGHBOR, PRESIDENT y ADMIN reservan. app_role_in ya
  -- exige membresía ACTIVE, así que un suspendido o un PROVIDER reciben 403
  -- aquí sin comprobación adicional.
  v_role := app_role_in(v_community);

  if v_role is null or v_role::text not in ('NEIGHBOR', 'PRESIDENT', 'ADMIN') then
    raise exception 'forbidden_role: su rol no puede reservar' using errcode = '42501';
  end if;

  -- 5. No en el pasado. Se tolera "ahora mismo" (>= now()) porque entre la
  -- validación y el insert siempre pasa un milisegundo.
  if p_starts_at is null or p_starts_at < now() then
    raise exception 'reservation_in_the_past: la reserva debe empezar en el futuro' using errcode = '22023';
  end if;

  -- 6. Orden. El CHECK de la tabla también lo cubre, pero llegar a él es un
  -- 23514 sin contexto. La spec 06 §5.3 no le da sentinel porque zod lo
  -- intercepta antes en el backend (endsAt > startsAt); este es el seguro
  -- por si alguien llama a la función directamente.
  if p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'reservation_invalid_range: el fin debe ser posterior al inicio' using errcode = '22023';
  end if;

  -- 7. Rejilla (CA-5). El epoch desde la medianoche LOCAL, en segundos: si no
  -- es múltiplo exacto de slot_minutes*60, la reserva no encaja en la rejilla
  -- y el índice único no podría detectar solapes parciales (una reserva de
  -- 10:00-11:00 y otra de 10:30-11:30 comparten media hora sin compartir
  -- ningún starts_at). Los microsegundos hacen que el resto sea distinto de
  -- cero, así que la comprobación de "segundos a cero" viene gratis.
  v_local_start := p_starts_at at time zone v_tz;
  v_local_end   := p_ends_at   at time zone v_tz;
  v_sec_start   := extract(epoch from v_local_start::time);
  v_sec_end     := extract(epoch from v_local_end::time);

  if v_sec_start % (v_slot * 60) <> 0 or v_sec_end % (v_slot * 60) <> 0 then
    raise exception 'reservation_misaligned: las horas deben caer en la rejilla de la zona'
      using errcode = '22023';
  end if;

  -- 8. Horario y día local (CA-11). open/close son hora de pared de la
  -- comunidad, no UTC: a las 10:00 de Valencia la piscina está abierta aunque
  -- en UTC sean las 08:00. El mismo día local descarta la franja que cruza
  -- medianoche local —un 22:00→06:00 alineado a rejilla pasaría la comprobación
  -- de horas por separado (06:00 < open lo salva, pero 08:00→08:00+1d no), y
  -- CA-11 prohíbe ese cruce de raíz.
  if v_local_start::date <> v_local_end::date
     or v_local_start::time < v_open
     or v_local_end::time > v_close
  then
    raise exception 'reservation_outside_hours: fuera del horario de la zona' using errcode = '22023';
  end if;

  -- 9. Capacidad. attendees opcional; capacity opcional. Solo cuando AMBOS
  -- existen hay algo que comparar.
  if p_attendees is not null
     and v_capacity is not null
     and p_attendees > v_capacity
  then
    raise exception 'reservation_capacity_exceeded: supera la capacidad de la zona'
      using errcode = '22023';
  end if;

  -- 10. Límite diario. Cuenta solo CONFIRMED (R-7): una PENDING no ocupa el
  -- calendario, y hacer que el trámite de aprobación consumiera plaza
  -- significaría que una cola de aprobación pudiera bloquear un día entero.
  if v_max_daily is not null then
    v_local_day := (p_starts_at at time zone v_tz)::date;

    select count(*)::integer
      into v_daily_count
      from reservations r
     where r.common_area_id = p_common_area
       and r.status = 'CONFIRMED'
       and (r.starts_at at time zone v_tz)::date = v_local_day;

    if v_daily_count >= v_max_daily then
      raise exception 'reservation_daily_limit: límite diario de la zona alcanzado'
        using errcode = '22023';
    end if;
  end if;

  -- 11. Estado inicial: lo decide la zona, no el cliente (R-2, D-1).
  if v_requires then
    v_status := 'PENDING';
  else
    v_status := 'CONFIRMED';
  end if;

  insert into reservations (
    community_id, common_area_id, user_id, starts_at, ends_at,
    status, attendees, notes
  )
  values (
    v_community, p_common_area, app_current_user_id(), p_starts_at, p_ends_at,
    v_status, p_attendees, nullif(p_notes, '')
  )
  returning id into v_id;

  -- 12. Slots solo si nace CONFIRMED. Una reserva PENDING ocupa cero filas de
  -- area_slots: el índice no sabe distinguir "reserva provisional" de
  -- "reserva real", así que el hueco sigue libre hasta que el ADMIN confirme
  -- (R-2, R-3). El INSERT de la reserva ya ocurrió arriba: si este bloque
  -- revienta, la excepción se propaga y la transacción entera se deshace, la
  -- reserva incluida.
  if v_status = 'CONFIRMED' then
    v_step  := v_slot * interval '1 minute';
    -- Alineación garantizada por la guarda 7, así que la división es exacta.
    v_slots := (extract(epoch from (p_ends_at - p_starts_at)) / (60.0 * v_slot))::integer;

    begin
      for i in 0 .. v_slots - 1 loop
        insert into area_slots (common_area_id, reservation_id, starts_at, ends_at)
        values (
          p_common_area,
          v_id,
          p_starts_at + i * v_step,
          p_starts_at + (i + 1) * v_step
        );
      end loop;
    exception
      when unique_violation then
        -- R-6: la ÚNICA forma de disputar un hueco. Solo se traduce si el
        -- índice que revienta es el del solape; cualquier otro 23505 (un id
        -- duplicado, por improbable) se propaga tal cual para no enmascarar
        -- un bug como si fuera un conflicto de agenda.
        if SQLERRM like '%area_slots_no_overlap_uidx%' then
          raise exception 'reservation_slot_taken: el horario ya está ocupado'
            using errcode = '23505';
        end if;
        raise;
    end;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2.2 Confirmar una reserva (solo ADMIN)
-- ----------------------------------------------------------------------------
--
-- R-3, D-2. El orden importa y es al revés de lo que se haría por conveniencia:
-- primero los slots, después el status. Si el hueco ya lo ocupó otra reserva
-- entre que se creó la PENDING y ahora, el 409 revienta aquí y la reserva
-- SIGUE PENDING: el ADMIN la puede cancelar o esperar. Confirmar a medias
-- (slots dentro, status fuera, o al revés) dejaría el sistema mintiendo.
--
-- Sin requireCommunityRole en la ruta: el rol lo decide esta función con la
-- fila delante. Un PRESIDENT recibe 403 aunque sea su comunidad y su reserva.
create or replace function app_confirm_reservation(p_reservation uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_status    reservation_status;
  v_starts    timestamptz;
  v_ends      timestamptz;
  v_area      uuid;
  v_slot      integer;
  v_step      interval;
  v_slots     integer;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_can_see_reservation(p_reservation) then
    raise exception 'reservation_not_found: la reserva no existe o no es visible'
      using errcode = 'P0002';
  end if;

  select r.community_id, r.status, r.starts_at, r.ends_at, r.common_area_id,
         a.slot_minutes
    into v_community, v_status, v_starts, v_ends, v_area, v_slot
    from reservations r
    join common_areas a on a.id = r.common_area_id
   where r.id = p_reservation;

  if not app_is_admin_of(v_community) then
    raise exception 'forbidden_role: solo un ADMIN puede confirmar reservas'
      using errcode = '42501';
  end if;

  -- Confirmar una CONFIRMED no es un no-op silencioso (200 sin efecto es peor
  -- que un error que lo dice), y confirmar una CANCELLED sería revivirla.
  if v_status <> 'PENDING' then
    raise exception 'reservation_not_pending: la reserva no está pendiente' using errcode = '22023';
  end if;

  -- Mismo bucle y mismo traductor que la creación: aquí es donde una reserva
  -- PENDING puede haberse quedado sin hueco mientras esperaba aprobación.
  v_step  := v_slot * interval '1 minute';
  v_slots := (extract(epoch from (v_ends - v_starts)) / (60.0 * v_slot))::integer;

  begin
    for i in 0 .. v_slots - 1 loop
      insert into area_slots (common_area_id, reservation_id, starts_at, ends_at)
      values (
        v_area,
        p_reservation,
        v_starts + i * v_step,
        v_starts + (i + 1) * v_step
      );
    end loop;
  exception
    when unique_violation then
      if SQLERRM like '%area_slots_no_overlap_uidx%' then
        -- La reserva NO se auto-cancela: quien decide si rechazarla o
        -- reprogramarla es el ADMIN que la estaba confirmando.
        raise exception 'reservation_slot_taken: el horario ya está ocupado'
          using errcode = '23505';
      end if;
      raise;
  end;

  update reservations
     set status = 'CONFIRMED'
   where id = p_reservation;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2.3 Cancelar una reserva (dueño o ADMIN)
-- ----------------------------------------------------------------------------
--
-- R-4. UNA sola función porque son tres cambios atómicos: status, cancelled_at
-- y el borrado de los slots. El tercer paso es el que la spec 06 §4b llama "el
-- fallo silencioso más caro": un simple `update status` dejaría la piscina
-- bloqueada para siempre por una reserva que la app dice cancelada.
--
-- El DELETE de area_slots lo ejecuta esta función como dueña de los datos:
-- app_runtime no tiene (ni tendrá) permiso de DELETE sobre esa tabla.
--
-- Se puede cancelar una PENDING: es el rechazo del ADMIN (R-4). Un PRESIDENT
-- recibe 403 en los dos papeles.
create or replace function app_cancel_reservation(p_reservation uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_owner     uuid;
  v_status    reservation_status;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_can_see_reservation(p_reservation) then
    raise exception 'reservation_not_found: la reserva no existe o no es visible'
      using errcode = 'P0002';
  end if;

  select r.community_id, r.user_id, r.status
    into v_community, v_owner, v_status
    from reservations r
   where r.id = p_reservation;

  if not (v_owner = app_current_user_id() or app_is_admin_of(v_community)) then
    raise exception 'forbidden_role: solo el dueño o un ADMIN pueden cancelar'
      using errcode = '42501';
  end if;

  -- Cancelar dos veces es un 409, no un no-op: la segunda no cambiaría nada, y
  -- un 200 que no hace nada dejaría al cliente sin saber si su primera
  -- cancelación llegó.
  if v_status = 'CANCELLED' then
    raise exception 'reservation_already_cancelled: la reserva ya está cancelada'
      using errcode = '22023';
  end if;

  update reservations
     set status = 'CANCELLED',
         cancelled_at = now()
   where id = p_reservation;

  -- Se libera el calendario. Sin este DELETE la reserva seguiría bloqueando su
  -- hueco en area_slots y, como el índice único no tiene condición, nadie
  -- podría reservarlo nunca más.
  delete from area_slots where reservation_id = p_reservation;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Lecturas
-- ----------------------------------------------------------------------------
--
-- Todas SECURITY DEFINER (R-8) porque el SELECT de RLS no puede redactar
-- columnas: devuelve filas enteras o no devuelve nada. La redacción de notes
-- (R-5) es un CASE en estas funciones, y es la ÚNICA vía de lectura de la API.

-- ----------------------------------------------------------------------------
-- 3.1 Listado por comunidad
-- ----------------------------------------------------------------------------
--
-- El community_id de la ruta va en el WHERE como ámbito, no como comprobación
-- (a diferencia de app_list_incidents, que es una sola comunidad pero filtra
-- el alcance por fila): aquí el filtro es el propio where.
--
-- `count(*) over ()` da el total sin paginar en la MISMA pasada, con el mismo
-- motivo que en incidencias: con un COUNT aparte, una página fuera de rango
-- saldría con el total imposible de situar, y en `returns table` el total vive
-- dentro de cada fila.
create or replace function app_list_community_reservations(
  p_community_id uuid,
  p_common_area  uuid              default null,
  p_date         date              default null,
  p_status       reservation_status default null,
  p_limit        integer           default 20,
  p_offset       integer           default 0
)
returns table (
  id               uuid,
  community_id     uuid,
  community_name   text,
  common_area_id   uuid,
  common_area_name text,
  user_id          uuid,
  user_name        text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  status           reservation_status,
  attendees        integer,
  notes            text,
  cancelled_at     timestamptz,
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

  -- Un miembro de otra comunidad recibe 403, no una lista vacía: "no hay
  -- reservas" confirmaría que esa comunidad existe.
  if not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select r.id,
         r.community_id,
         c.name,
         r.common_area_id,
         a.name,
         r.user_id,
         u.full_name,
         r.starts_at,
         r.ends_at,
         r.status,
         r.attendees,
         -- Redacción R-5: el dueño, un ADMIN y un PRESIDENT ven el texto; el
         -- resto, null. La API no distingue "sin notas" de "no te las enseño",
         -- porque la distinción solo beneficiaría a un atacante. Los filtros
         -- de fila de arriba no pueden hacer esto: RLS decide fila a fila y
         -- no sabe escribir en una columna.
         case
           when app_role_in(r.community_id) in ('ADMIN', 'PRESIDENT')
             or r.user_id = app_current_user_id()
           then r.notes
           else null
         end,
         r.cancelled_at,
         r.created_at,
         r.updated_at,
         count(*) over ()
    from reservations r
    join communities c on c.id = r.community_id
    join common_areas a on a.id = r.common_area_id
    join users u on u.id = r.user_id
   where r.community_id = p_community_id
     -- Sin estado: PENDING y CONFIRMED (R-10). Canceladas solo si se piden
     -- explícitamente: la agenda por defecto es lo que va a pasar, no lo que
     -- ya no va a pasar.
     and (p_status is null and r.status in ('PENDING', 'CONFIRMED')
          or r.status = p_status)
     and (p_common_area is null or r.common_area_id = p_common_area)
     -- Día LOCAL de la comunidad (R-10): a las 23:00 de Valencia ya es otro
     -- día en UTC, y la agenda es local.
     and (p_date is null or (r.starts_at at time zone c.timezone)::date = p_date)
   order by r.starts_at asc, r.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3.2 Listado propio (GET /reservations/me)
-- ----------------------------------------------------------------------------
--
-- Mismo esquema que el anterior, sin comunidad en el where: el ámbito es
-- user_id = el de la sesión. Todas las filas son del llamante, así que notes
-- sale SIEMPRE sin redactar, y además salen community_id y community_name
-- (legible para cualquier miembro): con la lista cruzando comunidades, sin el
-- nombre el cliente no sabría qué está mirando.
create or replace function app_list_user_reservations(
  p_status reservation_status default null,
  p_limit  integer            default 20,
  p_offset integer            default 0
)
returns table (
  id               uuid,
  community_id     uuid,
  community_name   text,
  common_area_id   uuid,
  common_area_name text,
  user_id          uuid,
  user_name        text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  status           reservation_status,
  attendees        integer,
  notes            text,
  cancelled_at     timestamptz,
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

  return query
  select r.id,
         r.community_id,
         c.name,
         r.common_area_id,
         a.name,
         r.user_id,
         u.full_name,
         r.starts_at,
         r.ends_at,
         r.status,
         r.attendees,
         r.notes,
         r.cancelled_at,
         r.created_at,
         r.updated_at,
         count(*) over ()
    from reservations r
    join communities c on c.id = r.community_id
    join common_areas a on a.id = r.common_area_id
    join users u on u.id = r.user_id
   where r.user_id = app_current_user_id()
     and (p_status is null and r.status in ('PENDING', 'CONFIRMED')
          or r.status = p_status)
   order by r.starts_at asc, r.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3.3 Detalle
-- ----------------------------------------------------------------------------
--
-- Una fila con el predicado de §1 y la misma redacción que el listado de
-- comunidad: dueño, ADMIN y PRESIDENT ven notes; un tercero recibe null. No
-- encontrarla y no verla son el mismo 404 (§1). Devuelve community_name y
-- common_area_name para que la pantalla de detalle no necesite dos llamadas.
create or replace function app_get_reservation(p_reservation uuid)
returns table (
  id               uuid,
  community_id     uuid,
  community_name   text,
  common_area_id   uuid,
  common_area_name text,
  user_id          uuid,
  user_name        text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  status           reservation_status,
  attendees        integer,
  notes            text,
  cancelled_at     timestamptz,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id,
         r.community_id,
         c.name,
         r.common_area_id,
         a.name,
         r.user_id,
         u.full_name,
         r.starts_at,
         r.ends_at,
         r.status,
         r.attendees,
         case
           when app_role_in(r.community_id) in ('ADMIN', 'PRESIDENT')
             or r.user_id = app_current_user_id()
           then r.notes
           else null
         end,
         r.cancelled_at,
         r.created_at,
         r.updated_at
    from reservations r
    join communities c on c.id = r.community_id
    join common_areas a on a.id = r.common_area_id
    join users u on u.id = r.user_id
   where r.id = p_reservation
     and app_can_see_reservation(r.id)
$$;

-- ----------------------------------------------------------------------------
-- 4. Políticas RLS
-- ----------------------------------------------------------------------------

-- reservations: se elimina la de INSERT (4a), la de UPDATE (4a), la de DELETE
-- (4a: no hay endpoint físico de borrado en toda la API) y se recrea la de
-- SELECT más ancha. Esta recreación ES el cambio de R-5: antes solo veías las
-- tuyas y las de ADMIN/PRESIDENT; ahora ves todas las de tu comunidad. Los
-- permisos de escritura de la sección 5 son los que cierran la puerta de
-- verdad; sin permiso, una política de escritura ni se llega a evaluar.
drop policy if exists reservations_insert_self on reservations;
drop policy if exists reservations_update_scoped on reservations;
drop policy if exists reservations_delete_admin on reservations;
drop policy if exists reservations_select_scoped on reservations;

create policy reservations_select_scoped on reservations
  for select using (app_is_member_of(community_id));

-- area_slots: se elimina la de INSERT y se recrea la de SELECT con el mismo
-- alcance ESTRECHO pero ya sin la condición de autor/rol que tenía: los slots
-- no son datos sensibles por sí mismos (dicen "a las 10:00 hay alguien", no
-- quién ni qué nota puso), y el listado de reservas ya es la API pública de
-- esa información. La pieza que importa aquí es el revoke de INSERT: los
-- slots solo los escribe app_create_reservation/app_confirm_reservation.
drop policy if exists slots_insert_own_reservation on area_slots;
drop policy if exists slots_via_reservation on area_slots;

create policy slots_via_reservation on area_slots
  for select using (
    exists (
      select 1
        from reservations r
       where r.id = reservation_id
         and app_is_member_of(r.community_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Permisos
-- ----------------------------------------------------------------------------
--
-- El revoke es imprescindible, no decorativo: 02_rls §5.19 concedió
-- `insert, update on reservations, area_slots` a app_runtime, y ese GRANT sigue
-- vivo aunque las políticas desaparezcan. Quitarlo de la lista de 02_rls no lo
-- deshace. Con los permisos fuera, no puede haber escritura por PostgREST ni
-- por un error de omisión en una función.
revoke insert, update, delete on reservations, area_slots from app_runtime;
revoke insert, update, delete on reservations, area_slots from anon, authenticated;

grant execute on function app_can_see_reservation(uuid) to app_runtime;
grant execute on function app_reservation_community(uuid) to app_runtime;
grant execute on function app_create_reservation(uuid, timestamptz, timestamptz, integer, text) to app_runtime;
grant execute on function app_confirm_reservation(uuid) to app_runtime;
grant execute on function app_cancel_reservation(uuid) to app_runtime;
grant execute on function app_list_community_reservations(uuid, uuid, date, reservation_status, integer, integer) to app_runtime;
grant execute on function app_list_user_reservations(reservation_status, integer, integer) to app_runtime;
grant execute on function app_get_reservation(uuid) to app_runtime;

revoke execute on function app_can_see_reservation(uuid) from public;
revoke execute on function app_reservation_community(uuid) from public;
revoke execute on function app_create_reservation(uuid, timestamptz, timestamptz, integer, text) from public;
revoke execute on function app_confirm_reservation(uuid) from public;
revoke execute on function app_cancel_reservation(uuid) from public;
revoke execute on function app_list_community_reservations(uuid, uuid, date, reservation_status, integer, integer) from public;
revoke execute on function app_list_user_reservations(reservation_status, integer, integer) from public;
revoke execute on function app_get_reservation(uuid) from public;

-- ----------------------------------------------------------------------------
-- 6. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Aplicar este archivo sin errores no demuestra nada: se puede instalar una
-- función sin security definer, con search_path abierto o con permisos de
-- escritura intactos y el archivo sigue "yendo bien". Estas comprobaciones son
-- las que fallan en `db:verify`, y cubren la lista de aceptación de la spec 06
-- §10.
do $$
declare
  v_fallos text := '';
  r        record;
  v_expr   text;
begin
  -- Las ocho funciones: SECURITY DEFINER, search_path fijo, no PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_can_see_reservation', 'app_reservation_community',
         'app_create_reservation', 'app_confirm_reservation',
         'app_cancel_reservation', 'app_list_community_reservations',
         'app_list_user_reservations', 'app_get_reservation'
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

  -- Y que las ocho estén completas.
  for r in
    select unnest(array[
      'app_can_see_reservation', 'app_reservation_community',
      'app_create_reservation', 'app_confirm_reservation',
      'app_cancel_reservation', 'app_list_community_reservations',
      'app_list_user_reservations', 'app_get_reservation'
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

  -- reservations: solo puede quedar la política de SELECT, y debe citar
  -- app_is_member_of sin filtrar por dueño (el alcance de R-5). Cualquier
  -- política de escritura reabriría el camino que este archivo cierra.
  if exists (
    select 1
      from pg_policies
     where tablename = 'reservations'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' reservations tiene politica de escritura;';
  end if;

  select coalesce(min(qual), '') into v_expr
    from pg_policies
   where tablename = 'reservations'
     and policyname = 'reservations_select_scoped'
     and cmd = 'SELECT';

  if v_expr = '' then
    v_fallos := v_fallos || ' falta reservations_select_scoped;';
  elsif v_expr not like '%app_is_member_of%' then
    v_fallos := v_fallos || ' reservations_select_scoped no usa app_is_member_of;';
  elsif v_expr like '%user_id%' then
    v_fallos := v_fallos || ' reservations_select_scoped filtra por user_id y debe ser de comunidad entera (R-5);';
  end if;

  -- area_slots: sin escrituras; SELECT vía la reserva.
  if exists (
    select 1
      from pg_policies
     where tablename = 'area_slots'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' area_slots tiene politica de escritura;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'area_slots'
       and policyname = 'slots_via_reservation'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta slots_via_reservation;';
  end if;

  -- El índice del solape, SIN condición (R-6). Con un `where` parcial, dos
  -- reservas que solapen a medias podrían convivir y el "imposible por
  -- construcción" dejaría de serlo.
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'area_slots_no_overlap_uidx'
       and i.indisunique
       and i.indpred is null
  ) then
    v_fallos := v_fallos || ' area_slots_no_overlap_uidx debe ser unico y sin condicion;';
  end if;

  -- Sin permisos de escritura para nadie que no deba (mismo criterio que 02e:
  -- se excluyen postgres y service_role).
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('reservations', 'area_slots')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' reservations/area_slots tiene escritura concedida a un rol que no debe;';
  end if;

  -- El default de status: CONFIRMED (R-2, sección 11 de la spec). Si alguien
  -- lo cambia a PENDING, toda reserva nacería esperando aprobación aunque la
  -- zona no la requiera.
  select pg_get_expr(d.adbin, d.adrelid)
    into v_expr
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.reservations'::regclass
     and a.attname = 'status';

  if v_expr is null or v_expr not like '%CONFIRMED%' then
    v_fallos := v_fallos || ' reservations.status debe tener default CONFIRMED;';
  end if;

  -- El enum exactamente en tres estados (aceptación de la spec 06 §10).
  if (select count(*) from pg_enum e
       where e.enumtypid = 'public.reservation_status'::regtype) <> 3
  then
    v_fallos := v_fallos || ' reservation_status debe tener exactamente 3 valores;';
  end if;

  if v_fallos <> '' then
    raise exception 'Las reservas no son seguras:%', v_fallos;
  end if;

  raise notice 'OK: 8 funciones SECURITY DEFINER con search_path fijo, reservations/area_slots solo lectura desde RLS y permisos, indice de solape unico sin condicion.';
end $$;

-- =============================================================================
-- 02n — Bloque 13: Dashboard
-- =============================================================================
--
-- Los agregados de la home de una comunidad: KPIs + series para Recharts. La
-- decision de fondo del bloque, DSH-1, es que la home es UNA pantalla y UNA
-- peticion; y DSH-2, que CONTAR NO ES LEER: el dashboard expone agregados de
-- toda la comunidad a cualquier miembro activo, pero nunca filas de recursos
-- que RLS le escondería (spec 13 §2).
--
-- Este archivo NO crea tablas: agrega lo que ya existe en 01_schema.sql. Toda
-- la autorizacion vive aqui dentro, y no por mania:
--
--   * El predicado de fila de `incidents` (02_rls §5.4) deja a un NEIGHBOR ver
--     solo SUS incidencias. Un "12 incidencias abiertas" calculado por el
--     cliente sobre ese listado seria falso. Contar la comunidad entera es
--     informacion del barrio, no la ficha de una incidencia ajena (DSH-2).
--   * El bloque `finance` es SOLO para ADMIN (DSH-3), como el bloque 09
--     (FN-1) y su RLS `expenses_admin_only`. Para el resto viaja `null`, no
--     ceros: "no lo puedes ver" y "esta a cero" son cosas distintas.
--
-- Y por que `SECURITY DEFINER` y `STABLE`:
--
--   * `security definer`: la funcion corre como su propietario, el rol de
--     migracion (`postgres`). Las tablas tienen RLS con ENABLE y FORCE
--     (02_rls §5 aplica las dos), pero `force` solo somete al DUEÑO a las
--     politicas; un rol con el atributo BYPASSRLS las salta siempre. `postgres`
--     lo tiene (comprobado: rolsuper=false, rolbypassrls=true), asi que la
--     funcion ve la comunidad entera. El unico filtro que queda es el guard de
--     pertenencia que hay aqui abajo: miembro ACTIVO o 42501. Es el mismo
--     mecanismo de app_list_expenses (02j §4) y de las funciones de 02e-02l.
--   * `stable`: solo lee. Postgres rechaza escribir dentro de una funcion
--     `stable` con 0A000, asi que ademas de ser cierto, es lo que garantiza
--     que un futuro cambio que intente escribir aqui falle en el motor y no en
--     produccion (la leccion de 04_verify §19).
--
-- Nota sobre las fechas: la ventana de las series (`p_from`..`p_to`) sale en el
-- bloque `period` de la respuesta para que el frontend sepa que rango esta
-- pintando. Por defecto son los ultimos 12 meses (DSH-5). Los instantes se
-- formatean a ISO 8601 UTC con `Z`, para que el contrato coincida con el
-- `.toISOString()` que usa el resto de la API.
--
-- Orden interno: 1) dashboard  2) permisos  3) autocomprobacion.
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. El dashboard (DSH-1, DSH-2, DSH-3)
-- ----------------------------------------------------------------------------
-- Devuelve SIEMPRE una fila con una unica columna jsonb. El `from communities
-- c where c.id = p_community_id` es lo que ata todos los `(select ... from x
-- where x.community_id = c.id ...)` a la comunidad pedida; el guard previo
-- garantiza que existe (la membresia es una FK) y que quien llama es miembro.
create or replace function app_community_dashboard(
  p_community_id uuid,
  p_from         date default null,
  p_to           date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from     date;
  v_to       date;
  v_is_admin boolean;
  v_result   jsonb;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- DSH-6: el grueso lo hace requireCommunity() en la ruta; esto lo repite
  -- porque es SECURITY DEFINER y no puede asumir por donde se entro.
  if not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  -- DSH-5: ventana de las series. Por defecto, los ultimos 12 meses contando el
  -- mes en curso (12 puntos, no 13).
  v_to := coalesce(p_to, current_date);
  v_from := coalesce(p_from, (date_trunc('month', v_to) - interval '11 months')::date);

  -- DSH-3: la finanzas son de ADMIN. La RLS de `expenses` lo impondria en una
  -- lectura normal; aqui se decide de forma explicita para poder devolver
  -- `null` en vez de ceros.
  v_is_admin := app_is_admin_of(p_community_id);

  select jsonb_build_object(
    'community', jsonb_build_object(
      'id',            c.id,
      'name',          c.name,
      'city',          c.city,
      -- DSH-8: "vecinos" excluye al PROVIDER; memberCount cuenta a todos los
      -- ACTIVOS. Dos numeros porque son dos preguntas distintas.
      'neighborCount', (
        select count(*) from community_members m
         where m.community_id = c.id and m.status = 'ACTIVE' and m.role <> 'PROVIDER'
      ),
      'memberCount', (
        select count(*) from community_members m
         where m.community_id = c.id and m.status = 'ACTIVE'
      )
    ),

    'incidents', jsonb_build_object(
      -- DSH-7: abiertas = OPEN; en curso = IN_PROGRESS; pendientes = OPEN sin
      -- asignar; criticas = CRITICAL y no cerradas. Todas excluyen borradas.
      'open', (
        select count(*) from incidents i
         where i.community_id = c.id and i.deleted_at is null and i.status = 'OPEN'
      ),
      'inProgress', (
        select count(*) from incidents i
         where i.community_id = c.id and i.deleted_at is null and i.status = 'IN_PROGRESS'
      ),
      'pending', (
        select count(*) from incidents i
         where i.community_id = c.id and i.deleted_at is null
           and i.status = 'OPEN' and i.assigned_to_id is null
      ),
      'critical', (
        select count(*) from incidents i
         where i.community_id = c.id and i.deleted_at is null
           and i.priority = 'CRITICAL' and i.status not in ('RESOLVED', 'CANCELLED')
      ),
      'byStatus', coalesce((
        select jsonb_agg(jsonb_build_object('status', s.status, 'count', s.cnt) order by s.status)
          from (
            select i.status, count(*) as cnt
              from incidents i
             where i.community_id = c.id and i.deleted_at is null
               and i.created_at::date between v_from and v_to
             group by i.status
          ) s
      ), '[]'::jsonb),
      'byCategory', coalesce((
        select jsonb_agg(jsonb_build_object('category', s.category, 'count', s.cnt) order by s.category)
          from (
            select i.category, count(*) as cnt
              from incidents i
             where i.community_id = c.id and i.deleted_at is null
               and i.created_at::date between v_from and v_to
             group by i.category
          ) s
      ), '[]'::jsonb)
    ),

    'reservations', jsonb_build_object(
      -- DSH-9: proximas = CONFIRMED/PENDING con starts_at >= ahora, top 5 por
      -- starts_at ascendente. Sin `notes` (R-5): la agenda es comunitaria, la
      -- nota privada no.
      'upcomingCount', (
        select count(*) from reservations r
         where r.community_id = c.id
           and r.status in ('CONFIRMED', 'PENDING') and r.starts_at >= now()
      ),
      'upcoming', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id',             s.id,
                 'commonAreaId',   s.common_area_id,
                 'commonAreaName', s.area_name,
                 'startsAt',       to_char(s.starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'endsAt',         to_char(s.ends_at   at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'status',         s.status,
                 'userId',         s.user_id,
                 'userName',       s.user_name
               ) order by s.starts_at)
          from (
            select r.id, r.common_area_id, a.name as area_name, r.starts_at, r.ends_at,
                   r.status, r.user_id, u.full_name as user_name
              from reservations r
              left join common_areas a on a.id = r.common_area_id
              left join users u on u.id = r.user_id
             where r.community_id = c.id
               and r.status in ('CONFIRMED', 'PENDING') and r.starts_at >= now()
             order by r.starts_at
             limit 5
          ) s
      ), '[]'::jsonb),
      -- Serie de uso por mes (A-4): cuenta CONFIRMED/PENDING (una reserva
      -- cancelada no es uso). Un mes sin datos no aparece: el backend no
      -- inventa ceros.
      'byMonth', coalesce((
        select jsonb_agg(jsonb_build_object('month', s.month, 'count', s.cnt) order by s.month)
          from (
            select to_char(date_trunc('month', r.starts_at), 'YYYY-MM') as month, count(*) as cnt
              from reservations r
             where r.community_id = c.id
               and r.status in ('CONFIRMED', 'PENDING')
               and r.starts_at::date between v_from and v_to
             group by 1
          ) s
      ), '[]'::jsonb)
    ),

    'announcements', jsonb_build_object(
      -- DSH-10: los 5 avisos vigentes mas recientes, con los fijados primero.
      'latest', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id',        s.id,
                 'title',     s.title,
                 'type',      s.type,
                 'priority',  s.priority,
                 'isPinned',  s.is_pinned,
                 'publishAt', to_char(s.publish_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               ) order by s.is_pinned desc, s.publish_at desc)
          from (
            select a.id, a.title, a.type, a.priority, a.is_pinned, a.publish_at
              from announcements a
             where a.community_id = c.id and a.deleted_at is null
               and a.publish_at <= now()
               and (a.expires_at is null or a.expires_at > now())
             order by a.is_pinned desc, a.publish_at desc
             limit 5
          ) s
      ), '[]'::jsonb)
    ),

    'votes', jsonb_build_object(
      -- DSH-11: votaciones OPEN no vencidas, top 5 por cierre. Sin recuento:
      -- los resultados tienen su propio endpoint con su result_visibility.
      'openCount', (
        select count(*) from votes v
         where v.community_id = c.id and v.deleted_at is null
           and v.status = 'OPEN' and v.ends_at >= now()
      ),
      'open', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id',     s.id,
                 'title',  s.title,
                 'endsAt', to_char(s.ends_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               ) order by s.ends_at)
          from (
            select v.id, v.title, v.ends_at
              from votes v
             where v.community_id = c.id and v.deleted_at is null
               and v.status = 'OPEN' and v.ends_at >= now()
             order by v.ends_at
             limit 5
          ) s
      ), '[]'::jsonb)
    ),

    -- DSH-3: solo ADMIN. Para el resto, `null` (no ceros).
    'finance', case when v_is_admin then (
      select jsonb_build_object(
        'expenseTotal', coalesce((
          select sum(e.amount) from expenses e
           where e.community_id = c.id and e.deleted_at is null
             and e.expense_date between v_from and v_to
        ), 0),
        'expenseCount', (
          select count(*) from expenses e
           where e.community_id = c.id and e.deleted_at is null
             and e.expense_date between v_from and v_to
        ),
        -- FN-14 (bloque 09): pendiente = PENDING con due_date futura; vencida =
        -- PENDING con due_date pasada; el importe abierto suma TODO lo PENDING.
        'invoiceOpenAmount', coalesce((
          select sum(i.amount) from invoices i
           where i.community_id = c.id and i.deleted_at is null and i.status = 'PENDING'
        ), 0),
        'invoicePendingCount', (
          select count(*) from invoices i
           where i.community_id = c.id and i.deleted_at is null
             and i.status = 'PENDING' and i.due_date >= current_date
        ),
        'invoiceOverdueCount', (
          select count(*) from invoices i
           where i.community_id = c.id and i.deleted_at is null
             and i.status = 'PENDING' and i.due_date < current_date
        ),
        'expensesByMonth', coalesce((
          select jsonb_agg(jsonb_build_object('month', s.month, 'total', s.total) order by s.month)
            from (
              select to_char(date_trunc('month', e.expense_date), 'YYYY-MM') as month,
                     sum(e.amount)::numeric(12,2) as total
                from expenses e
               where e.community_id = c.id and e.deleted_at is null
                 and e.expense_date between v_from and v_to
               group by 1
            ) s
        ), '[]'::jsonb)
      )
    ) else null end,

    'generatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'period', jsonb_build_object('from', v_from, 'to', v_to)
  )
  into v_result
  from communities c
  where c.id = p_community_id;

  -- Defensivo: la membresia es una FK, asi que la comunidad existe. Si por una
  -- carrera se hubiera borrado entre el guard y el select, se avisa en vez de
  -- devolver `null` (que romperia el contrato).
  if v_result is null then
    raise exception 'community_not_found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Permisos
-- ----------------------------------------------------------------------------
-- Solo por funcion: `app_runtime` ejecuta, PUBLIC no. La funcion ya aplica su
-- propio guard de pertenencia y de rol, asi que el EXECUTE no expone nada de
-- mas.
grant execute on function app_community_dashboard(uuid, date, date) to app_runtime;

revoke execute on function app_community_dashboard(uuid, date, date) from public;

-- ----------------------------------------------------------------------------
-- 3. Autocomprobacion
-- ----------------------------------------------------------------------------
-- Que este archivo se aplique sin errores no demuestra nada: si se le olvida
-- `security definer`, si se declara `volatile` (una lectura), o si se concede a
-- PUBLIC, se aplicaria igual de limpio y el agujero se instalaria solo.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  select p.proname, p.prosecdef, p.proconfig, p.provolatile
    into r
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_community_dashboard'
   limit 1;

  if r is null then
    v_fallos := v_fallos || ' falta app_community_dashboard();';
  else
    if not r.prosecdef then
      v_fallos := v_fallos || ' app_community_dashboard ya no es SECURITY DEFINER;';
    end if;

    if r.proconfig is null
       or not exists (
         select 1 from unnest(r.proconfig) as c where c like 'search\_path=%'
       )
    then
      v_fallos := v_fallos || ' app_community_dashboard necesita search_path fijo;';
    end if;

    if r.provolatile <> 's' then
      v_fallos := v_fallos || ' app_community_dashboard debe ser STABLE (solo lee);';
    end if;
  end if;

  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'app_community_dashboard'
       and grantee = 'PUBLIC'
  ) then
    v_fallos := v_fallos || ' app_community_dashboard sigue siendo ejecutable por PUBLIC;';
  end if;

  if v_fallos <> '' then
    raise exception 'El dashboard no es seguro:%', v_fallos;
  end if;

  raise notice 'OK · Dashboard: app_community_dashboard SECURITY DEFINER, STABLE, con search_path fijo y no ejecutable por PUBLIC.';
end $$;

-- ============================================================================
-- 02d · Miembros
-- ============================================================================
--
-- Depende de: 01_schema.sql (users, communities, community_members, member_role,
-- member_status), 02_rls.sql (app_current_user_id, app_is_member_of,
-- app_is_admin_of, el rol app_runtime y los permisos por tabla) y
-- 02c_communities.sql (app_create_community, que ya crea el primer ADMIN).
--
-- Qué hace este archivo, en una frase: convierte la pertenencia a una comunidad
-- en algo que solo se puede cambiar por una función privilegiada, y añade el
-- camino de entrada por código de invitación (spec 03, decisiones M-1 a M-11).
--
-- Hay tres cosas deliberadamente distintas aquí, y conviene no confundirlas:
--
--   1. SE QUITAN tres políticas de community_members. No se añaden. Las de
--      INSERT, UPDATE y DELETE sobran y una estaba rota (§1). Con ellas fuera,
--      la única forma de crear o modificar una membresía es una función
--      SECURITY DEFINER de este archivo o app_create_community(). Y eso es
--      justo lo que hace que el invariante de M-3 no se pueda saltar: un
--      invariante que vive en la capa HTTP no es un invariante.
--
--   2. community_invitations NO tiene política de INSERT. El alta de una
--      invitación pasa por app_invite_to_community(), que genera el código,
--      pone la caducidad y pone accepted_at = null. Con una política, el
--      cliente podría elegir expires_at (rompiendo M-7) o escribirse
--      accepted_at (simulando una invitación ya usada).
--
--   3. community_invitations SÍ tiene política de SELECT y de DELETE. No
--      tienen ningún campo que el cliente pueda usar para saltarse una regla:
--      leer es leer, y anular es anular si no se ha usado (M-11).
--
-- Sobre el código de las funciones de lectura: son las dos únicas del proyecto
-- que leen filas de `users` que no son las del propio usuario, porque
-- `users_select_self` solo deja ver la fila propia y un listado de vecinos sin
-- nombre no sirve. Es una excepción deliberada y acotada: exige ser miembro
-- ACTIVO de esa comunidad y devuelve dos columnas, no `select *`. La alternativa
-- era denormalizar full_name y email en community_members, que duplica el dato y
-- se queda viejo en cuanto el vecino cambia su nombre en el bloque 01.

-- ----------------------------------------------------------------------------
-- 1. community_members: fuera las políticas de escritura
-- ----------------------------------------------------------------------------
--
-- members_insert_self  : la mitad `or app_is_admin_of(community_id)` dejaba
--                        insertar la fila de cualquier user_id con el role que
--                        fuera, ADMIN incluido. Con el alta directa por email
--                        descartada (M-1) no queda ningún camino legítimo que la
--                        necesite.
-- members_update_admin : con ella, un ADMIN podía cambiar role y status sin
--                        pasar por el invariante de M-3.
-- members_delete_admin : contradice M-4. Nadie borra una membresía.
--
-- Se deja members_select_own_community, que es la que necesita el listado y las
-- políticas de los bloques siguientes. Y se deja el GRANT de SELECT.
drop policy if exists members_insert_self on community_members;
drop policy if exists members_update_admin on community_members;
drop policy if exists members_delete_admin on community_members;

-- ----------------------------------------------------------------------------
-- 2. community_invitations
-- ----------------------------------------------------------------------------
--
-- El código se guarda con hash, nunca en claro. Es el mismo criterio que las
-- sesiones del bloque 01: con el hash, leer la tabla no sirve para entrar en
-- nada. En claro sería una lista de puertas abiertas de todas las comunidades.
--
-- No hay columna `role` (M-9): quien entra por invitación es siempre NEIGHBOR.
-- Un campo que solo puede valer una cosa es ruido que alguien acabará leyendo
-- como configurable.
--
-- No hay columna `expires_at` con DEFAULT a propósito. Que caduque a los 7 días
-- (M-7) lo decide la función, no la tabla: un default se puede sortear con un
-- INSERT explícito, y esta tabla no admite INSERT.
create table if not exists community_invitations (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references communities (id) on delete cascade,
  email         text        not null,
  code_hash     text        not null,
  invited_by    uuid not null references users (id) on delete cascade,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references users (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Una invitación por código, que es la unicidad de verdad: el hash es lo único
-- que se puede repetir si el generador falla, y el unique es la última línea.
create unique index if not exists community_invitations_code_uidx
  on community_invitations (community_id, code_hash);

-- "Solo una invitación viva por email y comunidad" (M-11) garantizado por un
-- índice y no solo por un if dentro de la función. Es la diferencia entre una
-- regla y una intención.
create unique index if not exists community_invitations_live_uidx
  on community_invitations (community_id, email)
  where accepted_at is null;

-- Para GET /invitations, que lista por comunidad y de más reciente a más vieja.
create index if not exists community_invitations_listing_idx
  on community_invitations (community_id, created_at desc);

-- No hay índice por email a propósito: ninguna consulta busca invitaciones por
-- email. El canje busca por code_hash y el "ya hay una viva" por
-- (community_id, email), que es justo lo que cubre community_invitations_live_uidx.
-- Un índice que nadie consulta solo cuesta escrituras.

comment on table community_invitations is
  'Invitaciones por codigo (spec 03). El codigo nunca se guarda: solo su SHA-256.';

-- ----------------------------------------------------------------------------
-- 3. RLS y permisos
-- ----------------------------------------------------------------------------
--
-- ENABLE y FORCE, las dos, siempre juntas: ver 02_rls.sql §4.
alter table community_invitations enable row level security;
alter table community_invitations force  row level security;

-- Lectura: solo el ADMIN de esa comunidad. Un vecino no ve las invitaciones, ni
-- las que se han usado: el historial de a quien invito cada ADMIN es informacion
-- de la direccion.
drop policy if exists invitations_select_admin on community_invitations;
create policy invitations_select_admin on community_invitations
  for select using (app_is_admin_of(community_id));

-- Anular (M-11): solo invitaciones SIN usar. El borrado físico se limita a la
-- que nunca se usó, que es justo la que no tiene valor histórico: su código era
-- una puerta abierta y al borrar deja de serlo. Las usadas no se tocan, y por
-- eso `accepted_at is null` está en el USING y no en un if del servicio.
drop policy if exists invitations_delete_unused_admin on community_invitations;
create policy invitations_delete_unused_admin on community_invitations
  for delete using (app_is_admin_of(community_id) and accepted_at is null);

-- INSERT y UPDATE: sin política. Se van por app_invite_to_community(), que no
-- pasa por RLS porque es SECURITY DEFINER.

grant select, delete on community_invitations to app_runtime;

-- 02_rls.sql concede `insert, update` sobre community_members a app_runtime para
-- el camino de policies. Ese camino ya no existe, así que el permiso se revoca
-- aquí. Quitarlo de la lista de 02_rls.sql no basta: un GRANT anterior no se
-- deshace por dejar de repetirlo.
revoke insert, update on community_members from app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Funciones
-- ----------------------------------------------------------------------------
--
-- Todas: SECURITY DEFINER, search_path fijo, sin ejecutables por PUBLIC. Las
-- guardas van DENTRO de la función y no solo en la política, porque una función
-- SECURITY DEFINER no pasa por RLS: si la comprobación viviera solo en la
-- política, llamarla saltaría el filtro.

-- ----------------------------------------------------------------------------
-- 4.1 Lectura de un miembro
-- ----------------------------------------------------------------------------
--
-- `stable`: solo lee. Hay dos columnas de `users` (full_name y email) porque es
-- un listado de vecinos de la propia comunidad, no un directorio global. Se
-- filtran las cuentas con deleted_at para que un vecino dado de baja no aparezca
-- en el portal de los demás.
create or replace function app_get_community_member(
  p_community_id uuid,
  p_member_id    uuid
)
returns table (
  id          uuid,
  user_id     uuid,
  full_name   text,
  email       text,
  unit_number text,
  role        member_role,
  status      member_status,
  joined_at   timestamptz,
  created_at  timestamptz,
  updated_at  timestamptz
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

  if not app_is_member_of(p_community_id) then
    raise exception 'no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, u.full_name, u.email, m.unit_number,
         m.role, m.status, m.joined_at, m.created_at, m.updated_at
    from community_members m
    join users u on u.id = m.user_id
   where m.community_id = p_community_id
     and m.id = p_member_id
     and u.deleted_at is null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.2 Listado de miembros
-- ----------------------------------------------------------------------------
--
-- Sale todo, incluidos SUSPENDED y LEFT, con su `status` a la vista: SUSPENDED
-- es visible, no secreto, y el histórico es el punto de M-4. Filtrar por estado,
-- si hiciera falta, es cosa del frontend; ocultar a quien se fue sería tirar
-- justo el dato que M-4 dice que se conserva.
create or replace function app_list_community_members(
  p_community_id uuid
)
returns table (
  id          uuid,
  user_id     uuid,
  full_name   text,
  email       text,
  unit_number text,
  role        member_role,
  status      member_status,
  joined_at   timestamptz,
  created_at  timestamptz,
  updated_at  timestamptz
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

  if not app_is_member_of(p_community_id) then
    raise exception 'no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, u.full_name, u.email, m.unit_number,
         m.role, m.status, m.joined_at, m.created_at, m.updated_at
    from community_members m
    join users u on u.id = m.user_id
   where m.community_id = p_community_id
     and u.deleted_at is null
   order by lower(u.full_name), m.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.3 Crear una invitación
-- ----------------------------------------------------------------------------
--
-- Devuelve el código EN CLARO, que es lo único que se puede enseñar. El hash es
-- lo que se guarda.
--
-- El código se genera aquí dentro, nunca lo recibe el cliente: si lo recibiera,
-- un ADMIN podría poner un código predecible y adivinar invitaciones ajenas,
-- porque lo que se compara es el hash.
--
-- gen_random_bytes() está en pgcrypto, y con `search_path = public, pg_temp` no
-- se puede contar con que resuelva: en Supabase las extensiones se instalan en
-- el esquema `extensions`. Dos gen_random_uuid() dan 244 bits de entropía y
-- salen de pg_catalog, que es donde están desde PG 13. sha256() también.
create or replace function app_invite_to_community(
  p_community_id uuid,
  p_email        text
)
returns table (
  id   uuid,
  code text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code  text;
  v_id    uuid;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- M-2: solo el ADMIN de ESA comunidad.
  if not app_is_admin_of(p_community_id) then
    raise exception 'solo un ADMIN puede invitar' using errcode = '42501';
  end if;

  -- M-8: sin email no hay invitación. La comprobación no es adorno: el email es
  -- lo que impide que el código sirva a quien lo intercepte.
  if v_email = ''
     or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'email invalido' using errcode = '22023';
  end if;

  -- Una invitación viva por email y comunidad (el índice parcial también lo
  -- garantiza, pero el if da un mensaje utilizable en vez de un 23505 pelado).
  -- No se pisa la anterior: si el ADMIN la ha perdido, la anula con DELETE y se
  -- ve que hubo una anulación.
  if exists (
    select 1
      from community_invitations i
     where i.community_id = p_community_id
       and i.email = v_email
       and i.accepted_at is null
  ) then
    raise exception 'invitation_live: ya hay una invitacion viva para ese email'
      using errcode = '23505';
  end if;

  v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into community_invitations (
    community_id, email, code_hash, invited_by, expires_at, accepted_at
  )
  values (
    p_community_id,
    v_email,
    encode(sha256(convert_to(v_code, 'utf8')), 'hex'),
    app_current_user_id(),
    now() + interval '7 days',   -- M-7
    null
  )
  returning community_invitations.id into v_id;

  return query select v_id, v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.4 Canjear una invitación
-- ----------------------------------------------------------------------------
--
-- El camino de entrada (M-1). Exige sesión: el canje va en
-- POST /api/v1/invitations/redeem, no dentro del registro (M-10).
--
-- El orden de las comprobaciones importa. Primero se localiza la invitación
-- viva, luego se mira si caducó, luego el email, y el "usar" el código es lo
-- ÚLTIMO, ya con la decisión tomada. Si se reclamara antes, un 403 por email
-- distinto dejaría el código consumido sin haber servido para nada.
--
-- El email se compara AQUÍ y no en TypeScript. El UPDATE que marca el código
-- como usado y el INSERT de la membresía tienen que quedar en la misma
-- transacción que la comparación contra la fila; si se comparara en la
-- aplicación primero, un segundo canje simultáneo por parte de otra persona
-- podría colarse entre medias.
create or replace function app_redeem_invitation(
  p_code text
)
returns table (
  member_id   uuid,
  community_id uuid
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- Los OUT de `returns table` (member_id, community_id) son variables plpgsql, y
-- `on conflict (community_id, user_id)` nombra columnas sin cualificar: sin esto
-- plpgsql ve las dos cosas y el canje falla con 42702 "ambiguous". La columna
-- gana, que es lo que significa un ON CONFLICT.
#variable_conflict use_column
declare
  v_code    text := btrim(coalesce(p_code, ''));
  v_hash    text;
  v_inv     community_invitations%rowtype;
  v_email   text;
  v_status  member_status;
  v_member  uuid;
  v_rows    integer;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if v_code = '' then
    raise exception 'el codigo es obligatorio' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to(v_code, 'utf8')), 'hex');

  select * into v_inv
    from community_invitations i
   where i.code_hash = v_hash
     and i.accepted_at is null;

  -- M-6: un solo uso. El segundo intento no encuentra nada porque accepted_at ya
  -- no es null.
  if not found then
    raise exception 'invitation_used: el codigo ya se ha usado'
      using errcode = '22023';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired: el codigo ha caducado'
      using errcode = '22023';
  end if;

  select lower(u.email) into v_email
    from users u
   where u.id = app_current_user_id()
     and u.deleted_at is null;

  if v_email is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- 42501 y no 22023 a propósito: un 400 con "este codigo es de otro email"
  -- confirmaría que el código existe, y eso es información sobre una comunidad
  -- ajena. Es el mismo motivo por el que el bloque 02 no filtra ese detalle.
  if v_email <> v_inv.email then
    raise exception 'invitation_email_mismatch: el codigo es de otro email'
      using errcode = '42501';
  end if;

  select m.status into v_status
    from community_members m
   where m.community_id = v_inv.community_id
     and m.user_id = app_current_user_id();

  if v_status = 'ACTIVE' then
    raise exception 'member_already_joined: ya es miembro de la comunidad'
      using errcode = '23505';
  end if;

  -- Reclamar el código. El UPDATE con `accepted_at is null` serializa a los
  -- concurrentes: el segundo espera al bloqueo y, cuando lo hereda, ya no
  -- cumple el WHERE y no toca nada. Por eso cero filas significa "otro se ha
  -- adelantado".
  update community_invitations
     set accepted_at = now(),
         accepted_by = app_current_user_id()
   where id = v_inv.id
     and accepted_at is null;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'invitation_used: el codigo ya se ha usado'
      using errcode = '22023';
  end if;

  -- M-9: siempre NEIGHBOR. Y si la fila existía en SUSPENDED o LEFT, el unique
  -- (community_id, user_id) la reutiliza en vez de crear una segunda fila, que
  -- el índice rechazaría. Un ADMIN que se fue y vuelve entra como vecino otra
  -- vez: el rol se le vuelve a dar desde dentro, con registro.
  insert into community_members as m (
    community_id, user_id, role, status, invited_by, joined_at
  )
  values (
    v_inv.community_id, app_current_user_id(), 'NEIGHBOR', 'ACTIVE',
    v_inv.invited_by, now()
  )
  on conflict (community_id, user_id) do update
     set role        = 'NEIGHBOR',
         status      = 'ACTIVE',
         invited_by  = excluded.invited_by,
         joined_at   = excluded.joined_at,
         updated_at  = now()
  returning m.id into v_member;

  return query select v_member, v_inv.community_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.5 Cambiar el rol
-- ----------------------------------------------------------------------------
--
-- M-3. "Es el último" es un count sobre la misma tabla, y un UPDATE suelto no
-- puede llevar la cuenta dentro de la misma sentencia sin un disparador. Aquí el
-- count y el UPDATE van en la misma transacción, y es imposible que alguien se
-- cuelgue entre medias.
--
-- El count mira status = 'ACTIVE', no solo role = 'ADMIN': un ADMIN suspendido
-- ya no administra nada, porque app_role_in() filtra por estado activo. Si se
-- contaran todas las filas con role ADMIN, el invariante saltaría justo cuando
-- más falta hace, que es cuando queda un ADMIN suspendido y el otro se va.
--
-- Y no hay ninguna prohibición de cambiarse a sí mismo (spec 03 §5): con dos
-- ADMIN, uno sí puede degradarse. El criterio es el del último.
create or replace function app_set_member_role(
  p_community_id uuid,
  p_member_id    uuid,
  p_role         member_role
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_role   member_role;
  v_status member_status;
  v_admins integer;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'solo un ADMIN puede cambiar los roles' using errcode = '42501';
  end if;

  if p_role is null then
    raise exception 'el rol es obligatorio' using errcode = '22023';
  end if;

  -- El `and m.community_id = p_community_id` no es decorativo: es lo que impide
  -- que el ADMIN de A toque a un miembro de B diciendo un memberId de B. El
  -- error es P0002 y se traduce a 404, no a 403: en esa comunidad ese miembro no
  -- existe, y un 403 confirmaría que el id es válido en alguna parte.
  select m.role, m.status into v_role, v_status
    from community_members m
   where m.id = p_member_id
     and m.community_id = p_community_id;

  if not found then
    raise exception 'member_not_found: no existe ese miembro en la comunidad'
      using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' and v_status = 'ACTIVE' and p_role <> 'ADMIN' then
    select count(*) into v_admins
      from community_members m
     where m.community_id = p_community_id
       and m.role = 'ADMIN'
       and m.status = 'ACTIVE';

    if v_admins <= 1 then
      raise exception
        'member_last_admin: hay que promover a otro ADMIN antes de degradar al ultimo'
        using errcode = '23514';
    end if;
  end if;

  update community_members
     set role = p_role
   where id = p_member_id
     and community_id = p_community_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.6 Cambiar el estado
-- ----------------------------------------------------------------------------
--
-- Misma guarda, invariante simétrico: si el objetivo es el último ADMIN ACTIVO y
-- el estado nuevo no es ACTIVE, no puede.
create or replace function app_set_member_status(
  p_community_id uuid,
  p_member_id    uuid,
  p_status       member_status
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_role   member_role;
  v_status member_status;
  v_admins integer;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'solo un ADMIN puede cambiar los estados' using errcode = '42501';
  end if;

  if p_status is null then
    raise exception 'el estado es obligatorio' using errcode = '22023';
  end if;

  select m.role, m.status into v_role, v_status
    from community_members m
   where m.id = p_member_id
     and m.community_id = p_community_id;

  if not found then
    raise exception 'member_not_found: no existe ese miembro en la comunidad'
      using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' and v_status = 'ACTIVE' and p_status <> 'ACTIVE' then
    select count(*) into v_admins
      from community_members m
     where m.community_id = p_community_id
       and m.role = 'ADMIN'
       and m.status = 'ACTIVE';

    if v_admins <= 1 then
      raise exception
        'member_last_admin: hay que promover a otro ADMIN antes de suspender al ultimo'
        using errcode = '23514';
    end if;
  end if;

  update community_members
     set status = p_status
   where id = p_member_id
     and community_id = p_community_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Permisos de ejecución
-- ----------------------------------------------------------------------------
--
-- El revoke va de public y no de anon/authenticated a propósito: revocar del
-- grupo PUBLIC los cubre a todos de una vez, y no deja al autor acordarse de un
-- cuarto rol mañana. Es el mismo criterio que 02b y 02c.
grant execute on function app_get_community_member(uuid, uuid) to app_runtime;
grant execute on function app_list_community_members(uuid) to app_runtime;
grant execute on function app_invite_to_community(uuid, text) to app_runtime;
grant execute on function app_redeem_invitation(text) to app_runtime;
grant execute on function app_set_member_role(uuid, uuid, member_role) to app_runtime;
grant execute on function app_set_member_status(uuid, uuid, member_status) to app_runtime;

revoke execute on function app_get_community_member(uuid, uuid) from public;
revoke execute on function app_list_community_members(uuid) from public;
revoke execute on function app_invite_to_community(uuid, text) from public;
revoke execute on function app_redeem_invitation(text) from public;
revoke execute on function app_set_member_role(uuid, uuid, member_role) from public;
revoke execute on function app_set_member_status(uuid, uuid, member_status) from public;

-- ----------------------------------------------------------------------------
-- 6. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Que este archivo se ejecutara sin errores no demuestra nada. Lo que importa es
-- que las funciones hayan QUEDADO como deben: si alguien las reescribe y se le
-- olvida el `security definer` o el `search_path` fijo, el archivo se aplicaría
-- igual de limpio y el agujero se instalaría solo, en silencio.
--
-- Las comprobaciones de que NO existen las políticas de escritura valen tanto
-- como las de que existen las funciones. Un `drop policy` que alguien deshaga
-- dejando el `drop` no se ve en ningún diff si nadie lo comprueba.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las seis funciones: SECURITY DEFINER, search_path fijo y no ejecutables por
  -- PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_get_community_member', 'app_list_community_members',
         'app_invite_to_community', 'app_redeem_invitation',
         'app_set_member_role', 'app_set_member_status'
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

  -- Las seis tienen que existir. El bucle anterior no falla si no hay ninguna.
  for r in
    select unnest(array[
      'app_get_community_member', 'app_list_community_members',
      'app_invite_to_community', 'app_redeem_invitation',
      'app_set_member_role', 'app_set_member_status'
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

  -- community_members: solo lectura. Cualquier política de escritura es un fallo,
  -- porque reabre el camino que el invariante de M-3 necesita cerrado.
  if exists (
    select 1
      from pg_policies
     where tablename = 'community_members'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' community_members tiene politica de escritura; deberia ser solo lectura;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'community_members'
       and policyname = 'members_select_own_community'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta members_select_own_community de SELECT;';
  end if;

  -- Invitaciones: SELECT y DELETE para el ADMIN, y nada de INSERT ni de UPDATE.
  if exists (
    select 1
      from pg_policies
     where tablename = 'community_invitations'
       and cmd in ('INSERT', 'UPDATE')
  ) then
    v_fallos := v_fallos || ' community_invitations tiene politica de escritura y el alta debe ir por funcion;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'community_invitations'
       and policyname = 'invitations_delete_unused_admin'
       and cmd = 'DELETE'
  ) then
    v_fallos := v_fallos || ' falta invitations_delete_unused_admin de DELETE;';
  end if;

  -- RLS activada y forzada en la tabla nueva. Sin FORCE se aplica a los roles no
  -- propietarios y el dueño se la salta.
  if not exists (
    select 1
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relname = 'community_invitations'
       and c.relrowsecurity
       and c.relforcerowsecurity
  ) then
    v_fallos := v_fallos || ' community_invitations necesita RLS activada y forzada;';
  end IF;

  -- La tabla de invitaciones no puede tener INSERT para el rol de la aplicación.
  --
  -- Se excluyen a propósito el dueño (postgres, que es owner y por tanto puede
  -- todo) y service_role (la clave de administración de Supabase, que recibe
  -- todos los privilegios por defecto en cualquier tabla nueva por
  -- ALTER DEFAULT PRIVILEGES). Lo que importa es que app_runtime, anon,
  -- authenticated y PUBLIC no puedan insertar: el alta va por función.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'community_invitations'
       and privilege_type = 'INSERT'
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' community_invitations tiene INSERT concedido a un rol que no debe;';
  end if;

  if v_fallos <> '' then
    raise exception 'Los miembros no son seguros:%', v_fallos;
  end if;

  raise notice 'OK: members en solo lectura, invitaciones por funcion, seis funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC.';
end $$;
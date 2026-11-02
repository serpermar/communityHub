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
drop policy if exists members_insert_self on community_members;
drop policy if exists members_update_admin on community_members;
drop policy if exists members_delete_admin on community_members;

-- ----------------------------------------------------------------------------
-- 2. community_invitations
-- ----------------------------------------------------------------------------
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

create unique index if not exists community_invitations_code_uidx
  on community_invitations (community_id, code_hash);

create unique index if not exists community_invitations_live_uidx
  on community_invitations (community_id, email)
  where accepted_at is null;

create index if not exists community_invitations_listing_idx
  on community_invitations (community_id, created_at desc);

comment on table community_invitations is
  'Invitaciones por codigo (spec 03). El codigo nunca se guarda: solo su SHA-256.';

-- ----------------------------------------------------------------------------
-- 3. RLS y permisos
-- ----------------------------------------------------------------------------
alter table community_invitations enable row level security;
alter table community_invitations force  row level security;

drop policy if exists invitations_select_admin on community_invitations;
create policy invitations_select_admin on community_invitations
  for select using (app_is_admin_of(community_id));

drop policy if exists invitations_delete_unused_admin on community_invitations;
create policy invitations_delete_unused_admin on community_invitations
  for delete using (app_is_admin_of(community_id) and accepted_at is null);

grant select, delete on community_invitations to app_runtime;

revoke insert, update on community_members from app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Funciones
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 4.1 Lectura de un miembro
-- ----------------------------------------------------------------------------
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

  if not app_is_admin_of(p_community_id) then
    raise exception 'solo un ADMIN puede invitar' using errcode = '42501';
  end if;

  if v_email = ''
     or v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception 'email invalido' using errcode = '22023';
  end if;

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
    now() + interval '7 days',
    null
  )
  returning community_invitations.id into v_id;

  return query select v_id, v_code;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.4 Canjear una invitación (MODIFICADO PARA ACEPTAR VIVIENDA)
-- ----------------------------------------------------------------------------

-- Eliminamos la versión anterior de la función para evitar conflictos de firmas
drop function if exists app_redeem_invitation(text);

create or replace function app_redeem_invitation(
  p_code text,
  p_unit_number text default null
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
#variable_conflict use_column
declare
  v_code    text := btrim(coalesce(p_code, ''));
  v_unit    text := btrim(coalesce(p_unit_number, ''));
  v_hash    text;
  v_inv     community_invitations%rowtype;
  v_email   text;
  v_full    text;
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

  if not found then
    raise exception 'invitation_used: el codigo ya se ha usado'
      using errcode = '22023';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired: el codigo ha caducado'
      using errcode = '22023';
  end if;

  select lower(u.email), u.full_name into v_email, v_full
    from users u
   where u.id = app_current_user_id()
     and u.deleted_at is null;

  if v_email is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

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

  -- MODIFICACIÓN: Añadimos unit_number al INSERT y al ON CONFLICT
  insert into community_members as m (
    community_id, user_id, role, status, invited_by, joined_at, unit_number
  )
  values (
    v_inv.community_id, app_current_user_id(), 'NEIGHBOR', 'ACTIVE',
    v_inv.invited_by, now(), case when v_unit = '' then null else v_unit end
  )
  on conflict (community_id, user_id) do update
     set role        = 'NEIGHBOR',
         status      = 'ACTIVE',
         invited_by  = excluded.invited_by,
         joined_at   = excluded.joined_at,
         unit_number = case when excluded.unit_number is not null then excluded.unit_number else m.unit_number end,
         updated_at  = now()
  returning m.id into v_member;

  perform app_notify_leadership(
    v_inv.community_id,
    'MEMBER_JOINED',
    'Nuevo miembro',
    v_full,
    jsonb_build_object('userId', app_current_user_id()),
    app_current_user_id()
  );

  return query select v_member, v_inv.community_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.5 Cambiar el rol
-- ----------------------------------------------------------------------------
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
     and m.community_id = p_community_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Permisos de ejecución
-- ----------------------------------------------------------------------------
grant execute on function app_get_community_member(uuid, uuid) to app_runtime;
grant execute on function app_list_community_members(uuid) to app_runtime;
grant execute on function app_invite_to_community(uuid, text) to app_runtime;
-- MODIFICACIÓN: Nueva firma con dos argumentos
grant execute on function app_redeem_invitation(text, text) to app_runtime;
grant execute on function app_set_member_role(uuid, uuid, member_role) to app_runtime;
grant execute on function app_set_member_status(uuid, uuid, member_status) to app_runtime;

revoke execute on function app_get_community_member(uuid, uuid) from public;
revoke execute on function app_list_community_members(uuid) from public;
revoke execute on function app_invite_to_community(uuid, text) from public;
-- MODIFICACIÓN: Nueva firma con dos argumentos
revoke execute on function app_redeem_invitation(text, text) from public;
revoke execute on function app_set_member_role(uuid, uuid, member_role) from public;
revoke execute on function app_set_member_status(uuid, uuid, member_status) from public;

-- ----------------------------------------------------------------------------
-- 6. Autocomprobación
-- ----------------------------------------------------------------------------
do $$
declare
  v_fallos text := '';
  r        record;
begin
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
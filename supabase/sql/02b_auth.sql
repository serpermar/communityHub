-- ============================================================================
-- CommunityHub · 02b_auth.sql
-- ============================================================================
-- Ejecutar DESPUÉS de 02_rls.sql.
--
-- Por qué existe este archivo aparte:
--
-- El login es el único punto del sistema donde NO se conoce todavía el
-- user_id, porque el usuario aún no ha demostrado quién es. Las políticas de
-- 02_rls.sql comparan siempre contra app_current_user_id(), así que sin
-- contexto devolverían 0 filas. Con eso, el login y el refresh token son
-- imposibles de implementar con la aplicación normal.
--
-- Este archivo resuelve ese punto ciego con funciones SECURITY DEFINER muy
-- acotadas. Cada una hace UNA cosa, no acepta parámetros libres y devuelve solo
-- las columnas imprescindibles. Es el precio de que el hash de contraseña se
-- pueda consultar sin haber autenticado todavía.
--
-- Advertencia de diseño: son la superficie más sensible del esquema. Cualquier
-- rol al que se le conceda EXECUTE puede leer el hash de contraseña de quien
-- sea. Solo se concede a app_runtime, y solo en el backend.
--
-- Idempotente: se puede reejecutar sin efecto.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Buscar usuario por email (para el login)
-- ----------------------------------------------------------------------------
-- El índice es users_email_lower_uidx, sobre lower(email): la búsqueda es
-- case-insensitive sin un lower() en el índice.
--
-- Se expone password_hash porque el backend tiene que verificar argon2, y
-- verificar la contraseña exige el hash. No hay forma de hacer el login sin
-- leerlo. Lo que se evita es que quede expuesto en el cliente.
--
-- Devuelve también deleted_at y status para que el backend pueda rechazar
-- cuentas borradas o desactivadas sin una segunda consulta.
create or replace function app_auth_find_user_by_email(p_email text)
returns table (
  id               uuid,
  password_hash    text,
  full_name        text,
  global_role      user_global_role,
  status           text,
  deleted_at       timestamptz,
  email_verified_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id, u.password_hash, u.full_name, u.global_role,
         u.status, u.deleted_at, u.email_verified_at
  from users u
  where lower(u.email) = lower(p_email)
  limit 1
$$;

-- ----------------------------------------------------------------------------
-- 2. Buscar sesión por hash de refresh token (para el refresh)
-- ----------------------------------------------------------------------------
-- Es la función que hace posible la rotación con detección de reutilización.
--
-- El flujo: llega un refresh token, se hashea con SHA-256, y se busca por
-- token_hash. Esta función existe porque la política sessions_own exige
-- user_id = app_current_user_id(), y en este punto todavía no se sabe quién es
-- el dueño del token. Se devuelve la fila para poder comprobar su estado y,
-- si está revocada, revocar la familia entera.
--
-- `token_hash` es un índice único, así que la búsqueda es un index scan.
create or replace function app_auth_find_session_by_hash(p_token_hash text)
returns table (
  id            uuid,
  user_id       uuid,
  family_id     uuid,
  status        session_status,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  replaced_by   uuid,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.user_id, s.family_id, s.status, s.expires_at,
         s.revoked_at, s.replaced_by, s.created_at
  from sessions s
  where s.token_hash = p_token_hash
  limit 1
$$;

-- ----------------------------------------------------------------------------
-- 3. Revocar una familia de sesiones entera
-- ----------------------------------------------------------------------------
-- Detección de robo. Si llega un refresh token ya revocado, no solo se rechaza:
-- se revoca la familia completa. El atacante y la víctima tienen el mismo
-- token, así que solo uno de los dos puede seguir usando la sesión. La víctima
-- pierde su sesión, pero es preferible a que el atacante la conserve.
--
-- Necesita SECURITY DEFINER por lo mismo: la política sessions_own solo deja
-- tocar las sesiones del usuario en contexto, y aquí hay queinvalidar las de
-- cualquiera que pertenezca a esa familia.
create or replace function app_auth_revoke_family(p_family_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  update sessions
  set status      = 'REVOKED',
      revoked_at  = coalesce(revoked_at, now()),
      last_used_at = coalesce(last_used_at, now())
  where family_id = p_family_id
    and status = 'ACTIVE';

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Permisos
-- ----------------------------------------------------------------------------
-- Solo app_runtime. Ni anon ni authenticated, que además no tienen nada
-- garantizado sobre estas tablas desde 02_rls.sql.
grant execute on function app_auth_find_user_by_email(text) to app_runtime;
grant execute on function app_auth_find_session_by_hash(text) to app_runtime;
grant execute on function app_auth_revoke_family(uuid) to app_runtime;

revoke execute on function app_auth_find_user_by_email(text) from public;
revoke execute on function app_auth_find_session_by_hash(text) from public;
revoke execute on function app_auth_revoke_family(uuid) from public;

-- ----------------------------------------------------------------------------
-- 5. Verificación
-- ----------------------------------------------------------------------------
-- Las tres funciones existen, son SECURITY DEFINER y su search_path está fijo.
--
-- El search_path merece atención: sin `set search_path`, cualquiera que pueda
-- crear un objeto en el schema de búsqueda podría sustituir la función y
-- ejecutar su código con estos privilegios. Fijarlo es lo que cierra eso.
do $$
declare
  r record;
  faltantes text := '';
  sp text;
begin
  for r in
    select p.proname,
           p.prosecdef  as is_security_definer,
           p.proconfig as config
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.proname in (
        'app_auth_find_user_by_email',
        'app_auth_find_session_by_hash',
        'app_auth_revoke_family'
      )
  loop
    -- Postgres guarda el search_path con los espacios tal cual se escribieron
    -- ('search_path=public, pg_temp'). Comparar contra la cadena exacta da
    -- falso negativo por un espacio, asi que se quitan antes de comparar.
    sp := coalesce(r.config::text, '');
    sp := replace(sp, ' ', '');

    if not r.is_security_definer then
      faltantes := faltantes || r.proname || ' (no es SECURITY DEFINER) ';
    elsif sp not like '%search_path=public,pg_temp%' then
      faltantes := faltantes || r.proname || ' (search_path sin fijar) ';
    else
      raise notice '  OK · %', r.proname;
    end if;
  end loop;

  if faltantes <> '' then
    raise exception 'Funciones de auth incorrectas: %', faltantes;
  end if;

  raise notice 'OK · funciones de auth listas';
end $$;

-- app_runtime puede ejecutarlas, y el resto de roles no.
do $$
declare
  n integer;
begin
  select count(*) into n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in (
      'app_auth_find_user_by_email',
      'app_auth_find_session_by_hash',
      'app_auth_revoke_family'
    )
    and grantee = 'app_runtime';

  if n <> 3 then
    raise exception 'Se esperaban 3 permisos para app_runtime, hay %', n;
  end if;

  raise notice 'OK · app_runtime puede ejecutar las 3 funciones';
end $$;
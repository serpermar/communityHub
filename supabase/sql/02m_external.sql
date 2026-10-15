-- =============================================================================
-- 02m — Bloque 12: APIs externas
-- =============================================================================
--
-- Meteorología (Open-Meteo), mapa/POIs (Photon) y geocodificado de la dirección
-- de una comunidad. La decisión de fondo del bloque, EXT-1, es que el frontend
-- NUNCA habla con el proveedor: el backend es el único que sale a la red, con
-- caché, validación y normalización. Y EXT-2, que un proveedor caído jamás
-- devuelve un 5xx: los dos widgets degradan.
--
-- Este archivo añade las piezas que no tenían dónde vivir: la caché compartida
-- de las respuestas externas. `external_cache` nace en 01_schema.sql (§4.23);
-- aquí va lo que el esquema no puede decir:
--
--   * `app_external_cache_get()` devuelve la fila AUNQUE esté caducada, con un
--     `is_fresh` aparte. Eso es lo que hace posible el stale-while-error (EXT-4):
--     si el proveedor falla, se sirve el último dato bueno marcado `stale: true`
--     en vez de no servir nada. Una get que solo devuelve lo fresco obligaría a
--     elegir entre "dato rancio" y "nada".
--   * `app_external_cache_put()` hace el UPSERT por `cache_key` con su TTL, y de
--     paso purga lo caducado: es el único punto de mantenimiento que el proyecto
--     tiene, porque aquí no hay jobs (D-4 de la spec 08).
--   * `app_external_cache_purge()` es esa purga, también disponible por separado
--     para que la verificación pueda comprobarla.
--
-- `app_runtime` NO tiene privilegios de tabla sobre `external_cache` (el revoke
-- está en 02_rls.sql §7): solo puede pasar por las funciones. Igual que
-- `ai_cache` (spec 11 §5.23), que es el patrón que este bloque copia.
--
-- Nota sobre la volatilidad: `get` es `stable` porque SOLO lee; `put` y `purge`
-- son `volatile` porque escriben. Postgres rechaza un INSERT/UPDATE dentro de
-- una función `stable` con 0A000 ("UPDATE is not allowed in a non-volatile
-- function"), que es exactamente el bug que cazó la comprobación de
-- 04_verify.sql §19 en el bloque 11.
--
-- Orden interno: 1) get  2) put (+ purga)  3) purge  4) permisos
--                 5) autocomprobación.
--
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Lectura (EXT-3, EXT-4)
-- ----------------------------------------------------------------------------
-- Devuelve una sola fila, o ninguna. `is_fresh` distingue "caducada pero
-- servible" de "caducada y hay que reintentar con el proveedor"; sin esa
-- distinción el service tendría que leer `expires_at` y decidir, que es
-- precisamente la lógica que se deja aquí para que se pruebe en un sitio.
create or replace function app_external_cache_get(p_key text)
returns table (payload jsonb, expires_at timestamptz, is_fresh boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.payload, e.expires_at, (e.expires_at > now())
  from external_cache e
  where e.cache_key = p_key
$$;

-- ----------------------------------------------------------------------------
-- 2. Escritura y purga (EXT-3)
-- ----------------------------------------------------------------------------
-- El TTL viaja como segundos para que el service no tenga que traducir minutos/
-- horas a intervalos, y porque un `integer` no admite ambiguigedades: el mismo
-- argumento que se cachea es el que caduca.
create or replace function app_external_cache_purge()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_borradas integer;
begin
  delete from external_cache where expires_at < now();
  get diagnostics v_borradas = row_count;
  return v_borradas;
end;
$$;

create or replace function app_external_cache_put(
  p_key       text,
  p_provider  text,
  p_payload   jsonb,
  p_ttl_seconds integer
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- Un solo PUT ya es el momento de mantenimiento: la tabla no crece sin
  -- control y no hace falta un job programado para ello.
  perform app_external_cache_purge();

  insert into external_cache (cache_key, provider, payload, expires_at)
  values (
    p_key, p_provider, p_payload,
    now() + make_interval(secs => greatest(p_ttl_seconds, 0))
  )
  on conflict (cache_key) do update
    set provider    = excluded.provider,
        payload     = excluded.payload,
        expires_at  = excluded.expires_at,
        updated_at  = now();
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Permisos
-- ----------------------------------------------------------------------------
-- `app_runtime` ejecuta las tres funciones; PUBLIC ninguna. La tabla no recibe
-- ningún GRANT: el acceso es SOLO por función (el revoke de la tabla está en
-- 02_rls.sql §7, que se ejecuta antes que este archivo).
grant execute on function app_external_cache_get(text) to app_runtime;
grant execute on function app_external_cache_put(text, text, jsonb, integer) to app_runtime;
grant execute on function app_external_cache_purge() to app_runtime;

revoke execute on function app_external_cache_get(text) from public;
revoke execute on function app_external_cache_put(text, text, jsonb, integer) from public;
revoke execute on function app_external_cache_purge() from public;

-- Por simetría con 02l: quitar permisos de la lista de abajo no deshace un
-- GRANT ya aplicado, y así queda escrita la intención aunque alguien cambie el
-- orden de los archivos.
revoke all on external_cache from app_runtime;
revoke all on external_cache from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Autocomprobación
-- ----------------------------------------------------------------------------
-- Que este archivo se aplique sin errores no demuestra nada: si se le olvida un
-- `security definer`, si `put` se declara `stable`, o si se concede un privilegio
-- de tabla, se aplicaría igual de limpio y el agujero se instalaría solo.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  for r in
    select p.proname, p.prosecdef, p.proconfig, p.provolatile
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_external_cache_get', 'app_external_cache_put',
         'app_external_cache_purge'
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
      'app_external_cache_get', 'app_external_cache_put', 'app_external_cache_purge'
    ]) as fn
  loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn
    ) then
      v_fallos := v_fallos || ' falta ' || r.fn || '();';
    end if;
  end loop;

  -- La volatilidad: la lección del bloque 11 (04_verify.sql §19).
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('app_external_cache_put', 'app_external_cache_purge')
     and p.provolatile <> 'v'
  ) then
    v_fallos := v_fallos || ' app_external_cache_put/purge deben ser VOLATILE;';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'app_external_cache_get'
     and p.provolatile <> 's'
  ) then
    v_fallos := v_fallos || ' app_external_cache_get debe ser STABLE (solo lee);';
  end if;

  -- app_runtime NO tiene ningún privilegio de tabla sobre external_cache.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'external_cache'
       and grantee = 'app_runtime'
  ) then
    v_fallos := v_fallos || ' app_runtime conserva permisos de tabla sobre external_cache;';
  end if;

  -- RLS activa y forzada en la tabla (aunque 02_rls.sql ya lo comprueba).
  if exists (
    select 1 from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relname = 'external_cache'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    v_fallos := v_fallos || ' external_cache no tiene RLS activada y forzada;';
  end if;

  if v_fallos <> '' then
    raise exception 'La caché externa no es segura:%', v_fallos;
  end if;

  raise notice 'OK: caché externa solo por funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC, put/purge VOLATILE, get STABLE, external_cache sin privilegios para app_runtime y con RLS activada y forzada.';
end $$;

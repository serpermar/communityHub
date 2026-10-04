-- ============================================================================
-- 02c_communities.sql — el alta de una comunidad y su primer administrador
-- ============================================================================
--
-- Por qué un archivo propio y no una línea más en 02_rls.sql: aquí vive la
-- ÚNICA función del proyecto que escribe saltándose RLS. 02_rls.sql define las
-- políticas; 02b_auth.sql, las funciones de sesión. Esta es de otra categoría:
-- un camino privilegiado que hace dos escrituras que RLS, por sí solo, no
-- permite. Merece su propio archivo para que se lea solo.
--
-- El problema que resuelve
-- -----------------------
-- Dos huecos encadenados, y el segundo solo se ve si se mira el primero:
--
--   1. `communities` no tenía política INSERT, así que con el rol app_runtime
--      nadie podía crear una comunidad. El comentario en 02_rls.sql lo
--      describía, pero la política nunca se escribió.
--
--   2. Aunque existiera, una comunidad recién creada NO tiene miembros. Luego
--      app_is_member_of() y app_is_admin_of() son falsas para todo el mundo,
--      incluido quien la acaba de crear. Y el INSERT en community_members que
--      hay que hacer para darle el papel de ADMIN exige, precisamente,
--      app_is_admin_of(community_id). Es un deadlock: nadie puede nombrar al
--      primer administrador, y la comunidad queda sin poder usarse.
--
-- La salida es una transacción, no un permiso. app_create_community() hace las
-- dos inserciones o no hace ninguna, y quien la puede ejecutar es el staff de
-- la plataforma, no un ADMIN de comunidad: un ADMIN de la comunidad A no puede
-- crear la comunidad B.
--
-- Sobre por qué SECURITY DEFINER
-- ------------------------------
-- La función se ejecuta como su propietario, que no está sujeto a RLS. Por eso
-- la comprobación de ADMIN_SA va DENTRO de la función, y no solo apoyada en la
-- política: si la guarda viviera únicamente en RLS, llamarla la saltaría. Las
-- dos capas juega a favor: esta para que la función no sea un agujero, y la política
-- communities_insert_admin_sa para que el insert directo tampoco lo sea.
--
-- Idempotente. Se puede reaplicar sin romper nada.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Coordenadas anulables (spec 02, C-7)
-- ----------------------------------------------------------------------------
--
-- `not null` a `drop not null` es idempotente: la segunda vez no hay nada que
-- hacer y la sentencia no falla.
--
-- Lo hace este archivo y no solo 01_schema.sql porque en 01_schema.sql está la
-- definición para bases nuevas, pero `create table if not exists` no toca la
-- tabla que ya existe. Sin este ALTER, la base de desarrollo seguiría exigiendo
-- coordenadas y la nueva no.
--
-- NULL significa "sin localizar todavía", no "en el centro del mapa". Rellenar
-- con 0,0 habría sido peor: 0,0 está en el Atlántico y daría meteorología y
-- mapa equivocados sin que nadie se entere.
alter table communities alter column latitude   drop not null;
alter table communities alter column longitude  drop not null;

-- ----------------------------------------------------------------------------
-- 2. La función de alta
-- ----------------------------------------------------------------------------
--
-- Los parámetros son explícitos y en el mismo orden que el DTO de la API. No se
-- pasa un jsonb: un jsonb deja que cualquiera de los dos lados lo renombre.
-- Con parámetros con nombre, además, una reordenación no rompe nada.
--
-- `p_*` por convención, que es lo que usa 02b_auth.sql.

create or replace function app_create_community(
  p_name                text,
  p_slug                text,
  p_address_line1       text,
  p_city                text,
  p_country             text    default 'ES',
  p_description         text    default null,
  p_province            text    default null,
  p_postal_code         text    default null,
  p_latitude            numeric default null,
  p_longitude           numeric default null,
  p_timezone            text    default 'Europe/Madrid',
  p_registration_number text    default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor     uuid := app_current_user_id();
  v_community uuid;
  v_country   text;
  v_timezone  text;
begin
  -- La guarda va aquí, no en la política. Esta función no pasa por RLS, así que
  -- si la comprobación viviera solo allí, llamarla saltaría el filtro.
  --
  -- 42501 es insufficient_privilege: un permiso denegado, no un error de
  -- entrada. La capa HTTP lo traduce a 403.
  if v_actor is null then
    raise exception 'sin contexto de usuario'
      using errcode = '42501';
  end if;

  if not app_is_global_admin() then
    raise exception 'solo un ADMIN_SA puede crear comunidades'
      using errcode = '42501';
  end if;

  -- Las coordenadas van juntas o no van. Aceptar solo una pondría la comunidad
  -- en el golfo de Guinea con latitude 0 y una longitude real. La regla se
  -- comprueba también en la capa de aplicación, para poder devolver un 400 con
  -- el campo concreto en lugar de un 403 genérico.
  if (p_latitude is null) is distinct from (p_longitude is null) then
    raise exception 'latitud y longitud van juntas'
      using errcode = '22023';
  end if;

  -- El nombre y el slug no pueden llegar vacíos aunque la capa HTTP ya lo
  -- haya comprobado: esta función es un punto de entrada privilegiado y no tiene
  -- por qué confiar en quien la llama. Un TRIM vacío es tan inútil como NULL.
  if p_name is null or btrim(p_name) = '' then
    raise exception 'el nombre es obligatorio' using errcode = '22023';
  end if;

  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'el slug es obligatorio' using errcode = '22023';
  end if;

  -- Los DEFAULT de la firma solo se aplican cuando el argumento NO se menciona.
  -- Un NULL explicito los pisa. Y un NULL explicito es justo lo que llega desde
  -- HTTP, donde un campo opcional del cuerpo se traduce a null y no a "omitido".
  --
  -- Sin estos coalesce, mandar country: null desde la API devolvia un 23502
  -- (null value in column "country") en vez de la intencion de quien lo escribio.
  -- El default tiene que estar tambien aqui dentro, no solo en la firma.
  --
  -- Y btrim('') sale vacio, que en un NOT NULL tambien es un 23502: un espacio en
  -- blanco no es un pais.
  v_country  := nullif(btrim(coalesce(p_country, 'ES')), '');
  v_timezone := nullif(btrim(coalesce(p_timezone, 'Europe/Madrid')), '');

  if v_country is null then
    raise exception 'el pais es obligatorio' using errcode = '22023';
  end if;

  if v_timezone is null then
    raise exception 'la zona horaria es obligatoria' using errcode = '22023';
  end if;
  -- 23505 es unique_violation: el slug ya existe. Llega a la capa HTTP como
  -- 409 por el mapeo de errores de Prisma.
  insert into communities (
    name, slug, description, address_line1, city, province, postal_code,
    country, latitude, longitude, timezone, registration_number, created_by
  )
  values (
    btrim(p_name), lower(btrim(p_slug)), nullif(btrim(p_description), ''),
    btrim(p_address_line1), btrim(p_city), nullif(btrim(p_province), ''),
    nullif(btrim(p_postal_code), ''), upper(v_country), p_latitude,
    p_longitude, v_timezone, nullif(btrim(p_registration_number), ''), v_actor
  )
  returning id into v_community;

  -- El primer ADMIN. Sin esta fila, la comunidad existe pero no tiene a nadie que
  -- la administre: `app_is_admin_of` sería falsa para todo el mundo y no habría
  -- forma de añadir al segundo miembro.
  --
  -- `joined_at` se deja ahora, que es cuando entra. `invited_by` es NULL porque
  -- no hubo invitación: se creó a sí mismo con el poder del staff.
  insert into community_members (
    community_id, user_id, role, status, joined_at
  )
  values (
    v_community, v_actor, 'ADMIN', 'ACTIVE', now()
  );

  return v_community;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Permisos
-- ----------------------------------------------------------------------------
--
-- `app_runtime` sí, que es quien la llama. `public` no: en Postgres, PUBLIC
-- incluye a todos los roles, así que sin este revoke la función sería
-- ejecutable por cualquiera, incluido `anon`, que es el rol que usan las claves
-- públicas de Supabase desde el navegador.
--
-- El revoke va de public y no de anon/authenticated a propósito: revocar del
-- grupo PUBLIC los cubre a todos de una vez, y no deja al autor
-- que acordarse de un cuarto rol mañana.
grant execute on function app_create_community(
  text, text, text, text, text, text, text, text, numeric, numeric, text, text
) to app_runtime;

revoke execute on function app_create_community(
  text, text, text, text, text, text, text, text, numeric, numeric, text, text
) from public;

-- ----------------------------------------------------------------------------
-- 4. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Que este bloque se ejecutara sin errores no demuestra nada. Lo que importa es
-- que la función haya QUEDADO como debe: si alguien la reescribe y se le olvida
-- el `security definer` o el `search_path` fijo, el archivo se aplicaría igual de
-- limpio y el agujero se instalaría solo, en silencio.
--
-- Por eso esto falla ruidosamente. Es el mismo guardia que hay al final de
-- 02b_auth.sql.
do $$
declare
  v_fn     record;
  v_fallos text := '';
begin
  select p.oid, p.prosecdef, p.proconfig
    into v_fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'app_create_community'
     and pg_get_function_identity_arguments(p.oid) =
         'p_name text, p_slug text, p_address_line1 text, p_city text, p_country text, p_description text, p_province text, p_postal_code text, p_latitude numeric, p_longitude numeric, p_timezone text, p_registration_number text';

  if v_fn.oid is null then
    raise exception 'app_create_community() no existe';
  end if;

  if not v_fn.prosecdef then
    raise exception 'app_create_community() ya no es SECURITY DEFINER';
  end if;

  if v_fn.proconfig is null
     or not exists (
       select 1 from unnest(v_fn.proconfig) as c
        where c like 'search\_path=%'
     ) then
    raise exception 'app_create_community() necesita search_path fijo';
  end if;

  -- El permiso se mira sobre el grupo PUBLIC, que es el que manda. La pregunta
  -- no es si app_runtime puede ejecutarla, sino si puede ejecutarla cualquiera.
  --
  -- Se usa information_schema y no aclexplode a proposito: aclexplode devuelve
  -- privilege_type y no priv_type, que es un detalle que cambia entre versiones
  -- y que ya costo una aplicacion fallida. Lo que importa es que el revoke de
  -- `public` de arriba se aplique de verdad, y esto lo comprueba sin depender de
  -- como Postgres representa el ACL por dentro.
  if exists (
    select 1
      from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'app_create_community'
       and grantee = 'PUBLIC'
  ) then
    v_fallos := v_fallos || ' app_create_community() sigue siendo ejecutable por PUBLIC;';
  end if;

  if exists (
    select 1 from pg_policies
     where tablename = 'communities'
       and policyname = 'communities_insert_admin_sa'
       and cmd <> 'INSERT'
  ) then
    v_fallos := v_fallos || ' communities_insert_admin_sa no es una politica de INSERT;';
  end if;

  if v_fallos <> '' then
    raise exception 'Autocomprobacion fallida:%', v_fallos;
  end if;

  raise notice 'OK: app_create_community() es SECURITY DEFINER, con search_path fijo, no ejecutable por PUBLIC, y communities_insert_admin_sa es de INSERT.';
end $$;

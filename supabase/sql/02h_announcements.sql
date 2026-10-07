-- =============================================================================
-- 02h — Bloque 07: avisos
-- =============================================================================
--
-- El tablón de anuncios es broadcast asimétrico: escriben PRESIDENT y ADMIN,
-- leen los cuatro roles. Esa asimetría es la razón de que este archivo exista,
-- y cada pieza traduce una decisión de la spec 07:
--
--   * AN-1/AN-2: crear y editar es de PRESIDENT y ADMIN, borrar es solo de
--     ADMIN. La política announcements_write_leadership de 02_rls.sql es un
--     `for all`: concede UPDATE y DELETE al mismo rol, y AN-5 dice que el
--     PRESIDENT puede fijar y corregir pero no destruir. Se elimina.
--   * AN-6: el PUT es reemplazo completo campo a campo y RLS mira la fila
--     RESULTANTE, no el camino que tomó hasta ahí: no puede exigir los ocho
--     campos ni impedir que el cuerpo toque author_id (AN-9).
--   * AN-3/AN-4: la ventana de visibilidad (publicado y no caducado, con el
--     rol del llamante dentro) se evalúa con now() AL LEER y dentro de la
--     función. Una política no expresa paginación, orden ni filtros.
--   * AN-9: author_id sale de app_current_user_id(), nunca del cuerpo.
--
-- Las funciones SECURITY DEFINER corren como su dueña, así que la política de
-- SELECT (que se queda tal cual) ni se les aplica: el predicado completo vive
-- en app_list_announcements() y hay UNA sola copia.
--
-- Orden interno:  1) CHECK de longitud  2) comunidad del aviso  3) lecturas
--                 4) escrituras  5) políticas  6) permisos  7) autocomprobación
--
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Longitudes de texto
-- ----------------------------------------------------------------------------
--
-- `title` y `body` son not null pero no tienen CHECK de longitud (spec §4a): el
-- not null no impide el '' ni el título de un carácter. Mismo criterio que
-- incidents_description_length en 02e: `not valid` aplica a filas nuevas sin
-- revalidar las que ya haya, así que la restricción se añade sin downtime y a
-- partir de ahí toda fila nueva pasa por ella. Quien pone los rangos por dos
-- veces —aquí y en el zod del backend— es porque la capa de entrada se puede
-- saltar con una llamada directa a la base de datos.
do $$
begin
  alter table announcements
    add constraint announcements_title_length
    check (char_length(title) between 3 and 120) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table announcements
    add constraint announcements_body_length
    check (char_length(body) between 1 and 5000) not valid;
exception
  when duplicate_object then null;
end $$;

-- 120 de título es de tablón (cabe en un aviso de móvil) y 5000 de cuerpo admite
-- el comunicado entero sin adjunto; los adjuntos son de la spec 08.

-- ----------------------------------------------------------------------------
-- 2. La comunidad de un aviso
-- ----------------------------------------------------------------------------
--
-- §4c: PUT /announcements/:id y DELETE /announcements/:id no llevan comunidad
-- en la URL. requireAnnouncement() llama a esta función y traduce NULL -> 404,
-- mismo criterio C-8 de los bloques 04 y 05: un 403 confirmaría que ese id
-- existe y que antes lo veías.
--
-- Devuelve el community_id SOLO si el aviso existe, no está borrado y el actor
-- es miembro activo de su comunidad. Nótese lo que NO filtra: la ventana de
-- AN-4 no aparece aquí, y es deliberado —un aviso programado o caducado tiene
-- que seguir siendo visible para su PUT y su DELETE, porque gestionar es
-- exactamente lo que hay que hacer con esos. Quien aplica la ventana es el
-- listado (sección 3).
--
-- SELECT en lugar de EXCEPTION, por el mismo motivo que app_incident_community
-- en 02e: se usa desde consultas que pueden no encontrar nada, y un 404 como
-- excepción PostgreSQL aborta la transacción en curso salvo que el backend la
-- capture con un savepoint.
create or replace function app_announcement_community(p_announcement uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.community_id
    from announcements a
   where a.id = p_announcement
     and a.deleted_at is null
     and app_is_member_of(a.community_id)
$$;

-- ----------------------------------------------------------------------------
-- 3. Lecturas
-- ----------------------------------------------------------------------------
--
-- AN-3: TODA lectura pasa por esta función. Tres cosas que un where de Prisma no
-- puede fijar a la vez: (a) la ventana de AN-4 con now() en la base de datos,
-- (b) deleted_at is null, y (c) authorName, que sale de users y que
-- users_select_self no deja leer desde el backend. Es la misma excepción
-- acotada que abrieron 02d (app_get_community_member), 02e (app_list_incidents)
-- y 02g (app_list_community_reservations).
--
-- Firmas y por qué hay seis parámetros y no uno solo (aclaración de la spec
-- §5.2): los cuatro filtros de §7.3 —type, q, paginación— tienen que llegar
-- desde la API, y p_announcement es la relectura por id que usan el POST y el
-- PUT para devolver la fila CON authorName después de escribir. Un
-- app_get_announcement() aparte (el precedente app_get_common_area) se descarta
-- porque AN-3 dice que toda lectura pasa por aquí: dos lectores serían dos
-- copias de la ventana de AN-4 que pueden discrepar.
--
-- El total sale de `count(*) over ()` sobre el conjunto filtrado (AN-8), la
-- misma técnica que 02e: una ventana se evalúa sobre las filas que SALEN, así
-- que con cero filas no hay dónde ponerlo, y el backend resuelve la página más
-- allá del final con una segunda llamada con offset 0.
create or replace function app_list_announcements(
  p_community_id uuid,
  p_announcement  uuid               default null,
  p_type          announcement_type  default null,
  p_q             text               default null,
  p_limit         integer            default 20,
  p_offset        integer            default 0
)
returns table (
  id            uuid,
  community_id  uuid,
  title         text,
  body          text,
  type          announcement_type,
  priority      announcement_priority,
  is_pinned     boolean,
  publish_at    timestamptz,
  expires_at    timestamptz,
  author_id     uuid,
  author_name   text,
  created_at    timestamptz,
  updated_at    timestamptz,
  total_count   bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role member_role;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- Un miembro de otra comunidad no obtiene una lista vacía sino un 403:
  -- decir "no hay avisos" a quien no es miembro confirmaría que esa comunidad
  -- existe. Mismo motivo que en 02e.
  if not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  -- El rol se resuelve UNA vez y no por fila. app_role_in es stable y filtra
  -- por ACTIVE, y aquí ya se ha comprobado la pertenencia, así que no puede
  -- venir null.
  v_role := app_role_in(p_community_id);

  return query
  select a.id, a.community_id, a.title, a.body, a.type, a.priority,
         a.is_pinned, a.publish_at, a.expires_at, a.author_id, u.full_name,
         a.created_at, a.updated_at,
         count(*) over ()
    from announcements a
    left join users u on u.id = a.author_id   -- author_id es nullable: si el autor se dio de baja, null
   where a.community_id = p_community_id
     and a.deleted_at is null                 -- borrado es borrado, para nadie (AN-5)
     and (p_announcement is null or a.id = p_announcement)
     -- Ventana de AN-4 aplicada por rol (AN-7, D-2): PRESIDENT y ADMIN ven
     -- también programados y caducados, porque lo que está por llegar es lo
     -- que tienen que revisar antes de que salga y lo caducado es lo que
     -- tienen que poder borrar o reabrir. Con la ventana aplicada a todos, un
     -- aviso caducado sería inalcanzable y su PUT/DELETE imposibles.
     and (
       v_role in ('ADMIN', 'PRESIDENT')
       or (a.publish_at <= now()
           and (a.expires_at is null or a.expires_at > now()))
     )
     and (p_type is null or a.type = p_type)
     and (p_q is null
          or a.title ilike '%' || p_q || '%'
          or a.body   ilike '%' || p_q || '%')
   order by a.is_pinned desc, a.publish_at desc   -- el orden exacto del índice announcements_community_publish_idx (AN-8)
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Escrituras
-- ----------------------------------------------------------------------------
--
-- Las tres son la única puerta de entrada que queda: la política de escritura
-- de 02_rls.sql desaparece en la sección 5 y app_runtime pierde INSERT, UPDATE
-- y DELETE sobre la tabla en la 6. Ninguna acepta un usuario como parámetro:
-- el actor sale de app_current_user_id() (AN-9).

-- ----------------------------------------------------------------------------
-- 4.1 Crear un aviso
-- ----------------------------------------------------------------------------
--
-- AN-1: solo PRESIDENT y ADMIN. El backend pone además
-- requireCommunityRole('PRESIDENT', 'ADMIN') como guardia gruesa, pero la
-- terna se repite DENTRO de la transacción: si el guard se olvidara, el
-- endpoint seguiría siendo seguro, que es el patrón de 02e y 02g.
--
-- Los defaults viven en la función, no en los parámetros SQL: el backend manda
-- lo que el cliente envió (o null si no lo envió) y aquí se aplica el default
-- de la columna, de forma que la función y el esquema dicen lo mismo aunque
-- alguien la llame por otro camino.
--
-- La ventana p_expires_at > p_publish_at la garantiza el CHECK
-- announcements_dates_valid que ya trajo 01_schema.sql; su violación sale como
-- 23514 y el backend la traduce a 400 (§7.5). Zod la adelanta en la capa de
-- entrada con el mismo resultado.
create or replace function app_create_announcement(
  p_community_id uuid,
  p_title        text,
  p_body         text,
  p_type         announcement_type      default null,
  p_priority     announcement_priority  default null,
  p_is_pinned    boolean                default null,
  p_publish_at   timestamptz            default null,
  p_expires_at   timestamptz            default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_role  member_role;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  v_role := app_role_in(p_community_id);

  -- Un no miembro da null y cae aquí: forbidden_role, no "no encontrado".
  if v_role is null or v_role not in ('ADMIN', 'PRESIDENT') then
    raise exception 'forbidden_role: su rol no puede publicar avisos'
      using errcode = '42501';
  end if;

  -- Guarda interna, inalcanzable desde la API (zod ya exige title y body):
  -- existe para que una llamada directa a la función no choque con el not null
  -- crudo de la columna, que llegaría al backend como un 23502 que nada traduce.
  if p_title is null or p_body is null then
    raise exception 'announcement_content_required: el título y el cuerpo son obligatorios'
      using errcode = '22023';
  end if;

  insert into announcements (
    community_id, title, body, type, priority, is_pinned,
    publish_at, expires_at, author_id
  )
  values (
    p_community_id,
    btrim(p_title),
    btrim(p_body),
    coalesce(p_type, 'GENERAL'),
    coalesce(p_priority, 'MEDIUM'),
    coalesce(p_is_pinned, false),
    coalesce(p_publish_at, now()),
    p_expires_at,                        -- null = no caduca
    app_current_user_id()                -- AN-9: jamás de los parámetros
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.2 Editar un aviso (PUT)
-- ----------------------------------------------------------------------------
--
-- AN-6: reemplazo completo. Los ocho parámetros son el valor nuevo entero; no
-- hay PATCH y los parámetros que no son del aviso (id, community_id, author_id,
-- created_at) ni siquiera existen en la firma. AN-9: el UPDATE no toca
-- author_id ni community_id —el autor es el que firmó la publicación original,
-- aunque otro dirigente la corrija después—.
--
-- El orden de las guardas es el de la spec §5.4: primero se ve si el aviso
-- existe (y si está borrado, no existe), después si el rol puede gestionarlo.
-- Un NEIGHBOR con el id de su comunidad recibe 403, no 404: el 404 es para no
-- pertenecer a la comunidad, el 403 para no poder gestionarla.
--
-- Devuelve la fila leída al final (spec §5.4). El backend no la usa: relee
-- través de app_list_announcements() porque solo ahí hay authorName (AN-3),
-- pero la función la devuelve para que su contrato sea el que documenta la
-- spec y para que un llamante directo no tenga que montar la respuesta con los
-- parámetros de entrada.
create or replace function app_update_announcement(
  p_announcement uuid,
  p_title        text,
  p_body         text,
  p_type         announcement_type,
  p_priority     announcement_priority,
  p_is_pinned    boolean,
  p_publish_at   timestamptz,
  p_expires_at   timestamptz
)
returns setof announcements
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_role      member_role;
begin
  v_community := app_announcement_community(p_announcement);

  if v_community is null then
    raise exception 'announcement_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  v_role := app_role_in(v_community);

  if v_role is null or v_role not in ('ADMIN', 'PRESIDENT') then
    raise exception 'forbidden_role: su rol no puede gestionar avisos'
      using errcode = '42501';
  end if;

  -- Inalcanzable desde la API (el PUT exige los ocho campos), misma razón que
  -- announcement_content_required en el alta.
  if p_title is null or p_body is null then
    raise exception 'announcement_content_required: el título y el cuerpo son obligatorios'
      using errcode = '22023';
  end if;

  update announcements
     set title      = btrim(p_title),
         body       = btrim(p_body),
         type       = p_type,
         priority   = p_priority,
         is_pinned  = p_is_pinned,
         publish_at = p_publish_at,      -- programar hacia adelante reprograma, sin estados (AN-4)
         expires_at = p_expires_at       -- null caduca nunca
   where id = p_announcement
     and deleted_at is null;             -- entre la guarda y aquí nadie lo ha borrado

  if not found then
    -- Solo si otra transacción lo borró entre la lectura de arriba y este
    -- UPDATE. Mismo criterio que app_soft_delete_incident en 02e.
    raise exception 'announcement_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  return query
  select a.* from announcements a where a.id = p_announcement;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.3 Borrar un aviso (soft delete)
-- ----------------------------------------------------------------------------
--
-- AN-5 y D-3: solo ADMIN. PRESIDENT recibe 403 (announcement_requires_admin):
-- puede fijar, corregir y caducar, pero el histórico de lo que la comunidad ya
-- se dijo no se destruye desde un rol que no es el último de la cadena. El
-- precedente es "Eliminar incidencia = ADMIN (soft delete)".
--
-- No es DELETE físico y no toca nada más: los avisos no tienen slots, ni
-- comentarios, ni nada que arrastrar. `and deleted_at is null` es lo que hace
-- que borrar dos veces no salga bien: la segunda vez no toca filas y cae en el
-- mismo 404. No hay 409 "ya borrado" (AN-11).
create or replace function app_delete_announcement(p_announcement uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  v_community := app_announcement_community(p_announcement);

  if v_community is null then
    raise exception 'announcement_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if app_role_in(v_community) is distinct from 'ADMIN' then
    raise exception 'announcement_requires_admin: solo un ADMIN puede borrar avisos'
      using errcode = '42501';
  end if;

  update announcements
     set deleted_at = now()
   where id = p_announcement
     and deleted_at is null;

  if not found then
    raise exception 'announcement_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Políticas RLS
-- ----------------------------------------------------------------------------
--
-- announcements se queda SOLO con announcements_select_member. La de escritura
-- se elimina, y no se sustituye por una versión más restrictiva: sin permiso de
-- INSERT, UPDATE ni DELETE para app_runtime no hay nada que una política pueda
-- decidir (02_rls.sql dio esos tres permisos en su 5.19 y el grant sigue vivo,
-- se revoca en la sección 6).
--
-- La política de SELECT no se toca, pero es deliberadamente MÁS DÉBIL que la
-- ventana de AN-4: no filtra publish_at futuro ni deleted_at. Esa diferencia
-- está asumida en la spec §6 y §11 —ninguna ruta lee announcements con
-- Prisma, todas pasan por app_list_announcements() (AN-3)— y la comprobación de
-- la sección 7 es la advertencia escrita en SQL.
drop policy if exists announcements_write_leadership on announcements;

-- ----------------------------------------------------------------------------
-- 6. Permisos
-- ----------------------------------------------------------------------------
--
-- El revoke es la pieza imprescindible, no decorativa: quitar announcements de
-- la lista de `grant insert, update, delete` de 02_rls.sql no deshace un GRANT
-- ya aplicado. Y se repite contra anon, authenticated por simetría con 02e y
-- 02f: revocar dos veces no cuesta nada y el segundo revoke sobrevive a un
-- `alter default privileges` futuro que pudiera re-conceder algo.
revoke insert, update, delete on announcements from app_runtime;
revoke insert, update, delete on announcements from anon, authenticated;

grant execute on function app_announcement_community(uuid) to app_runtime;
grant execute on function app_list_announcements(uuid, uuid, announcement_type, text, integer, integer) to app_runtime;
grant execute on function app_create_announcement(uuid, text, text, announcement_type, announcement_priority, boolean, timestamptz, timestamptz) to app_runtime;
grant execute on function app_update_announcement(uuid, text, text, announcement_type, announcement_priority, boolean, timestamptz, timestamptz) to app_runtime;
grant execute on function app_delete_announcement(uuid) to app_runtime;

-- El revoke va de PUBLIC y no de anon/authenticated a propósito: revocar del
-- grupo PUBLIC los cubre a todos de una vez y no deja al autor acordarse de un
-- cuarto rol mañana. Mismo criterio que 02b, 02c, 02d, 02e y 02f.
revoke execute on function app_announcement_community(uuid) from public;
revoke execute on function app_list_announcements(uuid, uuid, announcement_type, text, integer, integer) from public;
revoke execute on function app_create_announcement(uuid, text, text, announcement_type, announcement_priority, boolean, timestamptz, timestamptz) from public;
revoke execute on function app_update_announcement(uuid, text, text, announcement_type, announcement_priority, boolean, timestamptz, timestamptz) from public;
revoke execute on function app_delete_announcement(uuid) from public;

-- ----------------------------------------------------------------------------
-- 7. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Que este archivo se ejecute sin errores no demuestra nada: si alguien lo
-- reescribe y se le olvida el `security definer`, o se le olvida revocar un
-- permiso, o borra la línea del drop policy, el archivo se aplicaría igual de
-- limpio y el agujero se instalaría solo, en silencio. Estas comprobaciones son
-- las que fallan en `db:verify`.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las cinco funciones: SECURITY DEFINER, search_path fijo y no ejecutables
  -- por PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_announcement_community', 'app_list_announcements',
         'app_create_announcement', 'app_update_announcement',
         'app_delete_announcement'
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

  -- Y que las cinco estén. El bucle anterior no falla si no hay ninguna.
  for r in
    select unnest(array[
      'app_announcement_community', 'app_list_announcements',
      'app_create_announcement', 'app_update_announcement',
      'app_delete_announcement'
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

  -- announcements: solo lectura desde RLS. Cualquier política de escritura
  -- reabre el camino que AN-2 y D-1 cierran.
  if exists (
    select 1
      from pg_policies
     where tablename = 'announcements'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' announcements tiene politica de escritura; deberia ser solo lectura;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'announcements'
       and policyname = 'announcements_select_member'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta announcements_select_member de SELECT;';
  end if;

  -- Y que el permiso de escritura no exista para nadie, no solo para
  -- app_runtime. Se excluyen postgres (owner) y service_role (recibe todos los
  -- privilegios por ALTER DEFAULT PRIVILEGES de Supabase), igual que en 02e y
  -- 02f.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'announcements'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' announcements tiene INSERT/UPDATE/DELETE concedido a un rol que no debe;';
  end if;

  -- Los dos CHECK de longitud de la sección 1, y si alguien los validó ya
  -- (validarlos revalidaría las filas existentes, que es un paso deliberado y
  -- no un accidente, pero conviene saberlo).
  if not exists (
    select 1
      from pg_constraint
     where conname = 'announcements_title_length'
       and conrelid = 'public.announcements'::regclass
       and contype = 'c'
  ) then
    v_fallos := v_fallos || ' falta announcements_title_length;';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'announcements_body_length'
       and conrelid = 'public.announcements'::regclass
       and contype = 'c'
  ) then
    v_fallos := v_fallos || ' falta announcements_body_length;';
  end if;

  if exists (
    select 1
      from pg_constraint
     where conname in ('announcements_title_length', 'announcements_body_length')
       and conrelid = 'public.announcements'::regclass
       and convalidated = false
  ) then
    raise notice 'AVISO: announcements_title_length/announcements_body_length existen pero siguen sin validar (not valid).';
  end if;

  -- El soporte de la ventana de AN-4 y el orden de AN-8. Ambos ya se cubrían
  -- en las secciones 1 y 5 de 04_verify.sql; se reiteran aquí porque son el
  -- soporte directo de este bloque (spec §10).
  if not exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'announcements_community_publish_idx'
  ) then
    v_fallos := v_fallos || ' falta announcements_community_publish_idx;';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'announcements_dates_valid'
       and conrelid = 'public.announcements'::regclass
       and contype = 'c'
  ) then
    v_fallos := v_fallos || ' falta announcements_dates_valid;';
  end if;

  -- AN-1/AN-5 escritas en las funciones para que no dependan de que nadie lea
  -- la spec: publicar admite a PRESIDENT, borrar no.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_create_announcement'
       and pg_get_functiondef(p.oid) like '%PRESIDENT%'
  ) then
    v_fallos := v_fallos || ' el alta deberia admitir a PRESIDENT (AN-1);';
  end if;

  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_delete_announcement'
       and pg_get_functiondef(p.oid) like '%announcement_requires_admin%'
       and pg_get_functiondef(p.oid) not like '%PRESIDENT%';
  ) then
    v_fallos := v_fallos || ' el borrado deberia ser solo de ADMIN con announcement_requires_admin (AN-5);';
  end if;

  -- La ventana por rol del listado (AN-7): si alguien la sustituye por la
  -- ventana universal, un aviso caducado se vuelve inalcanzable para quien
  -- tiene que borrarlo y el fallo ni siquiera es visible desde el backend.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_list_announcements'
       and pg_get_functiondef(p.oid) like '%app_is_member_of(%'
       and pg_get_functiondef(p.oid) like '%publish_at <= now()%'
       and pg_get_functiondef(p.oid) like '%PRESIDENT%'
  ) then
    v_fallos := v_fallos || ' el listado deberia comprobar pertenencia y aplicar la ventana por rol (AN-4/AN-7);';
  end if;

  -- Y que authorName siga saliendo de una función y no de un join suelto:
  -- la relectura del POST y del PUT pasa por el listado por eso.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_list_announcements'
       and pg_get_functiondef(p.oid) like '%left join users u%'
  ) then
    v_fallos := v_fallos || ' el listado deberia leer author_name con left join users (AN-3);';
  end if;

  if v_fallos <> '' then
    raise exception 'Los avisos no son seguros:%', v_fallos;
  end if;

  raise notice 'OK: announcements solo lectura, tres escrituras por funcion, cinco funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC.';
end $$;

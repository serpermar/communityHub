-- ============================================================================
-- CommunityHub · 02_rls.sql
-- ============================================================================
-- Ejecutar DESPUÉS de 01_schema.sql.
--
-- Row Level Security: la segunda barrera de aislamiento entre comunidades.
--
-- POR QUÉ ESTO NO ES OPCIONAL EN ESTE PROYECTO
-- ---------------------------------------------
-- El backend ya filtra por community_id en cada consulta (eso es el requisito
-- del enunciado y va testeado). RLS añade algo distinto: la garantía de que
-- si algún día alguien escribe un `prisma.incident.findMany()` sin filtro, o
-- añade un cliente Supabase directo desde el frontend para el Realtime, los
-- datos de otra comunidad siguen sin ser accesibles.
--
-- Es defensa en profundidad: dos capas independientes que deben fallar a la vez
-- para que haya una fuga.
--
-- CÓMO FUNCIONA
-- -------------
-- El backend no conecta como superusuario. Conecta con el rol `app_runtime`, y
-- en cada transacción fija dos variables de sesión:
--
--   SET LOCAL app.current_user_id      = '<uuid del usuario>';
--   SET LOCAL app.current_community_id = '<uuid de la comunidad activa>';
--
-- Las políticas leen esas variables. SET LOCAL (no SET) las ata a la transacción
-- actual, así que si la conexión vuelve al pool sin valor, el acceso es cero.
-- Nunca se filtran datos entre peticiones de distintos usuarios.
--
-- MODO DE VERIFICACIÓN
-- --------------------
-- Mientras consultas desde el SQL Editor, la sesión usa el rol `postgres`, que
-- tiene BYPASSRLS: verás todas las filas. Eso es correcto e esperado.
-- Para comprobar que las políticas funcionan hay que impersonar el rol de la
-- aplicación. Al final del script tienes las consultas de prueba.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensiones de soporte
-- ----------------------------------------------------------------------------
-- pg_trgm habilita el índice GIN trigram de búsqueda por texto sobre incidents.
-- Es lo que permite "buscar ascensor" con ILIKE '%ascensor%'.
-- pg_trgm ya está habilitada en 01_schema.sql. Se repite aquí por si este
-- script se ejecuta de forma aislada: `create extension if not exists` no hace
-- nada si ya existe.
create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- 2. Rol de aplicación
-- ----------------------------------------------------------------------------
-- El backend NO usa el usuario postgres. Usa este rol, que:
--   - no es superusuario
--   - no tiene BYPASSRLS
--   - solo puede tocar las tablas de public
--
-- La password se fija después, fuera de este archivo, porque no va hardcodeada
-- en el repositorio. Si ya existe, no se toca.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin;
    raise notice 'Rol app_runtime creado (aun sin LOGIN: se activa manualmente)';
  else
    raise notice 'Rol app_runtime ya existe';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Variables de contexto y funciones auxiliares
-- ----------------------------------------------------------------------------

-- Devuelve el usuario actual, o NULL si no hay contexto.
-- NULL hace que la comparación con = sea NULL, que no es true: acceso denegado.
create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

create or replace function app_current_community_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_community_id', true), '')::uuid
$$;

-- Comprobación de pertenencia. USES SECURITY DEFINER porque la política se
-- evalúa como el usuario de la conexión, que puede no tener SELECT sobre
-- community_members. Esta función es la única puerta de entrada, y no acepta
-- parámetros libres: siempre compara contra la variable de sesión.
create or replace function app_is_member_of(target_community uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from community_members m
    where m.community_id = target_community
      and m.user_id = app_current_user_id()
      and m.status = 'ACTIVE'
  )
$$;

-- Rol del usuario dentro de una comunidad. NULL si no es miembro.
create or replace function app_role_in(target_community uuid)
returns member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from community_members m
  where m.community_id = target_community
    and m.user_id = app_current_user_id()
    and m.status = 'ACTIVE'
$$;

-- ¿El usuario administra la comunidad?
-- ADMIN es el gestor del día a día. PRESIDENT puede crear avisos y votaciones
-- pero no tocar finanzas ni miembros. La diferencia importa en la política de
-- expenses.
create or replace function app_is_admin_of(target_community uuid)
returns boolean
language sql
stable
as $$
  select coalesce(app_role_in(target_community) = 'ADMIN', false)
$$;

-- ¿El usuario es staff de la plataforma (ADMIN_SA)?
--
-- Es el único permiso que NO es de una comunidad: existe para dar de alta
-- comunidades, no para mirar lo que hay dentro de ellas. Por eso va aparte de
-- app_role_in() y por eso communities_select_member no lo consulta.
--
-- DELIBERADAMENTE no acepta ningún usuario como parámetro. Una función
-- SECURITY DEFINER que admitiera "este es admin" sería escalada de privilegios
-- en una llamada: cualquiera podría preguntar por otro. Aquí el único sujeto
-- posible es el de la sesión, que es justo lo que se quiere comprobar.
--
-- SECURITY DEFINER por lo mismo que app_is_member_of: la política se evalúa
-- como el usuario de la conexión, que bajo RLS solo puede ver su propia fila de
-- `users`. Confiar en que la política siga siendo "solo yo" sería atar la
-- autorización a otra política que puede cambiar sin que nadie lo note.
create or replace function app_is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from users u
    where u.id = app_current_user_id()
      and u.global_role = 'ADMIN_SA'
  )
$$;

-- ¿El usuario es PROVIDER con una incidencia asignada?
-- Los proveedores ven únicamente los trabajos que tienen asignados. Es el caso
-- más delicado del RBAC: un proveedor podría leer información financiera de la
-- comunidad si la política fuera solo por pertenencia.
create or replace function app_is_assigned_provider(target_incident uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from incidents i
    where i.id = target_incident
      and i.assigned_to_id = app_current_user_id()
  )
$$;

-- ----------------------------------------------------------------------------
-- 4. Activar RLS
-- ----------------------------------------------------------------------------
-- Las políticas de la sección 5 no se aplican solas: hay que activar RLS en cada
-- tabla. Y activarla no basta para cubrir al dueño de la tabla, de ahí el FORCE.
--
-- ENABLE y FORCE son cosas distintas y hacen falta LAS DOS:
--
--   ENABLE ROW LEVEL SECURITY  -> la activa
--   FORCE  ROW LEVEL SECURITY  -> la aplica también al dueño de la tabla
--
-- FORCE por sí solo NO la activa: solo marca que se aplique al owner. Ejecutar
-- solo el FORCE deja la tabla sin RLS, que es exactamente el fallo que produce
-- "table is not protected by row level security". Por eso van las dos
-- sentencias, siempre juntas, generated desde la misma lista de tablas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'communities', 'community_members', 'incidents',
    'incident_comments', 'common_areas', 'reservations', 'area_slots',
    'announcements', 'documents', 'document_acl', 'expenses', 'invoices',
    'votes', 'vote_options', 'vote_responses', 'notifications', 'sessions',
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
    'incident_drafts', 'ai_usage', 'ai_cache'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Políticas
-- ----------------------------------------------------------------------------
-- Nota sobre UPSERT: para INSERT basta con WITH CHECK, para UPDATE hacen falta
-- USING (qué filas son visibles) y WITH CHECK (en qué se puede convertir). Una
-- tabla con UPDATE pero sin USING deja pasar cualquier UPDATE, que es un agujero.
--
-- Nota sobre DELETE: casi nada se borra de verdad. El soft delete (deleted_at)
-- es un UPDATE, así que está cubierto por las políticas de UPDATE.

-- ----------------------------------------------------------------------------
-- 5.1 users
-- ----------------------------------------------------------------------------
-- Un usuario solo se ve a sí mismo. La comunidad no necesita ver la fila
-- completa de los vecinos: expone nombre y número de unidad vía community_members
-- en la capa de aplicación.
drop policy if exists users_select_self on users;
create policy users_select_self on users
  for select using (id = app_current_user_id());

drop policy if exists users_update_self on users;
create policy users_update_self on users
  for update
  using (id = app_current_user_id())
  with check (id = app_current_user_id());

-- INSERT: cualquiera puede registrarse (el endpoint público de registro).
-- La contraseña llega ya hasheada desde la capa de aplicación.
drop policy if exists users_insert_public on users;
create policy users_insert_public on users
  for insert with check (true);

-- DELETE: solo el propio usuario. Borrar la cuenta debe pasar por soft delete
-- en la aplicación; esta política es el último recurso.

-- ----------------------------------------------------------------------------
-- 5.2 communities
-- ----------------------------------------------------------------------------
-- SELECT: las comunidades de las que soy miembro activo.
drop policy if exists communities_select_member on communities;
create policy communities_select_member on communities
  for select using (app_is_member_of(id) or id = app_current_community_id());

-- UPDATE: solo ADMIN de esa comunidad.
drop policy if exists communities_update_admin on communities;
create policy communities_update_admin on communities
  for update
  using (app_is_admin_of(id))
  with check (app_is_admin_of(id));

-- INSERT: solo el staff de la plataforma, y solo atributiéndose la creación.
--
-- Esta política es la SEGUNDA capa, no la principal. El alta normal la hace
-- app_create_community() (02c_communities.sql), que además crea al primer
-- ADMIN. Pero esa función se ejecuta como su propietario y no pasa por RLS, así
-- que sin esta política el único camino para crear una comunidad sería
-- privilegiado: si alguien escribiera un insert directo en el servicio, nada lo
-- frenaría.
--
-- El `created_by = app_current_user_id()` no es decorativo: obliga a que la
-- comunidad quede atribuida a quien la creó, y no a un id arbitrario que le
-- hayan pasado por el cuerpo.
drop policy if exists communities_insert_admin_sa on communities;
create policy communities_insert_admin_sa on communities
  for insert
  with check (app_is_global_admin() and created_by = app_current_user_id());

-- DELETE: sin política, a propósito.
--
-- Una comunidad no se borra en cascada desde la API: `community_members` tiene
-- ON DELETE CASCADE, así que un DELETE aquí se llevaría por delante a los
-- vecinos, sus incidencias y sus gastos. La baja es lógica
-- (is_active = false) y la hace un ADMIN por el UPDATE de arriba.

-- ----------------------------------------------------------------------------
-- 5.3 community_members
-- ----------------------------------------------------------------------------
-- Ver los miembros de mi comunidad. Necesario para el listado de vecinos y
-- para que un neighbour vea a quién dirigir una incidencia.
drop policy if exists members_select_own_community on community_members;
create policy members_select_own_community on community_members
  for select using (app_is_member_of(community_id));

-- Escribirse a uno mismo (aceptar una invitación) sí se permite: es el camino
-- para que un vecino recién invitado exista en la comunidad.
drop policy if exists members_insert_self on community_members;
create policy members_insert_self on community_members
  for insert
  with check (user_id = app_current_user_id() or app_is_admin_of(community_id));

-- Cambiar el rol de alguien es la operación más sensible del sistema: solo
-- ADMIN. Y el CHECK impide que un ADMIN se degrade a sí mismo por accidente.
drop policy if exists members_update_admin on community_members;
create policy members_update_admin on community_members
  for update
  using (app_is_admin_of(community_id))
  with check (app_is_admin_of(community_id));

drop policy if exists members_delete_admin on community_members;
create policy members_delete_admin on community_members
  for delete using (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 5.4 incidents
-- ----------------------------------------------------------------------------
-- SELECT. Esta es la política central del proyecto. Cuatro ramas, todas
-- evaluadas en el motor:
--   1. NEIGHBOR / PRESIDENT / ADMIN  -> todas las de la comunidad
--   2. NEIGHBOR                     -> solo las suyas
--   3. PROVIDER                     -> solo las que tiene asignadas
drop policy if exists incidents_select_scoped on incidents;
create policy incidents_select_scoped on incidents
  for select using (
    app_is_member_of(community_id)
    and (
      app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
      or reporter_id = app_current_user_id()
      or app_is_assigned_provider(id)
    )
  );

-- INSERT: cualquier miembro activo de la comunidad. Los ADMIN_SA también.
drop policy if exists incidents_insert_member on incidents;
create policy incidents_insert_member on incidents
  for insert with check (
    app_is_member_of(community_id)
    and reporter_id = app_current_user_id()
  );

-- UPDATE: ADMIN y PRESIDENT sobre cualquier incidencia; el vecino sobre la suya
-- (por ejemplo, para subir prioridad o completar datos); el proveedor
-- asignado, para mover el estado de su trabajo.
drop policy if exists incidents_update_scoped on incidents;
create policy incidents_update_scoped on incidents
  for update
  using (
    app_is_member_of(community_id)
    and (
      app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
      or reporter_id = app_current_user_id()
      or app_is_assigned_provider(id)
    )
  )
  with check (
    app_is_member_of(community_id)
    and (
      app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
      or reporter_id = app_current_user_id()
      or app_is_assigned_provider(id)
    )
  );

-- DELETE: solo ADMIN. El soft delete es un UPDATE y ya pasa por la política
-- anterior; el borrado físico se reserva al ADMIN y en la práctica no se usa.

-- ----------------------------------------------------------------------------
-- 5.5 incident_comments
-- ----------------------------------------------------------------------------
-- El comentario hereda el alcance de su incidencia. Un vecino no puede leer
-- comentarios de una incidencia ajena, y no necesita ver la incidencia para que
-- el permiso sea coherente.
drop policy if exists comments_select_via_incident on incident_comments;
create policy comments_select_via_incident on incident_comments
  for select using (
    exists (
      select 1 from incidents i
      where i.id = incident_id
        and (
          app_is_member_of(i.community_id)
          and (
            app_role_in(i.community_id) in ('ADMIN', 'PRESIDENT')
            or i.reporter_id = app_current_user_id()
            or app_is_assigned_provider(i.id)
          )
        )
    )
  );

drop policy if exists comments_insert_author on incident_comments;
create policy comments_insert_author on incident_comments
  for insert with check (
    author_id = app_current_user_id()
    and exists (
      select 1 from incidents i
      where i.id = incident_id
        and (
          app_role_in(i.community_id) in ('ADMIN', 'PRESIDENT')
          or i.reporter_id = app_current_user_id()
          or app_is_assigned_provider(i.id)
        )
    )
  );

drop policy if exists comments_update_author on incident_comments;
create policy comments_update_author on incident_comments
  for update
  using (author_id = app_current_user_id())
  with check (author_id = app_current_user_id());

-- ----------------------------------------------------------------------------
-- 5.6 common_areas
-- ----------------------------------------------------------------------------
-- Todos los miembros ven la configuración de zonas comunes.
drop policy if exists areas_select_member on common_areas;
create policy areas_select_member on common_areas
  for select using (app_is_member_of(community_id));

-- Crear o editar una zona común es decisión del ADMIN.
drop policy if exists areas_admin_write on common_areas;
create policy areas_admin_write on common_areas
  for all
  using (app_is_admin_of(community_id))
  with check (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 5.7 reservations
-- ----------------------------------------------------------------------------
-- SELECT: ADMIN/PRESIDENT ven todas (necesitan gestionar el uso); un vecino ve
-- las suyas y las de los demás en la misma franja, porque si no no puede saber
-- si un hueco está libre. Mostrar el nombre del vecino que reservó es
-- información razonable dentro de la comunidad.
drop policy if exists reservations_select_scoped on reservations;
create policy reservations_select_scoped on reservations
  for select using (
    app_is_member_of(community_id)
    and (
      app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
      or user_id = app_current_user_id()
    )
  );

-- INSERT: solo sobre la propia cuenta, y solo siendo miembro activo.
-- La comprobación de horarios, capacidad y disponibilidad NO está aquí: eso lo
-- hace la aplicación. RLS no puede validar reglas de negocio complejas sin
-- volverse inmanejable.
drop policy if exists reservations_insert_self on reservations;
create policy reservations_insert_self on reservations
  for insert with check (
    app_is_member_of(community_id)
    and user_id = app_current_user_id()
  );

-- UPDATE: cancelar solo la propia; ADMIN puede cambiar estado de cualquiera.
drop policy if exists reservations_update_scoped on reservations;
create policy reservations_update_scoped on reservations
  for update
  using (
    app_is_member_of(community_id)
    and (app_role_in(community_id) = 'ADMIN' or user_id = app_current_user_id())
  )
  with check (
    app_is_member_of(community_id)
    and (app_role_in(community_id) = 'ADMIN' or user_id = app_current_user_id())
  );

drop policy if exists reservations_delete_admin on reservations;
create policy reservations_delete_admin on reservations
  for delete using (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 5.8 area_slots
-- ----------------------------------------------------------------------------
-- Los slots siguen a la reserva: su alcance es el de reservations.
-- Exponerlos sin filtrar revelaría la agenda de la piscina al vecindario.
drop policy if exists slots_via_reservation on area_slots;
create policy slots_via_reservation on area_slots
  for select using (
    exists (
      select 1 from reservations r
      where r.id = reservation_id
        and app_is_member_of(r.community_id)
        and (
          app_role_in(r.community_id) in ('ADMIN', 'PRESIDENT')
          or r.user_id = app_current_user_id()
        )
    )
  );

-- INSERT: los crea la aplicación al confirmar la reserva, en la misma
-- transacción. La política exige que la reserva sea del propio usuario, así que
-- un PROVIDER no puede ocupar slots.
drop policy if exists slots_insert_own_reservation on area_slots;
create policy slots_insert_own_reservation on area_slots
  for insert with check (
    exists (
      select 1 from reservations r
      where r.id = reservation_id
        and r.user_id = app_current_user_id()
        and app_is_member_of(r.community_id)
    )
  );

-- El borrado en cascada (al cancelar) lo ejecuta el motor; DELETE no necesita
-- política propia para propagating desde el padre.

-- ----------------------------------------------------------------------------
-- 5.9 announcements
-- ----------------------------------------------------------------------------
drop policy if exists announcements_select_member on announcements;
create policy announcements_select_member on announcements
  for select using (
    app_is_member_of(community_id)
    and (expires_at is null or expires_at > now())
  );

-- PUBLICAR avisos es de PRESIDENT y ADMIN: es una decisión de la comunidad, no
-- unposted personal.
drop policy if exists announcements_write_leadership on announcements;
create policy announcements_write_leadership on announcements
  for all
  using (
    app_is_member_of(community_id)
    and app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
  )
  with check (
    app_is_member_of(community_id)
    and app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
  );

-- ----------------------------------------------------------------------------
-- 5.10 documents
-- ----------------------------------------------------------------------------
-- El caso más delicado. Por defecto, un documento es visible si:
--   - soy ADMIN (ve todos), o
--   - is_public = true, o
--   - min_role es NEIGHBOR (visible para cualquier miembro), o
--   - soy PROVIDER/PRESIDENT/ADMIN según el min_role, o
--   - estoy en la ACL explícita del documento.
--
-- La comparación de roles usa el orden de la enumeración, que es
-- NEIGHBOR < PROVIDER < PRESIDENT < ADMIN. Es intencionado: un requisito de
-- ADMIN no lo cumple un PRESIDENT.
drop policy if exists documents_select_scoped on documents;
create policy documents_select_scoped on documents
  for select using (
    app_is_admin_of(community_id)
    or (
      app_is_member_of(community_id)
      and (
        is_public
        or min_role = 'NEIGHBOR'
        or app_role_in(community_id) >= min_role
        or exists (
          select 1 from document_acl a
          where a.document_id = id
            and a.user_id = app_current_user_id()
            and a.can_view
        )
      )
    )
  );

drop policy if exists documents_insert_admin on documents;
create policy documents_insert_admin on documents
  for insert with check (app_is_admin_of(community_id));

drop policy if exists documents_update_admin on documents;
create policy documents_update_admin on documents
  for update
  using (app_is_admin_of(community_id))
  with check (app_is_admin_of(community_id));

drop policy if exists documents_delete_admin on documents;
create policy documents_delete_admin on documents
  for delete using (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 5.11 document_acl
-- ----------------------------------------------------------------------------
-- Solo visible el ACL de documentos que uno ya puede ver. Evita que un vecino
-- descubra qué otros vecinos tienen acceso a un acta.
drop policy if exists acl_select_scoped on document_acl;
create policy acl_select_scoped on document_acl
  for select using (
    exists (
      select 1 from documents d
      where d.id = document_id
        and (
          app_is_admin_of(d.community_id)
          or (
            app_is_member_of(d.community_id)
            and (
              d.is_public or d.min_role = 'NEIGHBOR'
              or app_role_in(d.community_id) >= d.min_role
            )
          )
          or exists (
            select 1 from document_acl inner_acl
            where inner_acl.document_id = d.id
              and inner_acl.user_id = app_current_user_id()
              and inner_acl.can_view
          )
        )
    )
  );

drop policy if exists acl_write_admin on document_acl;
create policy acl_write_admin on document_acl
  for all
  using (
    exists (
      select 1 from documents d
      where d.id = document_id and app_is_admin_of(d.community_id)
    )
  )
  with check (
    exists (
      select 1 from documents d
      where d.id = document_id and app_is_admin_of(d.community_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 5.12 expenses
-- ----------------------------------------------------------------------------
-- Solo ADMIN ve el detalle de gastos. Ni PRESIDENT ni PROVIDER: es
-- información financiera interna. El PRESIDENT recibe un resumen agregado por
-- otra vía (la vista de resumen no expone filas individuales).
drop policy if exists expenses_admin_only on expenses;
create policy expenses_admin_only on expenses
  for all
  using (app_is_admin_of(community_id))
  with check (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 5.13 invoices
-- ----------------------------------------------------------------------------
-- ADMIN ve todas. Cada vecino puede ver sus propias facturas de cuotas.
drop policy if exists invoices_select_scoped on invoices;
create policy invoices_select_scoped on invoices
  for select using (
    app_is_admin_of(community_id)
    or (
      app_is_member_of(community_id)
      and exists (
        select 1 from community_members m
        where m.community_id = invoices.community_id
          and m.user_id = app_current_user_id()
          and m.status = 'ACTIVE'
      )
    )
  );

drop policy if exists invoices_write_admin on invoices;
create policy invoices_write_admin on invoices
  for all
  using (app_is_admin_of(community_id))
  with check (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 5.14 votes
-- ----------------------------------------------------------------------------
-- Ver una votación: cualquier miembro activo.
drop policy if exists votes_select_member on votes;
create policy votes_select_member on votes
  for select using (app_is_member_of(community_id));

-- Crear y publicar votaciones: PRESIDENT y ADMIN.
drop policy if exists votes_write_leadership on votes;
create policy votes_write_leadership on votes
  for all
  using (
    app_is_member_of(community_id)
    and app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
  )
  with check (
    app_is_member_of(community_id)
    and app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
  );

-- ----------------------------------------------------------------------------
-- 5.15 vote_options
-- ----------------------------------------------------------------------------
-- Las opciones se ven si la votación es visible y ya está publicada. Un DRAFT no
-- debe filtrarse: contiene la pregunta antes de que la comunidad la conozca.
drop policy if exists options_select_visible_vote on vote_options;
create policy options_select_visible_vote on vote_options
  for select using (
    exists (
      select 1 from votes v
      where v.id = vote_id
        and v.status <> 'DRAFT'
        and app_is_member_of(v.community_id)
    )
  );

drop policy if exists options_write_leadership on vote_options;
create policy options_write_leadership on vote_options
  for all
  using (
    exists (
      select 1 from votes v
      where v.id = vote_id
        and app_is_member_of(v.community_id)
        and app_role_in(v.community_id) in ('ADMIN', 'PRESIDENT')
    )
  )
  with check (
    exists (
      select 1 from votes v
      where v.id = vote_id
        and app_is_member_of(v.community_id)
        and app_role_in(v.community_id) in ('ADMIN', 'PRESIDENT')
    )
  );

-- ----------------------------------------------------------------------------
-- 5.16 vote_responses
-- ----------------------------------------------------------------------------
-- SELECT: un vecino ve SU voto. Ver los votos ajenos es secreto de voto.
-- ADMIN ve todos para recuento y quórum, pero esa lectura pasa por una función
-- SECURITY DEFINER en la capa de aplicación, no por la política general, para
-- que el recuento no quede expuesto en un listado accidental.
drop policy if exists responses_select_own_or_admin on vote_responses;
create policy responses_select_own_or_admin on vote_responses
  for select using (
    user_id = app_current_user_id()
    or exists (
      select 1 from votes v
      where v.id = vote_id
        and app_is_admin_of(v.community_id)
    )
  );

-- INSERT y UPDATE: solo el propio voto, y solo en votaciones abiertas.
-- La condición status = 'OPEN' es una garantía real: aunque la aplicación
-- tuviera un fallo, no se puede votar en una votación cerrada.
drop policy if exists responses_insert_own_open_vote on vote_responses;
create policy responses_insert_own_open_vote on vote_responses
  for insert with check (
    user_id = app_current_user_id()
    and exists (
      select 1 from votes v
      where v.id = vote_id
        and v.status = 'OPEN'
        and now() >= v.starts_at
        and now() <= v.ends_at
        and app_is_member_of(v.community_id)
    )
  );

drop policy if exists responses_update_own_open_vote on vote_responses;
create policy responses_update_own_open_vote on vote_responses
  for update
  using (user_id = app_current_user_id())
  with check (
    user_id = app_current_user_id()
    and exists (
      select 1 from votes v
      where v.id = vote_id and v.status = 'OPEN'
    )
  );

-- Sin política de DELETE: cambiar de voto se hace con un UPSERT
-- (ON CONFLICT DO UPDATE), que pasa por la política de UPDATE. Así es
-- imposible que un vecino borre su voto por una vía no prevista.

-- ----------------------------------------------------------------------------
-- 5.17 notifications
-- ----------------------------------------------------------------------------
-- Estrictamente personales. La pertenencia a la comunidad no da acceso a las
-- notificaciones de otro: pueden contener información sobre su actividad.
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications
  for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

-- ----------------------------------------------------------------------------
-- 5.18 sessions
-- ----------------------------------------------------------------------------
-- Un usuario solo gestiona sus propias sesiones. Nunca puede leer las de otro:
-- esa tabla contiene hashes de refresh tokens.
drop policy if exists sessions_own on sessions;
create policy sessions_own on sessions
  for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

-- ----------------------------------------------------------------------------
-- 5.19 audit_logs
-- ----------------------------------------------------------------------------
-- ADMIN de la comunidad ve el registro de su comunidad. Append-only: no hay
-- política de UPDATE ni DELETE en ningún caso, y además hay un trigger que
-- bloquea la operación a nivel de motor.
drop policy if exists audit_select_admin on audit_logs;
create policy audit_select_admin on audit_logs
  for select using (app_is_admin_of(community_id));

drop policy if exists audit_insert_any_authenticated on audit_logs;
create policy audit_insert_any_authenticated on audit_logs
  for insert with check (app_current_user_id() is not null);

-- ----------------------------------------------------------------------------
-- 5.20 ai_chat_sessions / ai_chat_messages
-- ----------------------------------------------------------------------------
-- Las conversaciones son privadas de quien las tuvo.
drop policy if exists ai_sessions_own on ai_chat_sessions;
create policy ai_sessions_own on ai_chat_sessions
  for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

drop policy if exists ai_messages_own on ai_chat_messages;
create policy ai_messages_own on ai_chat_messages
  for all
  using (
    exists (
      select 1 from ai_chat_sessions s
      where s.id = session_id and s.user_id = app_current_user_id()
    )
  )
  with check (
    exists (
      select 1 from ai_chat_sessions s
      where s.id = session_id and s.user_id = app_current_user_id()
    )
  );

-- ----------------------------------------------------------------------------
-- 5.21 incident_drafts
-- ----------------------------------------------------------------------------
-- Un draft es del usuario que lo generó. Nadie más lo ve, ni siquiera el ADMIN:
-- contiene texto libre que el vecino aún no ha decidido publicar.
drop policy if exists drafts_own on incident_drafts;
create policy drafts_own on incident_drafts
  for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

-- ----------------------------------------------------------------------------
-- 5.22 ai_usage
-- ----------------------------------------------------------------------------
-- Cada usuario ve su propio consumo de IA.
drop policy if exists ai_usage_own on ai_usage;
create policy ai_usage_own on ai_usage
  for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

-- ----------------------------------------------------------------------------
-- 5.23 ai_cache
-- ----------------------------------------------------------------------------
-- Caché compartida entre usuarios: NO tiene RLS utilizable por la aplicación.
--
-- Es intencionado. Las respuestas de la caché son Classification de incidencias
-- (categoría, prioridad, título) derivadas de texto que el usuario ya escribió.
-- No contiene datos de negocio ni identificadores de comunidad, así que que dos
-- usuarios compartan una entrada no filtra información entre comunidades.
--
-- La app NO usa el rol app_runtime contra esta tabla. Escribe y lee a través de
-- funciones SECURITY DEFINER dedicadas, que son la única superficie expuesta.
revoke all on ai_cache from public;

create or replace function app_ai_cache_get(key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  update ai_cache
     set hit_count = hit_count + 1
   where input_hash = key
     and expires_at > now()
  returning result
$$;

create or replace function app_ai_cache_put(
  key text, kind text, value jsonb, ttl_hours integer default 168
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into ai_cache (input_hash, kind, result, expires_at)
  values (key, kind, value, now() + make_interval(hours => ttl_hours))
  on conflict (input_hash) do update
    set result = excluded.result,
        kind = excluded.kind,
        expires_at = excluded.expires_at,
        hit_count = ai_cache.hit_count + 1;
end;
$$;

grant execute on function app_ai_cache_get(text) to app_runtime;
grant execute on function app_ai_cache_put(text, text, jsonb, integer) to app_runtime;

-- ----------------------------------------------------------------------------
-- 6. Permisos del rol de aplicación
-- ----------------------------------------------------------------------------
-- PRIMERO, revocar los permisos por defecto de Supabase.
--
-- En un proyecto nuevo, Supabase concede automáticamente SELECT, INSERT, UPDATE
-- y DELETE sobre TODAS las tablas del esquema public a los roles `anon` y
-- `authenticated`. Son los roles que usa la API de PostgREST con las claves
-- públicas del proyecto.
--
-- Añadir políticas RLS NO elimina esos permisos: son dos capas distintas. Las
-- políticas filtran filas, los permisos conceden o niegan la operación. Dejar los
-- grants por defecto significa que cualquier tabla a la que se le olvide una
-- política queda alcanzable desde Internet con la anon key.
--
-- En CommunityHub el frontend NO habla con Supabase: todo pasa por el backend,
-- que conecta como app_runtime. Por tanto anon y authenticated no necesitan
-- ningún permiso sobre las tablas del dominio. Se revocan todos.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Y en adelante: cualquier tabla nueva nace sin permisos para los roles
-- públicos. Sin esto, basta con crear una tabla nueva y forgetting de revocarle
-- los grants para que quede expuesta.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Comprobación: debe devolver 0 filas.
-- Si aparece alguna, hay una tabla con permisos para roles públicos.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, privilege_type;

-- GRANT por tabla para el backend. Explícito en lugar de dar ALL.
grant usage on schema public to app_runtime;

grant select on
  users, communities, community_members, incidents, incident_comments,
  common_areas, reservations, area_slots, announcements, documents,
  document_acl, invoices, votes, vote_options, vote_responses,
  notifications, audit_logs, ai_chat_sessions, ai_chat_messages
  to app_runtime;

-- expenses: solo lectura. Las escrituras pasan por función dedicada para dejar
-- rastro de auditoría.
grant select on expenses to app_runtime;

grant insert, update on users, community_members, incidents, incident_comments,
  reservations, area_slots, document_acl, notifications, vote_responses,
  ai_chat_sessions, ai_chat_messages, incident_drafts, ai_usage
  to app_runtime;

grant insert, update, delete on
  communities, common_areas, announcements, documents, invoices,
  votes, vote_options
  to app_runtime;

grant select, update on sessions to app_runtime;
grant insert on sessions to app_runtime;
grant delete on sessions to app_runtime;

grant insert on audit_logs to app_runtime;
grant select, update on audit_logs to app_runtime;   -- el trigger bloquea el UPDATE

-- Secuencias: necesarias solo si alguna tabla usara SERIAL. No es el caso
-- (todas las PK son uuid), pero sin este GRANT cualquier uso futuro de
-- DEFAULT nextval fallaría con permiso denegado en vez de un error claro.
grant usage on all sequences in schema public to app_runtime;

-- ----------------------------------------------------------------------------
-- 5.20 Sesiones: el punto ciego del login
-- ----------------------------------------------------------------------------
-- La política sessions_own de la seccion 5.18 exige user_id =
-- app_current_user_id(). Funciona para "ver mis sesiones" y "cerrar sesion",
-- donde el usuario ya esta autenticado.
--
-- Pero el login y el refresh NECESITAN buscar por email y por token_hash antes
-- de saber quien es el usuario. Con esa politica devuelven 0 filas siempre, y el
-- sistema de autenticacion no se podria construir. No es un bug de la politica:
-- es que la politica no puede cubrir ese caso por definicion.
--
-- La resolucion son tres funciones SECURITY DEFINER, cada una acotada a una
-- sola operacion, en 02b_auth.sql. Se ejecutan despues de este archivo.
--
-- Es una decision consciente, no un descuido: se abre una puerta muy pequena y
-- controlada para que el hash de la contrasena sea consultable antes de
-- autenticar. La alternativa (hacer el login con el rol postgres, que tiene
-- BYPASSRLS) seria mucho peor: ese rol tambien podria saltarse todas las
-- demas politicas.
--
-- ----------------------------------------------------------------------------
-- 7. La app_runtime NO tiene permisos sobre ai_cache
-- ----------------------------------------------------------------------------
-- ai_cache se gestiona solo por las dos funciones SECURITY DEFINER de la
-- sección 5.23. El GRANT explícito de abajo es la única vía de acceso.
revoke all on ai_cache from app_runtime;

-- ----------------------------------------------------------------------------
-- 8. Verificación de políticas
-- ----------------------------------------------------------------------------
-- Debe listar una política por tabla. Si una tabla aparece en la lista de abajo
-- y no tiene políticas, todo el acceso está denegado para app_runtime, que
-- normalmente es lo que uno quiere: deny by default.
do $$
declare
  t text;
  n integer;
begin
  foreach t in array array[
    'users', 'communities', 'community_members', 'incidents',
    'incident_comments', 'common_areas', 'reservations', 'area_slots',
    'announcements', 'documents', 'document_acl', 'expenses', 'invoices',
    'votes', 'vote_options', 'vote_responses', 'notifications', 'sessions',
    'audit_logs', 'ai_chat_sessions', 'ai_chat_messages',
    'incident_drafts', 'ai_usage', 'ai_cache'
  ] loop
    select count(*) into n
    from pg_policies
    where schemaname = 'public' and tablename = t;

    raise notice '  % -> % políticas', rpad(t, 22), n;
  end loop;
end $$;

-- Comprobación de que RLS está realmente activo Y forzado. Si una tabla
-- aparece aquí, algo se ejecutó a medias.
do $$
declare
  offenders text := '';
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
  loop
    offenders := offenders || r.relname || ' ';
  end loop;

  if offenders <> '' then
    raise exception 'RLS incompleta (enable o force) en: %', offenders;
  end if;

  raise notice 'OK · RLS activada y forzada en todas las tablas de public';
end $$;
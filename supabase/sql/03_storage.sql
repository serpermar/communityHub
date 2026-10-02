-- ============================================================================
-- CommunityHub · 03_storage.sql
-- ============================================================================
-- Ejecutar DESPUÉS de 01_schema.sql y 02_rls.sql.
--
-- Configura los buckets de Supabase Storage y, sobre todo, sus políticas.
-- Un bucket sin políticas de RLS es un archivo público: cualquiera que conozca
-- la URL puede descargarlo. Es el error más habitual al integrar Storage.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensión
-- ----------------------------------------------------------------------------
-- pgsodium (nombre anterior de pgsodium) es la base del módulo crypto de
-- Postgres. Necesaria para pgcrypto cuando está compilado de otra forma.
-- Supabase ya la trae; se deja explícita por si acaso.
create extension if not exists pgsodium;

-- ----------------------------------------------------------------------------
-- 2. Buckets
-- ----------------------------------------------------------------------------
-- `public = false` es lo importante: los buckets PRIVADOS.
--
-- El plan Free da 1 GB de almacenamiento. Un acta de comunidad en PDF pesa unos
-- 200 KB, así que el margen es amplio para el uso real del proyecto.
--
-- La primera carpeta de cada ruta es el community_id. Aísla también en el
-- storage, no solo en la base de datos: ni siquiera una URL firmada de otra
-- comunidad resuelve.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'community-documents',
    'community-documents',
    false,
    10485760,    -- 10 MB por archivo
    array[
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'
    ]
  )
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Bucket para las imágenes de avatar de los usuarios.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-avatars',
  'user-avatars',
  false,
  2097152,     -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 3. Políticas de Storage
-- ----------------------------------------------------------------------------
-- Estas políticas son para el acceso DIRECTO al Storage (PostgREST storage API,
-- que usan las claves anon/authenticated de Supabase).
--
-- El flujo principal de CommunityHub NO es ese: el backend descarga desde el
-- bucket, valida permisos en la capa de aplicación y devuelve una signed URL
-- de corta duración. Esas políticas son la segunda capa, para el día que
-- alguien conecte el frontend directamente.
--
-- Mismo principio que en 02_rls.sql: sin contexto de sesión, no hay acceso.

-- ----------------------------------------------------------------------------
-- 3.1 community-documents: SELECT
-- ----------------------------------------------------------------------------
-- Traduce la lógica de documentos: primer segmento de la ruta = community_id.
--   /<community_id>/<documento>.pdf
--
-- Reutiliza el mismo criterio de visibilidad que documents en 02_rls.sql.
drop policy if exists "documents read scoped"
  on storage.objects;

create policy "documents read scoped"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'community-documents'
    and app_is_member_of(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 3.2 community-documents: INSERT
-- ----------------------------------------------------------------------------
-- Solo ADMIN puede subir. Y solo en la carpeta de una comunidad donde es ADMIN:
-- la comparación del primer segmento impide escribir en la carpeta de otra
-- comunidad aunque pertenezcas a las dos.
drop policy if exists "documents upload admin"
  on storage.objects;

create policy "documents upload admin"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'community-documents'
    and app_is_admin_of(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 3.3 community-documents: UPDATE / DELETE
-- ----------------------------------------------------------------------------
drop policy if exists "documents update admin"
  on storage.objects;

create policy "documents update admin"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'community-documents'
    and app_is_admin_of(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'community-documents'
    and app_is_admin_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "documents delete admin"
  on storage.objects;

create policy "documents delete admin"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'community-documents'
    and app_is_admin_of(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- 3.4 user-avatars
-- ----------------------------------------------------------------------------
-- Rutas con el formato <user_id>/<archivo>. Solo el dueño escribe, solo el
-- dueño o un miembro de la comunidad lee. La lectura pública se resuelve
-- después en el frontend (un avatar visible en una lista de vecinos no necesita
-- ser secreto).
drop policy if exists "avatars read members"
  on storage.objects;

create policy "avatars read members"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'user-avatars');

drop policy if exists "avatars upload own"
  on storage.objects;

create policy "avatars upload own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = app_current_user_id()::text
  );

drop policy if exists "avatars update own"
  on storage.objects;

create policy "avatars update own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = app_current_user_id()::text
  )
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = app_current_user_id()::text
  );

drop policy if exists "avatars delete own"
  on storage.objects;

create policy "avatars delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = app_current_user_id()::text
  );

-- ----------------------------------------------------------------------------
-- 4. Verificación
-- ----------------------------------------------------------------------------
-- Los buckets deben existir y ser privados. public = false en ambos.
select
  id              as bucket,
  public          as es_publico,
  file_size_limit as limite_bytes
from storage.buckets
where id in ('community-documents', 'user-avatars')
order by id;

-- Expectativa: 5 políticas (3 de documents + ... ) sobre 'community-documents'
-- y 4 sobre 'user-avatars'. Si falta alguna, el acceso correspondiente queda
-- denegado.
select policyname, cmd, roles::text as roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
# Skill: base de datos y RLS

## Cuándo usarla
Al escribir consultas, migraciones, funciones SQL o cualquier cosa que toque
Postgres/Prisma.

## Contexto que hay que tener presente
- Hay dos conexiones: `DATABASE_URL` (rol `app_runtime`, sujeto a RLS) y
  `MIGRATION_DATABASE_URL` (rol `postgres`, con BYPASSRLS, solo para migraciones,
  seed y fixtures). Invertirlas desactiva el aislamiento sin dar ningún error.
- El contexto de RLS se fija con `set_config(..., true)` (LOCAL) dentro de una
  transacción. Nunca con `SET` normal: el valor se pegaría a la conexión del pool.
- El puerto es el 5432 (Session pooler). El 6543 pierde el contexto entre
  transacciones.

## Procedimiento
1. Todo acceso a datos pasa por `withContext({ userId, communityId }, (tx) => …)`.
3. Nada de SQL construido con interpolación de cadenas del cliente: usa plantillas
  parametrizadas de Prisma (`$queryRaw` / `$executeRaw`).
3. Los nombres de columna van literales; los valores, como parámetros ligados.
4. Para migraciones, escribe el SQL y pruébalo con `db:apply` antes de darlo por
   bueno.

## Errores típicos
- Leer con el cliente singleton fuera de `withContext`: las políticas RLS
  devuelven cero filas o, con el rol equivocado, todas.
- Usar `SET` en vez de `set_config(..., true)`.
- Confiar en que el `communityId` del cliente es legítimo sin comprobarlo.

## Verificación
- Un test de aislamiento: el mismo `select` con dos contextos devuelve conjuntos
  disjuntos.
- `select rolbypassrls from pg_roles where rolname = current_user` es `false`.

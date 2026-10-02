# SQL para Supabase · CommunityHub

Cinco scripts para ejecutar **en este orden** en el SQL Editor de Supabase
(*Dashboard → proyecto → SQL Editor → New query → Run*).

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `01_schema.sql` | Extensiones, 19 ENUMs, 24 tablas, índices, FKs, triggers |
| 2 | `02_rls.sql` | Rol `app_runtime`, revocación de permisos a `anon`, RLS y políticas |
| 3 | `02b_auth.sql` | Tres funciones `SECURITY DEFINER` para login y refresh token |
| 4 | `03_storage.sql` | Buckets privados y sus políticas |
| 5 | `04_verify.sql` | Comprobaciones; debe terminar todo en verde |

Cada script es **idempotente**: se puede volver a ejecutar sin romper nada.

---

## Orden y por qué

```
01_schema.sql   →  las tablas y los ENUMs existen
02_rls.sql      →  las políticas referencian esas tablas
02b_auth.sql    →  las funciones de auth, que usan las políticas ya creadas
03_storage.sql  →  los buckets y políticas de Storage
04_verify.sql   →  todo lo anterior está en su sitio
```

`02b_auth.sql` va después de `02_rls.sql` porque concede permisos sobre
funciones que leen `users` y `sessions`, y necesita que el rol `app_runtime` ya
esté creado.

Si ejecutas `02_rls.sql` antes que `01_schema.sql`, falla con
`relation "users" does not exist`. No es un error recuperable dentro del mismo
script: vuelve a empezar por el 1.

---

## Orden de ejecución paso a paso

### 0. Antes de nada

Crea el proyecto en [supabase.com](https://supabase.com) con el plan **Free**.
No hace falta tarjeta. Anota dos datos, los usarás en el `.env`:

- **Project URL** → `Settings → API`
- **service_role key** → `Settings → API → Service Role` (el que empieza por
  `eyJ...` y está en el bloque *service_role*)

> La `anon` key es pública por diseño. En este proyecto el frontend **no** habla
> directamente con Supabase: todo pasa por el backend, así que la clave que
> necesita el servidor es la `service_role`, y solo en el backend.

---

### 1. `01_schema.sql`

Pega el contenido completo y pulsa **Run**.

**Si aparece el aviso "Potential issues detected", elige `Run without RLS`.**

El aviso salta porque el script crea 24 tablas y el editor no ve un
`enable row level security` en el mismo envío. Es un aviso de precaution de
Supabase, no un error. RLS se activa en `02_rls.sql`, con `force row level
security`, que es más estricto: aplica también al dueño de la tabla.

(`Run and enable RLS` no rompería nada, pero añadiría un `enable` sin `force`
por tu cuenta y luego `02_rls.sql` lo sobrescribiría. Mejor una sola fuente.)

Resultado esperado en el panel de mensajes:

```
NOTICE: CommunityHub · tablas creadas: 24
```

**Comprueba que terminó sin errores.** Si aparece un error rojo, léelo entero:
Postgres aborta el script en la instrucción que falla, así que puede haberse
creado solo la mitad. En ese caso vuelve a ejecutarlo desde el principio (los
`if not exists` lo hacen seguro).

### 2. `02_rls.sql`

Igual. Resultado esperado:

```
NOTICE: Rol app_runtime creado (aun sin LOGIN: se activa manualmente)
NOTICE:   users                   -> 2 políticas
NOTICE:   incidents               -> 3 políticas
...
NOTICE: OK · RLS activada y forzada en todas las tablas de public
```

Esa última línea es la importante. Si aparece un `ERROR` en su lugar, las tablas
no están protegidas y hay que volver a ejecutar este script entero.

También revocará todos los permisos que Supabase concede por defecto a `anon` y
`authenticated`. La consulta que hay justo después debe devolver **0 filas**.

> `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY` no son sinónimos:
> el primero activa la política, el segundo la extiende al dueño de la tabla.
> Make falta los dos. Si solo ejecutas `FORCE`, Postgres no activa nada y la
> tabla queda sin proteger.

**Este script deja `app_runtime` sin contraseña.** Es intencionado: la clave se
establece después, en tu máquina, y no vive en ningún archivo del repositorio.

### 3. `02b_auth.sql`

Tres funciones `SECURITY DEFINER`: buscar usuario por email, buscar sesión por
hash de refresh token, y revocar una familia de sesiones entera.

Existen por un motivo concreto. Las políticas de `02_rls.sql` comparan siempre
contra `app_current_user_id()`, así que en el login y en el refresh devuelven 0
filas: en esos dos momentos todavía no se sabe quién es el usuario. Sin estas
funciones el sistema de autenticación no se puede construir.

Debe terminar con:

```
NOTICE:   OK · app_auth_find_user_by_email
NOTICE:   OK · app_auth_find_session_by_hash
NOTICE:   OK · app_auth_revoke_family
NOTICE: OK · funciones de auth listas
NOTICE: OK · app_runtime puede ejecutar las 3 funciones
```

Si ves `ERROR: Funciones de auth incorrectas:`, el `search_path` no quedó fijo o
falta `SECURITY DEFINER`. Sin `set search_path = public, pg_temp`, cualquiera que
pueda crear un objeto en el schema de búsqueda puede sustituir la función y
ejecutar su código con estos privilegios.

### 4. `03_storage.sql`

Igual. Debe crear los dos buckets. Si ves un error sobre el bucket ya existente,
es que lo habías creado a mano: `on conflict do update` lo resuelve.

### 5. `04_verify.sql`

Este es el que importa. Pégalo y ejecútalo **completo**, sin seleccionar partes.

Si todo está bien verás nueve líneas `NOTICE: OK · ...` y después una tabla
final con los recuentos:

```
comprobacion                                   | valor
-----------------------------------------------+-----------------------------------
Tablas                                         | 24
ENUMs                                          | 19
Tablas con RLS (enable)                        | 24
Tablas con RLS (force)                         | 24
Grants a anon/authenticated (debe ser 0)      | 0
Funciones de auth (debe ser 3)                 | 3
Grants de auth a PUBLIC (debe ser 0)           | 0
Buckets                                        | 2
```

Los dos recuentos de RLS tienen que dar 24. Si `enable` da 24 y `force` da 0,
se ejecutó un `FORCE` sin su `ENABLE` delante.

Los dos de auth tienen que dar 3 y 0. Si `Funciones de auth` da menos de 3,
falta ejecutar `02b_auth.sql`. Si `Grants de auth a PUBLIC` da algo distinto de
0, cualquiera podría leer el hash de contraseña de cualquier vecino: revisa los
`revoke execute ... from public` al final de `02b_auth.sql`.

Si falla, se detiene ahí y te dice exactamente qué falta:

```
ERROR:  FALTAN ÍNDICES ÚNICOS: area_slots_no_overlap_uidx
ERROR:  RLS incompleta en: expenses (sin ENABLE) incidents (sin FORCE)
ERROR:  Solo 2 de 3 funciones de auth existen. Falta ejecutar 02b_auth.sql
ERROR:  Funciones de auth inseguras: app_auth_revoke_family (search_path sin fijar)
```

Esa información es precisa, y ahora distingue entre `sin ENABLE` y `sin FORCE`
para localizar el problema de una. Corrige la causa y vuelve a ejecutar
`04_verify.sql` (no hace falta repetir los anteriores, salvo que el fallo sea de
RLS: entonces reejecuta `02_rls.sql` entero).

---

## El paso que falta: activar el rol `app_runtime`

`02_rls.sql` crea el rol **sin login**, porque poner una contraseña en un
archivo del repositorio sería exactamente el error que el enunciado prohíbe.

Necesitas dos conexiones distintas:

| Conexión | Usuario | Para qué |
|---|---|---|
| **Migraciones y setup** | `postgres` (la service role) | Crear tablas, policies, buckets. El rol `postgres` tiene `BYPASSRLS`, así que no le afectan las políticas. |
| **La aplicación en runtime** | `app_runtime` | Servir peticiones. **No** tiene bypass: las políticas se aplican de verdad. |

Para activar el rol, abre el **SQL Editor de Supabase** y ejecuta esto cambiando
la contraseña:

```sql
alter role app_runtime with login password 'UNA_CONTRASENA_LARGA_Y_ALEATORIA';
```

Y añade la conexión a tu `.env` (fuera de Git). Copia `.env.example` de la raíz
del proyecto, que ya trae la estructura y los comentarios:

```powershell
copy .env.example .env
```

Las dos variables. **El orden de los roles importa**, porque cada una va a un
consumidor distinto y equivocarse no da ningún error visible:

| Variable | Rol | Quién la consume |
|---|---|---|
| `DATABASE_URL` | `app_runtime` | Prisma Client, en **cada petición**. RLS se aplica de verdad. |
| `MIGRATION_DATABASE_URL` | `postgres` | Solo `prisma db pull` y scripts de setup. Tiene `BYPASSRLS`. |

```dotenv
DATABASE_URL="postgresql://app_runtime.ABCDEFGHIJKLMNOP:UNA_CONTRASENA_LARGA_Y_ALEATORIA@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require"

MIGRATION_DATABASE_URL="postgresql://postgres.ABCDEFGHIJKLMNOP:UNA_CONTRASENA_LARGA_Y_ALEATORIA@aws-1-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require"
```

Si se invierten, la aplicación funciona y devuelve datos de otras comunidades.
No hay excepción, no hay aviso: el síntoma es un test de aislamiento que falla.

Cuatro detalles del formato que confunden:

- **`app_runtime.ABCDEFGHIJKLMNOP`, no solo `app_runtime`.** Por el pooler, todo
  rol custom se conecta como `rol.project_ref`. Sin el sufijo, el pooler responde
  `Tenant or user not found`, un error que no menciona el sufijo.
- **Puerto 5432 (Session pooler), no 6543 (Transaction).** Transaction mode no
  conserva el estado de sesión entre transacciones, y el contexto de RLS depende
  de eso. Adicionalmente no admite prepared statements, lo que obliga a tocar
  Prisma. Session mode no tiene ninguna de las dos limitaciones.
- **`sslmode=require`.** Cifra la conexión contra la base de datos.
- **Las dos URLs salen de *Dashboard → Connect* → Session pooler.** Copia el host
  tal cual: el índice del pooler (`aws-0-`, `aws-1-`) no se deduce de la región,
  hay que leerlo del diálogo.

### Passwords con caracteres reservados: el error del `#`

Si tu contraseña tiene `#`, `@`, `:`, `/`, `?` o `&`, hay que percent-codificarla
**dentro de la URL**. Una contraseña de ejemplo, `s3cr#t#`, se escribe
`s3cr%23t%23`.

La misma contraseña se escribe de dos formas según dónde. Usando
`TU_CONTRASENA#` como ejemplo:

```sql
-- En el SQL Editor: literal, sin codificar. Esta es la contraseña real.
alter role app_runtime with login password 'TU_CONTRASENA#';
```

```dotenv
# En .env: percent-codificada. Es el mismo valor en otro idioma.
DATABASE_URL="postgresql://app_runtime.TU_PROJECT_REF:TU_CONTRASENA%23@POOLER_HOST:5432/postgres?sslmode=require"
```

El driver decodifica `%23` a `#` al conectar, así que Postgres recibe los mismos
caracteres. Tres reglas:

1. Un `#` desnudo en `.env` es un error, y produce un `FATAL: Password
   authentication failed` que no dice nada del `#`.
2. **En `.env`, siempre entre comillas.** Sin comillas, el parser corta el valor
   en el `#` y la contraseña se queda incompleta.
3. **En SQL, nunca percent-codifiques.** `'TU_CONTRASENA%23'` sería una
   contraseña distinta y más larga, y todo fallaría después.

Si puedes escoger la contraseña, usa solo letras y números y te ahorras esto
entero. Es la razón por la que las claves de ejemplo de la documentación
traen caracteres raros: para ejercitar el escapado, no para que las copies.

### La caché de Supavisor: cuando la contraseña correcta falla

Si acabas de hacer `alter role app_runtime with login password '...'` y el login
falla con `28P01 password authentication failed`, **la contraseña probablemente
es correcta**. Supavisor, el pooler, guarda en caché el hash SCRAM del rol y no
lo recarga al instante. Espera 15-30 segundos y reintenta.

Cómo distinguirlo de una contraseña realmente mala:

| | Caché del pooler | Contraseña mala |
|---|---|---|
| `postgres` conecta con la misma clave | sí | sí |
| El rol existe con `rolcanlogin = t` | sí | sí |
| `select rolpassword from pg_authid where rolname='app_runtime'` devuelve algo | sí | sí |
| Funciona tras esperar | **sí** | no |

Lo que **no** sirve para diagnosticarlo: comparar hashes con `crypt()` de
pgcrypto. Esa función solo entiende MD5 y Bcrypt, mientras que Postgres 17 usa
SCRAM-SHA-256. Comparar un hash SCRAM contra `crypt()` da `false` siempre, tanto
si la contraseña es correcta como si no. Es un test que nunca puede pasar y
te hace sospechar de la contraseña equivocada.

Para confirmarlo de verdad:

```sql
select rolname, rolcanlogin, rolvaliduntil
from pg_authid where rolname = 'app_runtime';
```

`rolcanlogin = t` y `rolvaliduntil` a null. Si eso es así y el login falla, es la
caché.

---

## Qué tienes que hacer en el backend (todavía no escrito)

Cada petición, dentro de una transacción, fija el contexto que leen las
políticas:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
  await tx.$executeRaw`select set_config('app.current_community_id', ${communityId}, true)`;

  return tx.incident.findMany();
});
```

El tercer parámetro `true` es lo que convierte `set_config` en `SET LOCAL`: la
variable existe **solo** durante esa transacción. Si la conexión vuelve al pool
sin valor, el acceso es cero. Con `SET` normal el valor se filtraría de una
petición a la siguiente, que es un fallo de aislamiento difícil de detectar.

---

## RLS no sustituye a la lógica de aplicación

Muy importante para el proyecto: **las dos capas son necesarias y distintas.**

| Capa | Qué garantiza | Dónde |
|---|---|---|
| Aplicación | Reglas de negocio: horarios, capacidad, transiciones de estado válidas | Services |
| RLS | Aislamiento entre comunidades, incluso ante un bug | Postgres |

RLS **no** puede validar que una reserva cae dentro del horario de apertura, ni
que la prioridad de una incidencia es coherente. Eso lo hace la capa de
aplicación, y por eso el enunciado pide que el filtrado por `community_id`
esté en los servicios.

Lo que RLS sí garantiza es lo que importa aquí: que una consulta sin filtro no
devuelve datos de otra comunidad. Es la diferencia entre que un bug de
programación cause una fuga y que cause una laincompleta.

---

## Verificación real del aislamiento

`04_verify.sql` comprueba que las políticas **existen**. Comprobar que
**funcionan** necesita datos y una sesión que no tenga `BYPASSRLS`.

**Por qué desde el SQL Editor no sirve:** tu sesión conecta como `postgres`, que
tiene `BYPASSRLS` y ve todas las filas. Ver todo ahí es correcto y esperado, no
es un fallo.

Para la prueba real:

```bash
npm run seed
```

Luego, en una terminal con `psql` apuntando a `DATABASE_URL` (que es `app_runtime`,
el rol con RLS; si apuntas a `MIGRATION_DATABASE_URL` verías todo y la prueba no
serviría para nada):

```sql
BEGIN;
-- vecino de la comunidad A
SET LOCAL app.current_user_id      = '<uuid-del-vecino-A>';
SET LOCAL app.current_community_id = '<uuid-comunidad-A>';

SELECT count(*) FROM incidents;   -- solo incidencias de A
SELECT count(*) FROM expenses;    -- 0: expenses es ADMIN-only
SELECT count(*) FROM votes;       -- solo las de A
COMMIT;
```

Repite con un usuario de la comunidad B y compara. Los números no deben solaparse.

Cuando el backend esté implementado, esto será un test de integración
automatizado (`incidents.isolation.test.ts`), que es donde tiene que vivir esta
garantía.

---

## Si algo falla

| Síntoma | Causa probable | Solución |
|---|---|---|
| `relation "users" does not exist` en `02_rls.sql` | Orden incorrecto | Ejecuta `01_schema.sql` primero |
| `permission denied for schema public` | Te falta el rol `app_runtime` con `login` | `alter role app_runtime with login password '...'` |
| `password authentication failed for user "app_runtime"` | **Caché de credenciales de Supavisor.** Acabas de fijar la contraseña y el pooler sigue con el hash anterior | Espera 15-30 s y reintenta. No es un problema de la contraseña: el rol no existía antes y el pooler aún no ha recargado su hash |
| `Tenant or user not found` | Falta el sufijo `.PROJECT_REF` en el usuario, o el proyecto no tiene pooler | Usuario = `app_runtime.TU_PROJECT_REF`. No es un problema de contraseña |
| `must be owner of table` | Te falta rol `postgres` | Usa el SQL Editor del dashboard, no el rol por defecto |
| `RLS incompleta en: ...` | `02_rls.sql` se ejecutó con una versión antigua | Vuelve a ejecutar `02_rls.sql` completo. `ENABLE` y `FORCE` han de ir juntos |
| `column "name" does not exist` en `03_storage.sql` | Versión antigua del esquema de Storage | Usa el SQL Editor del dashboard (Postgres 15+); si persiste, avísame |
| Un `NOTICE` no aparece | `raise notice` no se ve en el panel | No es error. Las políticas se comprueban con `04_verify.sql` |
| Los índices trigram fallan | `gin_trgm_ops` sin `pg_trgm` | Ya se activa en `02_rls.sql`; si falla, ejecuta `create extension pg_trgm;` |

---

## Lo que todavía no está

Estos scripts cubren esquema, seguridad y storage. **No** incluyen:

- Datos de demostración → llega con `npm run seed`
- `schema.prisma` → se genera con `npx prisma db pull` desde este esquema
- Nada de la lógica de aplicación

La secuencia después de ejecutar el SQL es:

```bash
npx prisma db pull          # deriva el schema.prisma de la base de datos
npm run seed                # datos de demo en 2 comunidades
npm run dev                 # frontend y backend
```

`prisma db pull` y no escribir el schema a mano: si definieras los modelos en
Prisma y luego pegaras este SQL, cualquier diferencia entre ambos sería drift
silencioso. Derivando uno del otro no hay dos verdades.
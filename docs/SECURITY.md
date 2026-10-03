# Seguridad · CommunityHub

Qué protege este proyecto, cómo, y qué riesgos quedan abiertos y aceptados.

---

## 1. El modelo de amenaza, en una frase

Una petición manipulada llega al backend con el token de otra persona, o sin
token, e intenta leer o escribir datos de una comunidad que no es la suya.

Todo lo de aquí existe para que eso falle, y para que falle **en la base de
datos**, no solo en el código de aplicación.

---

## 2. Las dos capas

| Capa | Qué garantiza | Dónde | Qué pasa si falla |
|---|---|---|---|
| Aplicación | Reglas de negocio: roles, horarios, capacidad, transiciones de estado | `services/` | Un vecino ve o hace algo que no debería, pero solo dentro de su comunidad |
| RLS | Aislamiento entre comunidades, ante cualquier consulta | Postgres, 24 tablas | Un bug de una sola línea devuelve datos de otra comunidad |

RLS no puede validar que una reserva cae dentro del horario ni que la prioridad
de una incidencia es coherente. Eso es de la capa de aplicación. Lo que RLS sí
garantiza es lo importante aquí: que una consulta **sin filtro** no devuelve
datos de otra comunidad.

La diferencia entre las dos capas es la que importa: una fuga causada por un bug
de programación, o una lista incompleta.

---

## 3. RLS en la base de datos

Cada tabla tiene `enable row level security` **y** `force row level security`.
Los dos, y no uno:

| | Qué hace |
|---|---|
| `enable` | las políticas se aplican a los roles sin privilegios |
| `force` | se aplican **también al dueño de la tabla** |

Sin `force`, una función o un rol que sea dueño de la tabla se saltaría todas
las políticas. Con los dos, 24 de 24 tablas quedan cerradas incluso para el
propietario.

### El rol de la aplicación

| Rol | `BYPASSRLS` | Quién lo usa |
|---|---|---|
| `app_runtime` | no | Prisma Client, en cada petición |
| `postgres` | sí | `db pull`, seed, fixtures de los tests, `db:apply` |

Conectar la aplicación con `postgres` no da ningún error: funciona, responde, y
cada vecino ve las Communities de los demás. Por eso `src/config/env.ts`
**comprueba el rol al arrancar y se niega a continuar** si `DATABASE_URL` no es
`app_runtime`, y si el puerto no es 5432.

El puerto importa por lo mismo: el *Transaction pooler* (6543) devuelve la
conexión al pool entre transacciones, así que el `SET LOCAL` del contexto de RLS
se pierde antes de que la política lo evalúe.

### El contexto por petición

Dentro de cada transacción, `withContext()` fija lo que las políticas leen:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`
  await tx.$executeRaw`select set_config('app.current_community_id', ${communityId}, true)`
  return tx.incident.findMany()
})
```

El `true` final es lo que lo convierte en `SET LOCAL`: la variable existe **solo**
durante esa transacción. Si al volver al pool la conexión conservara el valor,
la fuga de un vecino a otro sería un fallo de aislamiento difícil de detectar.

Sin contexto, las consultas de datos de comunidad devuelven **0 filas**, no un
error. Es deliberado: un endpoint al que se le olvide el contexto devuelve una
lista vacía en vez de una lista que no le pertenece.

### El punto ciego del login

Las políticas comparan siempre contra `app_current_user_id()`. En el login y en
el refresh todavía no se sabe quién es el usuario, así que devuelve 0 filas y no
hay forma de saber ni si el email existe.

De ahí las tres funciones `SECURITY DEFINER` de `02b_auth.sql`:

| Función | Para qué |
|---|---|
| `app_auth_find_user_by_email` | login y registro, sin contexto |
| `app_auth_find_session_by_hash` | refresh, sin contexto |
| `app_auth_revoke_family` | detección de reutilización |

Su seguridad depende de dos detalles, y `04_verify.sql` los comprueba:

- `set search_path = public, pg_temp`. Sin esto, cualquiera que pueda crear un
  objeto en el schema de búsqueda puede sustituir la función y ejecutar su
  código con estos privilegios.
- `revoke execute ... from public`, y `grant` **solo** a `app_runtime`. Con el
  `grant` abierto, cualquiera podría leer el hash de contraseña de cualquier
  vecino.

### Escribir exige poder leer lo que escribes

Este no estaba en la spec y costó un bug real. La escritura de Prisma comprueba
las políticas de `SELECT` sobre la fila afectada, no solo la de `INSERT`. Al
registrarse con `app.current_user_id` a `NULL`, `users_select_self` no coincide
con la fila recién creada y la operación falla con:

```
new row violates row-level security policy for table "users"
```

con `users_insert_public` siendo `with check (true)`. El INSERT era legal y aun
así se rechazaba.

La corrección no es un rodeo: al terminar de registrarse, uno **es** el usuario
nuevo, y poder leer su propia fila es justo lo que `users_select_self` existe
para permitir. El contexto del registro es su propio UUID.

Vale la pena dejarlo escrito porque el síntoma (`42501` en un `INSERT` con
`with check (true)`) no lleva a ninguna parte por intuition. Cuando aparezca
otra vez, el contexto es lo primero que hay que mirar.

---

## 4. Autenticación

| Decisión | Por qué |
|---|---|
| argon2id para contraseñas | bcrypt se ataca con GPU; SHA-256 no sirve para contraseñas |
| Access token JWT, 15 min | Ventana de robo corta |
| Refresh **opaco** de 64 bytes aleatorios, 30 días | Un JWT de refresh no se puede revocar: es válido hasta que expira |
| Solo el **hash SHA-256** del refresh en la BD | Si alguien lee la tabla `sessions`, no puede suplantar una sesión |
| Rotación con detección de reutilización | Un refresh ya usado vuelve a aparecer → está robado → se revoca la familia entera |
| Access token solo en memoria del cliente | `localStorage` es legible por cualquier XSS |
| Refresh en cookie `httpOnly` `secure` `sameSite=strict` | `localStorage` lo roba un XSS; `strict` da protección CSRF sin token |

`env.ts` se niega a arrancar en producción con `SameSite` distinto de `strict`.

La rotación con detección de reutilización tiene una consecuencia que conviene
tener presente, porque no es evidente: **reusar un refresh token ya usado tira
también el token nuevo**. Si alguien reutiliza el viejo, toda la familia cae, y
quien lo robó se queda sin sesión y sin poder reutilizar la suya. Es lo correcto.

Y otra, que salió de los tests: el access token de la sesión anterior queda
invalido en el acto de refrescar. Un cliente que guarde el token viejo en vez de
sustituirlo por el nuevo recibirá 401 aunque el servidor esté perfectamente bien.

### Enumeración de emails

Un login con email inexistente y otro con contraseña incorrecta devuelven el
mismo `401 INVALID_CREDENTIALS` y tardan lo mismo: el login con email
inexistente igualmente calcula un hash argon2 de señuelo. Sin eso, el tiempo de
respuesta enumera las cuentas del barrio, que es información que el proyecto
trata de no filtrar.

---

## 5. Permisos revoked a `anon` y `authenticated`

`02_rls.sql` revoca los permisos que Supabase concede por defecto a `anon` y
`authenticated`. Los dos recuentos tienen que dar **0**, y `04_verify.sql` lo
falla si no.

No es teórico: con los permisos por defecto, la `anon` key —que es pública por
diseño— puede leer tablas directamente desde el navegador, saltándose el
backend entero.

---

## 6. Secretos

| Secreto | Dónde | Estado |
|---|---|---|
| Contraseña de `app_runtime` | `.env`, y el rol en Supabase | Rotada, aleatoria, 32 caracteres |
| Contraseña de `postgres` | `.env` | Rotada, aleatoria, 32 caracteres |
| `JWT_SECRET` | `.env` | 64 bytes en base64, generado con `crypto.randomBytes` |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env`, nunca en el cliente | Del dashboard |

`.env` está en `.gitignore` y no se sube nunca. Las plantillas `.env.example`
contienen la estructura y los comentarios, ningún valor.

### Una credencial que sí quedó en el historial

La contraseña de `postgres` de la primera configuración se subió en el commit
`924a3e6`. **Está rotada**: la actual es aleatoria y el valor antiguo ya no
autentica. Rotar es lo que resuelve el problema; el historial del repositorio
sigue conteniéndolo, así que:

- No reutilices esa contraseña en ningún otro sitio.
- Si el repositorio se hace público, purga el historial (`git filter-repo`) o
  empieza de nuevo. El nombre del proyecto y su ref tampoco son secretos, pero
  la contraseña sí lo era.

### Sobre el certificado del pooler

`sslmode=require` no significa lo mismo en libpq que en node-postgres. En libpq
es "cifra, pero no compruebes la cadena". En `pg` se traduce a
`rejectUnauthorized: true`, y la conexión falla con:

```
self-signed certificate in certificate chain
```

porque el pooler de Supabase presenta un certificado firmado por su propia CA,
que no está en ningún almacén de CA público. Verificar contra las CA del
sistema no es un descuido de configuración: es imposible.

Por eso hay dos caminos, y el primero es el bueno:

1. `POSTGRES_CA_CERT_PATH` (o `PGSSLROOTCERT`) apunta al certificado de Supabase.
   Se verifica de verdad. Descárgalo de *Dashboard → Settings → Database →
   SSL Certificates*.
2. Sin certificado, se cifra **sin verificar**, que es lo que ya hace Prisma
   con `sslmode=require` en el cliente del backend. `npm run db:apply` lo dice
   en pantalla cada vez que conecta.

El riesgo residual del camino 2 es real pero acotado: sin verificar la cadena,
una composiciónTLS que llegue al puerto y sepa hablar el protocolo se hace
pasar por la base de datos. Sin la clave de `postgres`, no obtiene nada. En una
red con adversario esto no es suficiente; con la ruta 1, sí.

---

## 7. Riesgos aceptados

### `deepmerge-ts` — Prototipo pollution (transitivo, solo en dev)

`npm audit` marca `deepmerge-ts` (dependencia transitiva de Prisma CLI).

| | |
|---|---|
| Afecta a | `prisma` y `@prisma/dev`, que son **herramientas de desarrollo** |
| Presente en producción | No. No está en las dependencias de runtime |
| Cuándo se ejecuta | `npx prisma db pull`, `prisma generate`. Nunca al servir peticiones |
| Versión actual | 2.3.1, sin fix publicado |

**Decisión: aceptado.** No hay versión parcheada, así que no hay nada que
actualizar; y el vector exige ejecutar la herramienta CLI con una entrada
controlada por el atacante, lo que ya exige acceso al repositorio.

Volver a mirarlo cuando Prisma lo suba, no antes.

### Demo en la base de datos de desarrollo

`npm run db:seed` deja credenciales conocidas y las imprime por pantalla:

```
ADMIN      ana@comunidad-a.test     · CommunityHub2026
PRESIDENT  luis@comunidad-a.test    · CommunityHub2026
```

Es intencionado, para que cualquiera clone y entre sin pedirle nada a nadie. Pero
son contraseñas públicas: **nunca corras el seed contra un entorno con datos
reales**, y no tomes estas cuentas como referencia de un patrón.

### Sin verificación de email ni recuperación de contraseña

Fuera de alcance (sección 12 de la spec). Sin SMTP no hay correo, y sin correo no
hay "confirma tu cuenta" ni "restablece tu contraseña". Es una decisión
consciente: el enunciado no lo pedía y una implementación a medias —un token de
reset que caduca y nunca se envía— es peor que no tenerla.

### Rate limit en memoria

Vive en el proceso. Con una sola instancia es correcto; con varias, cada una
cuenta por su lado y el límite real es `N × el configurado`. El serverless
empeora esto porque las instancias se reciclan constantemente. Cuando haya más
de una instancia, mover a la tabla de Supabase, que ya está contratada.
Documentado como pregunta abierta 3 en la spec.

---

## 8. Qué se verifica, y cómo

Nada de lo anterior se da por bueno sin una comprobación que falle si se rompe.

| Comprobación | Qué demuestra |
|---|---|
| `npm run check:db` | Rol `app_runtime` sin `BYPASSRLS`, puerto correcto, RLS deniega sin contexto, el contexto se lee en las políticas |
| `npm run test:unit` | Hash y verify de argon2id, JWT (incluido `alg: none`), validación de entradas. Sin base de datos |
| `npm run test:integration` | Los 7 endpoints contra Postgres real: aislamiento entre comunidades, rotación, reutilización, envelope, rate limit |
| `npm run smoke` | El flujo entero por HTTP real, con cabeceras y cookies, contra el servidor levantado |
| `04_verify.sql` | Que el esquema y los permisos están donde deben, sin depender del código |

Los 7 endpoints y los criterios 1 a 19 de la spec tienen su test. La lista está
en `specs/01-authentication.md`, sección 10.

Sobre el test central del proyecto, el que si falla avisa de una fuga:

```
Usuario A de comunidad 1 intenta leer una incidencia de comunidad 2  ->  0 filas
```

No es un 403. Con RLS, la consulta simplemente no ve la fila. Un 403 confirmaría
que la fila existe y que solo le negaron el paso; cero filas no revela ni que
exista.

---

## 9. Lo que haría en una revisión de seguridad

Si esto se auditara, por orden de relación entre lo que se encuentra y lo que
cuesta:

1. **Purga del historial** de la contraseña de `924a3e6` (§6). Barato y elimina
   el único secreto que sigue en el repositorio.
2. **TLS verificado de verdad**: descargar el certificado de Supabase y poner
   `POSTGRES_CA_CERT_PATH` (§6). Convierte un riesgo aceptado en una garantía.
3. **Rate limit compartido** en cuanto haya más de una instancia (§7).
4. **Verificación de email y recuperación de contraseña**, cuando haya SMTP.
   Sin esto, un vecino que pierde la contraseña lo pierde todo.
5. **Límite global además del límite por IP** en el login. El actual lo detiene
   un atacante desde una IP; no lo detiene uno con un rango entero.

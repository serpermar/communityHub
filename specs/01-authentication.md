# Spec 01 · Autenticación y sesiones

> **Estado: IMPLEMENTADA Y VERIFICADA.**
>
> Los 7 endpoints existen y responden. La verificación, con lo que cubre cada
> capa:
>
> | Comprobación | Resultado |
> |---|---|
> | `npm run typecheck` | limpio |
> | `npm run test:unit` | 28 tests, sin base de datos |
> | `npm run test:integration` | 49 tests, contra Supabase real |
> | `npm run check:db` | todas las comprobaciones en verde |
> | `npm run smoke` | 17 comprobaciones por HTTP real |
> | `04_verify.sql` | sin excepciones |

> **Estado:** pendiente de revisión.
> **Fase:** 1 → 2 (autenticación propia, decisión D-11 de `ARCHITECTURE.md`).
> **Base de datos:** `supabase/sql/01_schema.sql`, `02_rls.sql`, `02b_auth.sql`.
> **Backend:** `backend/`.

Sin la aprobación de esta spec no se escribe código de autenticación.

---

## 1. Objetivo

Que un vecino pueda registrarse, entrar, renovar su sesión y cerrarla, y que un
usuario authenticado solo pueda tocar sus propios datos. Es la base sobre la que
se apoya todo el RBAC por comunidad: sin identidad fiable, el resto de
políticas no tiene a quién aplicar.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| A-1 | Auth propia con JWT + refresh opaco | Supabase Auth (GoTrue) | El enunciado pide JWT, RBAC y refresh como funcionalidad a desarrollar. GoTrue lo daría hecho y la Fase 2 sería un ejercicio de integración |
| A-2 | `argon2id` para hashes | bcrypt, SHA-256 | bcrypt se puede atacar con GPU; SHA-256 no sirve para contraseñas. argon2id es el estándar actual y también está en la librería nativa de Node |
| A-3 | Refresh token **opaco**, no JWT | Refresh JWT | Permite revocar un token en el servidor. Un JWT de refresh es válido hasta que expira, se robe o se invalide el JWT, porque no se puede consultar en una lista |
| A-4 | Solo el **hash SHA-256** del refresh en la BD | Guardar el token en claro | Si alguien lee la tabla `sessions`, no puede suplantar una sesión. El hash es suficiente porque el token es aleatorio y de alta entropía, no una contraseña |
| A-5 | Rotación con **detección de reutilización** | Refresh sin rotar | Si un refresh ya usado vuelve a aparecer, está robado. Se revoca la familia entera |
| A-6 | Access 15 min · Refresh 30 días | Sesiones largas | Menos ventana de robo, y el refresh lo hace transparente al usuario |
| A-7 | Refresh en cookie `httpOnly` `secure` `sameSite=strict` | `localStorage` | `localStorage` es legible por cualquier XSS. `httpOnly` lo cierra. `sameSite=strict` da protección CSRF sin token |
| A-8 | Access token solo **en memoria** del cliente | `localStorage` o cookie | Si va en cookie, el CSRF vuelve. Si va en `localStorage`, un XSS lo roba. En memoria, un refresh de página lo pierde y el cliente usa el refresh token para pedir uno nuevo |
| A-9 | Argon2 **en el backend**, nunca en SQL | `crypt()` de pgcrypto | pgcrypto no tiene argon2 (solo MD5, Blowfish, SHA-2), y son funciones sha256-crypt y bcrypt de coste fijo. Argon2id necesita parámetros de memoria y tiempo, que SQL no expone bien |
| A-10 | Email **case-insensitive** con índice `lower(email)` | Índice sobre `email` | `Ana@x.com` y `ana@x.com` son la misma cuenta. Sin el índice sobre `lower()`, la unicidad no se aplica |
| A-11 | El rate limit cuenta **solo intentos fallidos** | Contar también los exitosos | Entrar y salir cinco veces es uso normal, no un ataque. Contarlo bloquearía a un vecino que usa la app a diario, y el límite seguiría impidiendo lo único que importa: probar cinco contraseñas por cuenta |
| A-12 | Éxito con `{ data, meta }`; el refresh token va **solo en cookie** | Refresh también en el cuerpo de la respuesta | Un token en el cuerpo acaba antes o después en un log, en un `localStorage` mal hecho o en la consola del navegador. La cookie `httpOnly` es el único sitio donde el cliente no puede leerlo, que es justo la propiedad que se busca |
| A-13 | Un error de RLS al escribir se lee como **fallo de contexto**, no como bug de permisos | Aceptar el 42501 y buscar la política | La escritura de Prisma comprueba la política de `SELECT` sobre la fila afectada. Contexto vacío al registrarse → la fila nueva no es visible ni para sí misma → 42501 con `with check (true)`. El contexto del registro es su propio UUID |

### A-11, A-12 y A-13 en detalle

Las tres surgieron durante la implementación, y las tres se salen de lo que la
spec daba por supuesto. Se dejan aquí porque las decisiones que parecen menores
son las que más se olvidan.

**A-11 · el límite cuenta los fallos, no los aciertos.** La cuenta va por email e
IP: cinco intentos fallidos en quince minutos. Los logins correctos no suman, y
hay un test que hace siete logins buenos seguidos y espera que todos pasen. Es la
prueba de que el límite no molesta al uso legítimo.

**A-12 · el token viaja solo en la cookie.** El cuerpo de la respuesta lleva
`accessToken`, `expiresIn` y el usuario. El refresh no aparece ni ahí ni en
ningún log. La cookie va con `httpOnly`, `secure` y `sameSite=strict`, y con
`Path` restringido a `/api/v1/auth`.

**A-13 · escribir exige poder leer lo que escribes.** Es el punto menos obvio de
los tres, y costó un bug real: el registro devolvía 500 con

```
new row violates row-level security policy for table "users"
```

aunque `users_insert_public` fuese `with check (true)` y el INSERT fuese legal. La
causa: la escritura de Prisma consulta también la política de `SELECT` sobre la
fila afectada, y `users_select_self` exige `id = app_current_user_id()`. Con el
contexto a `NULL` en el registro, la fila recién creada no era visible ni para
sí misma.

La corrección no es un rodeo: al terminar de registrarse, uno **es** el usuario
nuevo, y poder leer su propia fila es lo que `users_select_self` existe para
permitir. Lo que cambia es que el contexto del registro es su propio UUID.

Se documenta porque el síntoma no lleva a ninguna parte por intuición: un 42501
en un INSERT cuya política de escritura es `true` no apunta a la política de
escritura. Apunta al contexto.

### A-9 en detalle

Es la decisión que más fricción genera, porque el hash de contraseña es el dato
más sensible de la tabla y PostgreScript lo expone como texto plano. La
alternativa sería calcularlo en SQL, pero `pgcrypto.sha256()` no sirve: las
contraseñas necesitan un KDF con coste y sal, y `sha256()` es una función de
hash rápida, justo lo que no se quiere en una contraseña.

Argon2id se calcula en la aplicación y se inserta el string resultante
(`$argon2id$v=19$m=65536,t=3,p=4$...`). La BD solo lo almacena y lo devuelve.

---

## 3. Modelo de datos

Ya existe en `01_schema.sql`. No requiere cambios.

### `users`

```
id, email, password_hash, full_name, phone, avatar_url,
global_role, status, email_verified_at, last_login_at,
created_at, updated_at, deleted_at
```

Índice único `users_email_lower_uidx` sobre `lower(email)`.

### `sessions`

```
id, user_id, family_id, token_hash, status, expires_at,
revoked_at, replaced_by, user_agent, ip_address,
created_at, last_used_at
```

- `token_hash`: SHA-256 del token, **nunca el token**. Índice único.
- `family_id`: agrupa todos los tokens derivados de un mismo login. Es lo que
  permite revocar la familia entera al detectar reutilización.
- `replaced_by`: el token que sustituyó a este. Convierte la rotación en una
  cadena auditable: `A → B → C`, y se ve de un vistazo qué token robado se usó
  primero.
- `status`: `'ACTIVE' | 'REVOKED'`.

---

## 4. RLS y el punto ciego del login

### El problema

Las políticas de `02_rls.sql` comparan siempre contra
`app_current_user_id()`, que sale de `set_config('app.current_user_id', ...)`.
Esa variable la fija el backend **después** de autenticar. En el login todavía
no existe, y `users_select_self` devolvería 0 filas siempre. El usuario nunca
encontraría su cuenta y no podría entrar.

Lo mismo pasa en el refresh: `sessions_own` exige
`user_id = app_current_user_id()`, y al renovar no se sabe todavía de quién es
el token.

### La solución

Tres funciones `SECURITY DEFINER` en `02b_auth.sql`, cada una acotada a una
operación:

| Función | Para qué | Devuelve |
|---|---|---|
| `app_auth_find_user_by_email(text)` | Login | id, hash, nombre, rol, estado |
| `app_auth_find_session_by_hash(text)` | Refresh | La fila de sesión |
| `app_auth_revoke_family(uuid)` | Detección de robo | Nº de sesiones revocadas |

Cada una:

- es `SECURITY DEFINER` porque se ejecutan como `postgres`, que sí puede leer
  `users` y `sessions`;
- fija `search_path = public, pg_temp`, sin lo cual cualquiera que pudiera crear
  un objeto en el schema de búsqueda podría sustituir la función y ejecutar su
  código con esos privilegios;
- no acepta parámetros libres: o un email, o un hash. No hay puerta trasera con
  un parámetro de tabla;
- tiene `EXECUTE` concedido **solo** a `app_runtime`, y `REVOKE` explícito a
  `PUBLIC`.

### Lo que esto cuesta

`app_auth_find_user_by_email` devuelve el hash de contraseña a cualquiera que
pueda ejecutarla. Es la superficie más sensible del esquema y hay que decirlo
sin rodeos. Se acepta porque es inevitable: verificar argon2 exige el hash.

La alternativa descartada sería hacer el login con el rol `postgres` completo.
Eso sería mucho peor, porque ese rol también se saltaría el resto de políticas
RLS. Aquí se abre una puerta pequeña y medida; allí se derriba la seguridad de
todo el esquema.

### Email inexistente vs contraseña incorrecta

Ambos devuelven el **mismo** error (`401 INVALID_CREDENTIALS`). Distinguirlos
en la respuesta convierte el login en un oráculo de qué emails están
registrados. La enumeración se evita en la capa de aplicación, no aquí.

---

## 5. Flujos

### 5.1 Registro

```
POST /api/v1/auth/register
  { email, password, fullName, phone? }

1. Validar formato. Password >= 12 chars. Email normalizado a minúsculas.
2. argon2id(password) en la aplicación.
3. BEGIN
     set_config('app.current_community_id', <null>)
     INSERT INTO users (email, password_hash, full_name, phone)
4. COMMIT
5. 201 { user: { id, email, fullName }, message: 'Cuenta creada. Ya puedes entrar.' }
```

No se crea sesión automáticamente: el usuario entra con su contraseña, lo que
además verifica que el hash se guardó bien.

**Conflicto de email** → `409 EMAIL_TAKEN`. Aquí sí se distingue del caso
anterior, porque quien se registra conoce su propio email y necesita saber que
está duplicado.

### 5.2 Login

```
POST /api/v1/auth/login
  { email, password }

1. Rate limit: 5 intentos / 15 min por (email, IP). Responde 429 al superarlo.
2. app_auth_find_user_by_email(email)  →  SECCIÓN 4
3. Si no existe  →  argon2.verify(hash_dummy, password)   →  401
4. Si deleted_at no es null  →  401  (mismo mensaje)
5. argon2id.verify(password_hash, password)  →  si falla, 401
6. Access token:  JWT HS256, 15 min, payload { sub, role, ver }
   Refresh token: randomBytes(48).base64url, 30 días
   sha256(refresh)  →  sessions.token_hash
   family_id = randomUUID()
7. INSERT sessions (..., status='ACTIVE', expires_at = now() + 30d)
8. UPDATE users SET last_login_at = now()
9. Set-Cookie:
     refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000
10. 200 { accessToken, expiresIn: 900, user: {...} }
```

**El paso 3 es importante.** Si el email no existe, hay que ejecutar igualmente
un `argon2.verify` contra un hash señuelo. Sin eso, el tiempo de respuesta
delata si una cuenta existe: un login fallido con usuario inexistente tarda 2 ms
y con contraseña incorrecta tarda 80 ms. Es una fuga de información por canal
lateral, y el hash señuelo cuesta una constante fija.

### 5.3 Refresh con rotación

```
POST /api/v1/auth/refresh        (cookie refresh_token)

1. sha256(refresh de la cookie)
2. app_auth_find_session_by_hash(hash)
3. Si no existe                    → 401 + borrar cookie
4. Si status = 'REVOKED'           →  DETECCIÓN DE ROBO, paso 5. Este token ya se
                                      usó legítimamente y luego fue revocado, o
                                      al revés: alguien está reutilizando uno
                                      antiguo.
5. Revocar la familia entera:
     app_auth_revoke_family(family_id)
   → 401 + borrar cookie. La víctima también pierde la sesión. Es lo correcto:
     atacante y víctima comparten el token, y solo uno puede conservarlo.
6. Si expires_at < now()           → 401 + borrar cookie
7. Emitir refresh nuevo, mismo family_id.
   INSERT sessions (status='ACTIVE')
   UPDATE sessions SET status='REVOKED', revoked_at=now(), replaced_by=<nuevo>
                        WHERE id = <viejo>
8. Set-Cookie con el refresh nuevo. 200 { accessToken, expiresIn: 900 }
```

`family_id` se mantiene entre rotaciones: toda la cadena de un login comparte
familia. Solo se genera uno nuevo al hacer login de verdad.

### 5.4 Verificación del access token

```
1. Verificar firma HS256 y `exp`. Si falla o expiró → 401.
2. `ver` del payload contra sessions.id del usuario.
   Si la sesión ya no está ACTIVE → 401. Permite cerrar sesión sin esperar a que
   expire el token, que es lo que espera un usuario al pulsar "salir".
3. Si el endpoint es de comunidad, resolver el contexto:
     set_config('app.current_user_id',      sub,  true)
     set_config('app.current_community_id', <de la ruta>, true)
4. Ejecutar la consulta dentro de esa transacción. SIEMPRE.
```

El paso 4 es donde RLS empieza a hacer su trabajo, y por eso `withContext()`
exige que la consulta pase por su callback. Una consulta hecha fuera de la
transacción corre sin contexto y RLS deniega.

---

## 6. Contrato HTTP

### Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/auth/register` | No | Crear cuenta |
| POST | `/api/v1/auth/login` | No | Iniciar sesión |
| POST | `/api/v1/auth/refresh` | Cookie | Renovar, con rotación |
| POST | `/api/v1/auth/logout` | Sí | Revocar la sesión actual |
| GET | `/api/v1/auth/me` | Sí | Usuario actual |
| GET | `/api/v1/auth/sessions` | Sí | Sesiones activas del usuario |
| DELETE | `/api/v1/auth/sessions/:id` | Sí | Revocar una sesión concreta |

### Códigos de error

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Correo o contraseña incorrectos." } }
```

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Formato inválido, password corta |
| 401 | `INVALID_CREDENTIALS` | Email o contraseña incorrectos, indistinguible |
| 401 | `TOKEN_EXPIRED` | Access token vencido |
| 401 | `TOKEN_REVOKED` | Sesión revocada, incluido el caso de robo |
| 409 | `EMAIL_TAKEN` | El email ya está registrado |
| 429 | `RATE_LIMITED` | Superado el límite de intentos |

Los mensajes van en castellano. Los identificadores y nombres de función, en
inglés.

---

## 7. JWT

Payload mínimo, deliberadamente:

```json
{ "sub": "<uuid>", "role": "NEIGHBOR", "ver": "<sessions.id>", "iat": 0, "exp": 0 }
```

- **Firma:** HS256. Clave en `JWT_SECRET`, nunca en el repositorio.
- **`ver`:** el id de la sesión. Permite invalidar el access token al cerrar
  sesión, sin esperar 15 minutos.
- **Sin `email` ni `full_name`.** Un access token viaja en cada petición,
  incluido en logs del proxy y del navegador. Cuanto menos lleve, menos se
  filtra. Los datos del usuario salen de la BD cuando hacen falta.
- **`alg` fijo.** La verificación rechaza cualquier token que no sea HS256. Sin
  esa comprobación, un atacante puede mandar `alg: none` o cambiarlo a RS256 y
  que la librería acepte una firma que no hemos verificado.

---

## 8. Variables de entorno

Viven en **`backend/.env`**, que está en `.gitignore`. La plantilla con los
comentarios de todas ellas es `backend/.env.example`.

```dotenv
JWT_SECRET="<64 bytes aleatorios en base64>"
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=30
ARGON2_MEMORY_COST=65536
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=4
```

`JWT_SECRET` se genera con `crypto.randomBytes(64).toString('base64')`. Si en
algún momento se filtra, todos los access tokens existentes son válidos hasta
expirar, y no hay manera de invalidarlos sin cambiar la clave, que es
exactamente lo que lleva a todos los usuarios a iniciar sesión de nuevo.

`env.ts` la exige con un mínimo de 32 caracteres y **valida todo el entorno al
arrancar**: si algo está mal, el proceso no llega a levantar el servidor. También
comprueba ahí que `DATABASE_URL` usa el rol `app_runtime` y el puerto 5432, que
son las dos condiciones cuya violación no da ningún error visible.

`MIGRATION_DATABASE_URL` es **opcional** a propósito: el servidor no la usa y
ningún módulo de producto la importa. Exigirla haría fallar el arranque de un
servidor que funciona perfectamente. Quien la necesita (el seed, los fixtures de
los tests, `db:apply`) la comprueba ella misma y explica qué falta.

---

## 9. Estructura de archivos

```
backend/
  .env                              fuera de Git
  .env.example                      la plantilla de arriba, sin valores
  prisma/
    schema.prisma                   derivado con db pull, no escrito a mano
    seed.ts                         datos de demo
    apply-sql.ts                    aplica supabase/sql, idempotente
  scripts/
    smoke.ts                        flujo por HTTP real contra el servidor
  src/
    db.ts                           Prisma singleton (app_runtime)
    db-admin.ts                     Prisma con BYPASSRLS: fixtures y seed
    context.ts                      withContext()  ← ya escrito
    check-db.ts                     verificación de RLS  ← ya escrito
    config/
      env.ts                        validación del .env al arrancar
    auth/
      service.ts                    register, login, refresh, logout, revoke
      repository.ts                 las consultas
      routes.ts                     los 7 endpoints
      controller.ts                 validación y envelope
      middleware.ts                 requireAuth
      password.ts                   argon2id: hash, verify, hash señuelo
      tokens.ts                     JWT y refresh tokens
      validators.ts                 zod
      __tests__/                    password, tokens, validators (unitarios)
    http/
      envelope.ts                   { data, meta } y { error }
      errors.ts                     códigos de la sección 6
      ratelimit.ts                  límite en memoria
    __tests__/
      auth.api.integration.test.ts  los 7 endpoints
      rls.integration.test.ts       aislamiento y políticas
      integration.setup.ts          exige conexión real y app_runtime
      helpers.ts                    fixtures, vía db-admin
```

Dos reglas que esta estructura deja fijas:

**`db-admin.ts` no se importa desde código de producto.** Es el único módulo con
`BYPASSRLS`, y el fixture de los tests lo necesita. Si se colgara de un service,
el aislamiento desaparecería sin ningún error visible.

**Los tests unitarios viven dentro del módulo que prueban; los de integración, en
`src/__tests__/`.** Los de integración cruzan varios módulos a la vez —una
petición pasa por middleware, auth y RLS—, que es justo lo que un test unitario
no puede reproducir. El sufijo del archivo dice de qué tipo es.

---

## 10. Criterios de aceptación

Cada uno tiene un test que lo demuestra. No se da por good sin él.

Los 19 están implementados. La columna de la derecha es dónde vive cada uno.

### Seguridad

| # | Criterio | Dónde |
|---|---|---|
| 1 | Registrar, cerrar sesión y volver a entrar funciona | `auth.api.integration`, `smoke` |
| 2 | La contraseña nunca aparece en ninguna respuesta ni log | `auth.api.integration` |
| 3 | Un access token con firma inválida da 401 | `tokens.unit` |
| 4 | Un access token con `alg: none` da 401 | `tokens.unit` |
| 5 | Un access token expirado da 401 | `tokens.unit`, `smoke` |
| 6 | Un login con email inexistente tarda lo mismo que con contraseña incorrecta | `auth.api.integration` (margen del 20%, repetido) |
| 7 | Usar dos veces el mismo refresh token revoca la sesión | `auth.api.integration`, `smoke` |
| 8 | Tras detectar reutilización, **todos** los refresh de esa familia fallan | `auth.api.integration`, `smoke` |
| 9 | Cerrar sesión invalida el access token en la siguiente petición | `auth.api.integration`, `smoke` |
| 10 | `JWT_SECRET` no aparece en ningún archivo versionado | `.gitignore` + escaneo previo a cada commit |

### RLS

| # | Criterio | Dónde |
|---|---|---|
| 11 | `GET /auth/me` con token válido devuelve solo los datos del usuario | `auth.api.integration` |
| 12 | Dos vecinos de comunidades distintas no pueden leerse entre sí | `rls.integration`, `auth.api.integration` |
| 13 | `app_runtime` no tiene `BYPASSRLS` | `rls.integration`, `check:db` |
| 14 | Sin `set_config`, las consultas de datos de comunidad devuelven 0 filas | `rls.integration`, `check:db` |

### Contrato

| # | Criterio | Dónde |
|---|---|---|
| 15 | Los 7 endpoints responden con el envelope de la sección 6 | `auth.api.integration` |
| 16 | Los errores usan los códigos de la tabla | `auth.api.integration` |
| 17 | El rate limit responde 429 al superarse, y **no** cuenta los aciertos | `auth.api.integration` (ambos sentidos) |

### Verificación manual

| # | Criterio | Dónde |
|---|---|---|
| 18 | `npm run check:db` pasa todas sus comprobaciones | `check:db` |
| 19 | `04_verify.sql` termina todo en verde tras aplicar `02b_auth.sql` | `db:apply --verify` |

> El criterio 18 decía «los 12 checks». `check:db` tiene hoy 12 comprobaciones
> agrupadas en 5 secciones; el número cambia con lo que se añada, así que el
> criterio es que pase entero, no que dé una cifra concreta.

---

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Olvidar `withContext` en una ruta y leer datos sin filtrar | El endpoint devuelve 0 filas en vez de datos de otros. Es visible en el test 12, no silencioso |
| Filtrar `JWT_SECRET` en un commit | Está en `.env`, que está en `.gitignore`. Test 10 |
| Reutilización de refresh no detectada | `token_hash` único y `family_id` rastreable. Tests 7 y 8 |
| Enumeración de emails por tiempo de respuesta | Hash señuelo. Test 6 |
| Argon2 con coste alto en hardware débil | Los parámetros son configurables, con el valor por defecto para hardware moderno |
| `app_auth_find_user_by_email` usada por un rol que no debe | Solo `app_runtime` tiene `EXECUTE`, y `02b_auth.sql` lo verifica |
| **Contexto vacío en una escritura, y el error señala a la política equivocada** | Documentado en A-13 y en `SECURITY.md`. El INSERT puede ser legal y rechazarse por la política de `SELECT` |
| Cliente que reuse el access token viejo tras refrescar | Comportamiento correcto del servidor, documentado. El cliente debe sustituir el token en cuanto llega el 200 |

---

## 12. Fuera de alcance

- Verificación de email por correo. Requiere un proveedor transaccional con
  dominio propio; Supabase no lo da en plan free sin configurar SMTP.
- Recuperación de contraseña. Mismo motivo.
- OAuth (Google, GitHub). Se añade después sobre la misma interfaz.
- MFA. Igual.

Ninguna de las cuatro bloquea a las demás, porque la sesión es la misma. Si
alguna entra más adelante, es una implementación adicional del contrato de esta
spec, no un rediseño.

---

## 13. Preguntas abiertas

Las tres siguen sin responder. Lo que se hizo en cada caso, y por qué:

1. **¿Cookie de refresh en `Path=/api/v1/auth` o `Path=/`?**
   **Resuelto: `Path=/api/v1/auth`.** Es lo más estrecho: fuera de los endpoints
   de auth, la cookie no viaja. Todos los que la necesitan están ahí. Cambiarlo
   después es una constante en un sitio.

2. **¿`SameSite=Strict` rompe algo si el frontend se sirve en otro dominio?**
   **Sin resolver, y es la que más puede doler.** En desarrollo
   (`localhost:5173` → `localhost:3000`) no hay problema, porque `Strict` compara
   el sitio, no el origen. En producción, con dominios distintos, el refresh
   deixa de funcionar.

   `env.ts` se niega a arrancar en producción con `SameSite` distinto de
   `strict`, para desbloquear harían falta dos cosas a la vez: `SameSite=none`
   **más** `secure`, y un token CSRF, porque `none` es exactamente el caso para
   el que `strict` protegía. Bajar solo el `SameSite` cambia un problema por
   otro.

   La recomendación sigue siendo la misma: serving frontend y API bajo el mismo
   dominio, que es lo que hace `CORS_ORIGINS` sin necesitar `none` en absoluto.
   Queda anotado aquí para que la decisión se tome **antes** de desplegar, no
   después de que alguien no pueda entrar.

3. **¿Rate limit en memoria o compartido?**
   **Resuelto para una instancia: en memoria.** Si se despliega en serverless o
   con más de una instancia, hay que moverlo a Supabase, que ya está contratado:
   con N instancias, cada una cuenta por su lado y el límite real es N veces el
   configurado. En serverless es peor, porque las instancias se reciclan
   constantemente y el contador se pierde.

   Documentado como riesgo aceptado en `SECURITY.md`, sección 7.
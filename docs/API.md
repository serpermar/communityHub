# API · CommunityHub

Contrato HTTP del backend. Base: `/api/v1`. Formato: JSON.

Los envoltorios son **únicos** y no tienen excepción:

```jsonc
// exito
{ "data": { }, "meta": { } }        // `meta` solo en listados paginados

// error
{ "error": { "code": "CONFLICT", "message": "Ya existe…", "details": [ ] } }
```

- Los **mensajes** van en castellano: los lee quien los ve, y el enunciado del
  proyecto está en castellano.
- Los **identificadores** (`code`, campos, valores de enum) van en inglés:
  los escribe el cliente, y las convenciones de un programa no se traducen.
- Nunca `data: null` en un error, ni un error dentro de un `200`. Un `200` con
  `{ error }` obliga a comprobar el cuerpo en todas partes, que es como se
  cuelan errores que nadie muestra.

`details` solo aparece cuando hay algo útil que decir campo a campo (errores de
validación). Los errores de autorización no lo llevan nunca: un 403 no dice qué
faltó.

## Autenticación

Salvo el registro y el login, todo necesita cabecera `Authorization`:

```
Authorization: Bearer <accessToken>
```

El access token es un JWT de 15 minutos. El refresh va en cookie `httpOnly`
`secure` `sameSite=strict` y **no** se devuelve en el cuerpo.

Que el rol global se lea de la base de datos y no del token es deliberado: el
token dura 15 minutos, así que leer el rol de ahí permitiría revocar un permiso
y seguir usándolo durante la ventana del token.

---

## Comunidades

Las cuatro rutas viven bajo `/api/v1/communities`.

### Modelo

```jsonc
{
  "id": "uuid",
  "name": "Barrio Alto",
  "slug": "barrio-alto",          // inmutable tras el alta
  "description": "text o null",
  "addressLine1": "Calle Mayor 1", // obligatorio
  "city": "Valencia",             // obligatorio
  "province": "Valencia",         // null
  "postalCode": "46001",          // null
  "country": "ES",                // 2 letras
  "latitude": 39.474,             // null = "sin localizar todavía"
  "longitude": -0.379,            // null = "sin localizar todavía"
  "timezone": "Europe/Madrid",
  "registrationNumber": "null",
  "isActive": true,
  "createdAt": "2026-10-04T12:00:00.000Z",
  "updatedAt": "2026-10-04T12:00:00.000Z",
  "memberRole": "ADMIN"           // el rol del llamante en ESTA comunidad
}
```

`latitude` y `longitude` son **anulables, y van juntas**: `null` significa que
aún no se ha localizado la comunidad, no `0,0`. Rellenarlas con `0,0` sería
peor, porque `0,0` está en el Atlántico y daría mapa y meteorología equivocados
sin que nadie se entere. Si se manda una, se mandan las dos. Rango: latitud
`[-90, 90]`, longitud `[-180, 180]`.

`memberRole` es el rol **en esa comunidad**, no el global. La misma persona puede
salir `ADMIN` aquí y `NEIGHBOR` en otra, y su permiso cambia con la comunidad del
`communityId`.

### Roles

| Rol | Puede |
|---|---|
| `NEIGHBOR` | Ver la comunidad, crear incidencias y reservas |
| `PRESIDENT` | Gestión de comunidad. **No** ve los gastos |
| `ADMIN` | Gestión completa, incluido el `PATCH` de configuración |
| `PROVIDER` | Solo los trabajos que tiene asignados |
| `ADMIN_SA` | **Staff de plataforma.** Solo crear comunidades |

`ADMIN` y `ADMIN_SA` son cosas distintas y no se confunden: `ADMIN` es un rol
*dentro* de una comunidad, `ADMIN_SA` es de la plataforma entera.

Y una asimetría que conviene tener presente al integrar: **`ADMIN_SA` crea
comunidades pero no las lee.** Un `ADMIN_SA` que no es miembro recibe `403` al
pedir la comunidad de otro. Entrar por la puerta de al lado a mirar el contenido
de una comunidad sería un cambio de modelo, y se decide en su propia spec.

### `GET /api/v1/communities`

Comunidades de las que el llamante es miembro, con su rol en cada una.

No es un catálogo: no hay descubrimiento. Se entra con invitación o con el alta
del administrador, no recorriendo una lista. Las dadas de baja y las borradas
(`deleted_at`) no aparecen.

```
200 → { "data": [ { …comunidad, "memberRole": "ADMIN" } ] }
401 → sin sesión
```

### `POST /api/v1/communities`

Crea una comunidad y **deja al llamante como su primer `ADMIN`**, en la misma
transacción. No hay un segundo paso de "asignar administrador".

Reservado a `ADMIN_SA`. Un `NEIGHBOR` recibe `403`, y un `ADMIN` de otra
comunidad también: el permiso es de plataforma, no de comunidad.

```jsonc
// mínimo
{ "name": "Barrio Alto", "slug": "barrio-alto",
  "addressLine1": "Calle Mayor 1", "city": "Valencia" }
```

```
201 → { "data": { …comunidad, "memberRole": "ADMIN" } }
      Location: /api/v1/communities/{id}
400 → cuerpo inválido, con el campo concreto en `details`
401 → sin sesión
403 → el rol global no es ADMIN_SA
409 → el slug ya existe
```

El `slug` va en minúsculas y solo admite `[a-z0-9]` y guiones simples, sin
guiones al principio ni al final. Se rechazan los slugs con mayúsculas o espacios
en lugar de normalizarlos: "arreglarlos" necesita una regla para decidir cuál era
el correcto, y esa regla no existe.

### `GET /api/v1/communities/:communityId`

```
200 → { "data": { …comunidad } }
400 → el `:communityId` no es un UUID
401 → sin sesión
403 → no es miembro
404 → existe la membresía pero la comunidad está dada de baja
```

Un `:communityId` **mal formado es `400`, no `403`**. Un 403 significa "no tienes
permiso"; un id que no es un UUID no es una petición sin permiso, es una
petición mal formada. Confundirlo obligaría a depurar credenciales cuando el
problema es un enlace roto.

Y al revés: un id **bien formado pero ajeno**, y un id que **no existe**, dan
ambos `403`. Un `404` en el caso "no existe" confirmaría que ese id está libre,
que es información sobre los ids de los demás.

### `PATCH /api/v1/communities/:communityId`

Actualización parcial. Solo se escribe lo que viene en el cuerpo: un campo
ausente no se toca.

Requiere rol `ADMIN` en esa comunidad. `PRESIDENT` y `NEIGHBOR` reciben `403`.

```jsonc
{ "name": "Barrio Alto", "description": "", "isActive": false }
```

```
200 → { "data": { …comunidad } }
400 → cuerpo vacío, slug, clave desconocida o coordenadas descuadradas
401 → sin sesión
403 → no es ADMIN de esa comunidad
404 → no existe
```

Reglas que no son evidentes:

- **`slug` no se puede cambiar.** Se rechaza con `400` y un mensaje que lo diga,
  no como "clave desconocida". Admitirlo rompería los enlaces ya compartidos
  sin avisar, que es justo lo que un identificador visible tiene que evitar.
- **Cadena vacía es `null`.** `{"description": ""}` guarda `null`, no `""`, para
  que el frontend no tenga que tratar el caso aparte.
- **`isActive: false` es la baja.** No hay `DELETE`: `communities` no tiene
  política de `DELETE` a propósito, así que un borrado físico es imposible desde
  el rol de la aplicación. La baja lógica deja de aparecer en el listado pero la
  comunidad sigue siendo consultable por id.
- **`updated_at`** lo pone el servidor. Aceptarlo del cliente sería aceptar una
  fecha inventada en un campo que sirve para ordenar.

### No hay `DELETE /communities/:id`

Deliberado. La baja es `PATCH { "isActive": false }`. Añadir el borrado físico
sería el primero del proyecto y exigiría una política `DELETE` que hoy no existe
a propósito.

---

## Incidencias

Ocho rutas en **dos** routers, porque no comparten prefijo: dos llevan la comunidad
en la URL y las otras seis llevan la incidencia. Que las de incidencia no lleven
`communityId` es intencionado: la incidencia ya tiene comunidad, y pedir las dos
cosas es pedir lo mismo dos veces.

La comunidad sale de la propia incidencia, y por eso un `ADMIN_SA` o cualquier
usuario de otra comunidad recibe **`404`** en estas seis rutas, no `403`: un `403`
confirmaría que ese id existe.

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "referenceCode": "INC-2026-000001",
  "title": "Fuga de agua en el pasillo del 3º",
  "description": "Empieza el martes...",
  "category": "PLUMBING",      // ELEVATOR | ELECTRICITY | PLUMBING
                               // CLEANING | SECURITY | HEATING | OTHER
  "priority": "HIGH",          // LOW | MEDIUM | HIGH | CRITICAL
  "status": "IN_PROGRESS",     // OPEN | IN_PROGRESS | RESOLVED | CANCELLED
  "location": "Pasillo 3º",    // null si no se dijo
  "reporterId": "uuid",
  "reporterName": "Marta Ruiz",
  "assignedToId": "uuid",      // null si no hay proveedor asignado
  "assignedToName": "Manolo",
  "needsReview": false,
  "createdVia": "MANUAL",
  "resolvedAt": null,          // fecha al entrar en RESOLVED, null al salir
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

`referenceCode` es `INC-<año>-<6 dígitos>`, único, y es lo que la gente dice en voz
alta. **No es una ruta**: las URLs van por `id`.

`email` **no** sale. Para un listado de incidencias no hace falta, y
`GET /members` ya es la excepción acotada que expone correos.

Un comentario es `{ id, incidentId, authorId, authorName, body, createdAt }`, y no
tiene ni `PUT` ni `DELETE`: no se editan ni se borran desde la API.

### Qué ve cada rol

Lo decide la base de datos, fila a fila, no el backend. La misma ruta devuelve
cosas distintas según quién la llame.

| | Lista | Abre | Comenta | Asignado |
|---|---|---|---|---|
| `ADMIN` | todas | todas | sí | sí |
| `PRESIDENT` | todas | todas | sí | no |
| `NEIGHBOR` | **las suyas** | las suyas | las suyas | no |
| `PROVIDER` | **las asignadas** | las asignadas | las asignadas | sí |

### `GET /api/v1/communities/:communityId/incidents`

Lo visible, en orden `created_at desc`. Filtros opcionales, combinables:
`status`, `priority`, `category` y `q` (fragmento de título, con acentos y sin
distinguir mayúsculas).

```
200 → { "data": [ …incidencias ],
        "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```

`total` es el total **sin paginar**, que es lo que hace útil la paginación. Una
página más allá del final devuelve `data: []` pero conserva el `total` real, para
que el cliente no dibuje "página 5 de 0".

`page` empieza en 1. `limit` va de 1 a 100, y `limit=1000` es un `400` que nombra
el campo, no un `200` con 100 filas: un `4xx` que explica el problema es mejor que
un recorte silencioso.

### `POST /api/v1/communities/:communityId/incidents`

Alta por cualquier miembro activo salvo `PROVIDER`: informar de un problema es cosa
de quien vive en la comunidad, y el proveedor reporta por el trabajo que le asigna
el `ADMIN`.

```
201 → { "data": …incidencia }
      Location: /api/v1/incidents/{id}
400 → cuerpo inválido, con el campo concreto en `details`
403 → el rol no puede abrir incidencias
```

El reporter **no** se manda: lo pone el servidor, y mandarlo es un `400` en vez de
un `201` que lo ignoraría en silencio. Lo mismo con `status` o `needsReview`.

`needsReview` no se manda y no se decide en el cliente: es `true` si la prioridad es
`CRITICAL` **y** quien la abre es un `NEIGHBOR`. Lo decide la misma transacción que
la inserta.

### `GET /api/v1/incidents/:id`

```
200 → { "data": …incidencia }
404 → no existe, está borrada, o no es visible para ti
```

### `PUT /api/v1/incidents/:id`

Reemplazo **completo** del contenido: `title`, `description` y `category` son
obligatorios. Es un `PUT`, no un `PATCH`, y no hay `PATCH` de contenido.

Opcionales y con permisos distintos:

- `location`: `null` **o** `""` la borran.
- `priority`: solo `ADMIN`.
- `assignedToId`: solo `ADMIN`, y `null` desasigna.

```
200 → { "data": …incidencia }
403 → tu rol no permite cambiar la prioridad o la asignación
404 → no existe o no es visible
```

Enviar solo el contenido no toca ni el estado, ni la prioridad, ni el `assignedToId`.
Y un `NEIGHBOR` que manda `priority` recibe `403`, no un `200` que lo ignoró.

### `PATCH /api/v1/incidents/:id/status`

```
200 → { "data": …incidencia }
403 → tu rol no puede cambiar el estado, o esta arista es solo del ADMIN
409 → la transición no existe desde el estado actual
```

El grafo:

| De | A | Quién |
|---|---|---|
| `OPEN` | `IN_PROGRESS` | `ADMIN`, o el `PROVIDER` **asignado** |
| `IN_PROGRESS` | `RESOLVED` | `ADMIN`, o el `PROVIDER` **asignado** |
| `RESOLVED` | `OPEN` | solo `ADMIN` |
| cualquiera de los tres | `CANCELLED` | solo `ADMIN` |
| `CANCELLED` | — | estado final |

`403` y `409` significan cosas distintas y el cliente las tiene que tratar distinto:
un `409` ofrece elegir otro estado destino, y un `403` no tiene nada que ofrecer.

Dos `PATCH` simultáneos desde el mismo estado **no** se pierden: uno entra y el
otro recibe `409`. Nunca los dos `200`.

`PRESIDENT` no aparece en el grafo, en ninguna fila.

### `DELETE /api/v1/incidents/:id`

```
204 → sin cuerpo
403 → solo `ADMIN`
404 → no existe, o ya estaba borrada
```

Borrado lógico, y **para todos los roles desaparece**: ni el reporter ni el
proveedor asignado la vuelven a ver. Un `DELETE` repetido es `404`, no un `204`
idempotente.

### Comentarios

```
GET  /api/v1/incidents/:id/comments    200 → { "data": [ …comentarios ] }
POST /api/v1/incidents/:id/comments    201 → { "data": …comentario }
                                        400 → cuerpo inválido
                                        404 → no existe o no es visible
```

El listado va en `created_at asc` y no se pagina. El autor es el llamante y no se
manda.

---

## Errores

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo mal formado, `:communityId` que no es UUID |
| 401 | `UNAUTHORIZED` | Falta la cabecera, o la sesión ya no vale |
| 401 | `TOKEN_REVOKED` | La sesión se revocó |
| 401 | `TOKEN_EXPIRED` | El access token caducó |
| 401 | `INVALID_CREDENTIALS` | Login con email o contraseña incorrectos |
| 403 | `FORBIDDEN` | Autenticado pero sin permiso |
| 404 | `NOT_FOUND` | El endpoint no existe, o el recurso sí pero está dado de baja |
| 409 | `CONFLICT` | El slug ya existe, el email en el registro, o una transición de estado que no existe |
| 429 | `RATE_LIMITED` | Rate limit. `Retry-After` en la cabecera |
| 500 | `INTERNAL_ERROR` | Error no previsto |

Un mismo `code` puede venir de sitios distintos, y por eso el mensaje importa aunque
el cliente no debería leerlo: un `CONFLICT` puede ser "el slug está pillado" o "de
`OPEN` no se puede pasar a `RESOLVED`". Si el cliente necesita distinguirlos, no
puede con el `code` todavía.

El cliente decide **por el `code`**, nunca por el mensaje: el mensaje es para las
personas y puede cambiar; el código es parte del contrato.

Un `500` nunca lleva detalle del fallo hacia fuera, solo un `reference`
opaco que sí aparece en el log del servidor. Un error no previsto puede llevar en
su mensaje rutas, SQL o valores.
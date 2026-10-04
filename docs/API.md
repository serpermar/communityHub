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
| 409 | `CONFLICT` | El slug ya existe, o el email en el registro |
| 429 | `RATE_LIMITED` | Rate limit. `Retry-After` en la cabecera |
| 500 | `INTERNAL_ERROR` | Error no previsto |

El cliente decide **por el `code`**, nunca por el mensaje: el mensaje es para las
personas y puede cambiar; el código es parte del contrato.

Un `500` nunca lleva detalle del fallo hacia fuera, solo un `reference`
opaco que sí aparece en el log del servidor. Un error no previsto puede llevar en
su mensaje rutas, SQL o valores.
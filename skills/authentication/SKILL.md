# Skill: autenticación y sesiones

## Cuándo usarla
Al razonar sobre registro, login, logout, refresh de token, recuperación de
contraseña o sesiones.

## Contexto que hay que tener presente
- Access token: JWT HS256 de vida corta, se envía en `Authorization: Bearer`. No
  lleva datos personales; sí un `ver` que identifica la sesión para poder
  revocarla.
- Refresh token: opaco, va en cookie `httpOnly` + `SameSite=strict`, y en base de
  datos solo se guarda su hash SHA-256. Nunca se devuelve en el cuerpo.
- El hash de contraseñas es Argon2id. Una contraseña nunca se compara en claro.
- Cerrar sesión invalida de verdad: la siguiente petición da 401 aunque el access
  token no haya caducado.

## Procedimiento
1. Al autenticar, devuelve el access token en el cuerpo y el refresh solo en la
   cookie.
2. Al refrescar, rota el refresh y reemite el access.
3. Al cerrar sesión, marca la sesión como revocada; no te fíes de que el token
   caduque solo.

## Errores típicos
- Devolver el refresh token en JSON (queda accesible a JS y a los logs).
- Guardar el refresh en claro.
- Distinguir en el mensaje de error si el correo existe o no (facilita enumerar
  cuentas).

## Verificación
- Tras logout, una petición con el access token anterior devuelve 401
  `TOKEN_REVOKED`.
- La cookie de refresh llega con `HttpOnly` y `SameSite=strict`.

# Skill: gestión de comunidad

## Cuándo usarla
Al crear, consultar o editar una comunidad, o al razonar sobre membresías,
invitaciones y roles dentro de una comunidad.

## Contexto que hay que tener presente
- Una persona no "está en" la plataforma: pertenece a una o varias comunidades,
  y en cada una tiene un rol distinto (`NEIGHBOR`, `PROVIDER`, `ADMIN`,
  `PRESIDENT`).
- El aislamiento entre comunidades es la regla número uno. Toda consulta pasa por
  `withContext({ userId, communityId })`, que fija las variables que leen las
  políticas RLS. Sin ese contexto, o se ve nada o (peor) se ve de más.
- El rol NO viaja en el cuerpo de la petición: se resuelve con `app_role_in()`.

## Procedimiento
1. Identifica la comunidad por su `id` (uuid), nunca por su nombre.
2. Comprueba la pertenencia con `requireCommunity` antes de leer o escribir.
3. Para datos agregados (miembros, incidencias, saldo) delega en el service del
   dominio; no reimplementes la regla aquí.
4. Al crear una comunidad se hace con rol de plataforma `ADMIN_SA`, y solo se
   escribe con `created_by` propio.

## Errores típicos
- Dar por hecho que un `ADMIN_SA` puede leer cualquier comunidad: crea
  comunidades, no las lee.
- Usar el nombre de la comunidad como clave: no es único.
- Saltarse `requireCommunity` "porque el id viene de la sesión": el `communityId`
  de la URL es un dato del cliente y se valida siempre.

## Verificación
- Un miembro ve la comunidad; alguien que no pertenece recibe 403.
- Cambiar el `communityId` de la URL no da acceso a otra comunidad.

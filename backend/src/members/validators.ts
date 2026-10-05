// ---------------------------------------------------------------------------
// Validacion de entrada de miembros e invitaciones (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde, `.strict()`
// en todos los esquemas y mensajes en castellano. Lo propio de este bloque:
//
//   - El PATCH acepta UN campo, `role` o `status`, nunca los dos y nunca ninguno
//     (spec 03, seccion 6). No es capricho de la API: son dos funciones de SQL y
//     por tanto dos transacciones, y mandarlos a la vez dejaria al vecino a
//     mitad de camino si la segunda fallara.
//   - Los parametros de ruta `memberId` e `invitationId` se validan aqui y no en
//     `auth/middleware.ts`, porque ese archivo es del bloque 01 y la spec 03
//     declara que no se toca. Se reusa su misma expresion regular para que un id
//     mal formado sea un 400 identico en los dos sitios.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/**
 * Los cuatro roles y los tres estados, tal cual estan en `member_role` y
 * `member_status` (01_schema.sql).
 *
 * Se listan aqui y no se dejan pasar como texto libre: un `$queryRaw` con un
 * `${valor}` sin castear deja que el texto llegue al servidor, y ahi un
 * `::member_role` con basura revienta con 22P02. Validarlo antes convierte eso en
 * un 400 con el nombre del campo.
 */
const ROLES = ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER'] as const
const ESTADOS = ['ACTIVE', 'SUSPENDED', 'LEFT'] as const

/**
 * Mismo criterio que `requireUuidParam` de `auth/middleware.ts` (C-9).
 *
 * Un id que no tiene forma de UUID es una peticion mal formada, no una peticion
 * sin permiso: 400 y no 403. Y se comprueba antes de abrir transaccion, porque un
 * `::uuid` sobre texto invalido revienta con 22P02.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El mismo criterio que `auth/validators.ts`: minúsculas con `transform`.
 *
 * Aqui es imprescindible que el correo salga en minusculas, no por costumbre: M-8
 * compara el correo de la cuenta con el de la invitacion, y las dos columnas se
 * guardan en minusculas. Sin esta transformacion, `Marta@Ejemplo.Test` pasaria la
 * validacion de formato y fallaria el canje contra una invitacion creada con el
 * mismo correo escrito de otra forma.
 */
const email = z
  .string()
  .trim()
  .min(1, 'El correo es obligatorio.')
  .max(320, 'El correo es demasiado largo.')
  .pipe(z.email('El correo no tiene un formato válido.'))
  .transform((value) => value.toLowerCase())

/**
 * Alta de una invitacion.
 *
 * Solo el correo. `expires_at` no se acepta (M-7: lo pone el servidor a 7 dias),
 * `role` no se acepta (M-9: quien entra es siempre NEIGHBOR) y `code` tampoco, que
 * lo genera el servidor. Los tres son cosas que el cliente no decide, y con
 * `.strict()` mandarlos es un 400 que dice la verdad en vez de un 200 que los
 * ignora en silencio.
 */
export const inviteSchema = z.object({ email }).strict()

/**
 * PATCH de un miembro: `role` XOR `status`.
 *
 * Sin `.transform()` en ningun campo, por el mismo motivo que en
 * `communities/validators.ts`: un campo con transform aparece en la salida aun
 * que no venga, y un PATCH de solo `role` acabaria metiendo `status` en la base
 * de datos.
 *
 * `LEFT` es un estado final y no reversible desde la API (M-4): no hay ninguna
 * operacion para volver de `LEFT` a `ACTIVE` que no sea un canje de invitacion
 * nuevo, que es justo lo que hace `app_redeem_invitation()`.
 */
export const patchMemberSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(ESTADOS).optional(),
  })
  .strict()
  .refine((v) => !(v.role !== undefined && v.status !== undefined), {
    message: 'Envía role o status, pero no los dos: son dos cambios y dos transacciones.',
    path: ['status'],
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'No hay nada que actualizar: envía role o status.',
    path: [],
  })

/**
 * Canje de un codigo.
 *
 * Solo `code`, y `.strict()` por el mismo motivo que en el alta: un canje con
 * `communityId` dentro seria un intento de elegir a que comunidad se entra, que
 * es justo lo que el codigo ya tiene decidido.
 *
 * Sin `.toLowerCase()`: el codigo se genera en el servidor con digitos
 * hexadecimales, y no se toca su forma. Solo el `trim`, que es lo mismo que hace
 * el `btrim` de `app_redeem_invitation()`, para que pegar el codigo con un
 * espacio de mas no lo invalide.
 *
 * El limite de 200 caracteres no acota nada real: el codigo son 64 hex. Acota lo
 * que se puede mandar contra la funcion antes de que sha256 lo convierta todo en
 * lo mismo.
 */
export const redeemSchema = z
  .object({
    code: z.string().trim().min(1, 'El código es obligatorio.').max(200, 'El código es demasiado largo.'),
  })
  .strict()

/**
 * Un UUID de ruta.
 *
 * Se exporta como esquema para que el controller lo valide con el mismo `parse`
 * que usa para los cuerpos, en vez de un segundo camino de validacion.
 */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/** Los valores admitidos, para los mensajes de error de los tests. */
export const ROLES_VALIDOS = ROLES
export const ESTADOS_VALIDOS = ESTADOS

export type InviteInput = z.infer<typeof inviteSchema>
export type PatchMemberInput = z.infer<typeof patchMemberSchema>
export type RedeemInput = z.infer<typeof redeemSchema>
// ---------------------------------------------------------------------------
// Acceso a datos de miembros e invitaciones.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// Cuatro de las seis funciones se llaman por SQL a mano y el resto va por el
// cliente de Prisma:
//
//   - app_list_community_members() y app_get_community_member(): hacen un JOIN
//     con `users` que el cliente de Prisma no puede escribir, porque `users` solo
//     es legible por RLS para la fila propia y la funcion es la excepcion
//     acotada que autoriza la spec 03 (seccion 4b).
//   - app_invite_to_community(), app_redeem_invitation(),
//     app_set_member_role() y app_set_member_status(): son SECURITY DEFINER, y
//     su guarda y su invariante (M-3) viven DENTRO. Llamarlas por Prisma no es
//     posible de otra forma, y el cliente no debe decidir nada de eso.
//   - community_invitations se lee y se borra por el cliente: son
//     `SELECT` y `DELETE` con politica, y no tienen ningun campo que el cliente
//     pueda usar para saltarse una regla (spec 03, seccion 4c).
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los
// nombres de columna van LITERALMENTE en la plantilla, porque en `$queryRaw`
// cualquier cosa metida en `${}` viaja como parametro ligado, no como SQL. Una
// constante de texto ahi se convierte en `select $1, ...`, que es un error de
// tipo y un 500.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Una fila de `app_get_community_member()` / `app_list_community_members()`.
 *
 * `full_name` y `email` vienen de `users`, no de `community_members`: la tabla de
 * membresias no los tiene, y denormalizarlos duplicaria el dato y se quedaria
 * viejo en cuanto el vecino cambiase su nombre. `full_name` es nullable en
 * `users` y por eso lo es aqui.
 */
export type MemberRow = {
  id: string
  user_id: string
  full_name: string | null
  email: string | null
  unit_number: string | null
  role: string
  status: string
  joined_at: Date
  created_at: Date
  updated_at: Date
}

/**
 * Fila de `community_invitations` con solo las columnas que salen en la API.
 *
 * `code_hash` NO esta en la lista. No hay ninguna razon de negocio para leerlo
 * desde la aplicacion: el canje lo hace la funcion de SQL, y seleccionar el hash
 * solo pondria un valor inutil en la memoria del proceso y en cualquier log que
 * se hiciera por el camino.
 */
export type InvitationRow = {
  id: string
  email: string
  expires_at: Date
  accepted_at: Date | null
  created_at: Date
}

/**
 * Una invitacion por id.
 *
 * Sin `community_id` en el filtro, a proposito y a diferencia de las demas lecturas
 * de este archivo: esta se usa justo DESPUES de crearla, con el id recien devuelto
 * por la funcion, y el `community_id` no se conoce todavia en el codigo que la
 * llamo. La seguridad no la da el filtro de esta consulta sino que el actor es un
 * ADMIN activo de una comunidad y la politica `invitations_select_admin` ya
 * limita la fila a las de las comunidades que administra.
 */
export async function findInvitation(tx: Tx, invitationId: string): Promise<InvitationRow | null> {
  return tx.communityInvitations.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      email: true,
      expires_at: true,
      accepted_at: true,
      created_at: true,
    },
  })
}

/**
 * Listar los miembros de una comunidad.
 *
 * Las columnas van escritas una a una y repetidas en cada consulta, no en una
 * constante interpolada (ver la nota de la cabecera) y no con `select *`: el
 * `select *` de una funcion que devuelve TABLE se resuelve en el orden de sus
 * parametros de salida, y ese orden es un detalle de la definicion SQL que no se
 * ve al leer el TypeScript.
 */
export async function listMembers(tx: Tx, communityId: string): Promise<MemberRow[]> {
  return tx.$queryRaw<MemberRow[]>`
    select id, user_id, full_name, email, unit_number, role, status,
           joined_at, created_at, updated_at
      from app_list_community_members(${communityId}::uuid)
  `
}

/** Un miembro concreto. Que exista dentro de esa comunidad lo decide la funcion. */
export async function findMember(tx: Tx, communityId: string, memberId: string): Promise<MemberRow | null> {
  const rows = await tx.$queryRaw<MemberRow[]>`
    select id, user_id, full_name, email, unit_number, role, status,
           joined_at, created_at, updated_at
      from app_get_community_member(${communityId}::uuid, ${memberId}::uuid)
  `

  return rows[0] ?? null
}

/**
 * Cambiar el rol de un miembro.
 *
 * `$executeRaw` y no `$queryRaw` porque la funcion devuelve `void`: no hay nada
 * que mapear y el unico resultado que interesa es "ha fallado o no".
 *
 * `::member_role` es obligatorio. Sin el cast, el texto llegaria como `text` y
 * Postgres no lo convertiria al enum solo; con el cast, un valor fuera del enum
 * falla con 22P02 en vez de guardarse como un string raro. El enum lo valida
 * tambien zod, y por eso el 22P02 es una segunda linea, no la primera.
 *
 * El `memberId` va con `community_id` en el `where` de la funcion, no por su
 * cuenta: es lo que impide que un ADMIN de A toque a un miembro de B diciendo un
 * `memberId` de B, y lo que convierte ese intento en un 404 (spec 03, seccion 6).
 */
export async function setMemberRole(tx: Tx, communityId: string, memberId: string, role: string): Promise<void> {
  await tx.$executeRaw`select app_set_member_role(${communityId}::uuid, ${memberId}::uuid, ${role}::member_role)`
}

/** Cambiar el estado de un miembro. Simetrica a la anterior, con su invariante propio. */
export async function setMemberStatus(tx: Tx, communityId: string, memberId: string, status: string): Promise<void> {
  await tx.$executeRaw`select app_set_member_status(${communityId}::uuid, ${memberId}::uuid, ${status}::member_status)`
}

/**
 * Crear una invitacion y devolver el codigo EN CLARO.
 *
 * El codigo se genera entero en la funcion. Si lo recibiera el cliente, un ADMIN
 * podria poner un codigo predecible y adivinar invitaciones ajenas, porque lo que
 * se compara es el hash. Este `code` es el unico punto del sistema donde existe
 * en claro, y sale en la respuesta de creacion y en ningun otro sitio.
 */
export async function createInvitation(
  tx: Tx,
  communityId: string,
  email: string,
): Promise<{ id: string; code: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string; code: string }>>`
    select id, code
      from app_invite_to_community(${communityId}::uuid, ${email})
  `

  const row = rows[0]

  if (!row) {
    throw new Error('app_invite_to_community() no devolvio ninguna invitación')
  }

  return row
}

/**
 * Invitaciones de una comunidad, de mas reciente a mas vieja.
 *
 * Por el cliente de Prisma y no a mano, porque es un `SELECT` con politica y no
 * necesita nada que el cliente no sepa hacer. El orden es el del indice
 * `community_invitations_listing_idx`, asi que no hay un sort encima.
 *
 * Devuelve tambien las ya usadas (M-11): el ADMIN necesita ver a quien ha
 * invitado y cuando entro. Ocultarlas haria que la tabla creciera sin que nadie
 * supiera por que.
 */
export async function listInvitations(tx: Tx, communityId: string): Promise<InvitationRow[]> {
  return tx.communityInvitations.findMany({
    where: { community_id: communityId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      email: true,
      expires_at: true,
      accepted_at: true,
      created_at: true,
    },
  })
}

/**
 * Anular una invitacion sin usar (M-11).
 *
 * Devuelve un TRES ESTADOS en vez de un booleano porque el servicio los traduce a
 * tres respuestas distintas, y un `false` de "no se borro" no distingue entre "no
 * existe" y "ya se uso", que son un 404 y un 409.
 *
 * El borrado lo filtra la politica `invitations_delete_unused_admin`, no un `if` de
 * aqui, y por eso el `where` NO lleva `accepted_at: null`: lo que decide es la
 * politica, y por eso una invitacion usada devuelve 0 filas, que es lo que
 * permite despues distinguirla de una que no existe. Si la politica se relajara
 * alguna vez, el DELETE aqui seguiria borrando una usada y el 409 dejaria de
 * aparecer: por eso el `where` minimo y la relectura, y no un filtro en el codigo.
 *
 * La relectura va con `community_id` en el filtro. Sin el, un ADMIN de A que
 * borrara por su cuenta el id de una invitacion de B veria 'used' y no 'missing',
 * y la respuesta 409 confirmaria que ese id existe en otra comunidad (C-8).
 */
export async function deleteInvitation(
  tx: Tx,
  communityId: string,
  invitationId: string,
): Promise<'deleted' | 'used' | 'missing'> {
  const result = await tx.communityInvitations.deleteMany({
    where: { id: invitationId, community_id: communityId },
  })

  if (result.count > 0) {
    return 'deleted'
  }

  const row = await tx.communityInvitations.findFirst({
    where: { id: invitationId, community_id: communityId },
    select: { id: true },
  })

  return row ? 'used' : 'missing'
}

/**
 * Canjear un codigo.
 *
 * Devuelve el id de la membresia y el de la comunidad, que es lo unico que la
 * funcion sabe: el rol y el estado los pone ella misma (siempre NEIGHBOR y
 * ACTIVE, M-9) y no se piden, para que el servicio no los suponga.
 *
 * Se llama con `communityId: null` en el contexto a proposito: la comunidad la
 * decide el codigo, y fijar una antes seria fijar una suposicion.
 */
export async function redeemInvitation(tx: Tx, code: string): Promise<{ member_id: string; community_id: string }> {
  const rows = await tx.$queryRaw<Array<{ member_id: string; community_id: string }>>`
    select member_id, community_id
      from app_redeem_invitation(${code})
  `

  const row = rows[0]

  if (!row) {
    throw new Error('app_redeem_invitation() no devolvio nada')
  }

  return row
}
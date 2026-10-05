// ---------------------------------------------------------------------------
// Servicio de miembros e invitaciones.
//
// Aqui vive la logica de negocio. Los controllers solo reparten peticiones y los
// repositorios solo ejecutan SQL.
//
// La regla que atraviesa todo el archivo: la autorizacion esta en dos capas y las
// dos se necesitan. Los guards del middleware comprueban el rol CONTRA ESTADO
// (que el ADMIN no este suspendido), y las funciones de SQL comprueban lo mismo
// DENTRO de la transaccion, en el unico sitio donde el motor la ve. Un invariante
// que solo vive en la capa HTTP no es un invariante: la misma llamada se puede
// hacer por PostgREST.
//
// Y ninguna regla de negocio se decide leyendo filas y comparando en TypeScript.
// La comparacion de email del canje (M-8) y el conteo del ultimo ADMIN (M-3) son
// cosas que tienen que pasar en la misma transaccion que la escritura, o entre
// una y otra se cuela otra peticion.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { badRequest, conflict, notFound } from '../http/errors.js'
import type { InviteInput, PatchMemberInput, RedeemInput } from './validators.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'

/**
 * El miembro tal como sale en la API.
 *
 * `id` es el id de la MEMBRESIA, no el del usuario, y no es un descuido: son dos
 * filas distintas. El `userId` va aparte porque hace falta para otras cosas, y
 * porque un endpoint de membresia que devuelve el id del usuario invita a usarlo
 * como si fuera el mismo identificador.
 *
 * `email` y `fullName` salen porque quien lista ya es miembro de esa comunidad y
 * los ve en cualquier pantalla del portal. No es una fuga: la comunidad es el
 * ambito cerrado. Vienen de la funcion de lectura, que es la unica excepcion
 * acotada a `users_select_self` en todo el proyecto (spec 03, seccion 4b).
 */
export type MemberView = {
  id: string
  userId: string
  fullName: string | null
  email: string | null
  unitNumber: string | null
  role: string
  status: string
  joinedAt: string
  createdAt: string
  updatedAt: string
}

/**
 * La invitacion tal como sale en la API.
 *
 * NO tiene `code`. El codigo existe en claro solo en la respuesta de creacion:
 * lo que se guarda es su SHA-256, y por eso no se puede recuperar despues. Un
 * campo `code: null` seria ruido; el campo no existe.
 *
 * `acceptedAt` es fecha o nada, no un estado. Una invitacion usada se queda en la
 * tabla porque "este ADMIN invito a este vecino el dia tal" es informacion que
 * hace falta (M-4, M-11).
 */
export type InvitationView = {
  id: string
  email: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}

/** La invitacion recien creada, que es la unica vez que se ve el codigo. */
export type InvitationCreatedView = InvitationView & { code: string }

function toMemberView(row: repo.MemberRow): MemberView {
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    unitNumber: row.unit_number,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toInvitationView(row: repo.InvitationRow): InvitationView {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at ? row.accepted_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Miembros: lectura
// ---------------------------------------------------------------------------

/**
 * Listar los miembros de una comunidad.
 *
 * De CUALQUIER miembro, no solo del ADMIN (spec 03, seccion 6). Es el caso de uso
 * principal ("¿el tecnico ya tiene acceso?") y el `PROVIDER` necesita ver a quien
 * esperar.
 *
 * Sale todo: tambien los `SUSPENDED` y los `LEFT`, con su `status` a la vista.
 * `SUSPENDED` es visible, no secreto, y el historico es el punto de M-4. Ocultar a
 * quien se fue seria tirar justo el dato que M-4 dice que se conserva; filtrar, si
 * hace falta, es cosa del frontend.
 *
 * El orden lo pone la funcion SQL (`lower(full_name)`), no un `orderBy` aqui:
 * con el cliente de Prisma habria que traer las filas para ordenarlas en memoria,
 * o duplicar la expresion en dos sitios.
 */
export async function listMembers(userId: string, communityId: string): Promise<MemberView[]> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const rows = await repo.listMembers(tx, communityId)
      return rows.map(toMemberView)
    }),
  )
}

/**
 * Un miembro concreto.
 *
 * El middleware ya ha resuelto la pertenencia y ha puesto 403 si no hay
 * pertenencia, asi que llegar aqui significa que el usuario es miembro activo de
 * esta comunidad. Que la fila salga vacia es entonces un 404 de verdad: la
 * membresia no existe aqui.
 *
 * Un miembro de otra comunidad da 404 y no 403, y no por descuido: la funcion
 * busca por `(community_id, member_id)`, asi que para esta comunidad la fila no
 * existe. Un 403 confirmaria que ese `memberId` es real en algun sitio (C-8).
 */
export async function getMember(userId: string, communityId: string, memberId: string): Promise<MemberView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const row = await repo.findMember(tx, communityId, memberId)

      if (!row) {
        throw notFound('Ese miembro no existe en esta comunidad.')
      }

      return toMemberView(row)
    }),
  )
}

// ---------------------------------------------------------------------------
// Miembros: rol y estado
// ---------------------------------------------------------------------------

/**
 * Cambiar el rol o el estado de un miembro.
 *
 * El cuerpo llega ya validado con la regla de exclusividad: `role` XOR `status`
 * (spec 03, seccion 6). La comprobacion se hace aqui y no en el controller para
 * que la regla este junto al resto de las del dominio, pero el unico sitio donde
 * de verdad no se puede saltar es la funcion de SQL: el invariante del ultimo
 * ADMIN (M-3) vive ahi, dentro de la misma transaccion que el `UPDATE`.
 *
 * Por que dos funciones y no una: son dos invariantes distintos con dos mensajes
 * distintos, y separarlas deja claro que un cambio de rol no puede cambiar el
 * estado por accidente. El coste es que un PATCH con los dos daria 409 a mitad de
 * camino, y por eso el esquema lo rechaza antes (spec 03, seccion 6).
 *
 * El middleware ya ha comprobado que el actor es `ADMIN` activo. La funcion lo
 * vuelve a comprobar dentro: es la segunda capa, y la que importa, porque es la
 * unica que el motor ejecuta.
 *
 * Se relee la fila despues del cambio y se devuelve completa, en vez de
 * inventarse el resultado. La funcion devuelve `void` justamente para no poder
 * devolver medio estado; leer despues cuesta una consulta y elimina la clase de
 * bugs en la que la respuesta dice una cosa y la tabla dice otra.
 */
export async function patchMember(
  userId: string,
  communityId: string,
  memberId: string,
  input: PatchMemberInput,
): Promise<MemberView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      if (input.role !== undefined) {
        await repo.setMemberRole(tx, communityId, memberId, input.role)
      } else if (input.status !== undefined) {
        await repo.setMemberStatus(tx, communityId, memberId, input.status)
      } else {
        // El esquema lo rechaza antes. Si llegara aqui, es que alguien ha
        // llamado al servicio sin pasar por el controller, y un 400 explicito es
        // mejor que un UPDATE que no cambia nada devolviendo 200.
        throw badRequest('No hay nada que actualizar: envía role o status.')
      }

      const row = await repo.findMember(tx, communityId, memberId)

      if (!row) {
        // Solo alcanzable si el UPDATE no habria tocado ninguna fila, que no
        // deberia ocurrir. Si se llegara, es un 404 honesto: la membresia no esta.
        throw notFound('Ese miembro no existe en esta comunidad.')
      }

      return toMemberView(row)
    }),
  )
}

// ---------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------

/**
 * Crear una invitacion.
 *
 * El codigo lo genera `app_invite_to_community()` y sale en claro en la respuesta:
 * hay que poder enseñarselo al vecino y no hay SMTP para mandarlo (M-1). Es la
 * unica vez que se ve; despues solo queda su hash.
 *
 * El ADMIN lo ha comprobado ya el middleware (`requireCommunityRole('ADMIN')`) y
 * la funcion lo vuelve a hacer dentro. Se fija el contexto de comunidad en las dos
 * llamadas porque la segunda (la relectura) si pasa por RLS, y sin el contexto
 * `app_is_admin_of()` seria falsa y no se veria la fila que se acaba de crear.
 */
export async function createInvitation(
  userId: string,
  communityId: string,
  input: InviteInput,
): Promise<InvitationCreatedView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const row = await repo.createInvitation(tx, communityId, input.email)

      const invitation = await repo.findInvitation(tx, row.id)

      if (!invitation) {
        // La funcion es SECURITY DEFINER y acaba de insertar la fila; si no se ve,
        // algo se ha roto por debajo. Un 404 seria mentira: si que existe.
        throw new Error('La invitación se creó pero no se puede leer.')
      }

      return { ...toInvitationView(invitation), code: row.code }
    }),
    'invitacion_viva',
  )
}

/**
 * Listar las invitaciones de una comunidad.
 *
 * De mas reciente a mas vieja, e incluyendo las usadas (M-11): el ADMIN necesita
 * ver a quien ha invitado y cuando entro.
 */
export async function listInvitations(userId: string, communityId: string): Promise<InvitationView[]> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const rows = await repo.listInvitations(tx, communityId)
      return rows.map(toInvitationView)
    }),
  )
}

/**
 * Anular una invitacion sin usar (M-11).
 *
 * Tres salidas distintas, y las tres importan:
 *
 *   - borrada: la invitacion existia y no se habia usado. 204.
 *   - usada: existe pero `accepted_at` no es null. 409, y NO se borra. La fila es
 *     visible y el problema no es de permiso, es que un canje no se deshace.
 *   - missing: no existe, o es de otra comunidad. 404. No se distingue el caso de
 *     "es de otra comunidad" del de "no existe" (C-8).
 *
 * Se devuelve 204 y no 200 con `null`: anular no deja recurso que leer, y el
 * envelope prohibe `data: null` para que nadie lo trate como un error.
 */
export async function deleteInvitation(userId: string, communityId: string, invitationId: string): Promise<void> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const resultado = await repo.deleteInvitation(tx, communityId, invitationId)

      if (resultado === 'used') {
        throw conflict('CONFLICT', 'Esa invitación ya se usó y no se puede anular.')
      }

      if (resultado === 'missing') {
        throw notFound('Esa invitación no existe en esta comunidad.')
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Canje
// ---------------------------------------------------------------------------

/**
 * Canjear un codigo de invitacion.
 *
 * Ruta aparte y autenticada (M-10). El registro del bloque 01 no se toca: meter el
 * canje alli obligaria a decidir que pasa si el alta funciona y el codigo no, o se
 * deshace la cuenta o se devuelve un 400 con la cuenta ya creada.
 *
 * El contexto va con `communityId: null` a proposito: la comunidad la decide el
 * codigo, y fijarla antes seria fijar una suposicion.
 *
 * La comparacion de email (M-8) y el "ya es miembro" (M-6) ocurren dentro de la
 * funcion, en la misma transaccion que el `INSERT`/`UPDATE` de la membresia. Si se
 * comprobaran en TypeScript, un segundo canje simultaneo con el mismo codigo por
 * parte de otra persona se colaria entre la comprobacion y la escritura.
 *
 * Devuelve los dos ids y nada mas. El rol y el estado los pone la funcion (siempre
 * `NEIGHBOR` y `ACTIVE`, M-9), asi que inventarlos aqui seria mentir por
 * duplicado; quien quiera verlos tiene `GET /members/:memberId`.
 */
export async function redeemInvitation(
  userId: string,
  input: RedeemInput,
): Promise<{ memberId: string; communityId: string }> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const row = await repo.redeemInvitation(tx, input.code)

      return { memberId: row.member_id, communityId: row.community_id }
    }),
    'ya_es_miembro_activo',
  )
}
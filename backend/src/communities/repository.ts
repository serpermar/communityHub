// ---------------------------------------------------------------------------
// Acceso a datos de comunidades.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// Dos lecturas van por SQL a mano y el resto por el cliente de Prisma:
//
//   - La que necesita `app_role_in()`, que no existe en el cliente.
//   - `app_create_community()`, que es `SECURITY DEFINER` y por tanto se
//     ejecuta saltandose RLS a proposito. Lo que la protege es la guarda de
//     `ADMIN_SA` que lleva dentro, mas la politica `communities_insert_admin_sa`
//     como segunda capa (spec 02, seccion 4). La segunda capa no protege la
//     funcion, protege el INSERT directo que alguien escribiera por su cuenta en
//     el mismo servicio.
//
// Para lo demas se usa el cliente, y no `Prisma.raw` con un objeto armado a
// mano: los nombres de columna pasan por el generador y no por una concatenacion.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export type CommunityRow = {
  id: string
  name: string
  slug: string
  description: string | null
  address_line1: string
  city: string
  province: string | null
  postal_code: string | null
  country: string
  latitude: Prisma.Decimal | null
  longitude: Prisma.Decimal | null
  timezone: string
  registration_number: string | null
  is_active: boolean
  created_at: Date
  updated_at: Date
  deleted_at: Date | null
}

/** El mismo recurso por el cliente de Prisma, para lo que no necesita SQL a mano. */
const COMMUNITY_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  address_line1: true,
  city: true,
  province: true,
  postal_code: true,
  country: true,
  latitude: true,
  longitude: true,
  timezone: true,
  registration_number: true,
  is_active: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
} as const

/**
 * Comunidades donde el usuario es miembro.
 *
 * SIN `where` de pertenencia, a proposito. La politica
 * `communities_select_member` ya devuelve solo las filas que le tocan, y
 * duplicar el filtro aqui significaria que un fallo en la politica pasaria
 * desapercibido: el filtro de la aplicacion taparia el agujero y los tests
 * seguirian en verde. Lo que si se filtra a mano es lo que RLS no puede saber:
 * los soft-deletes y las comunidades dadas de baja (C-5).
 *
 * `memberRole` viene de `app_role_in()`, que lee el contexto. No se consulta
 * `community_members` aparte: seria una segunda lectura con la misma politica, y
 * para el listado un join que no hace falta.
 *
 * Las columnas se escriben LITERALMENTE dentro de la plantilla, y no como una
 * constante interpolada: en `$queryRaw` cualquier valor metido en `${}` se envia
 * como un parametro vinculado, no como SQL. Una constante de texto ahi se
 * convierte en `select $1, app_role_in(...)`, que es un error de tipo y un 500.
 *
 * Es una lista fija, sin nada que venga del cliente: no hay por donde inyectar.
 * Se escribe a mano porque la consulta necesita una columna calculada
 * (`app_role_in`) al lado, y el cliente de Prisma no sabe expresar eso.
 */
export async function listCommunities(tx: Tx): Promise<Array<CommunityRow & { member_role: string | null }>> {
  return tx.$queryRaw<Array<CommunityRow & { member_role: string | null }>>`
    select c.id, c.name, c.slug, c.description, c.address_line1, c.city, c.province,
           c.postal_code, c.country, c.latitude, c.longitude, c.timezone,
           c.registration_number, c.is_active, c.created_at, c.updated_at,
           c.deleted_at,
           app_role_in(c.id) as member_role
      from communities c
     where c.deleted_at is null
       and c.is_active = true
     order by c.name asc
  `
}

/** Una comunidad por id. Que la fila exista es cosa de la politica, no del `where`. */
export async function findCommunityById(tx: Tx, communityId: string) {
  return tx.communities.findUnique({
    where: { id: communityId },
    select: COMMUNITY_FIELDS,
  })
}

/**
 * Dar de alta una comunidad.
 *
 * Va por `app_create_community()` y no por un `create` de Prisma por dos motivos
 * que no son de estilo:
 *
 *   1. La funcion crea tambien al primer ADMIN en la misma transaccion. Con dos
 *      escrituras sueltas, un fallo entre medias dejaria una comunidad sin nadie
 *      que la administre y sin forma de arreglarlo desde la API.
 *   2. El INSERT directo esta bloqueado por RLS para quien no sea `ADMIN_SA`, y
 *      esa comprobacion tiene que vivir en un sitio que el codigo de aplicacion
 *      no pueda saltarse.
 *
 * Los parametros van en el orden de la firma de la funcion, que es el mismo que
 * el del DTO de la API. Un NULL explicito en `country` o `timezone` es lo
 * correcto: la funcion tiene su propio valor por defecto y lo aplica dentro.
 */
export async function createCommunity(tx: Tx, input: {
  name: string
  slug: string
  addressLine1: string
  city: string
  country: string
  description: string | null
  province: string | null
  postalCode: string | null
  registrationNumber: string | null
  timezone: string
  latitude: number | null
  longitude: number | null
}): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_community(
      ${input.name},
      ${input.slug},
      ${input.addressLine1},
      ${input.city},
      ${input.country},
      ${input.description},
      ${input.province},
      ${input.postalCode},
      ${input.latitude}::numeric,
      ${input.longitude}::numeric,
      ${input.timezone},
      ${input.registrationNumber}
    ) as id
  `

  const id = rows[0]?.id
  if (!id) {
    throw new Error('app_create_community() no devolvio ninguna comunidad')
  }

  return id
}

/**
 * Actualizacion parcial.
 *
 * `updateMany` y no `update`: la politica `communities_update_admin` ya impide
 * tocar comunidades ajenas, asi que un `update` sobre una fila no visible
 * afectaria a cero filas y Prisma lanzaria P2025, que el middleware traduce a
 * 404. Para el servicio, "no he podido actualizar nada" y "no existe" son cosas
 * distintas, y con `updateMany` la primera no se disfraza de la segunda.
 *
 * Solo se escribe lo que viene en el cuerpo: `data` lo arma el servicio con los
 * campos presentes, y un campo ausente no se toca. Un update con el objeto
 * entero sobrescribiria con null lo que el cliente no menciono, que es como se
 * pierde medio formulario en la primera actualizacion parcial.
 */
export async function updateCommunity(
  tx: Tx,
  communityId: string,
  data: Record<string, unknown>,
): Promise<number> {
  const result = await tx.communities.updateMany({
    where: { id: communityId },
    data: data as Prisma.CommunitiesUpdateManyMutationInput,
  })
  return result.count
}

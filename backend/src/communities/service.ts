// ---------------------------------------------------------------------------
// Servicio de comunidades.
//
// Aqui vive la logica de negocio. Los controllers solo reparten peticiones y los
// repositorios solo ejecutan SQL.
//
// Regla que atraviesa todo el archivo: el servicio no acepta del cliente nada
// sin comprobarlo antes. El `communityId` de la URL se valida contra la
// pertenencia real en el middleware, y el rol se comprueba contra la fila antes
// de escribir. RLS esta siempre detras, como red, nunca como unica defensa: una
// politica que deja pasar una fila devuelve cero en vez de fallar, y eso
// convierte un descuido de autorizacion en un 404 en lugar de un 403.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { withContext } from '../context.js'
import { conflict, notFound } from '../http/errors.js'
import type { CreateCommunityInput, UpdateCommunityInput } from './validators.js'
import * as repo from './repository.js'

export type CommunityView = {
  id: string
  name: string
  slug: string
  description: string | null
  addressLine1: string
  city: string
  province: string | null
  postalCode: string | null
  country: string
  latitude: number | null
  longitude: number | null
  timezone: string
  registrationNumber: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  memberRole: string | null
}

/**
 * Coordenadas: `Decimal` de Prisma a `number`.
 *
 * Aqui si es un numero. Son coordenadas, y convertirlas a texto las haria
 * inutiles para un mapa: el cliente las suma, las compara y las pasa al mapa.
 * Perder precision en una septima cifra decimal no importa ahi.
 *
 * NO se extiende a los importes. En `finance` el `Decimal` se devuelve como
 * string y se opera con decimal, nunca con coma flotante. La regla no es "el
 * Decimal se convierte", sino "cada tipo se convierte como lo que es".
 */
function toCoordinate(value: { toNumber(): number } | null | undefined): number | null {
  return value == null ? null : value.toNumber()
}

function toView(
  row: repo.CommunityRow & { member_role?: string | null },
  memberRole: string | null = row.member_role ?? null,
): CommunityView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    addressLine1: row.address_line1,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    country: row.country,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    timezone: row.timezone,
    registrationNumber: row.registration_number,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    memberRole,
  }
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

/**
 * Comunidades del usuario.
 *
 * `communityId: null` en el contexto a proposito: en este punto todavia no se ha
 * elegido ninguna comunidad, y fijarla haria que `app_role_in()` devolviera el
 * rol de una sola. El filtro de pertenencia lo pone la politica de RLS.
 */
export async function listMine(userId: string): Promise<CommunityView[]> {
  return withContext({ userId, communityId: null }, async (tx) => {
    const rows = await repo.listCommunities(tx)
    return rows.map((row) => toView(row))
  })
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

/**
 * Una comunidad concreta.
 *
 * El middleware ya ha resuelto el rol y ha puesto 403 si no hay pertenencia, asi
 * que llegar aqui significa que el rol existe. Que la fila salga vacia seria
 * entonces un 404 de verdad: la comunidad esta dada de baja o borrada.
 *
 * El 403 por "es de otro" no se distingue del 403 por "no existe" (C-8). Un 404
 * en el caso de "no existe" confirmaria que el id esta libre, que es informacion
 * sobre los ids de los demas.
 */
export async function getOne(userId: string, communityId: string, memberRole: string): Promise<CommunityView> {
  return withContext({ userId, communityId }, async (tx) => {
    const row = await repo.findCommunityById(tx, communityId)

    if (!row || row.deleted_at !== null) {
      throw notFound('La comunidad no existe.')
    }

    return toView(row as repo.CommunityRow, memberRole)
  })
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

/**
 * Crear una comunidad.
 *
 * `communityId: null` tambien aqui. La comunidad todavia no existe, asi que no
 * hay ninguna que poner en el contexto, y `app_create_community()` recibe el
 * actor de `app_current_user_id()` para poder exigirse a si misma un ADMIN_SA.
 *
 * La respuesta lleva `memberRole: 'ADMIN'` sin consultar nada: la funcion acaba
 * de crear al actor como primer administrador dentro de la misma transaccion, y
 * volver a preguntarle al motor seria una consulta extra para confirmar algo que
 * ya se sabe. Si algun dia esa fila no existiera, lo detectaria el test que
 * comprueba que la comunidad nace con exactamente un ADMIN.
 */
export async function create(userId: string, input: CreateCommunityInput): Promise<CommunityView> {
  const id = await withContext({ userId, communityId: null }, (tx) => repo.createCommunity(tx, input)).catch(
    (error: unknown) => {
      // 23505 sobre el indice del slug -> 409. El error se translatee aqui y no
      // en el middleware de errores porque el middleware no sabe de comunidades:
      // esta decision es de este dominio.
      if (slugEnUso(error)) {
        throw conflict('CONFLICT', 'Ya existe una comunidad con ese identificador.')
      }

      throw error
    },
  )

  const row = await withContext({ userId, communityId: id }, (tx) => repo.findCommunityById(tx, id))

  if (!row) {
    throw notFound('La comunidad se creó pero no se puede leer.')
  }

  return toView(row as repo.CommunityRow, 'ADMIN')
}

// ---------------------------------------------------------------------------
// Configuracion
// ---------------------------------------------------------------------------

/**
 * Actualizar la configuracion.
 *
 * El rol ya lo ha comprobado el middleware (`requireCommunityRole('ADMIN')`).
 * Aqui solo se traduce el cuerpo a columnas.
 *
 * Los campos se filtran uno a uno contra una lista blanca en vez de mapear el
 * objeto entero. El esquema es `.strict()` y ya ha descartado las claves
 * desconocidas, pero el filtro es la segunda linea: si el esquema se relajara
 * alguna vez, lo que no este en la lista no se escribe, y no se acaba
 * aceptando `created_by` o `id` desde un cuerpo.
 *
 * `updated_at` lo pone el servidor. Aceptarlo del cliente seria aceptar una
 * fecha inventada en un campo que se usa para ordenar y para saber que version
 * se esta mirando.
 */
const COLUMNAS: Record<string, string> = {
  name: 'name',
  description: 'description',
  addressLine1: 'address_line1',
  city: 'city',
  country: 'country',
  province: 'province',
  postalCode: 'postal_code',
  registrationNumber: 'registration_number',
  timezone: 'timezone',
  latitude: 'latitude',
  longitude: 'longitude',
  isActive: 'is_active',
}

export async function update(
  userId: string,
  communityId: string,
  memberRole: string,
  input: UpdateCommunityInput,
): Promise<CommunityView> {
  const data: Record<string, unknown> = {}

  for (const [campo, columna] of Object.entries(COLUMNAS)) {
    const valor = input[campo as keyof UpdateCommunityInput]

    // `undefined` = el cliente no lo ha mencionado. No se escribe, y esa es toda
    // la diferencia entre un PATCH parcial y uno que vacia la comunidad.
    //
    // La cadena vacia si se escribe, pero como NULL: mandarla como `''` dejaria
    // una descripcion vacia que el frontend tiene que tratar aparte, y aqui se
    // puede resolver en la linea de arriba.
    if (valor === undefined) continue

    data[columna] = valor === '' ? null : valor
  }

  data.updated_at = new Date()

  return withContext({ userId, communityId }, async (tx) => {
    const affected = await repo.updateCommunity(tx, communityId, data)

    if (affected === 0) {
      throw notFound('La comunidad no existe.')
    }

    const row = await repo.findCommunityById(tx, communityId)

    if (!row) {
      throw notFound('La comunidad no existe.')
    }

    return toView(row as repo.CommunityRow, memberRole)
  })
}

/**
 * Texto del error de PostgreSQL cuando un `slug` ya existe.
 *
 * `app_create_community()` es `SECURITY DEFINER` y su unicidad la impone el
 * indice unico de la tabla, no Prisma. Por eso el conflicto llega como un error
 * de Postgres (`23505`), no como el `P2002` que el middleware de errores ya
 * sabia traducir, y sin esto el alta de un slug repetido devolvia un 500.
 *
 * Se busca la columna `(slug)` y no el nombre del indice porque el mensaje de
 * PostgreSQL NO incluye el nombre de la restriccion: es
 * `Key (slug)=(...) already exists.`. Ademas esta traducido al idioma de la
 * sesion, asi que el codigo `23505` y el nombre de la columna son las dos cosas
 * que no cambian con el idioma.
 */
export function slugEnUso(error: unknown): boolean {
  // Un fallo de `$queryRaw` SIEMPRE llega como `P2010`, y el codigo de
  // PostgreSQL va en `meta.code`, no en `message`. Comprobando `message` (o
  // esperando un `PrismaClientUnknownRequestError`, que es lo primero que
  // parece) esto nunca detectaba el conflicto y el alta devolvia 500.
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2010') return false

  return error.meta?.code === '23505' && /\(slug\)/.test(String(error.meta?.message ?? ''))
}

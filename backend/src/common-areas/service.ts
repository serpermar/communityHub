// ---------------------------------------------------------------------------
// Servicio de zonas comunes.
//
// Aqui vive la logica de negocio. Los controllers solo reparten peticiones y
// los repositorios solo ejecutan SQL.
//
// La autorizacion esta en dos capas y las dos se necesitan, igual que en los
// bloques 03 y 04. `requireCommonArea()` comprueba el rol CONTRA ESTADO en las
// rutas sin comunidad en la URL, y las funciones de SQL comprueban lo mismo
// DENTRO de la transaccion, en el unico sitio donde el motor lo ve. Un
// invariante que solo vive en la capa HTTP no es un invariante: la misma
// llamada se puede hacer por PostgREST.
//
// Y ninguna regla se decide leyendo filas y comparando en TypeScript: la
// visibilidad de la zona, el rol de escritura y el nombre duplicado son cosas
// que tienen que pasar en la misma transaccion que la escritura.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import type { AvailabilityQueryInput, CreateCommonAreaInput, UpdateCommonAreaInput } from './validators.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'

/**
 * La zona tal como sale en la API (spec 05 7.1).
 *
 * Los horarios van como cadena `HH:MM`, la hora local de la comunidad: son hora
 * de pared, y un timestamp UTC los mostraria desplazados en verano. El formato
 * lo garantiza el `to_char` del repositorio.
 */
export type CommonAreaView = {
  id: string
  communityId: string
  name: string
  type: string
  description: string | null
  capacity: number | null
  slotMinutes: number
  openTime: string
  closeTime: string
  maxDailyReservations: number | null
  requiresApproval: boolean
  isActive: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** Un slot de la disponibilidad, tal como sale en la API. */
export type SlotView = {
  startsAt: string
  endsAt: string
  status: 'FREE' | 'OCCUPIED'
}

/**
 * La disponibilidad de un dia.
 *
 * La rejilla (`slotMinutes`, `openTime`, `closeTime`) viaja dentro de la misma
 * respuesta porque sin ella el cliente necesitaria una SEGUNDA peticion a la
 * zona para poder dibujar el calendario: los slots dicen "esta libre", no de
 * que a que horas abre la piscina.
 */
export type AvailabilityView = {
  date: string
  slotMinutes: number
  openTime: string
  closeTime: string
  slots: SlotView[]
}

function toCommonAreaView(row: repo.CommonAreaRow): CommonAreaView {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    type: row.type,
    description: row.description,
    capacity: row.capacity,
    slotMinutes: row.slot_minutes,
    openTime: row.open_time,
    closeTime: row.close_time,
    maxDailyReservations: row.max_daily_reservations,
    requiresApproval: row.requires_approval,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Listar las zonas de una comunidad.
 *
 * Cualquier miembro activo lee, sin filtro de rol (CA-1), y la funcion lo
 * comprueba dentro. Sin `where` de rol aqui: seria una segunda implementacion
 * de la regla, y ademas al reves —la API no escala zonas por rol, solo por
 * comunidad.
 *
 * `is_active: false` tambien sale en la lista, a proposito: el ADMIN necesita
 * ver las dadas de baja para reactivarlas, y al vecino no le hace daño saber
 * que la sala cerro. Quien decide que reservas admite una zona dada de baja es
 * la spec 06 (R-7), no este listado.
 */
export async function listCommonAreas(userId: string, communityId: string): Promise<CommonAreaView[]> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const rows = await repo.listCommonAreas(tx, communityId)
      return rows.map(toCommonAreaView)
    }),
  )
}

/**
 * La disponibilidad de un dia.
 *
 * El `requireCommonArea()` de la ruta ya ha puesto 404 si la zona no es
 * visible, y la funcion lo vuelve a comprobar: si entre el guard y esta
 * llamada la zona se diera de baja o desapareciera, aqui sale el 404 correcto
 * en vez de una rejilla construida sobre nada.
 *
 * El resultado se pide SIEMPRE a `app_get_area_availability()`, que es quien
 * sabe la timezone de la comunidad y quien sabe que `area_slots` es la unica
 * verdad de ocupacion (CA-7, D-2). Recalcularlo aqui seria una segunda verdad.
 */
export async function getAvailability(
  userId: string,
  communityId: string,
  areaId: string,
  query: AvailabilityQueryInput,
): Promise<AvailabilityView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const area = await repo.findCommonArea(tx, areaId)

      if (!area) {
        throw notFound('Esa zona común no existe.')
      }

      const slots = await repo.getAvailability(tx, areaId, query.date)

      return {
        date: query.date,
        slotMinutes: area.slot_minutes,
        openTime: area.open_time,
        closeTime: area.close_time,
        slots: slots.map((slot) => ({
          startsAt: slot.slot_start.toISOString(),
          endsAt: slot.slot_end.toISOString(),
          status: slot.status === 'OCCUPIED' ? 'OCCUPIED' : 'FREE',
        })),
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Crear una zona.
 *
 * El rol lo comprueba `requireCommunityRole('ADMIN')` en la ruta como chequeo
 * grueso, y `app_create_common_area()` lo repite dentro de la transaccion: si
 * el guard se olvidara, el endpoint seguiria siendo seguro. Aqui no se decide
 * nada de eso.
 *
 * Se relee la zona creada con `app_get_common_area()` y se devuelve esa, en vez
 * de inventar la respuesta: la funcion devuelve solo el id justamente para no
 * poder devolver medio estado.
 */
export async function createCommonArea(
  userId: string,
  communityId: string,
  input: CreateCommonAreaInput,
): Promise<CommonAreaView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createCommonArea(tx, communityId, input)

      const row = await repo.findCommonArea(tx, id)

      if (!row) {
        // La funcion es SECURITY DEFINER y acaba de insertar la fila; si no se
        // ve, algo se ha roto por debajo. Un 404 seria mentira: si que existe.
        throw new Error('La zona se creó pero no se puede leer.')
      }

      return toCommonAreaView(row)
    }),
  )
}

/**
 * Reconfigurar una zona (PUT, reemplazo completo).
 *
 * El `requireCommonArea()` de la ruta ya ha puesto 404 si la zona no es
 * visible, y la funcion lo vuelve a comprobar dentro de la transaccion.
 *
 * El unico permiso que decide algo aqui lo decide
 * `app_update_common_area()`: `app_is_admin_of()` contra la fila, dentro de la
 * transaccion. Un `req.community.role !== 'ADMIN'` en TypeScript seria una
 * segunda implementacion que se puede olvidar, y ademas no serviria para
 * PostgREST.
 *
 * CA-9 no vive aqui: ni este metodo ni la funcion tocan `area_slots`. Cambiar
 * `slotMinutes` con reservas futuras devuelve la zona nueva y deja los slots
 * existentes como estan.
 */
export async function updateCommonArea(
  userId: string,
  communityId: string,
  areaId: string,
  input: UpdateCommonAreaInput,
): Promise<CommonAreaView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.updateCommonArea(tx, areaId, input)

      const row = await repo.findCommonArea(tx, areaId)

      if (!row) {
        throw notFound('Esa zona común no existe.')
      }

      return toCommonAreaView(row)
    }),
  )
}

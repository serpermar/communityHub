// ---------------------------------------------------------------------------
// Validacion de entrada del dashboard (zod).
//
// El endpoint no tiene cuerpo, solo una query opcional: `from` y `to` recortan
// la ventana de las series (DSH-5). Nada mas se acepta (`.strict()`): un `?q=`
// o un `?communityId=` es un 400 explicito.
//
// La fecha es la MISMA `YYYY-MM-DD` estricta que en el resto de modulos
// (reservations/validators.ts, finance/validators.ts): `2026-2-5` es un 400, no
// una fecha que se arregla. El `.refine` del calendario evita el clasico
// `2026-02-31`, que la regex deja pasar y que `::date` rechazaria con 22P02.
//
// Dos reglas se comprueban con fechas de verdad y no por texto:
//   - `from <= to` (spec 13 §10.3);
//   - el rango no pasa de 24 meses (spec 13 §10.3). Se cuenta por meses de
//     calendario, no por dias: 2024-01-01..2026-01-01 son 24 meses exactos y sí
//     valen; 2024-01-01..2026-02-01 son 25 y no.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/**
 * Fecha con formato estricto `YYYY-MM-DD`, sin normalizar.
 *
 * Copiada de finanzas: el calendario se comprueba construyendo la fecha UTC y
 * verificando que sus componentes no han rodado (`2026-02-31` -> 3 de marzo).
 */
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD.')
  .refine((valor) => {
    const partes = valor.split('-')
    const anio = Number(partes[0])
    const mes = Number(partes[1])
    const dia = Number(partes[2])
    const d = new Date(Date.UTC(anio, mes - 1, dia))
    return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  }, 'Esa fecha no existe en el calendario.')

/** Meses de calendario entre dos fechas `YYYY-MM-DD` ya validadas. */
function mesesEntre(desde: string, hasta: string): number {
  const [anioDesde, mesDesde, diaDesde] = desde.split('-').map(Number) as [number, number, number]
  const [anioHasta, mesHasta, diaHasta] = hasta.split('-').map(Number) as [number, number, number]

  let meses = (anioHasta - anioDesde) * 12 + (mesHasta - mesDesde)
  if (diaHasta < diaDesde) meses -= 1
  return meses
}

/**
 * La query del dashboard: `?from=&to=`.
 *
 * `to` sin `from` (o al reves) es valido: el default de cada extremo lo pone la
 * funcion de SQL. Solo se compara cuando estan los dos.
 */
export const dashboardQuerySchema = z
  .object({
    from: fecha.optional(),
    to: fecha.optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (!datos.from || !datos.to) return

    if (Date.parse(datos.from) > Date.parse(datos.to)) {
      ctx.addIssue({
        code: 'custom',
        message: 'La fecha "to" no puede ser anterior a "from".',
        path: ['to'],
      })
      return
    }

    if (mesesEntre(datos.from, datos.to) > 24) {
      ctx.addIssue({
        code: 'custom',
        message: 'El rango no puede pasar de 24 meses.',
        path: ['to'],
      })
    }
  })

export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>

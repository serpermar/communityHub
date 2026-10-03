// ---------------------------------------------------------------------------
// Envelope de respuesta.
//
// Un solo formato para todo el backend, sin excepciones:
//
//   exito  ->  { data, meta? }
//   error  ->  { error: { code, message, details? } }
//
// La razon de que sea uno solo: el cliente escribe un unico interceptor de axios
// y un unico cliente de error. Con dos formatos por endpoint, cada pantalla
// acaba haciendo try/catch distintos y se cuelan los que no contemplan el caso.
//
// Nunca se devuelve `data: null` para un error, ni se devuelve el error dentro
// de un 200. Un 200 con `{ error }` obliga a comprobar el cuerpo en todas
// partes, que es como se cuelan errores que nadie muestra al usuario.
// ---------------------------------------------------------------------------

import type { Response } from 'express'
import type { ErrorBody } from './errors.js'

export type Meta = {
  page?: number
  limit?: number
  total?: number
  totalPages?: number
  [key: string]: unknown
}

export function ok(res: Response, data: unknown, meta?: Meta): void {
  res.status(200).json(meta ? { data, meta } : { data })
}

export function created(res: Response, data: unknown): void {
  res.status(201).json({ data })
}

export function noContent(res: Response): void {
  res.status(204).end()
}

export function fail(res: Response, status: number, body: ErrorBody): void {
  res.status(status).json(body)
}
// ---------------------------------------------------------------------------
// Middleware de errores.
//
// Va el ULTIMO en la cadena, siempre. Es el unico sitio donde se decide que se
// ve de un error hacia fuera, y esa decision importa:
//
//   AppError      -> su codigo y su mensaje, que son parte del contrato
//   ZodError      -> 400 con el detalle por campo
//   Prisma P2002  -> 409, "ese valor ya existe"
//   Prisma P2025  -> 404, "no existe" (y no un 500: no es un fallo del servidor)
//   desconocido    -> 500 con un mensaje generico
//
// El caso ultimo es el importante: un error no previsto puede llevar en su
// mensaje rutas, SQL o valores. Al cliente solo le llega un identificador opaco,
// y el detalle va al log del servidor. Nunca al reves.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { logger } from '../config/logger.js'
import { env } from '../config/env.js'
import { AppError } from './errors.js'

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No existe el endpoint ${req.method} ${req.path}.` },
  })
}

export function errorHandler(error: unknown, req: Request, res: Response, next: NextFunction): void {
  // Si la respuesta ya empezo a enviarse, delegar al handler por defecto de
  // Express: no se pueden reescribir cabeceras ya enviadas.
  if (res.headersSent) {
    next(error)
    return
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    })
    return
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Los datos enviados no son válidos.',
        details: error.issues.map((i) => ({ field: i.path.join('.') || '(raíz)', message: i.message })),
      },
    })
    return
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'Ese valor ya está en uso.' },
      })
      return
    }
    if (error.code === 'P2025') {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No encontrado.' },
      })
      return
    }
  }

  const reference = crypto.randomUUID()

  logger.error(
    {
      reference,
      method: req.method,
      path: req.path,
      err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    },
    'Error no controlado',
  )

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Error interno.',
      ...(env.isProduction ? {} : { reference }),
    },
  })
}
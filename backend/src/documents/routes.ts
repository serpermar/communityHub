// ---------------------------------------------------------------------------
// Rutas de documentos.
//
// En DOS routers por la misma razon que los bloques anteriores: las rutas de
// comunidad cuelgan de `/api/v1/communities` y las de documento de `/api/v1`.
// El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/documents   requireAuth + requireCommunity()
//   POST   /communities/:communityId/documents   + requireCommunityRole('ADMIN') + subida
//   GET    /documents/:id                        requireAuth
//   GET    /documents/:id/download               requireAuth
//   DELETE /documents/:id                        requireAuth
//
// Tres decisiones, ninguna nueva:
//
//   1. Las rutas por id NO llevan `requireCommunity()` (no hay `:communityId`
//      en la URL) ni un `requireDocument()` propio: la visibilidad la decide
//      la funcion de lectura dentro de la transaccion, y las funciones de
//      escritura comprueban el rol y la existencia (404/403) ellas solas.
//      `app_document_community()` no hace falta aqui: su unico llamante es
//      `app_delete_document()`, dentro de SQL.
//
//   2. El alta sí lleva `requireCommunityRole('ADMIN')` como chequeo grueso
//      (DN-1), colocado ANTES de la subida: un NEIGHBOR no hace pasar su
//      archivo por multer para luego recibir el 403. La funcion lo repite
//      dentro, como en el resto del proyecto.
//
//   3. El DELETE no lleva `requireCommunityRole('ADMIN')` ni siquiera como
//      chequeo grueso: el unico que lo dice es `app_delete_document()` con
//      `document_requires_admin`, porque es donde esta la fila y el rol real.
//
// Sobre la subida: multer en memoria con el limite del bucket. Los
// MulterError no son AppError y el error-middleware genérico los devolveria
// como 500; este wrapper los traduce a 400 antes (spec 08 §7.3: un archivo de
// más de 10 MB es `VALIDATION_ERROR`, no un fallo del servidor).
// ---------------------------------------------------------------------------

import { Router } from 'express'
import multer, { MulterError } from 'multer'
import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import * as controller from './controller.js'
import { MAX_FILE_BYTES } from './validators.js'

/** Multer en memoria: el buffer se valida (tamaño, mimetype) y se sube a Storage. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
})

function mensajeMulter(error: MulterError): string {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return 'El archivo no puede pasar de 10 MB.'
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE' && error.field !== 'file') {
    return 'El archivo debe viajar en el campo "file".'
  }

  return 'La subida del archivo ha fallado.'
}

/**
 * `upload.single('file')`, con los MulterError traducidos a 400.
 *
 * Multer invoca `next(error)` en vez de lanzar; aqui se intercepta PARA traducir
 * y PARA que el body correctamente parseado no quede a medias. Cualquier otro
 * error (una lectura de disco, un límite raro) pasa sin adornos al middleware
 * de errores, que decide.
 */
function subidaUnica(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }

    if (error instanceof MulterError) {
      next(badRequest(mensajeMulter(error)))
      return
    }

    next(error)
  })
}

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: leer documentos es de cualquier
 * miembro activo, y quien ve qué lo decide `app_list_documents()` (DN-6). El
 * alta sí, con el unico rol que lo permite (DN-1).
 */
export function createDocumentsRouter(): Router {
  const router = Router()

  router.get('/:communityId/documents', requireAuth, requireCommunity(), controller.listDocuments)

  router.post(
    '/:communityId/documents',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    subidaUnica,
    controller.createDocument,
  )

  return router
}

/** Rutas con el documento en la URL. Ninguna lleva guard de rol: decidir uno fuera de la transaccion seria duplicar la regla. */
export function createDocumentRouter(): Router {
  const router = Router()

  router.get('/documents/:id', requireAuth, controller.getDocument)
  router.get('/documents/:id/download', requireAuth, controller.downloadDocument)
  router.delete('/documents/:id', requireAuth, controller.deleteDocument)

  return router
}
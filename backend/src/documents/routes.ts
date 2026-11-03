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

  /**
   * @swagger
   * /api/v1/communities/{communityId}/documents:
   *   get:
   *     summary: Listar documentos de una comunidad
   *     description: |
   *       Devuelve solo los documentos visibles para el usuario autenticado
   *       según las políticas RLS de `documents` y `document_acl`. Un documento
   *       invisible devuelve 404, nunca 403 (no se filtra su existencia).
   *     tags: [Documents]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: category
   *         schema: { $ref: '#/components/schemas/DocumentCategory' }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de documentos visibles.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DocumentListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/:communityId/documents', requireAuth, requireCommunity(), controller.listDocuments)

  /**
   * @swagger
   * /api/v1/communities/{communityId}/documents:
   *   post:
   *     summary: Subir un documento
   *     description: |
   *       Sube un archivo al bucket de Supabase Storage y crea la fila en
   *       `documents`. Requiere rol ADMIN en la comunidad. El archivo viaja en
   *       el campo `file` (multipart/form-data) y no puede superar 10 MB.
   *     tags: [Documents]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file, title, category]
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: Archivo a subir (máx. 10 MB).
   *               title:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 200
   *               category: { $ref: '#/components/schemas/DocumentCategory' }
   *               minRole:
   *                 type: string
   *                 enum: [NEIGHBOR, PRESIDENT, ADMIN]
   *                 default: NEIGHBOR
   *               isPublic:
   *                 type: boolean
   *                 default: false
   *     responses:
   *       201:
   *         description: Documento creado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Document' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
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

  /**
   * @swagger
   * /api/v1/documents/{id}:
   *   get:
   *     summary: Detalle de un documento
   *     tags: [Documents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Documento.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Document' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/documents/:id', requireAuth, controller.getDocument)

  /**
   * @swagger
   * /api/v1/documents/{id}/download:
   *   get:
   *     summary: Obtener signed URL de descarga
   *     description: |
   *       Devuelve una URL firmada de Supabase Storage, válida durante
   *       `DOCUMENTS_SIGNED_URL_EXPIRES_IN` segundos (300 por defecto).
   *       El backend no sirve el archivo: solo genera la URL.
   *     tags: [Documents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: URL firmada.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DocumentDownloadResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/documents/:id/download', requireAuth, controller.downloadDocument)

  /**
   * @swagger
   * /api/v1/documents/{id}:
   *   delete:
   *     summary: Eliminar un documento
   *     description: |
   *       Requiere rol ADMIN en la comunidad del documento. La comprobación la
   *       hace `app_delete_document()` dentro de la transacción (no un guard de
   *       ruta): el rol real y la comunidad del documento se leen de la fila.
   *     tags: [Documents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Documento eliminado (fila y objeto en Storage).
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.delete('/documents/:id', requireAuth, controller.deleteDocument)

  return router
}

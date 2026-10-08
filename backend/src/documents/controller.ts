// ---------------------------------------------------------------------------
// Controller de documentos.
//
// Reparte HTTP y valida la FORMA de lo que llega; no decide negocio. Toda la
// autorizacion esta en las funciones de SQL (02i), con el chequeo grueso de
// ADMIN para el alta en la ruta.
//
// Dos detalles propios del bloque:
//
//   - El alta es multipart: el cuerpo son cadenas y el archivo viaja aparte en
//     `req.file` (multer). Aqui se comprueban los DOS limites que el bucket
//     tiene copiados —mimetype de la lista de 03_storage.sql y 10 MB— porque
//     DN-13 pide que el backend rechace antes que el provedor, con un 400 del
//     contrato y no un error de Storage.
//   - El 201 lleva `Location: /api/v1/documents/{id}` (spec 08 §7.3), y
//     `created()` no lo pone: se llama a `res.location()` antes. A diferencia
//     de avisos (que no exponen GET por id), aqui el Location es una URL
//     real.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import { createDocumentSchema, listQuerySchema, MAX_FILE_BYTES, MAX_FILE_MESSAGE, mimePermitido, uuidSchema } from './validators.js'
import { routeParam } from '../auth/middleware.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/** Un UUID de ruta, o un 400 que lo diga (C-9). */
function uuidParam(req: Request, name: string): string {
  return parse(uuidSchema, routeParam(req, name))
}

/** Para las rutas con comunidad en la URL: `req.community` ya lo puso el middleware. */
function comunidadDeRuta(req: Request): { userId: string; communityId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  if (!req.community) {
    throw badRequest('Petición sin contexto de comunidad.')
  }

  return { userId: req.auth.userId, communityId: req.community.communityId }
}

/** Para las rutas con el documento en la URL: solo hace falta quién pide. */
function actor(req: Request): string {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  return req.auth.userId
}

// ---------------------------------------------------------------------------
// Rutas con :communityId en la URL
// ---------------------------------------------------------------------------

/**
 * `GET /communities/:communityId/documents?category=&q=&page=&limit=`
 *
 * El rol no se mira aqui: leer documentos es de cualquier miembro activo, y
 * quien ve qué lo decide `app_list_documents()` (DN-6). Los filtros van por
 * query param, como en el resto de la API.
 */
export async function listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const query = parse(listQuerySchema, req.query)

    const resultado = await service.listDocuments(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/documents` (multipart, solo ADMIN).
 *
 * El rol ADMIN lo pone `requireCommunityRole('ADMIN')` en la ruta (chequeo
 * grueso: un NEIGHBOR recibe el 403 sin ni siquiera subir el archivo) y lo
 * repite `app_create_document()` dentro de la transaccion.
 *
 * Los campos de metadato van como campos de formulario (`title`,
 * `description`, `category`, ...); el archivo, en el campo `file`. Los limites
 * de mimetype y tamaño se comprueban aqui antes de tocar el servicio (DN-13).
 *
 * El 201 lleva `Location` con el documento recien creado, porque la API si
 * expone `GET /documents/:id`.
 */
export async function createDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const input = parse(createDocumentSchema, req.body)
    const file = req.file

    if (!file) {
      throw badRequest('El archivo es obligatorio.')
    }

    if (file.size > MAX_FILE_BYTES) {
      throw badRequest(MAX_FILE_MESSAGE)
    }

    if (!mimePermitido(file.mimetype)) {
      throw badRequest(
        'El tipo del archivo no está permitido. Se admiten PDF, JPEG, PNG, WEBP, Word, Excel, texto plano y CSV.',
      )
    }

    const documento = await service.createDocument(userId, communityId, input, {
      buffer: file.buffer,
      mimetype: file.mimetype,
    })

    res.location(`/api/v1/documents/${documento.id}`)
    created(res, documento)
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas con :id de documento
// ---------------------------------------------------------------------------

/**
 * `GET /documents/:id`.
 *
 * Sin comunidad en la URL: el predicado de la funcion de lectura decide la
 * visibilidad. No hay `requireDocument()` de por medio — la funcion ya
 * devuelve NULL para los cuatro casos (no existe / otra comunidad / borrado /
 * rol sin umbral), y aqui se traduce a un 404 unico (C-8).
 */
export async function getDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const documentId = uuidParam(req, 'id')

    ok(res, await service.getDocument(userId, documentId))
  } catch (error) {
    next(error)
  }
}

/**
 * `GET /documents/:id/download` -> `{ url, expiresIn }` (DN-10).
 *
 * La URL la firma el gateway, y su validez viene de
 * `DOCUMENTS_SIGNED_URL_EXPIRES_IN`. El flujo 404/403 de los dos pasos (spec
 * §5.5) esta en el servicio: aqui solo se pide.
 */
export async function downloadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const documentId = uuidParam(req, 'id')

    ok(res, await service.downloadDocument(userId, documentId))
  } catch (error) {
    next(error)
  }
}

/**
 * `DELETE /documents/:id`.
 *
 * 200 con `{ id, deleted: true }`, como en avisos (spec 08 §7.3). El rol
 * (solo ADMIN, DN-1) lo decide `app_delete_document()` con
 * `document_requires_admin`; aqui no hay `requireCommunityRole` — el segundo
 * borrado es 404, no 200 idempotente.
 */
export async function deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const documentId = uuidParam(req, 'id')

    await service.deleteDocument(userId, documentId)

    ok(res, { id: documentId, deleted: true })
  } catch (error) {
    next(error)
  }
}
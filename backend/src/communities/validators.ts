// ---------------------------------------------------------------------------
// Validacion de entrada de comunidades (zod).
// ---------------------------------------------------------------------------

import { z } from 'zod'

const slug = z
  .string()
  .trim()
  .min(1, 'El slug es obligatorio.')
  .max(60, 'El slug es demasiado largo.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'El slug solo admite minúsculas, números y guiones, sin guiones al principio ni al final.',
  )

const latitude = z.coerce
  .number({ error: 'La latitud debe ser un número.' })
  .min(-90, 'La latitud va de -90 a 90.')
  .max(90, 'La latitud va de -90 a 90.')

const longitude = z.coerce
  .number({ error: 'La longitud debe ser un número.' })
  .min(-180, 'La longitud va de -180 a 180.')
  .max(180, 'La longitud va de -180 a 180.')

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} es demasiado largo.`)
    .nullish()
    .transform((value) => (value ? value : null))

const textoEditable = (max: number, label: string) =>
  z.string().trim().max(max, `${label} es demasiado largo.`).nullish()

export const createCommunitySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio.')
      .max(120, 'El nombre es demasiado largo.'),
    slug,
    addressLine1: z
      .string()
      .trim()
      .min(1, 'La dirección es obligatoria.')
      .max(200, 'La dirección es demasiado larga.'),
    city: z.string().trim().min(1, 'La ciudad es obligatoria.').max(80),
    country: z
      .string()
      .trim()
      .length(2, 'El país se escribe con dos letras, como ES.')
      .toUpperCase()
      .default('ES'),
    description: optionalText(2000, 'La descripción'),
    province: optionalText(80, 'La provincia'),
    postalCode: optionalText(20, 'El código postal'),
    registrationNumber: optionalText(64, 'El número de registro'),
    timezone: z.string().trim().min(1).max(64).default('Europe/Madrid'),
    latitude: latitude.nullish().transform((v) => v ?? null),
    longitude: longitude.nullish().transform((v) => v ?? null),
  })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: 'La latitud y la longitud van juntas: si envías una, envía la otra.',
    path: ['latitude'],
  })

export const updateCommunitySchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(120).optional(),
    slug: slug.optional(), // <-- AHORA ES EDITABLE
    description: textoEditable(2000, 'La descripción'),
    addressLine1: z.string().trim().min(1, 'La dirección es obligatoria.').max(200).optional(),
    city: z.string().trim().min(1, 'La ciudad es obligatoria.').max(80).optional(),
    country: z
      .string()
      .trim()
      .length(2, 'El país se escribe con dos letras, como ES.')
      .toUpperCase()
      .optional(),
    province: textoEditable(80, 'La provincia'),
    postalCode: textoEditable(20, 'El código postal'),
    registrationNumber: textoEditable(64, 'El número de registro'),
    timezone: z.string().trim().min(1).max(64).optional(),
    isActive: z.boolean().optional(),
    latitude: latitude.nullish(),
    longitude: longitude.nullish(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'No hay nada que actualizar.',
    path: [],
  })
  .refine(
    (v) => {
      if (v.latitude === undefined && v.longitude === undefined) return true
      return (v.latitude == null) === (v.longitude == null)
    },
    {
      message: 'La latitud y la longitud van juntas: si envías una, envía la otra.',
      path: ['latitude'],
    },
  )

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>
export type UpdateCommunityInput = z.infer<typeof updateCommunitySchema>

// ---------------------------------------------------------------------------
// Validacion de entrada de comunidades (zod).
//
// Sigue las mismas reglas que `auth/validators.ts`: validacion en el borde,
// `.strict()` en todos los esquemas y mensajes en castellano. Lo que se anade
// aqui son las tres reglas propias de este recurso: el formato del slug, el
// emparejamiento de las coordenadas y la inmutabilidad del slug.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/**
 * Slug: minusculas, digitos y guiones.
 *
 * El nombre de una comunidad acaba en la URL, asi que no puede llevar espacios,
 * tildes ni mayusculas. Se rechazan en lugar de arreglarse solos porque "se
 * arregla" necesita una regla para decidir cual era el slug correcto, y esa
 * regla no existe: dos personas que escriban "Barrio Alto" y "barrio  alto"
 * esperando el mismo slug se llevarian un 400 y aprenderian por que.
 *
 * El limite de 60 caracteres no es arbitrario: es lo que cabe en una etiqueta
 * DNS y en un `slug` de sobra, y deja sitio para el sufijo de unicidad.
 */
const slug = z
  .string()
  .trim()
  .min(1, 'El slug es obligatorio.')
  .max(60, 'El slug es demasiado largo.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'El slug solo admite minúsculas, números y guiones, sin guiones al principio ni al final.',
  )

/**
 * Latitud.
 *
 * El rango no es "el que tiene el mundo" (-90 a 90) sino el que vale para una
 * comunidad habitada. Se acepta el rango completo porque el 400 con el valor
 * concreto es informacion mas util que un recorte silencioso: quien lo mando
 * quiere decir donde esta, y si no esta donde cree, hay que que le entere.
 */
const latitude = z.coerce
  .number({ error: 'La latitud debe ser un número.' })
  .min(-90, 'La latitud va de -90 a 90.')
  .max(90, 'La latitud va de -90 a 90.')

const longitude = z.coerce
  .number({ error: 'La longitud debe ser un número.' })
  .min(-180, 'La longitud va de -180 a 180.')
  .max(180, 'La longitud va de -180 a 180.')

/** Un texto opcional que se guarda como NULL si viene vacío. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} es demasiado largo.`)
    .nullish()
    .transform((value) => (value ? value : null))

/**
 * Igual que `optionalText` pero SIN `.transform()`, y solo para el PATCH.
 *
 * No es una preferencia de estilo sino un fallo de datos. En zod 4, un campo con
 * `.transform()` se ejecuta y aparece en la salida aunque no venga en el
 * cuerpo: `PATCH { name: 'Nuevo' }` devolvia ademas
 * `{ description: null, province: null, postalCode: null, registrationNumber: null }`.
 * El servicio escribe lo que viene, asi que un simple renombrado habria borrado la
 * descripcion y el codigo postal de la comunidad.
 *
 * Sin transform, una clave ausente simplemente no existe en el objeto, que es lo
 * que hace posible distinguir "no lo has enviado" de "lo has vaciado". Convertir
 * la cadena vacia en NULL lo hace despues el servicio.
 */
const textoEditable = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} es demasiado largo.`)
    .nullish()

export const createCommunitySchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(120, 'El nombre es demasiado largo.'),
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
  // El emparejamiento se comprueba aqui y no dentro de un objeto anidado de
  // coordenadas porque no hay objeto anidado: van planas, junto al resto. Con un
  // `.refine` dentro de un esquema opcional, si el campo no viene no se ejecuta
  // nada, que es justo el caso que hay que vigilar.
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: 'La latitud y la longitud van juntas: si envías una, envía la otra.',
    path: ['latitude'],
  })

/**
 * PATCH parcial.
 *
 * `.strict()` y sin `slug`: el slug se elige al crear y no se cambia. Admitirlo
 * aqui romperia los enlaces ya compartidos de la comunidad sin avisar, que es
 * justo lo que un identificador visible tiene que evitar. Se rechaza con un
 * mensaje que lo diga, no con un "clave desconocida" generico, porque quien lo
 * manda lo ha escrito a proposito y merece saber que la regla es deliberada
 * (C-6).
 *
 * Se exige al menos un campo. Un PATCH vacio no es un error de validacion de los
 * campos: es una peticion que no queria hacer nada, y responder 204 lo haria
 * silenciosamente.
 */
export const updateCommunitySchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es obligatorio.').max(120).optional(),
    description: textoEditable(2000, 'La descripción'),
    addressLine1: z.string().trim().min(1, 'La dirección es obligatoria.').max(200).optional(),
    city: z.string().trim().min(1, 'La ciudad es obligatoria.').max(80).optional(),
    country: z.string().trim().length(2, 'El país se escribe con dos letras, como ES.').toUpperCase().optional(),
    province: textoEditable(80, 'La provincia'),
    postalCode: textoEditable(20, 'El código postal'),
    registrationNumber: textoEditable(64, 'El número de registro'),
    timezone: z.string().trim().min(1).max(64).optional(),
    isActive: z.boolean().optional(),
    latitude: latitude.nullish(),
    longitude: longitude.nullish(),
    // `z.never().optional()` y no `z.never()` a secas: `never` tampoco acepta
    // `undefined`, asi que solo rechazaria el PATCH cuando `slug` viene y siempre
    // dejaria pasar los que no lo traen, que son todos los legitimos.
    // `.optional()` hace que la clave pueda faltar, y que si aparece sea error.
    slug: z.never({ error: 'El slug no se puede cambiar una vez creada la comunidad.' }).optional(),
  })
  .strict()
  // Se comprueba ANTES de cualquier transformacion, con las claves tal como las
  // mandaron. Si el esquema rellenara los opcionales, este refine no veria nunca
  // un objeto vacio y un `PATCH {}` {} pasaria.
  .refine((v) => Object.keys(v).length > 0, {
    message: 'No hay nada que actualizar.',
    path: [],
  })
  .refine((v) => {
    // Solo se exige el emparejamiento si el PATCH toca alguna de las dos. Poner
    // `latitude: null` sin decir nada de `longitude` es una peticion valida: se
    // esta diciendo "ya no la localizamos".
    if (v.latitude === undefined && v.longitude === undefined) return true
    return (v.latitude == null) === (v.longitude == null)
  }, {
    message: 'La latitud y la longitud van juntas: si envías una, envía la otra.',
    path: ['latitude'],
  })

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>
export type UpdateCommunityInput = z.infer<typeof updateCommunitySchema>

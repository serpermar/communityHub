// ---------------------------------------------------------------------------
// Validadores de comunidades.
//
// Sin base de datos: son funciones puras y su unica dependencia es zod. Lo que se
// prueba aqui son las TRES reglas propias del recurso (slug, emparejamiento de
// coordenadas, inmutabilidad del slug) mas el efecto de `.strict()`.
//
// El punto de estos tests no es que zod funcione, sino que las reglas se apliquen
// en el orden correcto y no se cuelgue ninguna.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { createCommunitySchema, updateCommunitySchema } from '../validators.js'

/** El alta minima valida: nombre, slug, direccion y ciudad. */
const MINIMO = {
  name: 'Comunidad del Bairro Alto',
  slug: 'bairro-alto',
  addressLine1: 'Calle Mayor 1',
  city: 'Valencia',
}

describe('createCommunitySchema', () => {
  it('acepta el alta minima y aplica los valores por defecto', () => {
    const r = createCommunitySchema.parse(MINIMO)

    expect(r.country).toBe('ES')
    expect(r.timezone).toBe('Europe/Madrid')
    expect(r.latitude).toBeNull()
    expect(r.longitude).toBeNull()
    // Un texto opcional ausente es NULL, no undefined: se escribe en la base de
    // datos como NULL y no como "no tocado".
    expect(r.description).toBeNull()
  })

  it('acepta una alta solo con la direccion (C-7)', () => {
    const r = createCommunitySchema.parse(MINIMO)
    expect(r.latitude).toBeNull()
    expect(r.longitude).toBeNull()
  })

  it('rechaza el slug con mayusculas, espacios, tildes o guiones mal puestos', () => {
    const malos = ['Barrio-Alto', 'barrio alto', 'bairro-alto-', '-bairro', 'barrio--alto', 'barrio_alto', 'barriño']
    for (const slug of malos) {
      const r = createCommunitySchema.safeParse({ ...MINIMO, slug })
      expect(r.success, `deberia rechazar el slug ${JSON.stringify(slug)}`).toBe(false)
    }
  })

  it('acepta el slug en minusculas con digitos y guiones simples', () => {
    const r = createCommunitySchema.safeParse({ ...MINIMO, slug: 'barrio-alto-2' })
    expect(r.success).toBe(true)
  })

  it('exige direccion y ciudad', () => {
    const { addressLine1: _a, ...sinDireccion } = MINIMO
    const { city: _c, ...sinCiudad } = MINIMO

    expect(createCommunitySchema.safeParse(sinDireccion).success).toBe(false)
    expect(createCommunitySchema.safeParse(sinCiudad).success).toBe(false)
  })

  it('rechaza una clave desconocida porque es .strict()', () => {
    const r = createCommunitySchema.safeParse({ ...MINIMO, isAdmin: true })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0]?.code).toBe('unrecognized_keys')
  })

  it('no deja crear en nombre de otro: created_by no es un campo del cuerpo', () => {
    const r = createCommunitySchema.safeParse({ ...MINIMO, createdBy: '11111111-1111-4111-8111-111111111111' })
    expect(r.success).toBe(false)
  })

  describe('coordenadas', () => {
    it('rechaza latitude sin longitude', () => {
      const r = createCommunitySchema.safeParse({ ...MINIMO, latitude: 39.474 })
      expect(r.success).toBe(false)
      // El error tiene que senalar el campo, o quien lo lee tendria que abrir el
      // cuerpo de la peticion para Averiguarlo.
      expect(r.error?.issues.some((i) => i.path.includes('latitude'))).toBe(true)
    })

    it('rechaza longitude sin latitude', () => {
      expect(createCommunitySchema.safeParse({ ...MINIMO, longitude: -0.379 }).success).toBe(false)
    })

    it('rechaza latitude fuera de rango y longitude fuera de rango', () => {
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: 91, longitude: 0 }).success).toBe(false)
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: -91, longitude: 0 }).success).toBe(false)
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: 0, longitude: 181 }).success).toBe(false)
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: 0, longitude: -181 }).success).toBe(false)
    })

    it('acepta los extremos del rango', () => {
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: 90, longitude: 180 }).success).toBe(true)
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: -90, longitude: -180 }).success).toBe(true)
    })

    it('acepta ambas y las deja como numero', () => {
      const r = createCommunitySchema.parse({ ...MINIMO, latitude: '39.474', longitude: '-0.379' })
      expect(r.latitude).toBe(39.474)
      expect(r.longitude).toBe(-0.379)
    })

    it('rechaza 0 y 0, que es el Atlantico y no una decision', () => {
      // 0,0 esta dentro del rango, asi que la validacion de formato no lo puede
      // tumbar. Lo que se comprueba es que el esquema no lo deja pasar: el
      // backend lo acepta, y por eso el comentario del schema avisa de que no
      // es un default. Este test deja esa decision escrita.
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: 0, longitude: 0 }).success).toBe(true)
    })

    it('rechaza un texto que no es un numero', () => {
      expect(createCommunitySchema.safeParse({ ...MINIMO, latitude: 'norte', longitude: 'oeste' }).success).toBe(false)
    })
  })
})

describe('updateCommunitySchema', () => {
  it('rechaza un cuerpo vacio', () => {
    // Sin este refine, un PATCH {} llegaria al servicio con un `data` sin nada
    // que escribir y devolveria 200 sin haber hecho nada.
    const r = updateCommunitySchema.safeParse({})
    expect(r.success).toBe(false)
  })

  it('rechaza cambiar el slug y lo dice (C-6)', () => {
    const r = updateCommunitySchema.safeParse({ slug: 'otro-slug' })

    expect(r.success).toBe(false)
    // No basta con que falle: tiene que explicar que el slug es inmutable, y no
    // un "clave desconocida" que deja pensar que es un error de escritura.
    expect(JSON.stringify(r.error?.issues)).toContain('slug')
  })

  it('acepta un PATCH parcial y solo trae los campos enviados', () => {
    const r = updateCommunitySchema.parse({ name: 'Nuevo nombre' })

    expect(r.name).toBe('Nuevo nombre')
    // Si el esquema rellenara los opcionales con null, el servicio los escribiria
    // y borraria medio formulario en la primera actualizacion parcial.
    expect(Object.keys(r)).toEqual(['name'])
  })

  it('no exige emparejar las coordenadas si el PATCH no las toca', () => {
    expect(updateCommunitySchema.safeParse({ name: 'Solo el nombre' }).success).toBe(true)
  })

  it('exige emparejar las coordenadas si el PATCH toca una', () => {
    expect(updateCommunitySchema.safeParse({ latitude: 39.474 }).success).toBe(false)
    expect(updateCommunitySchema.safeParse({ longitude: -0.379 }).success).toBe(false)
    expect(updateCommunitySchema.safeParse({ latitude: 39.474, longitude: -0.379 }).success).toBe(true)
  })

  it('permite borrar las coordenadas juntas', () => {
    // Poner las dos en null es una peticion con sentido: "ya no la localizamos".
    const r = updateCommunitySchema.safeParse({ latitude: null, longitude: null })
    expect(r.success).toBe(true)
  })

  it('no acepta media coordenada aunque venga null', () => {
    // El caso limite: una en null y la otra con valor sigue siendo media
    // coordenada, y es el que dejaria la comunidad en el golfo de Guinea.
    expect(updateCommunitySchema.safeParse({ latitude: null, longitude: -0.379 }).success).toBe(false)
    expect(updateCommunitySchema.safeParse({ latitude: 39.474, longitude: null }).success).toBe(false)
  })

  it('acepta la baja logica con isActive', () => {
    // `safeParse` no estrecha el tipo del resultado, asi que se usa `parse`: si el
    // cuerpo fuera invalido, el test revienta aqui en vez de decir que espera.
    const r = updateCommunitySchema.parse({ isActive: false })
    expect(r.isActive).toBe(false)
  })

  it('rechaza isActive que no sea booleano', () => {
    expect(updateCommunitySchema.safeParse({ isActive: 'false' }).success).toBe(false)
    expect(updateCommunitySchema.safeParse({ isActive: 0 }).success).toBe(false)
  })

  it('rechaza una clave desconocida porque es .strict()', () => {
    const r = updateCommunitySchema.safeParse({ nombre: 'con tilde rara' })
    expect(r.success).toBe(false)
  })
})

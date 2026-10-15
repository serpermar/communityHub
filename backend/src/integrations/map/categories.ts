// ---------------------------------------------------------------------------
// Clasificacion de POIs por `osm_key`/`osm_value` (EXT-12, §5.4).
//
// Photon devuelve features de OpenStreetMap con `properties.osm_key` y
// `properties.osm_value` (por ejemplo `shop`/`hardware`, `amenity`/`pharmacy`).
// Este archivo los traduce a una de las DOS listas del bloque:
//
//   - PROVIDER ("proveedores cercanos"): oficios y tiendas de reparacion. Es lo
//     que un vecino busca cuando se le rompe algo.
//   - POI ("puntos de interes"): todo lo demas que da vida al barrio.
//
// Se resuelve en dos pasadas: primero `key+value` exacto y, si no hay, una regla
// por `key` sola. La segunda pasada es lo que evita que un `leisure=cine` sin
// regla propia desaparezca: cae en "Ocio" y sigue siendo un POI util. Sin match
// de ninguna de las dos -> `OTRO`, que va a la lista de POIs (nunca a
// proveedores: inventar un proveedor es peor que reconocer que no se sabe que
// es).
//
// La `category` es ya la etiqueta en castellano (§5.1). El `kind` es lo que
// necesita el service para partir la respuesta en `providers`/`pois`; se
// recalcula al leer de cache en vez de guardarse, para que un cambio de
// clasificacion no obligue a invalidar la tabla.
// ---------------------------------------------------------------------------

export type PlaceKind = 'provider' | 'poi'

export type Classification = {
  category: string
  kind: PlaceKind
}

type Rule = {
  key: string
  value?: string
  category: string
  kind: PlaceKind
}

const PROVIDER = 'provider' as const
const POI = 'poi' as const

/** Reglas por `osm_key` + `osm_value`. Se comprueban antes que las de `key` sola. */
const VALUE_RULES: readonly Rule[] = [
  // --- Proveedores: oficios y reparacion --------------------------------------
  { key: 'craft', value: 'plumber', category: 'Fontanería', kind: PROVIDER },
  { key: 'craft', value: 'electrician', category: 'Electricidad', kind: PROVIDER },
  { key: 'craft', value: 'carpenter', category: 'Carpintería', kind: PROVIDER },
  { key: 'craft', value: 'locksmith', category: 'Cerrajería', kind: PROVIDER },
  { key: 'craft', value: 'painter', category: 'Pintura', kind: PROVIDER },
  { key: 'craft', value: 'gardener', category: 'Jardinería', kind: PROVIDER },
  { key: 'shop', value: 'hardware', category: 'Ferretería', kind: PROVIDER },
  { key: 'shop', value: 'doityourself', category: 'Bricolaje', kind: PROVIDER },
  { key: 'shop', value: 'trade', category: 'Suministros', kind: PROVIDER },
  { key: 'shop', value: 'car_repair', category: 'Taller mecánico', kind: PROVIDER },
  { key: 'shop', value: 'laundry', category: 'Lavandería', kind: PROVIDER },
  { key: 'shop', value: 'dry_cleaning', category: 'Tintorería', kind: PROVIDER },
  { key: 'amenity', value: 'pharmacy', category: 'Farmacia', kind: PROVIDER },
  { key: 'shop', value: 'chemist', category: 'Farmacia', kind: PROVIDER },
  { key: 'amenity', value: 'veterinary', category: 'Veterinaria', kind: PROVIDER },

  // --- POIs: parques y ocio ---------------------------------------------------
  { key: 'leisure', value: 'park', category: 'Parque', kind: POI },
  { key: 'leisure', value: 'playground', category: 'Parque infantil', kind: POI },
  { key: 'leisure', value: 'garden', category: 'Jardín', kind: POI },
  { key: 'leisure', value: 'sports_centre', category: 'Deporte', kind: POI },
  { key: 'leisure', value: 'fitness_centre', category: 'Gimnasio', kind: POI },
  { key: 'leisure', value: 'pitch', category: 'Deporte', kind: POI },

  // --- POIs: educacion --------------------------------------------------------
  { key: 'amenity', value: 'school', category: 'Educación', kind: POI },
  { key: 'amenity', value: 'kindergarten', category: 'Educación infantil', kind: POI },
  { key: 'amenity', value: 'college', category: 'Educación', kind: POI },
  { key: 'amenity', value: 'university', category: 'Universidad', kind: POI },

  // --- POIs: salud ------------------------------------------------------------
  { key: 'amenity', value: 'hospital', category: 'Salud', kind: POI },
  { key: 'amenity', value: 'clinic', category: 'Salud', kind: POI },
  { key: 'amenity', value: 'doctors', category: 'Salud', kind: POI },
  { key: 'amenity', value: 'dentist', category: 'Salud', kind: POI },

  // --- POIs: hostelería -------------------------------------------------------
  { key: 'amenity', value: 'restaurant', category: 'Restauración', kind: POI },
  { key: 'amenity', value: 'cafe', category: 'Cafetería', kind: POI },
  { key: 'amenity', value: 'bar', category: 'Bar', kind: POI },
  { key: 'amenity', value: 'pub', category: 'Bar', kind: POI },
  { key: 'amenity', value: 'fast_food', category: 'Comida rápida', kind: POI },

  // --- POIs: comercio y servicios --------------------------------------------
  { key: 'shop', value: 'supermarket', category: 'Supermercado', kind: POI },
  { key: 'shop', value: 'convenience', category: 'Tienda', kind: POI },
  { key: 'shop', value: 'bakery', category: 'Panadería', kind: POI },
  { key: 'shop', value: 'greengrocer', category: 'Frutería', kind: POI },
  { key: 'shop', value: 'butcher', category: 'Carnicería', kind: POI },
  { key: 'shop', value: 'clothes', category: 'Ropa', kind: POI },
  { key: 'amenity', value: 'bank', category: 'Banco', kind: POI },
  { key: 'amenity', value: 'atm', category: 'Cajero', kind: POI },
  { key: 'amenity', value: 'post_office', category: 'Correos', kind: POI },
  { key: 'amenity', value: 'place_of_worship', category: 'Religioso', kind: POI },
  { key: 'amenity', value: 'parking', category: 'Aparcamiento', kind: POI },
  { key: 'amenity', value: 'fuel', category: 'Gasolinera', kind: POI },

  // --- POIs: transporte -------------------------------------------------------
  { key: 'highway', value: 'bus_stop', category: 'Transporte', kind: POI },
  { key: 'railway', value: 'station', category: 'Transporte', kind: POI },
  { key: 'railway', value: 'halt', category: 'Transporte', kind: POI },
  { key: 'railway', value: 'tram_stop', category: 'Transporte', kind: POI },
]

/** Reglas de respaldo por `osm_key` sola, para lo que no tiene regla exacta. */
const KEY_RULES: readonly Rule[] = [
  { key: 'highway', category: 'Transporte', kind: POI },
  { key: 'railway', category: 'Transporte', kind: POI },
  { key: 'public_transport', category: 'Transporte', kind: POI },
  { key: 'leisure', category: 'Ocio', kind: POI },
  { key: 'tourism', category: 'Turismo', kind: POI },
  { key: 'amenity', category: 'Servicios', kind: POI },
  { key: 'shop', category: 'Comercio', kind: POI },
  { key: 'office', category: 'Oficinas', kind: POI },
  { key: 'healthcare', category: 'Salud', kind: POI },
]

export const OTHER: Classification = { category: 'Otro', kind: POI }

export function classify(osmKey: string, osmValue: string): Classification {
  const key = osmKey.trim().toLowerCase()
  const value = osmValue.trim().toLowerCase()

  if (!key) return OTHER

  const exact = VALUE_RULES.find((rule) => rule.key === key && rule.value === value)
  if (exact) return { category: exact.category, kind: exact.kind }

  const byKey = KEY_RULES.find((rule) => rule.key === key)
  if (byKey) return { category: byKey.category, kind: byKey.kind }

  return OTHER
}

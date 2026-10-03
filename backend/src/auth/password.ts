// ---------------------------------------------------------------------------
// Contrasenas: argon2id.
//
// argon2id es la decision A-2 de la spec 01. Se descarta bcrypt porque se
// puede atacar con GPU mucho mas rapido de lo que se puede atacar argon2, y se
// descartan SHA-256 y MD5 porque son rapidos por diseño: un hash de contrasena
// tiene que ser LENTO a proposito, y por eso argon2 permite elegir cuanta
// memoria y cuanto tiempo cuesta verificarlos.
//
// Los parametros salen del entorno (spec 01, seccion 8) para poder subirlos en
// hardware mas lento sin tocar codigo. Los valores por defecto son los que
// recomienda OWASP: 64 MiB, 3 iteraciones, 4 hilos.
// ---------------------------------------------------------------------------

import argon2 from 'argon2'
import { env } from '../config/env.js'

const options = {
  type: argon2.argon2id,
  memoryCost: env.ARGON2_MEMORY_COST,
  timeCost: env.ARGON2_TIME_COST,
  parallelism: env.ARGON2_PARALLELISM,
} as const

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    // Sin pasar parametros: argon2 los lee del propio hash. En verify no tiene
    // sentido fijarlos, y pasarlos seria sogar algo que el hash ya declara.
    return await argon2.verify(hash, password)
  } catch {
    // Un hash corrupto o de otro algoritmo no es un error de servidor: es una
    // credencial que no verifica. Se traduce en "no coincide" para no abrir un
    // canal lateral con el codigo de respuesta.
    return false
  }
}

// ---------------------------------------------------------------------------
// Hash senuelo: el detalle que cierra la enumeracion de cuentas.
//
// El login devuelve el mismo error tanto si el email no existe como si la
// contrasena es incorrecta. Pero el mensaje no es lo unico que delata si una
// cuenta existe: tambien lo hace el tiempo. Un login con email inexistente
// tarda 2 ms porque no hay nada que verificar, y uno con contrasena incorrecta
// tarda 80 ms porque hay que ejecutar argon2. Ese contraste convierte el login
// en un oraculo de que emails estan registrados, sin llegar a mostrar ningun
// mensaje distinto.
//
// La solucion es verificar igualmente contra un hash falso cuando el usuario no
// existe, de forma que ambos caminos ejecuten el mismo trabajo. El hash se
// genera una vez al cargar el módulo y se reutiliza: generarlo en cada intento
// haria el trabajo todavia mas rapido, que es justo lo que hay que evitar.
// ---------------------------------------------------------------------------

const dummyHashPromise: Promise<string> = argon2.hash(
  // No es una contrasena real: es una cadena aleatoria que solo existe para
  // que argon2 tenga algo que verificar.
  'communityhub::timing-equalizer::no-es-una-contrasena',
  options,
)

export async function equalizeTiming(password: string): Promise<void> {
  const hash = await dummyHashPromise
  await verifyPassword(hash, password)
}
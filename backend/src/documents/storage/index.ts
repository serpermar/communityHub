// ---------------------------------------------------------------------------
// Fabrica del gateway de Storage, cacheada.
//
// El driver se crea UNA vez (los dos singletons se guardan a mano en vez de
// hacerlo a base de lazy-loops): para `local` es importante que las llamadas
// compartan la misma carpeta raiz, y para `supabase` que no se abran clientes
// nuevos en cada peticion. `dispose()` existe solo para los tests —divide el
// ciclo de vida de un processo con el del proceso— y nunca lo llama la app.
// ---------------------------------------------------------------------------

import type { StorageGateway } from './gateway.js'
import { LocalStorageGateway } from './local.js'
import { SupabaseStorageGateway } from './supabase.js'

let local: LocalStorageGateway | null = null
let supabase: SupabaseStorageGateway | null = null

/**
 * El gateway de la app. `env` ya valido STORAGE_DRIVER y, si es supabase,
 * que existan las claves (config/env.ts); aqui nunca hay un caso de mas.
 */
export async function getStorageGateway(): Promise<StorageGateway> {
  const { env } = await import('../../config/env.js')

  if (env.STORAGE_DRIVER === 'local') {
    return (local ??= await LocalStorageGateway.create())
  }

  return (supabase ??= new SupabaseStorageGateway(env.DOCUMENTS_BUCKET, env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY))
}

/** Descarta el singleton del driver local (tests). Idempotente. */
export async function resetStorageGateway(): Promise<void> {
  if (local) {
    await local.dispose()
    local = null
  }
  supabase = null
}
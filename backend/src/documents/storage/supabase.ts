// ---------------------------------------------------------------------------
// Driver real de Storage: el bucket `community-documents` de Supabase.
//
// Se usa la SERVICE ROLE KEY, y solo desde el backend: da acceso sin pasar
// por RLS del storage, asi que vivir fuera del bundle del cliente es parte de
// la seguridad del bloque (DN-14). El cliente se crea sin persistir sesion
// (auth esnob: solo interesa `storage`), y el bucket es privado; la lectura
// de quien descarga va por signed URL, nunca por una politica de lectura.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { StorageGateway } from './gateway.js'

export class SupabaseStorageGateway implements StorageGateway {
  private readonly storage: SupabaseClient['storage']

  /**
   * @param bucket El bucket de documentos. Aparte de VACIO no hay comprobacion
   *   aqui: si no existe, la primera subida fallara con un error del provedor
   *   que el backend relanza tal cual (se ve en el log y en el 500).
   */
  constructor(
    private readonly bucket: string,
    supabaseUrl: string,
    serviceRoleKey: string,
  ) {
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })
    this.storage = client.storage
  }

  async upload(bucketPath: string, data: Buffer, mime: string): Promise<void> {
    // upsert false a proposito: la ruta lleva un uuid v4 arrastrado y sis colisiono
    // es una senal de que algo peta (document_path_taken en 02i). Sobreescribir
    // silenciosamente un documento de la comunidad es justo lo contrario de lo
    // que quiere un archivo de actas.
    const { error } = await this.storage.from(this.bucket).upload(bucketPath, data, {
      contentType: mime,
      upsert: false,
    })

    if (error) throw error
  }

  async remove(bucketPath: string): Promise<void> {
    // remove devuelve `{ error }`; borrar algo inexistente no se considera error.
    const { error } = await this.storage.from(this.bucket).remove([bucketPath])

    if (error) throw error
  }

  async signedUrl(bucketPath: string, expiresIn: number): Promise<string> {
    const { data, error } = await this.storage.from(this.bucket).createSignedUrl(bucketPath, expiresIn)

    if (error) throw error

    return data.signedUrl
  }
}
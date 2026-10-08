// ---------------------------------------------------------------------------
// Driver local de Storage.
//
// Vuelca los objetos a una carpeta temporal creada al arrancar con mkdtemp.
// Sirve para desarrollo sin bucket y para los tests de integracion, que
// verifican la orquestacion (se sube antes de insertar, se borra en la
// compensacion, se borra tras el soft delete) sin necesitar un provedor.
//
// La firma es la de Supabase: `signedUrl` pide una URL con caducidad. Aqui no
// hay firma que hacer, asi que se devuelve una URL "de juguete" que SI incluye
// el expiresIn: los tests pueden comprobar que el parametro se traspasa y que
// cada llamada produce un vinculo nuevo.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { StorageGateway } from './gateway.js'

export class LocalStorageGateway implements StorageGateway {
  private root: string

  private constructor(root: string) {
    this.root = root
  }

  /** Crea el driver y su carpeta raiz temporal (unicas por proceso). */
  static async create(): Promise<LocalStorageGateway> {
    const root = await mkdtemp(path.join(tmpdir(), 'communityhub-storage-'))
    return new LocalStorageGateway(root)
  }

  async upload(bucketPath: string, data: Buffer): Promise<void> {
    const destino = path.join(this.root, bucketPath)

    await mkdir(path.dirname(destino), { recursive: true })
    await writeFile(destino, data)
  }

  async remove(bucketPath: string): Promise<void> {
    try {
      await unlink(path.join(this.root, bucketPath))
    } catch (error) {
      // Borrar algo que no existe no es un error: el contrato lo dice. El
      // objetivo del borrado es que no quede huerfano, y si no estaba, ya esta.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async signedUrl(bucketPath: string, expiresIn: number): Promise<string> {
    // URL de juguete pero NO constante: una signed URL de verdad cambia con
    // cada llamada (lleva firma), y los tests y el codigo que las usa no deben
    // asumir que dos llamadas producen el mismo vinculo. El `sig` es lo que
    // simula esa firma.
    return `http://local-storage/${bucketPath}?expiresIn=${expiresIn}&sig=${randomUUID()}`
  }

  /** Limpieza de la carpeta temporal. No es parte del contrato: lo llama tests y dev. */
  async dispose(): Promise<void> {
    await rm(this.root, { recursive: true, force: true })
  }

  /** Ruta absoluta de un objeto, para los tests que quieran leer el binario. */
  rutaLocal(bucketPath: string): string {
    return path.join(this.root, bucketPath)
  }

  /** Identificador de proceso, util para los fixtures de los tests. */
  readonly id = randomUUID()
}
// ---------------------------------------------------------------------------
// Driver local de Storage.
//
// Es el driver que usan desarrollo y tests, y lo que se comprueba aqui es el
// CONTRATO de la interfaz (gateway.ts): subir, borrar, firmar URL. Que el
// backend cuelgue de una interfaz y no de Supabase es lo que hace que el
// resto del bloque se pruebe sin claves.
//
// No se comprueba `remove` de un objeto inexistente como "no falla" por
// probar algo facil: es parte del contrato (gateway.ts lo dice) y es lo que
// usa la compensacion del alta, que puede llegar a borrar un objeto que ya no
// existia.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorageGateway } from '../storage/local.js'
import { getStorageGateway, resetStorageGateway } from '../storage/index.js'

let gateway: LocalStorageGateway

beforeEach(async () => {
  gateway = await LocalStorageGateway.create()
})

afterEach(async () => {
  await gateway.dispose()
})

const BUFFER = Buffer.from('los bytes del acta')

describe('LocalStorageGateway', () => {
  it('sube el objeto con sus bytes exactos, en la ruta pedida', async () => {
    const bucketPath = '22222222-2222-4222-8222-222222222222/8a2f2c3e-1111-4111-8111-111111111111'

    await gateway.upload(bucketPath, BUFFER)

    // La ruta del bucket se interpreta como una ruta de carpeta real: el
    // driver local crea los subdirectorios.
    const guardado = await readFile(gateway.rutaLocal(bucketPath))

    expect(guardado.equals(BUFFER)).toBe(true)
  })

  it('borra el objeto que se subio', async () => {
    const bucketPath = 'comm/5cf92f76-0000-0000-0000-000000000001'

    await gateway.upload(bucketPath, BUFFER)
    await gateway.remove(bucketPath)

    await expect(readFile(gateway.rutaLocal(bucketPath))).rejects.toThrow()
  })

  it('borrar un objeto inexistente no es un error', async () => {
    await expect(gateway.remove('comm/no-existe')).resolves.toBeUndefined()
  })

  it('la URL firmada lleva la ruta y el expiresIn, y cada llamada es nueva', async () => {
    const bucketPath = 'comm/c2031a0f-0000-0000-0000-000000000002'

    const una = await gateway.signedUrl(bucketPath, 300)
    const otra = await gateway.signedUrl(bucketPath, 300)

    expect(una).toContain(bucketPath)
    expect(una).toContain('expiresIn=300')
    expect(una).not.toBe(otra)
  })

  it('una URL firmada no requiere que el objeto exista (contrato de bytes)', async () => {
    // El backend entrega la URL a quien tiene can_download; de si el objeto
    // existe o no se encarga el provedor al resolverla.
    await expect(gateway.signedUrl('comm/sin-objeto', 60)).resolves.toContain('comm/sin-objeto')
  })

  it('dispose deja el almacen de nuevo limpio', async () => {
    const bucketPath = 'comm/temporal'
    await gateway.upload(bucketPath, BUFFER)

    await gateway.dispose()

    await expect(readFile(gateway.rutaLocal(bucketPath))).rejects.toThrow()
  })
})

describe('getStorageGateway', () => {
  it('en tests devuelve un driver local y cachea el mismo singleton', async () => {
    await resetStorageGateway()

    const primero = await getStorageGateway()
    const segundo = await getStorageGateway()

    expect(segundo).toBe(primero)
    expect(primero).toBeInstanceOf(LocalStorageGateway)

    await resetStorageGateway()
  })

  it('reset crea una instancia nueva con carpeta nueva', async () => {
    await resetStorageGateway()

    const primero = await getStorageGateway() as LocalStorageGateway
    const primeraRuta = primero.rutaLocal('x')

    await resetStorageGateway()

    const segundo = await getStorageGateway() as LocalStorageGateway
    const segundaRuta = segundo.rutaLocal('x')

    expect(segundo).toBeInstanceOf(LocalStorageGateway)
    expect(segundo).not.toBe(primero)
    expect(segundaRuta).not.toBe(primeraRuta)

    await resetStorageGateway()
  })
})
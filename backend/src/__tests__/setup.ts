// ---------------------------------------------------------------------------
// Arranque de la suite.
//
// Falla aqui, y no con un error de Prisma a mitad del primer test, si falta la
// configuración. Un `P1001 Can't reach database server` no dice nada de por qué
// no hay conexión, y el primer impulso es tocar el código en vez del entorno.
//
// Lo que se comprueba: que el .env existe y es coherente (eso ya lo hace
// config/env.ts al importar, y es intencionado que el fallo sea visible), y que
// la base de datos responde.
//
// No se salta ningún test si la base de datos no está. Un test que se salta es
// un test que no prueba nada, y en CI "todo verde" dejaría de significar nada.
// Si la base de datos no está, la suite tiene que fallar y decirlo claro.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll } from 'vitest'
import { prisma } from '../db.js'

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`
  } catch (error) {
    throw new Error(
      [
        '',
        'No se ha podido conectar con la base de datos.',
        '',
        'Los tests de CommunityHub corren contra un Postgres REAL. No se usa un',
        'mock, porque la mitad de lo que se comprueba aquí es que las políticas',
        'de RLS filtran de verdad, y un mock no las evalúa.',
        '',
        'Comprueba que backend/.env existe y que las credenciales son correctas.',
        'Detalle del error:',
        `  ${error instanceof Error ? error.message : String(error)}`,
        '',
      ].join('\n'),
      { cause: error },
    )
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})
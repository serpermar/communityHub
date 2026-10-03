// ---------------------------------------------------------------------------
// Arranque de la suite de integracion.
//
// Falla aqui, y no con un error de Prisma a mitad del primer test, si falta la
// configuracion. Un `P1001 Can't reach database server` no dice nada de por que
// no hay conexion, y el primer impulso es tocar el codigo en vez del entorno.
//
// Se comprueba tambien que el cliente administrativo tiene BYPASSRLS. Los
// fixtures se crean con el rol postgres porque es el unico que puede crearlos;
// si ese rol perdiera el bypass, todos los fixtures dejarian de insertarse y
// cada test fallaria con un error de permisos que no senala su causa.
//
// No se salta ningun test si la base de datos no esta. Un test que se salta es
// un test que no prueba nada, y en CI "todo verde" dejaria de significar nada.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll } from 'vitest'
import { prisma } from '../db.js'
import { admin, assertAdminBypassesRls } from '../db-admin.js'

beforeAll(async () => {
  try {
    await prisma.$queryRaw`select 1`
  } catch (error) {
    throw new Error(
      [
        '',
        'No se ha podido conectar con la base de datos.',
        '',
        'Los tests de integracion de CommunityHub corren contra un Postgres REAL.',
        'No se usa un mock, porque la mitad de lo que se comprueba aqui es que',
        'las politicas de RLS filtran de verdad, y un mock no las evalua.',
        '',
        'Comprueba que backend/.env existe y que las credenciales son correctas.',
        'Detalle del error:',
        `  ${error instanceof Error ? error.message : String(error)}`,
        '',
      ].join('\n'),
      { cause: error },
    )
  }

  if (!(await assertAdminBypassesRls())) {
    throw new Error(
      [
        '',
        'MIGRATION_DATABASE_URL no tiene BYPASSRLS.',
        '',
        'Los fixtures se crean con ese cliente. Si no puede saltarse las politicas,',
        'no puede crear las comunidades y los gastos que los tests necesitan.',
        'Comprueba que MIGRATION_DATABASE_URL apunta al rol postgres de Supabase,',
        'no a app_runtime.',
        '',
      ].join('\n'),
    )
  }
})

afterAll(async () => {
  await prisma.$disconnect()
  await admin.$disconnect()
})

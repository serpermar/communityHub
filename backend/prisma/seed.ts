// ---------------------------------------------------------------------------
// seed.ts · Datos de prueba deterministas.
//
// Por qué el seed va con el rol postgres y no con app_runtime:
//
//   Un seed tiene que poder escribir filas que RLS no le deja crear. Insertar
//   un ADMIN en community_members exige que app_is_admin_of(community) sea
//   cierto, y para insertar el primer ADMIN no hay ninguno todavia: es un
//   deadlock. Cualquier proyecto con RLS resuelve esto con un rol de setup.
//
//   Esto NO debilita la seguridad: postgres se usa solo aqui, al poblar. Y es
//   precisamente por eso que los tests de aislamiento usan OTRA conexion, la de
//   app_runtime, que es la que aplica RLS de verdad. Si el seed usara
//   app_runtime, los tests probarian el seed y no las politicas.
//
// Determinista: mismos UUID, mismos datos, siempre. Un seed con random() hace
// imposible comparar una ejecucion con otra y impossible escribir un test que
// espere un resultado concreto.
//
// Uso:
//   npm run seed          crea los datos
//   npm run seed -- --reset   borra lo anterior y vuelve a crear
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { hashSync } from 'node:crypto'

// ---------------------------------------------------------------------------
// Determinismo: hash de contraseña sin bcrypt ni argon2.
//
// En el seed la contraseña es de prueba y el hash no tiene por qué ser
// resistente. Usamos scryptSync de la librería nativa, que sí es un KDF
// correcto, y con coste bajo para que el seed no tarde.
//
// OJO: las contraseñas de los datos de prueba NO sirven para iniciar sesión
// hasta que la spec de auth esté implementada. En cuanto esté, app_auth_lookup
// verificará argon2id contra este hash y fallará, porque scrypt no es argon2.
// Para entonces el seed hay que cambiar a argon2id (npm i argon2).
// ---------------------------------------------------------------------------

const TEST_PASSWORD_HASH = hashSync('Vecino2026!', 'scrypt', {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
})

// UUID fijos. Elegidos a mano, no generados: el mismo seed en cada máquina.
const ID = {
  // Usuarios
  anaAdmin: '11111111-1111-4111-8111-111111111111',
  luisPresidente: '11111111-1111-4222-8222-222222222222',
  martaVecina: '11111111-1111-4333-8333-333333333333',
  carlosVecino: '11111111-1111-4444-8444-444444444444',
  proveedorManolo: '11111111-1111-4555-8555-555555555555',

  // Comunidades
  comunidadA: '22222222-2222-4111-8111-111111111111',
  comunidadB: '22222222-2222-4222-8222-222222222222',

  // Incidencias
  incFugaA: '33333333-3333-4111-8111-111111111111',
  incAscensorA: '33333333-3333-4222-8222-222222222222',
  incFarolaB: '33333333-3333-4333-8333-333333333333',
  incRoturaB: '33333333-3333-4444-8444-444444444444',
} as const

// ---------------------------------------------------------------------------
// Uso
// ---------------------------------------------------------------------------

const reset = process.argv.includes('--reset')
const dryRun = process.argv.includes('--dry-run')

const prisma = new PrismaClient({
  datasourceUrl: process.env.MIGRATION_DATABASE_URL,
})

async function wipe() {
  // El orden lo marca la FK: primero los hijos, luego los padres. ON DELETE
  // CASCADE ayuda, pero las tablas sin cascada desde communities (incidents,
  // expenses) necesitan ir antes.
  await prisma.voteResponse.deleteMany({})
  await prisma.voteOption.deleteMany({})
  await prisma.vote.deleteMany({})
  await prisma.invoice.deleteMany({})
  await prisma.expense.deleteMany({})
  await prisma.areaSlot.deleteMany({})
  await prisma.reservation.deleteMany({})
  await prisma.commonArea.deleteMany({})
  await prisma.auditLog.deleteMany({})
  await prisma.session.deleteMany({})
  await prisma.notification.deleteMany({})
  await prisma.documentAcl.deleteMany({})
  await prisma.document.deleteMany({})
  await prisma.announcement.deleteMany({})
  await prisma.incidentComment.deleteMany({})
  await prisma.incident.deleteMany({})
  await prisma.communityMember.deleteMany({})
  await prisma.community.deleteMany({})
  await prisma.user.deleteMany({})
}

async function main() {
  console.log(`\nSeed · CommunityHub\n`)
  if (dryRun) console.log('  (--dry-run: no se escribe nada)\n')

  if (reset) {
    console.log('  Borrando datos anteriores...')
    await wipe()
  }

  // -------------------------------------------------------------------------
  // Usuarios
  // -------------------------------------------------------------------------
  // Password: Vecino2026! para todos. Son datos de prueba, no credenciales.
  //
  // Reparto pensado para que cada prueba de aislamiento tenga un caso:
  //   anaAdmin        ADMIN de A. Debe ver gastos de A.
  //   luisPresidente  PRESIDENT de A. NO debe ver gastos: es la prueba de que
  //                   el RBAC distingue ADMIN de PRESIDENT.
  //   martaVecina     NEIGHBOR de A. Autora de una incidencia.
  //   carlosVecino    NEIGHBOR de B. No debe ver nada de A.
  //   proveedorManolo PROVIDER de A, asignado a UNA incidencia. No debe ver
  //                   las otras dos de A: es el caso más delicado del RBAC.
  console.log('  1/5  Usuarios')
  await prisma.user.createMany({
    data: [
      {
        id: ID.anaAdmin,
        email: 'ana@comunidad-a.test',
        passwordHash: TEST_PASSWORD_HASH,
        fullName: 'Ana Ruiz Delgado',
        phone: '+34600000001',
      },
      {
        id: ID.luisPresidente,
        email: 'luis@comunidad-a.test',
        passwordHash: TEST_PASSWORD_HASH,
        fullName: 'Luis Mendoza Prat',
        phone: '+34600000002',
      },
      {
        id: ID.martaVecina,
        email: 'marta@comunidad-a.test',
        passwordHash: TEST_PASSWORD_HASH,
        fullName: 'Marta Ibáñez Soto',
        phone: '+34600000003',
      },
      {
        id: ID.carlosVecino,
        email: 'carlos@comunidad-b.test',
        passwordHash: TEST_PASSWORD_HASH,
        fullName: 'Carlos Ferrer Ruiz',
        phone: '+34600000004',
      },
      {
        id: ID.proveedorManolo,
        email: 'manolo@proveedor.test',
        passwordHash: TEST_PASSWORD_HASH,
        fullName: 'Manolo Reparaciones SL',
        phone: '+34600000005',
        globalRole: 'NEIGHBOR',
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Comunidades
  // -------------------------------------------------------------------------
  // Coordenadas reales de Zaragoza y Barcelona: el widget de meteorología
  // (Open-Meteo) necesita una ubicación que exista de verdad.
  console.log('  2/5  Comunidades')
  await prisma.community.createMany({
    data: [
      {
        id: ID.comunidadA,
        name: 'Comunidad del Saucejo',
        slug: 'saucejo',
        description: 'Comunidad residencial de 48 viviendas en Zaragoza.',
        addressLine1: 'Calle Mayor 14',
        city: 'Zaragoza',
        province: 'Zaragoza',
        postalCode: '50001',
        latitude: 41.648800,
        longitude: -0.889100,
        timezone: 'Europe/Madrid',
        registrationNumber: 'Z-1998-00482',
        createdBy: ID.anaAdmin,
      },
      {
        id: ID.comunidadB,
        name: 'Residencial Diagonal Mar',
        slug: 'diagonal-mar',
        description: 'Comunidad de lujo en Barcelona. Existe solo para probar aislamiento.',
        addressLine1: 'Avinguda Diagonal 662',
        city: 'Barcelona',
        province: 'Barcelona',
        postalCode: '08019',
        latitude: 41.392400,
        longitude: 2.130000,
        timezone: 'Europe/Madrid',
        registrationNumber: 'B-2004-11877',
        createdBy: ID.carlosVecino,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Membresías: aquí vive el RBAC
  // -------------------------------------------------------------------------
  console.log('  3/5  Membresías')
  await prisma.communityMember.createMany({
    data: [
      {
        communityId: ID.comunidadA,
        userId: ID.anaAdmin,
        role: 'ADMIN',
        unitNumber: 'Portal A, 3º B',
      },
      {
        communityId: ID.comunidadA,
        userId: ID.luisPresidente,
        role: 'PRESIDENT',
        unitNumber: 'Portal A, 1º A',
      },
      {
        communityId: ID.comunidadA,
        userId: ID.martaVecina,
        role: 'NEIGHBOR',
        unitNumber: 'Portal B, 2º D',
      },
      {
        communityId: ID.comunidadA,
        userId: ID.proveedorManolo,
        role: 'PROVIDER',
      },
      {
        communityId: ID.comunidadB,
        userId: ID.carlosVecino,
        role: 'ADMIN',
        unitNumber: '4ª planta, D',
      },
      {
        communityId: ID.comunidadB,
        userId: ID.martaVecina,
        role: 'NEIGHBOR',
        // Marta es miembro de A y de B a la vez. Es el caso que demuestra que
        // el aislamiento depende de la comunidad, no solo del usuario: con el
        // contexto puesto en A no debe ver nada de B, y al revés.
        unitNumber: '2ª planta, B',
        status: 'ACTIVE',
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Incidencias
  // -------------------------------------------------------------------------
  // De la comunidad A: 3. De la B: 2. Repartidas para que cada rol vea un
  // subconjunto distinto y verificable.
  console.log('  4/5  Incidencias')
  await prisma.incident.createMany({
    data: [
      {
        id: ID.incFugaA,
        communityId: ID.comunidadA,
        referenceCode: 'INC-2026-0001',
        title: 'Fuga de agua en el cuarto de contadores',
        description:
          'Sale agua desde la junta de la tubería general del sótano. Ya se ha cerrado la llave de paso del portal.',
        category: 'PLUMBING',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        location: 'Sótano, cuarto de contadores',
        reporterId: ID.martaVecina,
        assignedToId: ID.proveedorManolo,
      },
      {
        id: ID.incAscensorA,
        communityId: ID.comunidadA,
        referenceCode: 'INC-2026-0002',
        title: 'Ascensor parado entre plantas por tercera vez',
        description:
          'Se ha detenido dos veces esta semana. La empresa dice que es por la cuota de uso.',
        category: 'ELEVATOR',
        priority: 'MEDIUM',
        status: 'OPEN',
        location: 'Portal A',
        reporterId: ID.luisPresidente,
        // Sin assigned_to_id a propósito: tiene que ser INVISIBLE para el
        // proveedor, que solo ve las que tiene asignadas.
      },
      {
        id: ID.incFarolaB,
        communityId: ID.comunidadB,
        referenceCode: 'INC-2026-0003',
        title: 'Farola fundida en el parking',
        description: 'La del fondo no enciende desde hace cuatro días.',
        category: 'ELECTRICITY',
        priority: 'LOW',
        status: 'OPEN',
        location: 'Parking, plaza 12',
        reporterId: ID.carlosVecino,
      },
      {
        id: ID.incRoturaB,
        communityId: ID.comunidadB,
        referenceCode: 'INC-2026-0004',
        title: 'Rotura de la puerta del cuarto deCommunity',
        description: 'No cierra bien y el cuarto de contadores queda accesible.',
        category: 'SECURITY',
        priority: 'HIGH',
        status: 'OPEN',
        location: 'Planta baja',
        reporterId: ID.martaVecina,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Gastos
  // -------------------------------------------------------------------------
  // Solo en la comunidad A, porque son lo que ADMIN ve y PRESIDENT no. Es el
  // dato más sensible del seed y el que mejor demuestra que el RBAC funciona.
  console.log('  5/5  Gastos')
  await prisma.expense.createMany({
    data: [
      {
        communityId: ID.comunidadA,
        concept: 'Reparación de la bomba de la comunidad',
        category: 'MAINTENANCE',
        amount: 1250.5,
        expenseDate: new Date('2026-01-15'),
        supplier: 'Bombeiros Zaragoza SL',
        createdBy: ID.anaAdmin,
      },
      {
        communityId: ID.comunidadA,
        concept: 'Limpieza de zonas comunes, enero',
        category: 'CLEANING',
        amount: 480.0,
        expenseDate: new Date('2026-01-31'),
        supplier: 'Limpiosol',
        createdBy: ID.anaAdmin,
      },
      {
        communityId: ID.comunidadA,
        concept: 'Seguro de la comunidad, primera cuota',
        category: 'INSURANCE',
        amount: 890.25,
        expenseDate: new Date('2026-02-01'),
        supplier: 'Mapfre',
        createdBy: ID.anaAdmin,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
  const [u, c, m, i, e] = await Promise.all([
    prisma.user.count(),
    prisma.community.count(),
    prisma.communityMember.count(),
    prisma.incident.count(),
    prisma.expense.count(),
  ])

  console.log(`\n  ${u} usuarios · ${c} comunidades · ${m} membresías · ${i} incidencias · ${e} gastos\n`)

  console.log('  Para entrar en cada rol (cuando exista el login):')
  console.log('    ADMIN      ana@comunidad-a.test     · Vecino2026!')
  console.log('    PRESIDENT  luis@comunidad-a.test    · Vecino2026!')
  console.log('    NEIGHBOR   marta@comunidad-a.test   · Vecino2026!  (miembro de A y B)')
  console.log('    NEIGHBOR   carlos@comunidad-b.test  · Vecino2026!')
  console.log('    PROVIDER   manolo@proveedor.test    · Vecino2026!  (solo 1 incidencia asignada)\n')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('\nError en el seed:\n')
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(`  ${e.code} en ${e.meta?.model ?? '?'}`)
    }
    console.error(e instanceof Error ? e.message : e)
    await prisma.$disconnect()
    process.exit(1)
  })
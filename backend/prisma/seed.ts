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
import argon2 from 'argon2'
// ---------------------------------------------------------------------------
// Contraseña de los datos de prueba.
//
// argon2id, el mismo algoritmo y los mismos parámetros que usa la aplicación
// (spec 01, decisión A-2). Antes se usaba scryptSync, y el propio script
// advertía de que en cuanto existiera autenticación estas cuentas dejarían de
// poder entrar, porque app_auth_find_user_by_email devuelve el hash y el
// backend verifica argon2. Ese momento es este.
//
// No se importan las funciones de `src/auth/password.ts` a propósito: esas
// cargan `config/env.ts`, que exige un DATABASE_URL con el rol app_runtime, y el
// seed tiene que correr justamente con MIGRATION_DATABASE_URL (rol postgres).
// Ver argon2 aquí no es duplicar lógica: son tres líneas y un hash.
//
// El hash lleva sal aleatoria, así que cambia en cada seed. Lo que es
// determinista son los UUID y los datos, que es lo que necesitan los tests.
// ---------------------------------------------------------------------------

const TEST_PASSWORD = 'CommunityHub2026'

const TEST_PASSWORD_HASH = await argon2.hash(TEST_PASSWORD, {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
})

// UUID fijos. Elegidos a mano, no generados: el mismo seed en cada máquina.
const ID = {
  // Usuarios
  anaAdmin: '11111111-1111-4111-8111-111111111111',
  luisPresidente: '11111111-1111-4222-8222-222222222222',
  martaVecina: '11111111-1111-4333-8333-333333333333',
  carlosVecino: '11111111-1111-4444-8444-444444444444',
  proveedorManolo: '11111111-1111-4555-8555-555555555555',
  // Staff de la plataforma. Unico usuario con `global_role = 'ADMIN_SA'` y el
  // unico que puede dar de alta una comunidad por la API.
 //
  // No es un ADMIN de la comunidad A como ana, y la confusion es facil: `ADMIN`
  // es un rol DENTRO de una comunidad y no puede crear comunidades; `ADMIN_SA` es
  // un rol de plataforma. Ana no puede usar POST /api/v1/communities aunque sea
  // la administradora de A, y viceversa: el de la plataforma entra en la
  // comunidad que acaba de crear como ADMIN de ella.
  staffElena: '11111111-1111-4666-8666-666666666666',

  // Comunidades
  comunidadA: '22222222-2222-4111-8111-111111111111',
  comunidadB: '22222222-2222-4222-8222-222222222222',

  // Incidencias
  incFugaA: '33333333-3333-4111-8111-111111111111',
  incAscensorA: '33333333-3333-4222-8222-222222222222',
  incFarolaB: '33333333-3333-4333-8333-333333333333',
  incRoturaB: '33333333-3333-4444-8444-444444444444',

  // Zonas comunes
  zonaPiscinaA: '44444444-4444-4111-8111-111111111111',
  zonaPadelA: '44444444-4444-4222-8222-222222222222',
  zonaSalonB: '44444444-4444-3333-8333-333333333333',

  // Reservas
  resPiscinaMarta: '55555555-5555-4111-8111-111111111111',
  resPiscinaAna: '55555555-5555-4222-8222-222222222222',
  resPadelMarta: '55555555-5555-3333-8333-333333333333',
  resSalonCarlos: '55555555-5555-4444-8444-444444444444',
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
  await prisma.voteResponses.deleteMany({})
  await prisma.voteOptions.deleteMany({})
  await prisma.votes.deleteMany({})
  await prisma.invoices.deleteMany({})
  await prisma.expenses.deleteMany({})
  await prisma.areaSlots.deleteMany({})
  await prisma.reservations.deleteMany({})
  await prisma.commonAreas.deleteMany({})
  await prisma.auditLogs.deleteMany({})
  await prisma.sessions.deleteMany({})
  await prisma.notifications.deleteMany({})
  await prisma.documentAcl.deleteMany({})
  await prisma.documents.deleteMany({})
  await prisma.announcements.deleteMany({})
  await prisma.incidentComments.deleteMany({})
  await prisma.incidents.deleteMany({})
  await prisma.communityMembers.deleteMany({})
  await prisma.communities.deleteMany({})
  await prisma.users.deleteMany({})
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
  // Contraseña de los datos de prueba: `CommunityHub2026` para todos los usuarios.
// Son datos de prueba generados por este script, no credenciales reales.
  //
  // Reparto pensado para que cada prueba de aislamiento tenga un caso:
  //   anaAdmin        ADMIN de A. Debe ver gastos de A.
  //   luisPresidente  PRESIDENT de A. NO debe ver gastos: es la prueba de que
  //                   el RBAC distingue ADMIN de PRESIDENT.
  //   martaVecina     NEIGHBOR de A. Autora de una incidencia.
  //   carlosVecino    NEIGHBOR de B. No debe ver nada de A.
  //   proveedorManolo PROVIDER de A, asignado a UNA incidencia. No debe ver
  //                   las otras dos de A: es el caso más delicado del RBAC.
  //   staffElena       ADMIN_SA de plataforma. No es miembro de A ni de B: su
  //                   poder es dar de alta comunidades, no leer las que hay. Al
  //                   crear una desde la API entra en ella como ADMIN.
  console.log('  1/7  Usuarios')
  await prisma.users.createMany({
    data: [
      {
        id: ID.anaAdmin,
        email: 'ana@comunidad-a.test',
        password_hash: TEST_PASSWORD_HASH,
        full_name: 'Ana Ruiz Delgado',
        phone: '+34600000001',
      },
      {
        id: ID.luisPresidente,
        email: 'luis@comunidad-a.test',
        password_hash: TEST_PASSWORD_HASH,
        full_name: 'Luis Mendoza Prat',
        phone: '+34600000002',
      },
      {
        id: ID.martaVecina,
        email: 'marta@comunidad-a.test',
        password_hash: TEST_PASSWORD_HASH,
        full_name: 'Marta Ibáñez Soto',
        phone: '+34600000003',
      },
      {
        id: ID.carlosVecino,
        email: 'carlos@comunidad-b.test',
        password_hash: TEST_PASSWORD_HASH,
        full_name: 'Carlos Ferrer Ruiz',
        phone: '+34600000004',
      },
      {
        id: ID.proveedorManolo,
        email: 'manolo@proveedor.test',
        password_hash: TEST_PASSWORD_HASH,
        full_name: 'Manolo Reparaciones SL',
        phone: '+34600000005',
        global_role: 'NEIGHBOR',
      },
      {
        id: ID.staffElena,
        email: 'elena@staff.test',
        password_hash: TEST_PASSWORD_HASH,
        full_name: 'Elena Vidal Cortés',
        phone: '+34600000006',
        // `ADMIN_SA` es lo unico que este usuario tiene de especial. Sin esta
        // linea el seed no tendria a nadie capaz de llamar a
        // POST /api/v1/communities, y la demo empezaria sin comunidades
        // creadas desde la API.
        global_role: 'ADMIN_SA',
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Comunidades
  // -------------------------------------------------------------------------
  // Coordenadas reales de Zaragoza y Barcelona: el widget de meteorología
  // (Open-Meteo) necesita una ubicación que exista de verdad.
  console.log('  2/7  Comunidades')
  await prisma.communities.createMany({
    data: [
      {
        id: ID.comunidadA,
        name: 'Comunidad del Saucejo',
        slug: 'saucejo',
        description: 'Comunidad residencial de 48 viviendas en Zaragoza.',
        address_line1: 'Calle Mayor 14',
        city: 'Zaragoza',
        province: 'Zaragoza',
        postal_code: '50001',
        latitude: 41.648800,
        longitude: -0.889100,
        timezone: 'Europe/Madrid',
        registration_number: 'Z-1998-00482',
        created_by: ID.anaAdmin,
      },
      {
        id: ID.comunidadB,
        name: 'Residencial Diagonal Mar',
        slug: 'diagonal-mar',
        description: 'Comunidad de lujo en Barcelona. Existe solo para probar aislamiento.',
        address_line1: 'Avinguda Diagonal 662',
        city: 'Barcelona',
        province: 'Barcelona',
        postal_code: '08019',
        latitude: 41.392400,
        longitude: 2.130000,
        timezone: 'Europe/Madrid',
        registration_number: 'B-2004-11877',
        created_by: ID.carlosVecino,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Membresías: aquí vive el RBAC
  // -------------------------------------------------------------------------
  console.log('  3/7  Membresías')
  await prisma.communityMembers.createMany({
    data: [
      {
        community_id: ID.comunidadA,
        user_id: ID.anaAdmin,
        role: 'ADMIN',
        unit_number: 'Portal A, 3º B',
      },
      {
        community_id: ID.comunidadA,
        user_id: ID.luisPresidente,
        role: 'PRESIDENT',
        unit_number: 'Portal A, 1º A',
      },
      {
        community_id: ID.comunidadA,
        user_id: ID.martaVecina,
        role: 'NEIGHBOR',
        unit_number: 'Portal B, 2º D',
      },
      {
        community_id: ID.comunidadA,
        user_id: ID.proveedorManolo,
        role: 'PROVIDER',
      },
      {
        community_id: ID.comunidadB,
        user_id: ID.carlosVecino,
        role: 'ADMIN',
        unit_number: '4ª planta, D',
      },
      {
        community_id: ID.comunidadB,
        user_id: ID.martaVecina,
        role: 'NEIGHBOR',
        // Marta es miembro de A y de B a la vez. Es el caso que demuestra que
        // el aislamiento depende de la comunidad, no solo del usuario: con el
        // contexto puesto en A no debe ver nada de B, y al revés.
        unit_number: '2ª planta, B',
        status: 'ACTIVE',
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Incidencias
  // -------------------------------------------------------------------------
  // De la comunidad A: 3. De la B: 2. Repartidas para que cada rol vea un
  // subconjunto distinto y verificable.
  console.log('  4/7  Incidencias')
  await prisma.incidents.createMany({
    data: [
      {
        id: ID.incFugaA,
        community_id: ID.comunidadA,
        reference_code: 'INC-2026-0001',
        title: 'Fuga de agua en el cuarto de contadores',
        description:
          'Sale agua desde la junta de la tubería general del sótano. Ya se ha cerrado la llave de paso del portal.',
        category: 'PLUMBING',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        location: 'Sótano, cuarto de contadores',
        reporter_id: ID.martaVecina,
        assigned_to_id: ID.proveedorManolo,
      },
      {
        id: ID.incAscensorA,
        community_id: ID.comunidadA,
        reference_code: 'INC-2026-0002',
        title: 'Ascensor parado entre plantas por tercera vez',
        description:
          'Se ha detenido dos veces esta semana. La empresa dice que es por la cuota de uso.',
        category: 'ELEVATOR',
        priority: 'MEDIUM',
        status: 'OPEN',
        location: 'Portal A',
        reporter_id: ID.luisPresidente,
        // Sin assigned_to_id a propósito: tiene que ser INVISIBLE para el
        // proveedor, que solo ve las que tiene asignadas.
      },
      {
        id: ID.incFarolaB,
        community_id: ID.comunidadB,
        reference_code: 'INC-2026-0003',
        title: 'Farola fundida en el parking',
        description: 'La del fondo no enciende desde hace cuatro días.',
        category: 'ELECTRICITY',
        priority: 'LOW',
        status: 'OPEN',
        location: 'Parking, plaza 12',
        reporter_id: ID.carlosVecino,
      },
      {
        id: ID.incRoturaB,
        community_id: ID.comunidadB,
        reference_code: 'INC-2026-0004',
        title: 'Rotura de la puerta del cuarto deCommunity',
        description: 'No cierra bien y el cuarto de contadores queda accesible.',
        category: 'SECURITY',
        priority: 'HIGH',
        status: 'OPEN',
        location: 'Planta baja',
        reporter_id: ID.martaVecina,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Gastos
  // -------------------------------------------------------------------------
  // Solo en la comunidad A, porque son lo que ADMIN ve y PRESIDENT no. Es el
  // dato más sensible del seed y el que mejor demuestra que el RBAC funciona.
  console.log('  5/7  Gastos')
  await prisma.expenses.createMany({
    data: [
      {
        community_id: ID.comunidadA,
        concept: 'Reparación de la bomba de la comunidad',
        category: 'MAINTENANCE',
        amount: 1250.5,
        expense_date: new Date('2026-01-15'),
        supplier: 'Bombeiros Zaragoza SL',
        created_by: ID.anaAdmin,
      },
      {
        community_id: ID.comunidadA,
        concept: 'Limpieza de zonas comunes, enero',
        category: 'CLEANING',
        amount: 480.0,
        expense_date: new Date('2026-01-31'),
        supplier: 'Limpiosol',
        created_by: ID.anaAdmin,
      },
      {
        community_id: ID.comunidadA,
        concept: 'Seguro de la comunidad, primera cuota',
        category: 'INSURANCE',
        amount: 890.25,
        expense_date: new Date('2026-02-01'),
        supplier: 'Mapfre',
        created_by: ID.anaAdmin,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Zonas comunes
  // -------------------------------------------------------------------------
  // Tres zonas, una por comunidad B y dos en A, para que el listado tenga
  // contenido en las dos. La de pádel lleva requires_approval: es la que
  // demuestra R-2 (nace PENDING) frente a la piscina, que nace CONFIRMED.
  //
  // open_time y close_time NO se escriben: usan el default de la columna
  // (08:00-22:00), y no ponerlos evita adivinar como convierte Prisma un Date
  // a una columna `time` en cada zona horaria. Las reservas de abajo caen
  // dentro de ese horario.
  console.log('  6/7  Zonas comunes')
  await prisma.commonAreas.createMany({
    data: [
      {
        id: ID.zonaPiscinaA,
        community_id: ID.comunidadA,
        name: 'Piscina comunitaria',
        type: 'SWIMMING_POOL',
        description: 'Piscina climatizada de 25 metros, con zona de solárium.',
        capacity: 25,
        slot_minutes: 60,
        max_daily_reservations: 10,
        requires_approval: false,
        created_by: ID.anaAdmin,
      },
      {
        id: ID.zonaPadelA,
        community_id: ID.comunidadA,
        name: 'Pista de pádel',
        type: 'PADEL_COURT',
        description: 'Pista cubierta con iluminación. Raquetas disponibles en el vestuario.',
        capacity: 4,
        slot_minutes: 90,
        max_daily_reservations: 6,
        // true a proposito: una reserva aqui nace PENDING y necesita
        // confirmacion de ADMIN. La piscina de al lado nace CONFIRMED. Con las
        // dos, la demo cubre los dos caminos de R-2 sin trucos.
        requires_approval: true,
        created_by: ID.anaAdmin,
      },
      {
        id: ID.zonaSalonB,
        community_id: ID.comunidadB,
        name: 'Salón de actos',
        type: 'COMMUNITY_ROOM',
        description: 'Salón polivalente con capacidad para 60 personas.',
        capacity: 60,
        slot_minutes: 60,
        max_daily_reservations: 4,
        requires_approval: false,
        created_by: ID.carlosVecino,
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Reservas
  // -------------------------------------------------------------------------
  // Cuatro reservas: tres CONFIRMED con sus area_slots (que es lo que la
  // disponibilidad pinta como OCCUPIED) y una PENDING sin slots, que es como
  // app_create_reservation() deja las de las zonas con requires_approval.
  //
  // Las horas van en UTC y son las locales de Madrid (octubre, UTC+2) para que
  // la rejilla cuadre: la piscina tiene slots de 60 min y la de pádel de 90,
  // y la funcion alinea contra la medianoche LOCAL de la comunidad.
  //
  // Se insertan directamente con el rol postgres, igual que las incidencias:
  // el seed poblaria filas que RLS no le deja crear si fuera app_runtime. La
  // logica de dominio (solape, limites) no se ejercita aqui; eso es de los
  // tests de integracion, que llaman a las funciones de verdad.
  console.log('  7/7  Reservas')
  await prisma.reservations.createMany({
    data: [
      {
        id: ID.resPiscinaMarta,
        community_id: ID.comunidadA,
        common_area_id: ID.zonaPiscinaA,
        user_id: ID.martaVecina,
        starts_at: new Date('2026-10-10T10:00:00.000Z'),
        ends_at: new Date('2026-10-10T11:00:00.000Z'),
        status: 'CONFIRMED',
        attendees: 3,
        notes: 'Con dos niños pequeños, si es posible en la zona de poca profundidad.',
      },
      {
        id: ID.resPiscinaAna,
        community_id: ID.comunidadA,
        common_area_id: ID.zonaPiscinaA,
        user_id: ID.anaAdmin,
        starts_at: new Date('2026-10-10T12:00:00.000Z'),
        ends_at: new Date('2026-10-10T13:00:00.000Z'),
        status: 'CONFIRMED',
        attendees: 2,
        notes: null,
      },
      {
        id: ID.resPadelMarta,
        community_id: ID.comunidadA,
        common_area_id: ID.zonaPadelA,
        user_id: ID.martaVecina,
        starts_at: new Date('2026-10-11T07:00:00.000Z'),
        ends_at: new Date('2026-10-11T08:30:00.000Z'),
        // PENDING y sin area_slots: la zona tiene requires_approval, y es el
        // estado que app_confirm_reservation() tiene que promover. Si llevara
        // slots, el hueco estaria bloqueado por una reserva que nadie ha
        // aprobado todavia.
        status: 'PENDING',
        attendees: 4,
        notes: 'Primera vez, mejor por la mañana.',
      },
      {
        id: ID.resSalonCarlos,
        community_id: ID.comunidadB,
        common_area_id: ID.zonaSalonB,
        user_id: ID.carlosVecino,
        starts_at: new Date('2026-10-12T15:00:00.000Z'),
        ends_at: new Date('2026-10-12T17:00:00.000Z'),
        status: 'CONFIRMED',
        attendees: 40,
        notes: 'Reunión de vecinos extraordinaria.',
      },
    ],
  })

  // Los slots de las tres CONFIRMED. Dos por la reserva de dos horas del
  // salón: un slot es un hueco de slot_minutes, no la reserva entera. El indice
  // unico (common_area_id, starts_at) es el que aqui daria un error si dos
  // reservas disputaran el mismo hueco — y no lo hacen.
  await prisma.areaSlots.createMany({
    data: [
      {
        common_area_id: ID.zonaPiscinaA,
        reservation_id: ID.resPiscinaMarta,
        starts_at: new Date('2026-10-10T10:00:00.000Z'),
        ends_at: new Date('2026-10-10T11:00:00.000Z'),
      },
      {
        common_area_id: ID.zonaPiscinaA,
        reservation_id: ID.resPiscinaAna,
        starts_at: new Date('2026-10-10T12:00:00.000Z'),
        ends_at: new Date('2026-10-10T13:00:00.000Z'),
      },
      {
        common_area_id: ID.zonaSalonB,
        reservation_id: ID.resSalonCarlos,
        starts_at: new Date('2026-10-12T15:00:00.000Z'),
        ends_at: new Date('2026-10-12T16:00:00.000Z'),
      },
      {
        common_area_id: ID.zonaSalonB,
        reservation_id: ID.resSalonCarlos,
        starts_at: new Date('2026-10-12T16:00:00.000Z'),
        ends_at: new Date('2026-10-12T17:00:00.000Z'),
      },
    ],
  })

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
  const [u, c, m, i, e, z, r] = await Promise.all([
    prisma.users.count(),
    prisma.communities.count(),
    prisma.communityMembers.count(),
    prisma.incidents.count(),
    prisma.expenses.count(),
    prisma.commonAreas.count(),
    prisma.reservations.count(),
  ])

  console.log(
    `\n  ${u} usuarios · ${c} comunidades · ${m} membresías · ${i} incidencias · ${e} gastos · ${z} zonas · ${r} reservas\n`,
  )

  console.log(`\n  Para entrar en cada rol:\n`)
  console.log(`    ADMIN      ana@comunidad-a.test     · ${TEST_PASSWORD}`)
  console.log(`    PRESIDENT  luis@comunidad-a.test    · ${TEST_PASSWORD}`)
  console.log(`    NEIGHBOR   marta@comunidad-a.test   · ${TEST_PASSWORD}   (miembro de A y B)`)
  console.log(`    NEIGHBOR   carlos@comunidad-b.test  · ${TEST_PASSWORD}`)
  console.log(`    PROVIDER   manolo@proveedor.test    · ${TEST_PASSWORD}   (solo 1 incidencia asignada)`)
  console.log(`    ADMIN_SA   elena@staff.test         · ${TEST_PASSWORD}   (staff de plataforma; puede crear comunidades)`)
  console.log(`\n  Elena no es miembro de A ni de B. Su poder es dar de alta comunidades, no`)
  console.log(`  leer las que ya hay: si pide la comunidad de Ana recibe un 403. Al crear una`)
  console.log(`  desde la API entra en ella como ADMIN.\n`)
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
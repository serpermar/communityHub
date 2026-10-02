// ---------------------------------------------------------------------------
// Singleton de Prisma Client.
//
// El orden de imports es lo unico que importa en Prisma v6: DATABASE_URL se
// resuelve cuando se lee el esquema, y .env se carga al importar este modulo.
// Por eso `import 'dotenv/config'` va antes que `import ... prisma/client`.
//
// Una sola instancia en produccion. En desarrollo, tsx watch recarga el modulo
// en cada cambio y crearia un pool nuevo por recarga, agotando las conexiones
// de Supabase hasta el error P1001 o P2024. El globalThis lo evita.
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
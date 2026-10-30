# 🏘️ CommunityHub

Plataforma integral para la gestión de comunidades de vecinos. Centraliza la administración de comunidades y miembros, incidencias, reservas de zonas comunes, avisos, documentos, finanzas, votaciones y comunicaciones en una única aplicación.

El proyecto utiliza una arquitectura basada en **Node.js, TypeScript, Express, React, PostgreSQL, Supabase y Prisma**, con aislamiento de datos entre comunidades mediante **Row Level Security (RLS)**. También incorpora funcionalidades de IA, un servidor MCP y agentes de desarrollo.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)

---

## 📑 Contenido

- [Stack tecnológico](#-stack-tecnológico)
- [Funcionalidades](#-funcionalidades)
- [Arquitectura y estructura](#-arquitectura-y-estructura)
- [Requisitos previos](#-requisitos-previos)
- [Instalación](#-instalación)
- [Configuración de Supabase y PostgreSQL](#-configuración-de-supabase-y-postgresql)
- [Aplicación de los scripts SQL](#-aplicación-de-los-scripts-sql)
- [Configuración de variables de entorno](#-configuración-de-variables-de-entorno)
- [Arrancar el proyecto](#-arrancar-el-proyecto)
- [Seguridad y aislamiento RLS](#-seguridad-y-aislamiento-rls)
- [IA, MCP y agentes](#-ia-mcp-y-agentes)
- [Tests y verificaciones](#-tests-y-verificaciones)
- [Solución de problemas](#-solución-de-problemas)
- [Estado del proyecto](#-estado-del-proyecto)
- [Documentación adicional](#-documentación-adicional)
- [Contribuir](#-contribuir)

---

## 🧰 Stack tecnológico

| Área | Tecnologías |
|---|---|
| Backend | Node.js 20+, TypeScript, Express |
| ORM | Prisma |
| Base de datos | PostgreSQL mediante Supabase |
| Seguridad de datos | Row Level Security (RLS) |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, React Router |
| Autenticación | JWT, Refresh Tokens y hash de contraseñas con Argon2id |
| Testing | Vitest y Playwright |
| IA | Chat con streaming SSE, herramientas y clasificación |
| Integración con agentes | Servidor MCP (HTTP y stdio), skills y agentes CLI |

## ✨ Funcionalidades

- **Autenticación y cuentas:** registro, inicio de sesión, renovación de sesión y gestión de perfil.
- **Comunidades:** creación, configuración y administración de comunidades.
- **Miembros:** invitaciones, gestión de miembros, roles y estados.
- **Incidencias:** registro, seguimiento y gestión de incidencias.
- **Zonas comunes y reservas:** administración de espacios, disponibilidad, reservas y cancelaciones.
- **Avisos:** publicación y consulta de comunicaciones según permisos.
- **Documentos:** almacenamiento privado, control de acceso y enlaces firmados.
- **Finanzas:** gastos, facturas, pagos y resúmenes para usuarios autorizados.
- **Votaciones:** creación y ciclo de vida de votaciones, emisión de votos y recuento.
- **Dashboard y notificaciones:** información resumida y notificaciones personales.
- **Integraciones externas:** meteorología con Open-Meteo y geocodificación/mapas con Photon.
- **IA:** chat con streaming SSE, herramientas, clasificación y borradores sujetos a confirmación.
- **MCP y agentes:** servidor MCP de solo lectura, skills y agentes de desarrollo ejecutables desde CLI.

---

## 🏗️ Arquitectura y estructura

La estructura principal del repositorio es:

```text
communityHub/
├── backend/
│   ├── prisma/                 # Schema Prisma, seed y utilidades de base de datos
│   └── src/
│       ├── auth/
│       ├── communities/
│       ├── members/
│       ├── incidents/
│       ├── common-areas/
│       ├── reservations/
│       ├── announcements/
│       ├── documents/
│       ├── finance/
│       ├── voting/
│       ├── ai/
│       ├── integrations/
│       ├── dashboard/
│       ├── notifications/
│       ├── mcp/
│       └── agents/
├── frontend/
│   └── src/                    # Aplicación React: páginas, componentes y hooks
├── supabase/
│   └── sql/                    # Scripts SQL de esquema, RLS, módulos y Storage
├── agents/                     # Definiciones de agentes
├── skills/                     # Skills del proyecto
└── docs/                       # Documentación adicional
```

> La estructura muestra los directorios principales y no pretende enumerar todos los archivos del proyecto.

---

## 🛠️ Requisitos previos

Antes de empezar, instala:

- **Node.js 20 o superior:** [nodejs.org](https://nodejs.org/)
- **npm**, incluido con Node.js.
- **Git:** [git-scm.com](https://git-scm.com/)
- **Una cuenta de Supabase:** [supabase.com](https://supabase.com/)

Comprueba que las herramientas están disponibles:

```bash
node --version
npm --version
git --version
```

También necesitarás acceso al proyecto de Supabase y permisos para configurar su base de datos.

---

## 🚀 Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/serpermar/communityHub.git
cd communityHub
```

### 2. Preparar el backend

```bash
cd backend
npm install
```

Crea el archivo de variables de entorno a partir de la plantilla:

**PowerShell (Windows):**

```powershell
Copy-Item .env.example .env
```

**Linux / macOS:**

```bash
cp .env.example .env
```

Edita `backend/.env` y completa las variables necesarias. No compartas este archivo ni lo subas al repositorio.

### 3. Preparar el frontend

Desde la raíz del repositorio:

```bash
cd frontend
npm install
```

El frontend utiliza Vite y se ejecuta, por defecto, en `http://localhost:5173`.

---

## ☁️ Configuración de Supabase y PostgreSQL

### 1. Crear el proyecto

1. Accede a [Supabase](https://supabase.com/) y crea un proyecto.
2. Abre la configuración del proyecto.
3. Ten a mano el **Project URL** y la clave **service_role** desde la sección de API.
4. Obtén también los datos de conexión a PostgreSQL desde la opción **Connect**, seleccionando el modo **Session pooler** cuando corresponda.

La clave `service_role` tiene privilegios elevados: debe permanecer exclusivamente en el backend y nunca debe incluirse en el código del frontend, en el repositorio ni en capturas o mensajes públicos. El frontend de este proyecto se comunica con el backend; no necesita recibir esa clave.

### 2. Roles de conexión

El proyecto utiliza dos conexiones de base de datos con responsabilidades distintas:

| Variable | Usuario | Uso |
|---|---|---|
| `DATABASE_URL` | `app_runtime` | Conexión utilizada por Prisma durante el funcionamiento normal de la aplicación. Está sujeta a RLS. |
| `MIGRATION_DATABASE_URL` | `postgres` | Operaciones de configuración, scripts SQL, introspección de Prisma y tareas que necesitan permisos administrativos. |

**No intercambies estas conexiones.** La aplicación debe utilizar `app_runtime` para que las políticas RLS se apliquen durante las peticiones.

### 3. Crear la contraseña de `app_runtime`

El script `02_rls.sql` crea el rol `app_runtime` sin permiso de inicio de sesión. Una vez creado, establece una contraseña desde el SQL Editor de Supabase:

```sql
alter role app_runtime with login password 'UNA_CONTRASENA_LARGA_Y_ALEATORIA';
```

Utiliza una contraseña propia, segura y diferente de los ejemplos de esta documentación.

### 4. Formato de las URLs

Las conexiones del ejemplo utilizan el Session pooler de Supabase. Sustituye los valores de ejemplo por los datos reales de tu proyecto:

```dotenv
DATABASE_URL="postgresql://app_runtime.TU_PROJECT_REF:TU_CONTRASENA@TU_HOST_POOLER:5432/postgres?sslmode=require"

MIGRATION_DATABASE_URL="postgresql://postgres.TU_PROJECT_REF:TU_CONTRASENA@TU_HOST_POOLER:5432/postgres?sslmode=require"
```

Ten en cuenta:

- En el pooler, el usuario del rol personalizado sigue el formato `rol.PROJECT_REF`, por ejemplo `app_runtime.TU_PROJECT_REF`.
- El ejemplo utiliza el puerto `5432` del **Session pooler**. Copia el host y los datos exactos que proporciona Supabase en **Connect**; no deduzcas el host a partir de la región.
- `sslmode=require` exige una conexión cifrada.
- Si la contraseña contiene caracteres reservados para una URL, como `#`, `@`, `:`, `/`, `?` o `&`, codifícala para utilizarla dentro de la URL. Por ejemplo, `#` se representa como `%23`.
- La contraseña que estableces mediante SQL se escribe en su forma original, sin codificación URL.

---

## 🗄️ Aplicación de los scripts SQL

Los scripts se encuentran en `supabase/sql/` y deben ejecutarse en el orden indicado:

| Orden | Archivo | Descripción |
|---:|---|---|
| 1 | `01_schema.sql` | Extensiones, tipos ENUM, tablas, índices, claves foráneas y triggers. |
| 2 | `02_rls.sql` | Rol `app_runtime`, permisos, activación de RLS y políticas. |
| 3 | `02b_auth.sql` | Funciones de base de datos utilizadas por autenticación y refresh tokens. |
| 4 | `02c_communities.sql` | Funciones de gestión de comunidades. |
| 5 | `02d_members.sql` | Funciones de gestión de miembros e invitaciones. |
| 6 | `02e_incidents.sql` | Funciones de incidencias. |
| 7 | `02f_common_areas.sql` | Funciones de zonas comunes. |
| 8 | `02g_reservations.sql` | Funciones de reservas. |
| 9 | `02h_announcements.sql` | Funciones de avisos. |
| 10 | `02i_documents.sql` | Funciones de documentos y control de acceso. |
| 11 | `02j_finance.sql` | Funciones de finanzas. |
| 12 | `03_storage.sql` | Buckets privados y políticas de Storage. |
| 13 | `04_verify.sql` | Comprobaciones de estructura, permisos, RLS y Storage. |

Los scripts están diseñados para poder volver a ejecutarse de forma segura en los casos contemplados por su implementación. Aun así, revisa siempre los errores que devuelva PostgreSQL antes de continuar.

### Opción A: SQL Editor de Supabase

Para una configuración inicial también puedes abrir **Dashboard → SQL Editor → New query**, pegar el contenido de cada script y ejecutarlos individualmente, respetando el orden de la tabla.

No continúes con el siguiente script si el anterior ha terminado con errores.

### Opción B: comando del backend

Desde la carpeta `backend`, ejecuta:

```bash
npm run db:apply
```

Este comando aplica los doce scripts de configuración, desde `01_schema.sql` hasta `03_storage.sql`.

Para aplicar también el script de comprobación:

```bash
npm run db:apply -- --verify
```

Si el argumento `--verify` no se transmite correctamente desde tu terminal, ejecuta directamente:

```bash
npx tsx prisma/apply-sql.ts --verify
```

Estos comandos necesitan `MIGRATION_DATABASE_URL`, que debe apuntar a la conexión administrativa `postgres`.

### Orden de ejecución y dependencias

El orden no es arbitrario:

1. `01_schema.sql` crea las tablas y los tipos que necesitan los demás scripts.
2. `02_rls.sql` crea el rol y las políticas de seguridad sobre esas tablas.
3. `02b_auth.sql` crea las funciones necesarias para los procesos de autenticación.
4. Los scripts `02c` a `02j` incorporan las funciones de cada módulo.
5. `03_storage.sql` configura los buckets y sus políticas.
6. `04_verify.sql` comprueba el resultado.

Si ejecutas `02_rls.sql` antes de `01_schema.sql`, puedes obtener un error como `relation "users" does not exist`. En ese caso, corrige el orden y vuelve a ejecutar los scripts necesarios.

---

## ⚙️ Configuración de variables de entorno

El archivo que debes editar es `backend/.env`. La plantilla `backend/.env.example` contiene la estructura y los comentarios de las variables previstas por el proyecto.

Como mínimo, revisa la configuración de:

- `DATABASE_URL`: conexión de runtime con `app_runtime`.
- `MIGRATION_DATABASE_URL`: conexión administrativa para migraciones y tareas de configuración.
- `JWT_SECRET`: secreto utilizado por la autenticación.
- Variables de Supabase necesarias para Storage, si utilizas el almacenamiento de Supabase.
- `STORAGE_DRIVER`: selecciona el controlador de almacenamiento configurado. El proyecto contempla `local` para trabajar sin bucket de Supabase.

No copies valores reales de credenciales en este README. Tampoco utilices las claves de ejemplo como valores de producción.

---

## ▶️ Arrancar el proyecto

Antes del primer arranque, asegúrate de haber configurado Supabase, aplicado los scripts SQL y completado `backend/.env`.

### 1. Sincronizar Prisma y preparar los datos

Desde `backend/`:

```bash
npx prisma db pull
npx prisma generate
npm run db:seed
```

- `prisma db pull` obtiene el esquema de la base de datos y actualiza `schema.prisma`.
- `prisma generate` genera Prisma Client.
- `db:seed` carga los datos de demostración y los objetos asociados que contempla el seed.

En este proyecto, el SQL es la fuente de verdad del esquema y Prisma se deriva de la base de datos. Por eso se ejecuta `db pull` antes de generar el cliente.

### 2. Arrancar el backend

En una terminal, desde `backend/`:

```bash
npm run dev
```

El backend estará disponible en:

```text
http://localhost:3000
```

### 3. Arrancar el frontend

Abre otra terminal y ejecuta:

```bash
cd frontend
npm run dev
```

La aplicación frontend estará disponible en:

```text
http://localhost:5173
```

Vite utiliza el proxy configurado para dirigir las peticiones `/api` al backend local.

---

## 🔒 Seguridad y aislamiento RLS

CommunityHub utiliza dos capas complementarias:

| Capa | Responsabilidad |
|---|---|
| Lógica de aplicación | Validar reglas de negocio, horarios, capacidad y transiciones de estado. |
| PostgreSQL RLS | Aislar los datos de cada comunidad incluso si una consulta del backend omite un filtro. |

RLS no sustituye las validaciones de negocio. Por ejemplo, la aplicación debe comprobar que una reserva se realiza dentro del horario permitido; RLS se encarga de impedir que una comunidad acceda a los datos de otra.

### Contexto de cada petición

El backend establece el contexto del usuario y de la comunidad dentro de una transacción. La implementación se encuentra en `backend/src/context.ts`:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`;
  await tx.$executeRaw`select set_config('app.current_community_id', ${communityId}, true)`;

  return tx.incident.findMany();
});
```

El tercer parámetro de `set_config` es `true`, de modo que el contexto se limita a la transacción. Esto evita que los datos de contexto de una petición se mantengan al reutilizar una conexión del pool.

Las consultas que acceden a datos de una comunidad deben ejecutarse mediante el mecanismo `withContext` del proyecto. Consulta también las reglas específicas de escritura y registro descritas en [`SECURITY.md`](./SECURITY.md), si está disponible en la raíz del repositorio.

### Comprobar el aislamiento

El script `04_verify.sql` comprueba la configuración de las políticas, pero la verificación funcional del aislamiento requiere datos y una conexión que no tenga `BYPASSRLS`.

Para ello, utiliza el rol `app_runtime` y ejecuta los tests de integración:

```bash
cd backend
npm run db:seed
npm run test:integration
```

La suite de integración incluye comprobaciones para verificar que los datos de una comunidad no son accesibles desde el contexto de otra.

---

## 🤖 IA, MCP y agentes

El backend incluye funcionalidades de IA y herramientas para trabajar con agentes:

- **IA:** chat con streaming SSE, sesiones, herramientas, clasificación y gestión de borradores.
- **MCP:** servidor de solo lectura disponible mediante HTTP y stdio.
- **Skills:** conjunto de skills que describen capacidades y procedimientos del proyecto.
- **Agentes de desarrollo:** agentes CLI orientados a testing, seguridad y documentación.

### Servidor MCP

El servidor MCP se monta dentro del backend. Su ruta HTTP se configura mediante `MCP_HTTP_PATH` y, por defecto, utiliza:

```text
/api/v1/mcp
```

Su activación se controla mediante `MCP_ENABLED`.

Para utilizar el transporte stdio desde `backend/`:

**Linux / macOS:**

```bash
MCP_SESSION_TOKEN=<tokenMCP> npm run mcp:stdio
```

**PowerShell:**

```powershell
$env:MCP_SESSION_TOKEN = "<tokenMCP>"
npm run mcp:stdio
```

El token se obtiene mediante `POST /api/v1/mcp/sessions`.

### Agentes de desarrollo

Los agentes de desarrollo se ejecutan desde la CLI, en modo de solo lectura sobre el repositorio. Generan propuestas para que una persona las revise; no aplican cambios automáticamente.

Ejemplos desde `backend/`:

```bash
npm run agent -- testing "qué endpoints no tienen test de integración"
npm run agent -- security "revisa la validación del endpoint de incidencias"
```

Si no hay un proveedor LLM configurado, el comando muestra el prompt para utilizarlo manualmente.

---

## 🧪 Tests y verificaciones

Desde `backend/`, puedes ejecutar:

```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run check:db
```

| Comando | Finalidad |
|---|---|
| `npm run typecheck` | Comprueba los tipos de TypeScript. |
| `npm run test:unit` | Ejecuta tests unitarios sin necesitar la base de datos. |
| `npm run test:integration` | Ejecuta tests de integración contra Supabase. |
| `npm run check:db` | Comprueba la conexión, el rol y aspectos de la configuración RLS. |

Los tests de integración necesitan una base de datos configurada y accesible.

---

## 🛠️ Solución de problemas

| Síntoma | Causa probable | Qué comprobar |
|---|---|---|
| `relation "users" does not exist` | Los scripts se han ejecutado fuera de orden. | Ejecuta primero `01_schema.sql` y después los siguientes scripts. |
| `permission denied for schema public` | El rol de runtime no tiene los permisos esperados o no se ha configurado correctamente. | Revisa `02_rls.sql` y la activación de `app_runtime`. |
| `password authentication failed` | Credenciales incorrectas o actualización todavía no propagada por el pooler. | Comprueba la contraseña, la URL y espera unos segundos si acabas de cambiarla. |
| `Tenant or user not found` | El usuario del pooler no tiene el formato esperado. | Comprueba que el usuario personalizado incluye `.TU_PROJECT_REF`. |
| `must be owner of table` | Se está utilizando una conexión sin permisos administrativos para una operación de configuración. | Utiliza `MIGRATION_DATABASE_URL` con el usuario `postgres`. |
| `RLS incompleta` | Alguna tabla no tiene la configuración RLS esperada. | Vuelve a revisar y ejecutar `02_rls.sql`; después ejecuta `04_verify.sql`. |
| Error de conexión a PostgreSQL | URL, host, puerto, SSL o credenciales incorrectos. | Copia de nuevo los datos desde Supabase → Connect y revisa las dos URLs. |
| No aparecen datos de otra comunidad | El contexto de usuario/comunidad no se ha establecido o no corresponde. | Revisa el uso de `withContext` y los tests de aislamiento. |

---

## 📊 Estado del proyecto

El siguiente resumen recoge el estado descrito en la documentación técnica del proyecto:

| Módulo | Ubicación | Estado documentado |
|---|---|---|
| Esquema, RLS, autenticación SQL y Storage | `supabase/sql/` | Implementado y verificado |
| Esquema Prisma | `backend/prisma/` | Derivado mediante `prisma db pull` |
| Datos de demostración | `backend/prisma/seed.ts` | Implementados |
| Autenticación | `backend/src/auth/` | 7 endpoints |
| Comunidades | `backend/src/communities/` | 4 endpoints |
| Miembros e invitaciones | `backend/src/members/` | 7 endpoints |
| Incidencias | `backend/src/incidents/` | 8 endpoints |
| Zonas comunes | `backend/src/common-areas/` | 4 endpoints |
| Reservas | `backend/src/reservations/` | 6 endpoints |
| Avisos | `backend/src/announcements/` | 4 endpoints |
| Documentos | `backend/src/documents/` | 5 endpoints |
| Finanzas | `backend/src/finance/` | 9 endpoints |
| Votaciones | `backend/src/voting/` | 9 endpoints |
| IA | `backend/src/ai/` | 9 endpoints |
| Integraciones externas | `backend/src/integrations/` | 3 endpoints |
| Dashboard | `backend/src/dashboard/` | Endpoint de portada |
| Notificaciones | `backend/src/notifications/` | 4 endpoints |
| Frontend | `frontend/` | SPA con las vistas principales del proyecto |
| MCP, skills y agentes | `backend/src/mcp/`, `backend/src/agents/`, `skills/`, `agents/` | Servidor MCP, skills, agentes y CLI |

Las cifras y el estado reflejan la documentación facilitada para esta actualización; conviene revisarlos cuando se incorporen nuevos módulos o cambie el número de endpoints y tests.

---

## 📚 Documentación adicional

La documentación específica se encuentra en el directorio `docs/` y en los documentos de seguridad del repositorio.

- [`docs/API.md`](./docs/API.md) — documentación de la API y sus módulos.
- [`docs/AI-DEVELOPMENT.md`](./docs/AI-DEVELOPMENT.md) — desarrollo asistido por IA, MCP, skills y agentes.
- [`SECURITY.md`](./SECURITY.md) — criterios y decisiones de seguridad.

---

## 🤝 Contribuir

Las contribuciones pueden realizarse mediante Pull Requests:

1. Haz un fork del repositorio.
2. Crea una rama para tu cambio:

   ```bash
   git checkout -b feature/nueva-funcionalidad
   ```

3. Realiza los cambios y comprueba el proyecto.
4. Crea un commit:

   ```bash
   git add .
   git commit -m "Añade nueva funcionalidad"
   ```

5. Sube la rama:

   ```bash
   git push origin feature/nueva-funcionalidad
   ```

6. Abre un Pull Request describiendo los cambios.

Antes de enviar una contribución, ejecuta como mínimo:

```bash
npm run typecheck
npm run test:unit
```

Si el cambio afecta a la base de datos o a la integración entre módulos, ejecuta también los tests de integración.

---

## 📄 Licencia

Consulta el archivo de licencia del repositorio para conocer las condiciones de uso y distribución.

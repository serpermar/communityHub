# Guía paso a paso para navegar por el frontend de CommunityHub

Esta guía te ayudará a recorrer la aplicación CommunityHub desde el arranque hasta las secciones clave. Se basa en el estado actual del código tras las mejoras 1–31 implementadas (incluye tema claro/oscuro, carga diferida por ruta con precarga, filtros en la URL, selector de comandos, estados de carga accesibles y la pantalla de cuenta).

## 1. Arranque de la aplicación

CommunityHub es una SPA (React + Vite) con backend Node/Express y Supabase (DB + RLS). Para desarrollo local:

```bash
# Frontend (Vite, puerto 5173)
cd frontend
npm run dev

# Backend (API REST, puerto 3000)
cd backend
npm run dev

# Base de datos (seed opcional)
cd backend
npm run db:seed
```

La configuración de desarrollo redirige `/api` a `http://localhost:3000` (proxy de Vite), por lo que el frontend corre en `http://localhost:5173` y habla con el backend en `3000`.

---

## 2. Autenticación y acceso inicial

1. Abre `http://localhost:5173` en el navegador.
2. Serás redirigido a `/login` (layout de autenticación `AuthLayout`).
3. Inicia sesión con una cuenta de seed. Las más comunes son:
   - `ana@comunidad-a.test` — rol `ADMIN` (comunidad A)
   - `luis@comunidad-a.test` — rol `PRESIDENT` (comunidad A)
   - `marta@comunidad-a.test` — rol `NEIGHBOR` (comunidad A)
   - `carlos@comunidad-b.test` — miembro de comunidad B
   - `manolo@proveedor.test` — rol `PROVIDER`
   - `elena@staff.test` — `ADMIN_SA` (administrador de plataforma)
4. Contraseña por defecto: `CommunityHub2026` (puede sobreescribirse con `E2E_PASSWORD`).
5. Tras iniciar sesión, la app te lleva a tu comunidad activa (`/c/:communityId/dashboard`).

> El tema (claro/oscuro) se guarda en `localStorage` (`communityhub.theme`) y aplica la clase `dark` al `<html>`. Puedes cambiarlo desde el icono de sol/luna en la cabecera.

---

## 3. Estructura general de la interfaz

Una vez dentro de una comunidad, la app usa `AppLayout`:

- **Cabecera superior**: logo, selector de comunidad (con **búsqueda**), **buscador de secciones** (Cmd/Ctrl+K), botón de tema, campana de notificaciones, nombre de usuario (enlaza a **Mi cuenta**) y botón "Salir".
- **Barra lateral (desktop)**: navegación principal con **icono por módulo**, disponible según tu rol. Se puede **contraer/expandir** (el estado se recuerda en `localStorage`).
- **Breadcrumbs**: bajo la cabecera se muestra la ruta de la sección activa (oculto en el panel).
- **Menú móvil (hamburguesa)**: aparece en pantallas `md:hidden`. Se abre/cierra desde el icono de hamburguesa y se cierra automáticamente al navegar.
- **Área principal**: ruta activa (`Outlet`) con fondo `slate-50`/`dark:slate-950`. Al cargar una ruta nueva se muestra un *skeleton*; si un componente falla al renderizar, un `ErrorBoundary` evita la pantalla en blanco. Al cambiar de ruta, el contenido entra con una transición suave (`motion-safe:fade-in-up`), desactivada si el sistema pide movimiento reducido.
- **Notificaciones globales**: el centro de notificaciones es `/notifications` (accesible desde la campana → "Ver todas").
- **Accesibilidad**: primer elemento enfocable es un *skip link* ("Saltar al contenido") que salta a `#main`.

---

## 4. Módulos de navegación (orden y visibilidad)

| Enlace | Ruta | Roles visibles | Qué encuentras |
|---|---|---|---|
| Panel | `/c/:id/dashboard` | Todos los miembros | Resumen de comunidad, incidencias abiertas/críticas, reservas, avisos, votaciones y **tendencia de gastos por mes** (cuando hay finanzas disponibles para ADMIN). |
| Incidencias | `/c/:id/incidents` | Todos | Listado, creación (con **asistente IA opcional**) y detalle de incidencias. |
| Zonas comunes | `/c/:id/common-areas` | Todos | Gestión de zonas comunes. |
| Reservas | `/c/:id/reservations` | Todos | **Vista Lista** y **Vista Calendario semanal**. El calendario carga 7 días en paralelo (API filtra por fecha individual). |
| Avisos | `/c/:id/announcements` | Todos | Anuncios de la comunidad. |
| Documentos | `/c/:id/documents` | Todos | Biblioteca documental. |
| Finanzas | `/c/:id/finance` | Solo `ADMIN` | Gastos, facturas, importes. |
| Votaciones | `/c/:id/votes` | `ADMIN`, `PRESIDENT`, `NEIGHBOR` | Votaciones y resultados. |
| Asistente IA | `/c/:id/assistant` | Todos | Chat con el asistente IA. Muestra **llamadas a herramientas** (`tool_calls`) y **citas/fuentes** (`citations`) durante la respuesta. |
| Miembros | `/c/:id/members` | Todos | Listado de miembros con **búsqueda en tiempo real** y **paginación cliente**. Invitaciones disponibles para `ADMIN`. |
| Ajustes | `/c/:id/settings` | Solo `ADMIN` | Configuración de comunidad. |
| Mi cuenta | `/account` | Todos (ruta global, fuera de una comunidad) | Editar perfil (`fullName`, `phone`), cambiar contraseña y ver/revocar sesiones. Se abre desde el nombre de usuario en la cabecera. |

---

## 5. Flujos destacados

### 5.1 Crear incidencia con asistente IA (punto 4)
1. Ve a **Incidencias → Nueva incidencia** (`/c/:id/incidents/new`).
2. En el bloque "Asistente IA (opcional)", describe el problema (mín. 10 caracteres). Ej.: _"El ascensor del portal B lleva dos días parado entre planta 1 y 2"_.
3. Pulsa **Analizar con IA**. El frontend crea un **borrador** (`/ai/incidents/drafts`) que devuelve una propuesta (título, categoría, prioridad, confianza y si requiere revisión humana).
4. La propuesta se precarga automáticamente en el formulario. Puedes revisarla, ajustarla o descartar el borrador.
5. Pulsa **Confirmar incidencia** para crearla desde el borrador (trazabilidad `createdVia`/reglas del backend). Si no usaste IA, pulsa **Crear incidencia** directamente.

### 5.2 Asistente IA con herramientas y citas (punto 3)
1. Ve a **Asistente IA** (`/c/:id/assistant`).
2. Escribe una pregunta relacionada con la comunidad (incidencias, reservas, avisos, votaciones...).
3. Durante la respuesta en streaming verás:
   - **Tool calls**: chips "🔧 ..." indicando qué herramienta interna se ha ejecutado (p.ej. consultar incidencias/reservas).
   - **Fuentes**: enlaces bajo "Fuentes" para saltar directamente a la entidad citada (incidencia/votación) o al módulo correspondiente.
4. Las conversaciones se guardan por sesión (izquierda). Puedes crear nueva conversación, abrir una anterior o eliminarla.

### 5.3 Reservas: Lista vs Calendario (punto 7)
1. Ve a **Reservas** (`/c/:id/reservations`).
2. Usa el selector superior (Lista / Calendario) para cambiar de vista.
3. **Calendario semanal**: muestra 7 días con sus reservas. Los botones "Semana anterior/siguiente" navegan por semanas. Cada celda agrupa reservas del día (hora, zona, estado).
   - **Importante**: la API solo filtra por una fecha. Por ello el calendario solicita los 7 días en paralelo (no carga un mes completo). Esto cumple la restricción del backend sin modificar SQL.
4. **Lista**: mantiene filtros por estado y fecha, con paginación.

### 5.4 Miembros: búsqueda y paginación (punto 7)
1. Ve a **Miembros** (`/c/:id/members`).
2. Usa el buscador "Buscar por nombre, correo o vivienda…" (filtrado en tiempo real con debounce de 250ms).
3. La tabla está paginada cliente-side (10 elementos por página). Los controles de paginación aparecen cuando hay más de una página.
   - **Importante**: `app_list_community_members` devuelve todo el listado sin paginación; por eso la búsqueda y paginación se hacen en el cliente (no se modifica SQL).

### 5.5 Notificaciones (punto 5)
1. Pulsa la **campana** en la cabecera. Muestra hasta 10 notificaciones recientes, badge con no-leídas y acciones "Marcar todas" / "Ver todas".
2. Pulsa **Ver todas** para ir a `/notifications`. Allí tienes:
   - Filtro **Todas / Sin leer**
   - Lista paginada (20 por página)
   - Botón "Marcar todas" para marcar como leídas
   - Al abrir una notificación no leída, se marca automáticamente y navega al destino correspondiente (incidencia, votación, aviso, reserva...).

### 5.6 Dashboard con tendencia (punto 8)
1. Ve a **Panel** (`/c/:id/dashboard`).
2. Si eres `ADMIN`, verás una tarjeta **"Tendencia de gastos por mes"** (`LineChart`) con `finance.expensesByMonth`. También aparecen totales de finanzas (gasto total, pendiente, vencidas).
3. Gráficos existentes: "Incidencias por categoría" (barras) y "Reservas por mes" (barras). Todos **adaptan sus colores al tema** (claro/oscuro) mediante `useChartColors` y ofrecen una **tabla de datos oculta (`sr-only`)** como alternativa accesible.

### 5.7 Mi cuenta: perfil y contraseña (mejoras 9–13)
1. Abre **Mi cuenta** (`/account`) desde el nombre de usuario en la cabecera.
2. **Perfil**: edita nombre y teléfono y pulsa **Guardar**. Dejar el teléfono vacío lo borra. Se confirma con un *toast*.
3. **Contraseña**: introduce la **actual** y la **nueva** (mínimo 12 caracteres) y repítela. Si la actual no coincide, el error aparece en el propio campo (*no* es un mensaje genérico).
4. Al cambiar la contraseña, el backend **revoca las demás sesiones**; la tuya sigue activa. La tabla de **sesiones** se refresca y puedes revocar cualquiera con `DELETE /auth/sessions/:id`.

---

## 6. Tema claro/oscuro (punto 8)
- **Toggle**: icono sol/luna en cabecera (cambia entre `light`/`dark`). También aparece en las pantallas de login/registro.
- **Persistencia**: `localStorage.getItem('communityhub.theme')`.
- **Preferencias del sistema**: si no hay valor, usa `prefers-color-scheme`.
- **Aplicación**: añade clase `dark` a `<html>`; colores base definidos en `src/index.css` (`body` con `dark:bg-slate-950 dark:text-slate-100`).
- **Sin destello (FOUC)**: un script *inline* en `index.html` aplica el tema **antes** del primer pintado (misma clave y misma lógica que `ThemeContext`), de modo que no se ve el salto claro→oscuro.
- **Movimiento reducido**: `index.css` respeta `@media (prefers-reduced-motion: reduce)`.
- **Cobertura**: las 18 páginas y los componentes compartidos (Button, Badge/Card/Modal, Feedback, Form, Table, Toast) tienen variantes `dark:` aplicadas.

---

## 7. Acciones rápidas desde teclado/UX
- **Buscador de secciones (Cmd/Ctrl+K)**: pulsa `Cmd/Ctrl + K` (o el botón de la cabecera) para abrir un selector; escribe para filtrar, `↑`/`↓` para moverte y `Enter` para ir a la sección. Ofrece los mismos destinos y respeta los mismos permisos que la barra lateral.
- **Menú móvil**: abre/cierra con hamburguesa; se cierra al pulsar fuera o al navegar.
- **Selector de comunidad**: es un **combobox con búsqueda**; escribe para filtrar, `↑`/`↓` para moverte, `Enter` para elegir y `Escape` para cerrar. Al elegir redirige a `/c/:id/dashboard`.
- **Barra lateral**: se **contrae/expande** con el botón de la cabecera de la barra; la preferencia persiste entre sesiones. Al pasar el ratón o enfocar un enlace, su página se **precarga** para que la navegación no muestre el *fallback*.
- **Campana**: clic abre desplegable; clic fuera o `Escape` lo cierra (devolviendo el foco a la campana).
- **Búsqueda de miembros**: escribe y el listado se filtra automáticamente (sin petición extra a API).
- **Paginación**: además de Anterior/Siguiente hay **números de página** y un selector de **tamaño de página** (10/20/50) donde la lista lo soporta.
- **Filtros en la URL**: los filtros, la página y la búsqueda de las pantallas de listado se guardan en la dirección (`?status=OPEN&page=2`). Puedes recargar o compartir el enlace sin perder el contexto. Las pestañas de finanzas también (`?tab=invoices`).
- **Ordenar tablas**: las tablas con orden muestran cabeceras pulsables (nombre, fecha…). El primer clic ordena ascendente, el segundo descendente y el tercero quita el orden.
- **Cambios sin guardar**: los formularios de edición (ajustes de comunidad, perfil) avisan antes de salir si hay cambios sin guardar. Los errores de validación aparecen al tocar/blur el campo, no nada más entrar.
- **Estados vacíos**: cuando una lista está vacía, el mensaje incluye una **ilustración** y, si tu rol lo permite, un **botón de acción** contextual ("Nueva incidencia", "Subir documento", etc.).

---

## 8. Notas técnicas útiles (para desarrollo)
- **No commitear**: las instrucciones indican no hacer commits (decisión del usuario).
- **Docker prohibido**: no usar contenedores para estas tareas.
- **Rutas protegidas**: requieren sesión válida; sin comunidad activa se muestra CTA para canjear invitación o crear comunidad (solo `ADMIN_SA`).
- **Toasts**: `useToast()` disponible globalmente (ToastProvider). Se usa en acciones con éxito (crear/actualizar/marcar leído, guardar perfil...). Los avisos se **anuncian a lectores de pantalla** (`role="alert"`/`"status"`), tienen **botón de cierre** y autocierre de 4 s que se **pausa** al pasar el ratón o el foco.
- **Diálogos de confirmación**: las acciones destructivas (borrar documento, aviso o gasto; cerrar sesión) usan `ConfirmDialog` (sobre el `Modal` accesible) en vez de `window.confirm`.
- **Cabeceras de página**: `PageHeader` (título/descripción/acciones) da estructura homogénea a todas las pantallas.
- **i18n ligero**: textos del shell (nav, app, common, notifications, toast) viven en `src/i18n/es.ts` (`t(path)`); preparado para añadir otros idiomas.
- **Carga diferida**: cada ruta se importa con `React.lazy` y Vite parte el bundle por vendors (`vendor-react`, `vendor-charts`, `vendor-forms`); al navegar se ve un *skeleton* hasta que llega el chunk. Los enlaces del sidebar y el selector de comandos **precargan** el chunk al pasar el ratón o enfocar (`routes/prefetch.ts`), y el chunk de gráficos (Recharts) solo se carga con el dashboard.
- **Análisis de bundle**: `npm run analyze` genera `dist/stats.html` (treemap de `rollup-plugin-visualizer`) para revisar el tamaño de cada chunk; el modo normal no lo genera.
- **Consistencia visual**: los colores de estado (incidencia, reserva, voto, factura, miembro, aviso) salen de un único mapa en `components/ui/status.ts` sobre tokens semánticos de Tailwind (`success`/`warning`/`danger`/`info`); no se elige el color a mano por página. El anillo de foco es único (clase global en `index.css`) y los controles de formulario comparten `CONTROL_BASE`.
- **Datos en la URL**: `useUrlFilters` sincroniza filtros/página/búsqueda con la barra de direcciones (modo `replace`).
- **Cambios sin guardar**: `useUnsavedChanges` combina `beforeunload` (cerrar/recargar) con `useBlocker` (navegación interna) y degrada con seguridad si la página no está bajo un *data router*.
- **Accesibilidad**: `Modal` con *focus trap*, foco inicial, retorno de foco y cierre con Escape; pestañas `Tabs` con *roving tabindex*; combobox de comunidad con `aria-activedescendant`; un solo `h1` por página; *skip link* a `#main`; `ErrorBoundary` en la raíz del router. `eslint-plugin-jsx-a11y` no se añade porque su última versión no soporta ESLint 10.
- **TypeScript estricto**: `tsc --noEmit` pasa. ESLint y Prettier OK.
- **Tests frontend**: 31 tests pasan (`ApiError`, `format`, `LoginPage`, `links` de notificaciones, `useDebouncedValue`, `Display`/Modal y `AccountPage`).

---

## 9. Puntos de entrada recomendados para explorar
1. **Login → Dashboard**: flujo completo de autenticación + resumen.
2. **Incidencias → Nueva**: prueba el asistente IA (flujo borrador → confirmación).
3. **Reservas → Calendario**: visualización semanal con navegación.
4. **Miembros**: busca por nombre/correo y observa paginación cliente.
5. **Asistente IA**: haz una pregunta y observa tool calls + citas en la respuesta.
6. **Notificaciones**: abre la campana, ve "Ver todas", marca algunas como leídas.
7. **Dashboard**: revisa la tendencia de gastos (si hay rol ADMIN en comunidad con finanzas).
8. **Toggle tema**: alterna claro/oscuro en distintas páginas para verificar estilos.
9. **Mi cuenta**: edita el perfil y cambia la contraseña; observa cómo se revocan las demás sesiones.
10. **Cmd/Ctrl+K**: abre el buscador de secciones y salta a cualquier módulo con el teclado.
11. **Filtros en la URL**: filtra incidencias, recarga la página y comprueba que el filtro se mantiene en la dirección.

¡Listo! Con esta guía puedes recorrer CommunityHub de principio a fin de forma ordenada.

# Spec 15 â€” Frontend (SPA React)

> **Estado: IMPLEMENTED â€” implementada (2026-10-16).** Bloque 15, el
> primero y Ãºnico de frontend. Decisiones `FE-1`â€¦`FE-31` cerradas: ver Â§2 y Â§12
> (`FE-16`â€¦`FE-31` son revisiones posteriores de mejoras de UX, tema, rendimiento,
> consistencia visual, accesibilidad y detalle).
> Este documento define **la SPA**
> que consume el backend ya terminado (bloques `01`â€“`14`) y, con Ã©l, **la
> plantilla de arquitectura de features** que el enunciado pide (Â§3 del PROMPT).
> **Fase:** 15 (frontend). Precedida de `01-authentication` â€¦ `14-notifications`
> (backend completo). Sucedida por el servidor MCP y los agentes de desarrollo
> (fuera de alcance aquÃ­).
> **Backend que consume:** la API REST de `/api/v1` documentada en
> [`docs/API.md`](../docs/API.md). **No se toca el backend salvo lo mÃ­nimo**:
> `CORS_ORIGINS` ya apunta a `http://localhost:5173` (Vite) por defecto y en
> producciÃ³n la SPA se sirve en el mismo origen (o tras un proxy) para que la
> cookie de refresh `sameSite=strict` viaje.
> **Backend nuevo:** `frontend/` (paquete nuevo; no existe todavÃ­a).
> **Fuera de alcance:** el servidor MCP, los agentes de desarrollo, el envÃ­o real
> de notificaciones (email/push/websocket) y el renderizado en servidor (SSR). Ver
> Â§16.
>
> La decisiÃ³n de fondo es **FE-1: el backend es el Ãºnico gatekeeper** y el
> frontend **solo refleja permisos para UX**; y **FE-2: disponibilidad primero**,
> es decir, la SPA no se acopla a ningÃºn proveedor externo ni a la IA â€” cada
> feature degrada a un estado vacÃ­o/`null` cuando el backend dice que no hay dato
> (p. ej. meteorologÃ­a o `finance: null` para un rol sin permiso).

---

## 1. Objetivo

Que un vecino pueda **usar CommunityHub desde el navegador**: entrar, elegir su
comunidad y, en pantallas por feature, ver y operar las incidencias, las reservas
de zonas comunes, los avisos, los documentos, las finanzas, las votaciones, la
asistencia de IA, el dashboard y la campana de notificaciones â€” **sin que el
frontend implemente autorizaciÃ³n propia**: cada botÃ³n que se oculta o se
deshabilita es cosmÃ©tico, y quien decide de verdad es el backend.

El objetivo de arquitectura es que `frontend/` demuestre la organizaciÃ³n por
**features** (una carpeta por dominio, con sus `api`, `hooks`, `components`,
`pages`, `schemas` y `types`) sobre una base compartida pequeÃ±a (`components/`,
`layouts/`, `services/`, `context/`, `hooks/`, `types/`, `utils/`, `routes/`).

---

## 2. Decisiones

| #           | DecisiÃ³n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Alternativa descartada                                                       | Motivo                                                                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **FE-1**    | **El backend es el Ãºnico gatekeeper** (ARCHITECTURE Â§1.2). El frontend **oculta o deshabilita** acciones por rol, pero **nunca** decide si una operaciÃ³n es vÃ¡lida: toda mutaciÃ³n va al API y acepta su `403`/`409`/`400`                                                                                                                                                                                                                                                                                                                                      | Bloquear en el cliente y no llegar al backend                                | El enunciado Â§9 lo dice literal: "nunca confiar Ãºnicamente en ocultar botones en React". Una regla duplicada en el cliente es una segunda copia que se desincroniza                                    |
| **FE-2**    | **La SPA no se acopla a proveedores externos ni a la IA**: meteorologÃ­a, mapa, geocodificado y asistente llegan por la API; si el backend devuelve `null` o un error de proveedor, la feature muestra un estado degradado, no un error de pantalla                                                                                                                                                                                                                                                                                                             | Llamar a Open-Meteo/Photon desde el navegador                                | Las claves no pueden llegar al cliente y el backend ya es un proxy con cachÃ© (ARCHITECTURE Â§8). El frontend solo pinta el DTO                                                                          |
| **FE-2bis** | **Token de acceso en memoria** (`AuthContext`), **refresh token en cookie `httpOnly`** que gestiona el backend; el cliente **nunca** lee ni escribe el refresh                                                                                                                                                                                                                                                                                                                                                                                                 | `localStorage` para el access token                                          | `docs/SECURITY.md` y ARCHITECTURE Â§7: el access token en memoria no es alcanzable por XSS; el refresh vive en cookie inaccesible a JS                                                                  |
| **FE-3**    | **Un Ãºnico cliente axios** con dos interceptores: uno adjunta `Authorization: Bearer`, y otro, ante un `401`, hace **un** `POST /api/v1/auth/refresh` y reintenta **una** vez; si el refresh falla, cierra sesiÃ³n                                                                                                                                                                                                                                                                                                                                              | LÃ³gica de refresco repartida por feature                                     | Un solo sitio donde vive la sesiÃ³n evita N copias del mismo bug. Con peticiones concurrentes, el interceptor **encola** las que llegan mientras el refresh estÃ¡ en curso (una sola llamada de refresh) |
| **FE-4**    | **Mismo origen**: en desarrollo, la SPA usa el **proxy de Vite** (`/api` â†’ `http://localhost:3000`); en producciÃ³n se sirve desde el mismo origen que la API (o tras un proxy que preserve la ruta `/api`)                                                                                                                                                                                                                                                                                                                                                     | CORS Â«de verdadÂ» con la cookie cross-site                                    | La cookie de refresh es `sameSite=strict` y `path=/api/v1/auth` (ARCHITECTURE Â§7, env `REFRESH_COOKIE_*`). Con el proxy, la cookie es _same-site_ tambiÃ©n en dev                                       |
| **FE-5**    | Enrutado con **React Router** (data router) + `<ProtectedRoute>` y `<RoleGate>`. La raÃ­z `/` redirige segÃºn sesiÃ³n y comunidad activa                                                                                                                                                                                                                                                                                                                                                                                                                          | Guardas por pantalla duplicadas                                              | Un route tree con guards declarativos es una sola fuente de verdad del acceso visual                                                                                                                   |
| **FE-6**    | **Estado de servidor con hooks propios** (`useAsync`/`useResource` + invalidaciÃ³n manual tras mutaciÃ³n), **sin** una librerÃ­a de cachÃ© de servidor (TanStack Query no estÃ¡ en el stack del enunciado). **Context** solo para `Auth` y `Community` activa                                                                                                                                                                                                                                                                                                       | Meter TanStack Query                                                         | El enunciado fija el stack (Â§3); aÃ±adir una dependencia grande para 14 features es scope creep. Los hooks propios bastan y no ocultan nada                                                             |
| **FE-7**    | Formularios con **React Hook Form + `zodResolver`**. Los esquemas **se copian** del backend a `features/*/schemas` (no se importa el paquete del backend), con los **mismos mensajes en espaÃ±ol**                                                                                                                                                                                                                                                                                                                                                              | Compartir los `zod` del backend por un paquete comÃºn                         | El enunciado pide el frontend como paquete aparte; un `.ts` compartido crearÃ­a acoplamiento de build entre dos apps. La spec del backend es la fuente; el frontend la refleja                          |
| **FE-8**    | Estilos con **Tailwind CSS**. Componentes de UI propios y accesibles (`Button`, `Input`, `Select`, `Modal`, `Table`, `EmptyState`, `Toast`, `Spinner`) en `components/ui`                                                                                                                                                                                                                                                                                                                                                                                      | Una librerÃ­a de componentes                                                  | El enunciado pide Tailwind; una librerÃ­a extra es otra dependencia y otra API que aprender                                                                                                             |
| **FE-9**    | **Recharts** solo en el **dashboard** (series de incidencias, reservas y gastos). El resto de pantallas no trae librerÃ­a de grÃ¡ficos                                                                                                                                                                                                                                                                                                                                                                                                                           | GrÃ¡ficos ad hoc                                                              | El enunciado pide Recharts para estadÃ­sticas; usarlo solo donde hay series evita peso en el resto                                                                                                      |
| **FE-10**   | **UI en espaÃ±ol**, sin framework de i18n. Los textos son literales                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `react-i18next`                                                              | El producto es monolingÃ¼e; un framework de i18n ahora es complejidad sin uso                                                                                                                           |
| **FE-11**   | El **envelope de error** del backend (`{ "error": { "code", "message", "details" } }`) se traduce a un tipo `ApiError` en el interceptor. Las pantallas muestran `message` y, si `code === 'VALIDATION_ERROR'`, mapean `details` a los campos del formulario                                                                                                                                                                                                                                                                                                   | Parsear el error en cada `catch`                                             | Un Ãºnico mapeo por cÃ³digo evita que cada pantalla reinvente el formato                                                                                                                                 |
| **FE-12**   | La **campana de notificaciones** sondea `unread-count` cada 60 s y **revalida al recuperar el foco** (`visibilitychange`), ademÃ¡s de en cada mutaciÃ³n relevante                                                                                                                                                                                                                                                                                                                                                                                                | WebSocket/SSE                                                                | `14-notifications.md` Â§16 deja el tiempo real fuera de alcance; un sondeo con revalidaciÃ³n por foco es suficiente y no abre un canal persistente                                                       |
| **FE-13**   | La **subida de documentos** va por `multipart/form-data` **a la API** (el backend valida y firma la _signed URL_); el cliente **nunca** habla con Storage                                                                                                                                                                                                                                                                                                                                                                                                      | Subir directo al bucket                                                      | El backend es el gatekeeper de ACL y de tipo/tamaÃ±o (spec 08). El cliente no debe tener credenciales de Storage                                                                                        |
| **FE-14**   | **Testing**: Vitest + React Testing Library + **MSW** para componentes e integraciÃ³n; **Playwright** para E2E con los 8 casos del enunciado (Â§18). Los componentes se prueban **con el backend mockeado**, nunca contra Supabase                                                                                                                                                                                                                                                                                                                               | E2E para todo                                                                | ARCHITECTURE Â§14: los tests de componente/integraciÃ³n con MSW son rÃ¡pidos y deterministas; el E2E se reserva para los flujos de extremo a extremo                                                      |
| **FE-15**   | **AdministraciÃ³n de plataforma** para `ADMIN_SA`: una pantalla mÃ­nima que **crea comunidades** (`POST /communities`) y muestra el resultado. No hay listado global ni ediciÃ³n de ajenas: el `ADMIN_SA` crea pero **no lee** lo que no pertenece (C-12)                                                                                                                                                                                                                                                                                                         | Un CRUD global de comunidades                                                | El backend no expone Â«listar todasÂ» ni administrar ajenas; la pantalla refleja lo Ãºnico que el backend permite                                                                                         |
| **FE-16**   | **Tema claro/oscuro con `class` de Tailwind** (`darkMode: 'class'`): la preferencia vive en `localStorage` (`communityhub.theme`), y si no hay, se toma `prefers-color-scheme`. La clase `dark` se pone en `<html>`                                                                                                                                                                                                                                                                                                                                            | Solo tema claro, o dos hojas CSS                                             | Tailwind ya estÃ¡ en el stack (FE-8); la variante `dark:` no aÃ±ade dependencias y evita duplicar estilos. El Â«huecoÂ» de Â§15 queda cerrado                                                               |
| **FE-17**   | **Code-splitting por ruta** con `React.lazy` + `Suspense` y `manualChunks` en Vite (`vendor-react`, `vendor-charts`, `vendor-forms`). El `RouteFallback` cubre la carga                                                                                                                                                                                                                                                                                                                                                                                        | Un Ãºnico bundle                                                              | Recharts pesa y solo lo usa el dashboard (FE-9); partirlo evita que la primera pintura cargue grÃ¡ficos que quizÃ¡ nadie abra                                                                            |
| **FE-18**   | **Estados de carga y error de primera clase**: `Skeleton`/`SkeletonList` en las listas, `ErrorBoundary` envolviendo el router, y `Modal` con _focus trap_, foco inicial y retorno, `aria-labelledby` y bloqueo de scroll. El shell tiene _skip link_ a `#main`                                                                                                                                                                                                                                                                                                 | Estados de carga mÃ­nimos y sin barreras                                      | Son los tres puntos donde una SPA se rompe en silencio (pantalla blanca, spinner infinito, modal que no se cierra con Escape). Ninguno depende del backend                                             |
| **FE-19**   | **Cuenta propia**: `PATCH /auth/me` (editar `fullName`/`phone`) y `POST /auth/change-password` (exige la actual y **revoca las demÃ¡s sesiones**). Cierra el hueco de Â§4.14                                                                                                                                                                                                                                                                                                                                                                                     | Dejar la ediciÃ³n de perfil fuera de alcance                                  | El backend ya expone ambos endpoints (spec 01 Â§5.5); la SPA los consume como cualquier otra feature, sin inventar contrato                                                                             |
| **FE-20**   | **Primitivas de UI de primera clase** en `components/ui`: `PageHeader` (tÃ­tulo/descripciÃ³n/acciones), `ConfirmDialog` (sobre `Modal`, para acciones destructivas o irreversibles) y `SkeletonDetail`/`SkeletonDashboard`. Los tokens `surface`/`surface-muted` viven en `tailwind.config.ts`                                                                                                                                                                                                                                                                   | Cabeceras y diÃ¡logos ad hoc por pantalla                                     | Un `PageHeader` da jerarquÃ­a y espaciado idÃ©nticos en las 16 pÃ¡ginas; un `ConfirmDialog` reutiliza el _focus trap_ del `Modal` (FE-18) en vez de repetir `window.confirm`                              |
| **FE-21**   | **Accesibilidad del `Toast`**: `role="alert"` en errores y `role="status"` en el resto, botÃ³n de cierre (Â«Cerrar avisoÂ»), autocierre a 4 s **pausable** al pasar el foco o el ratÃ³n (conserva el tiempo restante)                                                                                                                                                                                                                                                                                                                                              | Notificaciones que desaparecen sin control                                   | Un aviso que se va mientras se lee o que no se anuncia a un lector de pantalla es inaccesible; la pausa evita perder el mensaje                                                                        |
| **FE-22**   | **GrÃ¡ficos del dashboard conscientes del tema**: `useChartColors` devuelve los colores segÃºn claro/oscuro (Recharts pinta con `fill`/`stroke` _inline_ y no hereda `dark:`). Cada grÃ¡fico va en un `<figure>` con tabla `sr-only` de respaldo                                                                                                                                                                                                                                                                                                                  | Dejar los colores fijos o el `dark:` de Tailwind                             | Recharts no reacciona a la clase `dark`; sin esto el grÃ¡fico se queda en colores claros sobre fondo oscuro. La tabla `sr-only` da una alternativa textual a quien no ve el grÃ¡fico                     |
| **FE-23**   | **Sidebar colapsable y con iconos**: `NavIcons` da un icono a cada secciÃ³n y el estado colapsado se persiste en `localStorage` (`communityhub.sidebar`); colapsado muestra `title` y el botÃ³n lleva `aria-pressed`. SelecciÃ³n de comunidad con **combobox con bÃºsqueda** (`CommunitySwitcher`)                                                                                                                                                                                                                                                                 | Sidebar fijo y un `<select>` nativo                                          | Con muchas comunidades y secciones, un `<select>` y un sidebar rÃ­gido obligan a cambios de contexto; colapsar libera ancho y el buscador filtra por nombre                                             |
| **FE-24**   | **Sin destello de tema (FOUC)**: un script _inline_ en `index.html` aplica la clase `dark` **antes** del primer pintado, leyendo la misma clave (`communityhub.theme`) y `prefers-color-scheme` que `ThemeContext`                                                                                                                                                                                                                                                                                                                                             | Aplicar el tema solo tras montar React                                       | React monta tarde; sin el script, el primer fotograma es claro y luego salta a oscuro. La lÃ³gica se duplica a propÃ³sito (el script no puede importar el contexto)                                      |
| **FE-25**   | **PaginaciÃ³n con nÃºmeros y tamaÃ±o de pÃ¡gina** en `Pagination`: ventana de pÃ¡ginas alrededor de la actual (con extremos plegados), botones Anterior/Siguiente y selector de tamaÃ±o (`pageSizeOptions`) que reinicia a la pÃ¡gina 1. Los `EmptyState` aceptan una **acciÃ³n/CTA** contextual                                                                                                                                                                                                                                                                       | Solo Anterior/Siguiente y vacÃ­os sin salida                                  | Navegar de una en una por muchas pÃ¡ginas es lento; un vacÃ­o sin CTA deja al usuario sin siguiente paso. El backend ya devuelve `meta.total`/`totalPages`                                               |
| **FE-26**   | **Filtros, pÃ¡gina y bÃºsqueda persistidos en la URL** con el hook `useUrlFilters` (sincroniza cada filtro con `useSearchParams` en modo `replace`; los valores invÃ¡lidos caen a vacÃ­o). Cableado en incidencias, documentos, reservas (con `view` lista/calendario), notificaciones, avisos, votaciones, finanzas (pestaÃ±as) y miembros                                                                                                                                                                                                                         | Estado local que se pierde al recargar o compartir                           | Poder enlazar "incidencias abiertas de la categorÃ­a X" o recargar sin perder el contexto es una expectativa bÃ¡sica; tambiÃ©n hace el filtrado verificable por E2E                                       |
| **FE-27**   | **`DataTable` con orden en cliente y selecciÃ³n**: `Column` admite `sortable`/`sortValue`; `DataTable` ordena de forma estable (`localeCompare('es')`) con ciclo ascâ†’descâ†’sin orden, expone `aria-sort` y `initialSort`, y admite selecciÃ³n por fila con `selectable`/`selectedKeys`/`onSelectionChange` (checkbox con `aria-label`)                                                                                                                                                                                                                            | Solo orden por lo que devuelve la API                                        | La API no soporta `sort`; ordenar donde el usuario espera (la cabecera) es mejor que reordenar en servidor. La selecciÃ³n habilita futuras acciones por lote sin reescribir la tabla                    |
| **FE-28**   | **Selectores de comandos (Cmd/Ctrl+K)** con `CommandPalette`, montado una sola vez en el shell y alimentado por `visibleNavItems` (los mismos destinos y permisos que el sidebar). Filtra por texto, navega con flechas/Enter, cierra con Escape y devuelve el foco. La cabecera ofrece un botÃ³n-trigger                                                                                                                                                                                                                                                       | Solo el sidebar                                                              | Saltar a una secciÃ³n sin recorrer el menÃº acelera el uso con ratÃ³n y teclado; al compartir `navItems`, no puede desincronizarse del sidebar                                                            |
| **FE-29**   | **Feedback de formularios**: validaciÃ³n en modo `onTouched` (los errores salen tras tocar/blur, no al entrar) y aviso de **cambios sin guardar** con el hook `useUnsavedChanges` (`beforeunload` + `useBlocker` del data router, que degrada con seguridad fuera de un data router). Un `ConfirmDialog` pide confirmaciÃ³n antes de perder lo escrito                                                                                                                                                                                                           | Validar al montar y perder cambios al navegar                                | Marcar campos en rojo antes de que el usuario los toque es ruido; salir sin querer y perder un formulario largo es lo peor de una SPA                                                                  |
| **FE-30**   | **Accesibilidad estructural**: `h1` por pÃ¡gina (auth y detalle de votaciÃ³n incluidos), combobox del selector de comunidad con `aria-activedescendant`/`id` por opciÃ³n, pestaÃ±as accesibles (`Tabs`/`TabPanel` con roving tabindex y flechas), campana de notificaciones con `aria-haspopup`/`aria-expanded` y cierre con Escape/foco. `eslint-plugin-jsx-a11y` **no se aÃ±ade**: su Ãºltima versiÃ³n (6.10.2) no soporta ESLint 10 (el del repo)                                                                                                                  | Confiar en que "se ve bien"                                                  | La a11y de teclado y de lector de pantalla no se ve en una revisiÃ³n visual; un lint que no carga en CI serÃ­a peor que no tenerlo                                                                       |
| **FE-31**   | **Detalle y movimiento**: `SkeletonTable` dibuja cabecera + filas (como la tabla real) en vez de bloques genÃ©ricos; `EmptyState` acepta `icon` (ilustraciones SVG en lÃ­nea de `EmptyIllustrations`); transiciÃ³n `fade-in-up` al cambiar de ruta y una animaciÃ³n **propia** mÃ­nima en `tailwind.config.ts` (sin `tailwindcss-animate`), siempre bajo `motion-safe:`. La secciÃ³n activa se **precarga al pasar el ratÃ³n/enfocar** (`prefetchRoute` de `routes/prefetch.ts`) y el anÃ¡lisis de bundle se activa con `npm run analyze` (`rollup-plugin-visualizer`) | Esqueletos genÃ©ricos, vacÃ­os sin ilustraciÃ³n y descarga del chunk al navegar | Un esqueleto con la forma final evita el salto de layout; precargar en hover elimina el parpadeo del _fallback_; el analizador ayuda a vigilar el chunk de grÃ¡ficos (Recharts)                         |
| **FE-32**   | **Sistema de diseÃ±o semÃ¡ntico**: tokens `accent` (violeta), tipografÃ­as (`page-title`/`section-title`/`meta`), radios (`control`/`card`/`overlay`) y sombras (`card`/`overlay`) en `tailwind.config.ts`. `Button` con variantes semÃ¡nticas (`brand`/`secondary`/`danger`/`success`/`ghost`) y `size: 'icon'` con `rounded-control`. `Card`/`Modal` usan `bg-surface`, radios/sombras por nivel. `Badge` admite `accent`. `Tooltip` accesible con `role="tooltip"`, `aria-describedby` y teclado/Escape                                                         | Colores crudos y radios inconsistentes                                       | UnificaciÃ³n visual, mejor jerarquÃ­a tipogrÃ¡fica y componentes reutilizables sin romper la paleta semÃ¡ntica existente                                                                                   |
| **FE-33**   | **Superficies y consistencia**: migraciÃ³n de `bg-white`/`dark:bg-slate-900` a `bg-surface`/`surface-muted` en shell, error boundaries, layouts de auth/404 y estados. `ErrorState` con ilustraciÃ³n (`EmptyAlertIcon`) reutilizando `EmptyIllustrations`. TransiciÃ³n de color en `body` (`transition-colors duration-150`) y `ScrollToTop` al cambiar de ruta                                                                                                                                                                                                   | Superficies mezcladas entre modos claro/oscuro                               | Coherencia con tokens semÃ¡nticos y experiencia mÃ¡s pulida al navegar/cambiar tema                                                                                                                      |
| **FE-34**   | **DataTable avanzado**: densidad compacta/cÃ³moda persistida en `localStorage`, soporte para orden **controlado** (`sort` + `onSortChange`) con `aria-sort` y foco visible en cabeceras ordenables, y preparaciÃ³n para **acciones masivas** con barra flotante (`BulkActionsBar`). **Orden sincronizado con URL** vÃ­a `useUrlFilters` (`?sort=`/`?dir=`).                                                                                                                                                                                                       | Orden solo local o no persistente, sin control desde URL                     | Comparte enlaces con orden, permite persistir preferencias de densidad y habilita operaciones por lote                                                                                                 |
| **FE-35**   | **Indicador de cambios sin guardar**: `useUnsavedChanges` con `useBlocker` (data router) + `beforeunload`, degradando con seguridad fuera de data router (tests `MemoryRouter`). Integrado con `ConfirmDialog` para navegaciÃ³n interna                                                                                                                                                                                                                                                                                                                         | PÃ©rdida accidental de formularios largos                                     | ProtecciÃ³n robusta sin romper tests o navegaciÃ³n fuera del data router                                                                                                                                 |
| **FE-36**   | **Accesibilidad ampliada**: landmarks con `aria-label` Ãºnicos (`header/banner`, `aside`/navegaciÃ³n principal/mÃ³vil), `nav` con etiquetas diferenciadas, `aria-live="polite"` para resultados de bÃºsqueda/filtros, foco visible en enlaces activos del sidebar, `skip link` existente y `role="status"` en toasts.                                                                                                                                                                                                                                              | MÃºltiples landmarks con misma etiqueta o sin anuncio de resultados           | Mejor experiencia con lectores de pantalla y navegaciÃ³n por teclado                                                                                                                                    |
| **FE-37**   | **Rendimiento percibido**: `useDeferredValue` en bÃºsqueda client-side de miembros, avatares preparados para `loading="lazy"`/`decoding="async"` (sin `<img>` en uso actual), `prefetchRoute` ya existente. **Presupuesto de bundle** con `scripts/check-bundle.mjs` (lÃ­mites gzip por chunk) y paso en CI (`npm run check-bundle`).                                                                                                                                                                                                                            | Sin control de regresiones de bundle                                         | Busca fluida en listas grandes y control proactivo del tamaÃ±o de chunks                                                                                                                                |
| **FE-38**   | **Calidad y automatizaciÃ³n**: `check-bundle` integrado en `.github/workflows/frontend.yml`, lint/typecheck/tests/build verdes. DocumentaciÃ³n alineada con implementaciÃ³n.                                                                                                                                                                                                                                                                                                                                                                                      | Sin verificaciÃ³n automÃ¡tica de presupuesto                                   | Previene crecimientos inesperados de bundle en CI                                                                                                                                                      |

---

## 3. Estado real del backend que consume

El backend estÃ¡ **completo** (bloques `01`â€“`14`, `db:verify` en verde). El
frontend consume la API documentada en [`docs/API.md`](../docs/API.md); aquÃ­ solo
lo que condiciona decisiones del cliente:

- **Auth propia** (no GoTrue). `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me`,
  `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`.
- **Login/refresh devuelven el access token en el cuerpo** (`{ data: {
accessToken, expiresIn, user } }`) y el **refresh token solo en cookie**
  `httpOnly`. El cliente debe mandar `withCredentials: true`.
- **Envelope**: Ã©xito `{ "data": â€¦, "meta"?: â€¦ }`; error `{ "error": { "code",
"message", "details"? } }` (ver `docs/API.md` â†’ Errores).
- **Roles de miembro**: `ADMIN`, `PRESIDENT`, `NEIGHBOR`, `PROVIDER`. Rol global
  de plataforma: `NEIGHBOR`, `ADMIN_SA`. La autorizaciÃ³n fina vive en el backend.
- **Aislamiento por comunidad**: casi todo endpoint cuelga de
  `/communities/:communityId/â€¦` y exige pertenencia; las rutas de recurso
  (`/incidents/:id`, `/votes/:id`â€¦) resuelven el scope por el propio recurso.
- **`notifications`** es personal y **global** (sin `communityId` en la ruta).
- **`GET /auth/me`** devuelve `PublicUser` = `{ id, email, fullName, phone,
avatarUrl, globalRole, emailVerifiedAt, createdAt }`.

---

## 4. Alcance funcional

Cada feature consume endpoints ya existentes. La columna Â«endpointsÂ» remite a
`docs/API.md`.

### 4.1 AutenticaciÃ³n (`features/auth`)

- **Login** (`POST /auth/login`), **registro** (`POST /auth/register`),
  **logout** (`POST /auth/logout`, con confirmaciÃ³n).
- Tras login/refresh, cargar `GET /auth/me` y poblar `AuthContext`.
- Al montar la app, intentar `POST /auth/refresh` (silencioso) para recuperar la
  sesiÃ³n desde la cookie; si falla, estado Â«anÃ³nimoÂ».
- Pantallas: `/login`, `/register`.
- GestiÃ³n de sesiones en `/settings/sessions`: `GET /auth/sessions`,
  `DELETE /auth/sessions/:id`.

### 4.2 Shell y navegaciÃ³n (`layouts`, `app/routes`)

- **AppLayout** autenticado: cabecera con selector de comunidad, **campana**
  (con _badge_), menÃº de usuario (perfil, sesiones, salir).
- **Sidebar** por feature, con entradas visibles segÃºn rol (FE-1, Â§7).
- **AuthLayout** para `/login` y `/register`.
- Estados de carga (`Skeleton`), vacÃ­o (`EmptyState`) y error (`ErrorState`) en la
  base de cada pantalla de lista. Un `ErrorBoundary` envuelve el router para que un
  fallo de render no deje la pantalla en blanco (FE-18).
- **Atajo de accesibilidad**: _skip link_ a `#main` como primer elemento del shell;
  el `Modal` atrapa el foco y se cierra con Escape (FE-18).

### 4.3 Comunidades y selecciÃ³n (`features/communities`)

- `GET /communities` (a las que pertenece) â†’ poblar el selector y
  `CommunityContext`.
- `GET /communities/:communityId`, `PATCH /communities/:communityId`
  (configuraciÃ³n, solo `ADMIN`), `POST /communities` (`ADMIN_SA`).
- Al entrar en `/c/:communityId/...`, resolver la membresÃ­a del usuario **desde
  el backend**; si no es miembro, la API responde `403`/`404` y la UI lo muestra.

### 4.4 Incidencias (`features/incidents`)

- Listado con filtros (`GET /communities/:id/incidents?status=&priority=&category=&q=&page=&limit=`),
  detalle (`GET /incidents/:id`), alta (`POST â€¦/incidents`), ediciÃ³n
  (`PUT /incidents/:id`), cambio de estado (`PATCH /incidents/:id/status`),
  borrado (`DELETE /incidents/:id`) y comentarios.
- La UI de estados respeta el **grafo** (OPENâ†’IN_PROGRESSâ†’RESOLVED, CANCELLED
  final, reapertura solo `ADMIN`) ofreciendo solo transiciones vÃ¡lidas â€” pero el
  `409`/`403` del backend es la verdad.
- AsignaciÃ³n a un `PROVIDER` (selector) segÃºn lo que permita el backend.

### 4.5 Zonas comunes y reservas (`features/common-areas`, `features/reservations`)

- Zonas: listado, alta y ediciÃ³n (`â€¦/common-areas`), disponibilidad
  (`GET /common-areas/:id/availability?date=`).
- Reservas: alta (`POST /common-areas/:id/reservations`), listado de comunidad,
  Â«mis reservasÂ» (`GET /reservations/me`), cancelar (`PATCH /reservations/:id/cancel`),
  confirmar (`POST /reservations/:id/confirm`, **solo `ADMIN`**, R-3/D-2).
- La rejilla de slots viene de `availability`; la UI **no** calcula huecos por su
  cuenta (evita el bug de solape, spec 06).

### 4.6 Avisos (`features/announcements`)

- Listado, detalle, alta/ediciÃ³n/borrado segÃºn rol; fijado (`isPinned`),
  programaciÃ³n (`publishAt`) y caducidad (`expiresAt`).
- Contenido de usuario **renderizado como texto** (nunca
  `dangerouslySetInnerHTML`; ver Â§8).

### 4.7 Documentos (`features/documents`)

- Listado por rol, subida (`multipart/form-data` â†’ `POST â€¦/documents`), descarga
  (sigue la _signed URL_ que devuelve `GET /documents/:id/download`, con sus
  `404`/`403` en dos pasos), borrado (soft delete).

### 4.8 Finanzas (`features/finance`)

- **Solo `ADMIN`** (el backend responde `403` a los demÃ¡s y el dashboard da
  `finance: null`). Gastos, facturas, pago (`POST â€¦/invoices/:id/pay`) y resumen
  (`GET â€¦/finance/summary`).
- La UI **oculta** el mÃ³dulo a quien no es `ADMIN`, pero se apoya en el `403`.

### 4.9 Votaciones (`features/voting`)

- Listado, detalle, crear/editar borrador, publicar (`POST /votes/:id/publish`),
  cerrar (`POST /votes/:id/close`), votar (`POST /votes/:id/responses`) y
  resultados (`GET /votes/:id/results`, export `GET /votes/:id/results/export`).
- El `PROVIDER` no lista ni ve detalle (`403`/`404`); la UI lo refleja.

### 4.10 Asistencia de IA (`features/ai`)

- Chat (`POST /ai/chat`, **SSE**), sesiones (`GET /ai/chat/sessions`, mensajes,
  borrado), clasificar incidencia (`POST /ai/incidents/classify` â†’ propuesta),
  borradores (`POST /ai/incidents/drafts`, confirmar con actor humano),
  catÃ¡logo y _preview_ de _tools_.
- El SSE se consume con `fetch` + `ReadableStream` (no con axios) y se pinta por
  trozos; los borradores **nunca** crean la incidencia sin confirmaciÃ³n del
  usuario (ARCHITECTURE Â§1.4). Modo sin IA (backend sin proveedor): la pantalla
  avisa y el resto de la app sigue funcionando.

### 4.11 Dashboard (`features/dashboard`)

- `GET /communities/:id/dashboard?from=&to=` â†’ KPIs + listas cortas + series.
- GrÃ¡ficos **Recharts** con `incidents.byStatus`, `incidents.byCategory`,
  `reservations.byMonth`, `finance.expensesByMonth` (Â§5.2 de la spec 13).
- `finance` se pinta **solo si no es `null`** (rol `ADMIN`).

### 4.12 Notificaciones (`features/notifications`)

- **Campana** en la cabecera con `GET /notifications/unread-count` (badge).
- Panel/lista: `GET /notifications?unread=&page=&limit=`, marcar una
  (`PATCH /notifications/:id/read`, idempotente), marcar todas
  (`POST /notifications/read-all`).
- Sondeo + revalidaciÃ³n por foco (FE-12). La lista es personal y global.

### 4.13 Miembros (`features/members`)

- Listado de miembros, invitaciones (`POST â€¦/invitations`, listar, revocar),
  cambio de rol/estado (`PATCH â€¦/members/:memberId`), canje de invitaciÃ³n
  (`POST /invitations/redeem`). Solo `ADMIN` invita y cambia roles (el backend lo
  impone); la UI lo refleja.

### 4.14 Cuenta y sesiones (`features/account`)

- **Ver y editar** el perfil propio: `GET /auth/me` y `PATCH /auth/me`
  (`fullName`, `phone`; vaciar `phone` lo borra). Formulario RHF + zod con toast de
  confirmación (FE-19).
- **Avatar**: POST /auth/me/avatar (imagen, max 2 MB) y DELETE /auth/me/avatar con vista previa en AccountPage.
- **Cambiar contraseÃ±a**: `POST /auth/change-password` (`currentPassword`,
  `newPassword` â‰¥ 12). El error `CURRENT_PASSWORD_INVALID` se mapea al campo
  _contraseÃ±a actual_, no a un mensaje genÃ©rico. Al Ã©xito, se avisa de que las
  demÃ¡s sesiones se han revocado.
- GestiÃ³n de sesiones: `GET /auth/sessions`, `DELETE /auth/sessions/:id`, y
  logout. La tabla de sesiones se refresca tras un cambio de contraseÃ±a.
- `AccountPage` usa dos formularios (`<form>` independientes) y una lista de
  descripciÃ³n (`<dl>`) semÃ¡ntica para los datos de solo lectura.

### 4.15 AdministraciÃ³n de plataforma (`features/platform-admin`)

- Visible **solo** para `globalRole === 'ADMIN_SA'` (FE-15). Pantalla
  `/admin/communities/new`: formulario de alta de comunidad
  (`POST /communities`, spec 02) y confirmaciÃ³n con el `communityId` creado.
- No hay listado global de comunidades: el backend no lo expone (C-12). Si el
  `ADMIN_SA` no pertenece a ninguna comunidad, `GET /communities` vuelve vacÃ­o y el
  selector de comunidad muestra un estado vacÃ­o con enlace a Â«crear comunidadÂ».

---

## 5. Modelo de datos y tipos (contrato con el frontend)

Los DTOs son los de `docs/API.md`; en el cliente se declaran **una vez** en
`types/` (globales) o `features/*/types` (de dominio). Los tipos nÃºcleo:

```ts
// types/api.ts â€” el envelope de todo el backend
type ApiSuccess<T> = { data: T; meta?: Record<string, unknown> }
type ApiErrorBody = { error: { code: string; message: string; details?: unknown } }

// features/auth/types.ts
type PublicUser = {
  id: string
  email: string
  fullName: string
  phone: string | null
  avatarUrl: string | null
  globalRole: 'NEIGHBOR' | 'ADMIN_SA'
  emailVerifiedAt: string | null
  createdAt: string
}

// types/roles.ts
type MemberRole = 'ADMIN' | 'PRESIDENT' | 'NEIGHBOR' | 'PROVIDER'

// features/communities/types.ts
type Community = { id: string; name: string; city: string | null /* â€¦ */ }
type Membership = { communityId: string; role: MemberRole; status: MemberStatus }
```

El **envelope y los errores** se tipan genÃ©ricamente; cada feature declara el DTO
de su recurso. Las fechas viajan como ISO 8601 en UTC con `Z` y se formatean en el
cliente (nunca se envÃ­an formateadas).

---

## 6. API client y sesiÃ³n

- `services/http.ts`: **una** instancia `axios.create({ baseURL: '/api/v1',
withCredentials: true })`.
  - **Request**: adjunta `Authorization: Bearer <access>` si hay token en
    `AuthContext`.
  - **Response**: si `error.response.status === 401` y la ruta no es
    `/auth/refresh` ni `/auth/login`, llama a `POST /auth/refresh` **una vez**
    (encolando las concurrentes), actualiza el token y reintenta. Si el refresh
    falla, limpia la sesiÃ³n y redirige a `/login`.
  - Normaliza el error a `ApiError { status, code, message, details }` (FE-11).
- `services/<feature>.ts` por dominio, con funciones tipadas que devuelven `data`
  (y `meta` cuando aplica). Las **mutaciones** devuelven el recurso y disparan la
  invalidaciÃ³n del hook de lista correspondiente.

---

## 7. Permisos (solo UX; el backend manda)

Matriz **orientativa** de visibilidad de navegaciÃ³n/acciones. Es un espejo de la
autorizaciÃ³n real del backend; cuando difiera, **gana el backend** (FE-1).

| Feature                      | ADMIN               | PRESIDENT       | NEIGHBOR                        | PROVIDER      | ADMIN_SA              |
| ---------------------------- | ------------------- | --------------- | ------------------------------- | ------------- | --------------------- |
| Incidencias                  | ver/crear/gestionar | ver/crear       | ver/crear (las suyas segÃºn rol) | ver asignadas | â€”                     |
| Zonas / Reservas             | gestiÃ³n total       | ver/reservar    | ver/reservar                    | â€”             | â€”                     |
| Avisos                       | gestionar           | gestionar       | leer                            | leer          | â€”                     |
| Documentos                   | gestionar           | ver (segÃºn ACL) | ver (segÃºn ACL)                 | borde (ACL)   | â€”                     |
| Finanzas                     | **sÃ­**              | **no**          | **no**                          | **no**        | â€”                     |
| Votaciones                   | gestionar/votar     | crear/votar     | votar                           | **no**        | â€”                     |
| Dashboard                    | sÃ­ (+ `finance`)    | sÃ­              | sÃ­                              | sÃ­            | â€”                     |
| IA                           | sÃ­                  | sÃ­              | sÃ­                              | segÃºn _tool_  | â€”                     |
| Miembros/invitaciones        | gestionar           | ver             | ver (Â¿propio?)                  | â€”             | â€”                     |
| Notificaciones               | personales          | personales      | personales                      | personales    | â€”                     |
| Comunidades                  | gestiÃ³n (la suya)   | â€”               | â€”                               | â€”             | **crear**             |
| AdministraciÃ³n de plataforma | â€”                   | â€”               | â€”                               | â€”             | **crear comunidades** |

Las celdas Â«â€”Â» y Â«noÂ» son **ocultar en UI**, no autorizaciÃ³n. Las reglas exactas
estÃ¡n en las specs `02`â€“`14` y en `docs/SECURITY.md`.

---

## 8. Errores

| SituaciÃ³n                     | `code`                                  | Tratamiento en la UI                                              |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Formulario invÃ¡lido           | `VALIDATION_ERROR`                      | Pintar `details` en los campos (RHF `setError`); toast genÃ©rico   |
| Credenciales                  | `INVALID_CREDENTIALS`                   | Mensaje en el formulario de login                                 |
| ContraseÃ±a actual incorrecta  | `CURRENT_PASSWORD_INVALID`              | Mensaje inline en el campo _contraseÃ±a actual_                    |
| SesiÃ³n caducada / revocada    | `TOKEN_EXPIRED`, `TOKEN_REVOKED`        | Refresco transparente; si falla, `/login`                         |
| Sin permiso (`403`)           | `FORBIDDEN`, etc.                       | Ocultar la acciÃ³n + mensaje Â«no tienes permisoÂ»                   |
| No encontrado (`404`)         | `NOT_FOUND`                             | `EmptyState`/pÃ¡gina 404 de la SPA                                 |
| Conflicto de estado (`409`)   | `CONFLICT`, `*_INVALID_TRANSITION`, â€¦   | Mensaje con la acciÃ³n alternativa (la UI ofrece el estado vÃ¡lido) |
| ValidaciÃ³n de negocio (`400`) | `EXPENSE_INVOICE_MISMATCH`, `VOTE_*`, â€¦ | Mensaje inline junto al campo implicado                           |
| LÃ­mite (`429`)                | `RATE_LIMITED`                          | Aviso Â«demasiados intentos, esperaÂ»                               |
| `5xx`                         | â€”                                       | `ErrorState` con reintento                                        |

**XSS**: el contenido de usuario (avisos, comentarios, nombres) se pinta como
texto. Se prohÃ­be `dangerouslySetInnerHTML`; si en el futuro se renderiza markdown,
se sanea (ARCHITECTURE Â§15).

---

## 8-bis. Validaciones y casos lÃ­mite

- Los esquemas `zod` del cliente reflejan los mÃ­nimos/mÃ¡ximos del backend
  (tÃ­tulo â‰¥ 5, descripciÃ³n â‰¥ 10, `unread` solo `"true"`/`"false"`, `page` â‰¥ 1,
  `limit` 1..100â€¦). El backend vuelve a validar.
- Fechas de reserva: la UI solo ofrece **slots** de `availability` (evita el
  solape y el fallo de rejilla); nunca deja escribir una hora libre.
- VotaciÃ³n: la UI no permite abstenerse Â«a manoÂ» si el backend lo rechaza; usa el
  mecanismo del backend.
- Token expirado a mitad de una acciÃ³n: el interceptor reintenta el refresh y
  repite la peticiÃ³n sin perder el formulario.
- Multi-comunidad: cambiar de comunidad recarga los datos de la secciÃ³n y respeta
  el `communityId` de la URL; nunca reutiliza estado de otra comunidad.
- IA sin proveedor: la feature avisa y no rompe; el resto de la app funciona.

---

## 9. ConfiguraciÃ³n (env)

- `VITE_API_BASE_URL` (por defecto `/api/v1`, vacÃ­o en prod con mismo origen).
- `vite.config.ts` con **proxy de desarrollo** `/api` â†’
  `http://localhost:3000` (FE-4); `changeOrigin: true` y `cookieDomainRewrite`
  para que la cookie de refresh funcione en dev.
- Sin claves: el frontend **no** maneja ninguna credencial de terceros ni de
  Storage.

---

## 10. Estructura del frontend

```
frontend/
â”œâ”€â”€ index.html
â”œâ”€â”€ package.json
â”œâ”€â”€ vite.config.ts                 # proxy /api, alias @
â”œâ”€â”€ tailwind.config.ts  postcss.config.js
â”œâ”€â”€ tsconfig.json
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ main.tsx
â”‚   â”œâ”€â”€ app/                       # router, providers, App
â”‚   â”œâ”€â”€ routes/                    # route tree + ProtectedRoute/RoleGate + prefetch.ts
â”‚   â”œâ”€â”€ layouts/                   # AppLayout, AuthLayout
â”‚   â”œâ”€â”€ components/                # ui/ (Button, Input, Modal, Table, Tabs, CommandPaletteâ€¦)
â”‚   â”œâ”€â”€ components/ErrorBoundary.tsx  # lÃ­mite de render (FE-18)
â”‚   â”œâ”€â”€ services/                  # http.ts + api por dominio
â”‚   â”œâ”€â”€ context/                   # AuthContext, CommunityContext
â”‚   â”œâ”€â”€ hooks/                     # useResource, useUrlFilters, useUnsavedChanges, useDebouncedValueâ€¦
â”‚   â”œâ”€â”€ types/                     # api.ts, roles.ts
â”‚   â”œâ”€â”€ utils/                     # fechas, moneda, cn()
â”‚   â””â”€â”€ features/
â”‚       â”œâ”€â”€ auth/{api,hooks,components,pages,schemas,types}
â”‚       â”œâ”€â”€ communities/  members/
â”‚       â”œâ”€â”€ incidents/  common-areas/  reservations/
â”‚       â”œâ”€â”€ announcements/  documents/  finance/
â”‚       â”œâ”€â”€ voting/  ai/  dashboard/  notifications/  account/
â”‚       â””â”€â”€ ...
â””â”€â”€ tests/  (e2e/ con Playwright)
```

---

## 11. Tests

- **Componente**: `*.test.tsx` con RTL sobre `components/ui` y componentes de
  feature (render, interacciÃ³n, accesibilidad bÃ¡sica). La revisiÃ³n FE-16â€¦FE-19
  aÃ±adiÃ³ `components/ui/Display.test.tsx` (Modal + `SkeletonList`) y
  `features/account/pages/AccountPage.test.tsx` (perfil, contraseÃ±a, errores).
- **IntegraciÃ³n de feature**: con **MSW** simulando `/api/v1`; verifica estados
  carga/vacÃ­o/error y el camino feliz de cada formulario. La suite cubre tambiÃ©n
  utilidades puras (`features/notifications/links.test.ts` para el enrutado de
  notificaciones, `hooks/useDebouncedValue.test.ts`).
- **E2E (Playwright)** â€” los 8 flujos del enunciado Â§18: **login**, **crear
  incidencia**, **consultar incidencia**, **crear reserva**, **cancelar reserva**,
  **crear votaciÃ³n**, **votar**, **consultar resultados**. Contra el backend real
  en modo test y datos sembrados.

---

## 12. Decisiones cerradas

Aprobadas por el desarrollador (2026-10-16):

- [x] **FE-1â€¦FE-15** confirmadas sin cambios.
- [x] **Sondeo de notificaciones**: cada **60 s** **y** revalidaciÃ³n al recuperar
      el foco (`visibilitychange`) (FE-12).
- [x] **AdministraciÃ³n de plataforma** para `ADMIN_SA`: **sÃ­**, se incluye en este
      bloque (FE-15, Â§4.15).
- [x] **Vite + React 18** (`react@^18`, `react-dom@^18`). No hace falta React 19.

### RevisiÃ³n de mejoras (FE-16â€¦FE-19)

Cerrada tras la primera implementaciÃ³n, sobre el feedback de uso:

- [x] **FE-16 â€” Tema claro/oscuro** con `darkMode: 'class'`, preferencia en
      `localStorage` y respeto de `prefers-color-scheme`. Sustituye al Â«tema claro
      ÃºnicamenteÂ» que dejaba Â§15.
- [x] **FE-17 â€” Code-splitting** por ruta (`React.lazy` + `Suspense`) y
      `manualChunks` de Vite para React, Recharts y formularios.
- [x] **FE-18 â€” Carga y error de primera clase**: `Skeleton`/`SkeletonList`,
      `ErrorBoundary` y `Modal` accesible; _skip link_ a `#main`.
- [x] **FE-19 â€” Cuenta**: `PATCH /auth/me` y `POST /auth/change-password`
      (cierra el hueco de Â§4.14).

### RevisiÃ³n de mejoras (FE-20â€¦FE-25)

Cerrada tras la revisiÃ³n de diseÃ±o/accesibilidad sobre FE-16â€¦FE-19:

- [x] **FE-20 â€” Primitivas de UI**: `PageHeader` y `ConfirmDialog` en
      `components/ui`, mÃ¡s `SkeletonDetail`/`SkeletonDashboard`; tokens
      `surface`/`surface-muted` en Tailwind.
- [x] **FE-21 â€” `Toast` accesible**: `role` segÃºn severidad, cierre manual y
      autocierre pausable.
- [x] **FE-22 â€” GrÃ¡ficos por tema** con `useChartColors` y respaldo textual
      `sr-only` en un `<figure>`.
- [x] **FE-23 â€” NavegaciÃ³n**: sidebar colapsable con iconos (`NavIcons`) y
      selecciÃ³n de comunidad con bÃºsqueda (`CommunitySwitcher`).
- [x] **FE-24 â€” Sin FOUC**: script _inline_ en `index.html` que fija el tema antes
      del primer pintado.
- [x] **FE-25 â€” PaginaciÃ³n con nÃºmeros y tamaÃ±o** y `EmptyState` con CTA.

### RevisiÃ³n de mejoras (FE-26â€¦FE-31)

Segunda ronda de mejoras (consistencia visual, UX, accesibilidad, rendimiento y
detalle), cerrada sobre FE-20â€¦FE-25:

- [x] **FE-26 â€” Filtros/pÃ¡gina/bÃºsqueda en la URL** (`useUrlFilters`) en las
      pantallas de listado y las pestaÃ±as de finanzas.
- [x] **FE-27 â€” `DataTable` con orden en cliente y selecciÃ³n** por fila
      (`sortable`/`sortValue`, ciclo ascâ†’descâ†’sin orden, `aria-sort`).
- [x] **FE-28 â€” Selector de comandos Cmd/Ctrl+K** (`CommandPalette`) sobre el
      `NAV_ITEMS` compartido, con trigger en la cabecera.
- [x] **FE-29 â€” Feedback de formularios**: validaciÃ³n `onTouched` y aviso de
      cambios sin guardar (`useUnsavedChanges` + `ConfirmDialog`).
- [x] **FE-30 â€” Accesibilidad estructural**: `h1` por pÃ¡gina, combobox con
      `aria-activedescendant`, pestaÃ±as accesibles y campana mejorada. `jsx-a11y`
      no se aÃ±ade (no soporta ESLint 10).
- [x] **FE-31 â€” Detalle y movimiento**: `SkeletonTable`, `EmptyState` con icono,
      transiciÃ³n de ruta `motion-safe`, precarga al hover (`prefetchRoute`) y
      `npm run analyze` (bundle visualizer).

---

## 13. Criterios de aceptaciÃ³n

1. `npm run dev` en `frontend/` levanta la SPA y habla con el backend por el proxy
   `/api` (cookie de refresh incluida).
2. Login, registro y logout funcionan; al recargar la pÃ¡gina la sesiÃ³n se recupera
   por `refresh` silencioso; a los 15 min el interceptor renueva sin que el usuario
   note nada.
3. Un usuario sin sesiÃ³n es redirigido a `/login` desde cualquier ruta protegida.
4. Cada feature de Â§4 tiene sus pantallas de listado/detalle/alta y sus estados de
   carga, vacÃ­o y error.
5. La navegaciÃ³n y las acciones se ocultan/deshabilitan por rol **y** siguen siendo
   seguras: con permisos manipulados en el cliente, el backend responde
   `403`/`404` y la UI lo muestra.
6. El **dashboard** pinta KPIs y las 4 series con Recharts; `finance` solo si no es
   `null`.
7. La **campana** muestra el _badge_, lista, marca una y marca todas.
8. Los **8 flujos E2E** pasan.
9. `typecheck` (tsc), tests de componente e integraciÃ³n (MSW) y E2E, todos verdes.
10. Sin secretos en el cliente; el access token **nunca** se persiste.

---

## 14. DocumentaciÃ³n a actualizar (al implementar)

- `docs/README.md`: fila Â«FrontendÂ» y comando de arranque (`npm run dev` en
  `frontend/`).
- `ARCHITECTURE.md` Â§2 y Â§16: marcar la fase de frontend; enlazar esta spec.
- `docs/API.md`: sin cambios por parte del frontend (el contrato lo define el
  backend); si el frontend descubre una divergencia, primero se corrige la spec
  del backend. La revisiÃ³n FE-19 consume los endpoints `PATCH /auth/me` y
  `POST /auth/change-password` que se documentaron en `docs/API.md` y en
  `specs/01-authentication.md` Â§5.5.
- `docs/CONTRIBUTING.md`: cÃ³mo se prueba el frontend (component/integration/E2E).
- `docs/SECURITY.md`: pÃ¡rrafo del bloque (tokens en memoria + cookie `httpOnly`,
  contenido de usuario como texto, el frontend no autoriza).

---

## 15. Mejoras recientes (2026-10-24)\r\n\r\n### 15.1 Vistas de incidencias\r\n- **Toggle Lista / Tablero / Calendario** en rontend/src/features/incidents/pages/IncidentListPage.tsx. La vista se persiste en URL (?view=kanban o ?view=calendar), por defecto lista.\r\n- **Kanban** (rontend/src/features/incidents/components/IncidentKanban.tsx): agrupa por estado con transiciones válidas vía 	ransitionIncident(). Carga hasta 100 elementos filtrados.\r\n- **Calendario** (rontend/src/features/incidents/components/IncidentCalendar.tsx): agrupa por createdAt con navegación mensual y enlaces al detalle.\r\n\r\n### 15.2 Asistente IA integrado\r\n- **Botón flotante** (rontend/src/components/ai/AiFloatingButton.tsx) montado en rontend/src/layouts/AppLayout.tsx, visible con comunidad activa.\r\n- **Drawer del asistente** (rontend/src/components/ai/AiAssistantDrawer.tsx) reutilizable con sesiones, streaming SSE, 	ool_calls, citations. Escucha evento open-ai-assistant.\r\n- **Resumir con IA** en rontend/src/features/announcements/pages/AnnouncementsPage.tsx: botón que envía avisos visibles al asistente vía evento.\r\n\r\n### 15.3 Previsualización de documentos\r\n- **Modal de previsualización** (rontend/src/features/documents/components/DocumentPreviewModal.tsx) para image/* y pplication/pdf usando URLs firmadas de getDownloadUrl(). Integrado en rontend/src/features/documents/pages/DocumentsPage.tsx.\r\n\r\n### 15.4 Búsqueda global ampliada\r\n- **Cmd/Ctrl+K** ampliado (rontend/src/components/ui/CommandPalette.tsx) para buscar incidencias, documentos, avisos y miembros con debounce 300ms (>=2 caracteres). Navegación directa al detalle/listado.\r\n\r\n### 15.5 Dashboard\r\n- **Accesos rápidos** en tarjetas de avisos, votaciones y reservas con enlaces directos (rontend/src/features/dashboard/pages/DashboardPage.tsx).\r\n\r\n### 15.6 Componentes UI unificados\r\n- **DataTableView** (rontend/src/components/ui/DataTableView.tsx): unifica Card, DataTable, Pagination, EmptyState, ErrorState y Skeleton. Exportado desde rontend/src/components/ui/index.ts junto a SortState.\r\n\r\n## 16. Fuera de alcance

- **SSR / Next**: la SPA es cliente puro (Vite).
- **Tiempo real** (websockets/SSE de notificaciones): solo el _stream_ SSE del chat
  de IA, que ya expone el backend.
- **EnvÃ­o de notificaciones** por email/push.
- **Servidor MCP** y **agentes de desarrollo** (specs propias, aÃºn sin escribir).
- **InternacionalizaciÃ³n** mÃ¡s allÃ¡ del castellano. El tema claro/oscuro **ya no**
  estÃ¡ aquÃ­: se implementÃ³ en FE-16.
- **PWA / offline**.
- **RecuperaciÃ³n de contraseÃ±a olvidada** (ver `specs/01-authentication.md` Â§12):
  el cambio autenticado sÃ­ estÃ¡ (FE-19), la recuperaciÃ³n por correo no.

## 16. Mejoras recientes (2026-10-23)

### 16.1 DataTable unificado
- **Componente:** `frontend/src/components/ui/DataTableView.tsx`
- **Export:** `frontend/src/components/ui/index.ts` (`DataTableView`, `DataTableViewPagination`)
- **DescripciÃ³n:** Unifica `Card`, `DataTable`, `Pagination`, filtros y estados (`SkeletonTable`, `ErrorState`, `EmptyState`). Recomendado para nuevas listas.

### 16.2 Vista Kanban para incidencias
- **Componentes:** `frontend/src/features/incidents/components/IncidentKanban.tsx`, `frontend/src/features/incidents/pages/IncidentListPage.tsx`
- **DescripciÃ³n:** Toggle `Lista / Tablero` persistido en `?view=kanban` con `Tabs`. Agrupa por `OPEN/IN_PROGRESS/RESOLVED/CANCELLED`. Transiciones rÃ¡pidas con `transitionIncident()` (ocultas para `NEIGHBOR`/`PROVIDER`). En vista tablero se cargan hasta 100 elementos filtrados.

### 16.3 Asistente IA en frontend
- **BotÃ³n flotante:** `frontend/src/components/ai/AiFloatingButton.tsx` integrado en `frontend/src/layouts/AppLayout.tsx`
- **Drawer:** `frontend/src/components/ai/AiAssistantDrawer.tsx` con sesiones, streaming SSE, `tool_calls` y `citations`
- **Resumir avisos:** BotÃ³n "Resumir con IA" en `frontend/src/features/announcements/pages/AnnouncementsPage.tsx` que envÃ­a los avisos visibles al asistente vÃ­a evento `open-ai-assistant`
- **ConfiguraciÃ³n:** Ver `docs/AI-DEVELOPMENT.md` Â§8. Claves en `backend/.env`: `GROQ_API_KEY`, `GEMINI_API_KEY`, `AI_ENABLED`

### 16.4 Correcciones de integraciÃ³n (2026-10-23)
- `IncidentKanban` importa `INCIDENT_STATUS_TONES` e `INCIDENT_PRIORITY_TONES` desde `@/components/ui` (no desde `../types`).
- `components/ui/index.ts` exporta `type SortState` para `DataTableView`.
- `DataTableView` tipa `error` como `ApiError` y usa imports directos para evitar ciclos.
- `AiAssistantDrawer` usa la firma `streamChat(body, { onEvent })` y no pasa `className` a `Modal` (no soportado).


# Swagger · CommunityHub

Documentación interactiva y especificación OpenAPI 3.0 del backend.

## Acceso

Con el backend en marcha (`npm run dev` desde `backend/`):

| Recurso | URL |
|---|---|
| Swagger UI | `http://localhost:3000/api-docs` |
| Spec JSON (OpenAPI 3.0) | `http://localhost:3000/api-docs.json` |

La UI incluye un botón **Authorize** para pegar el `accessToken` obtenido en `POST /api/v1/auth/login`. A partir de ahí, todos los endpoints protegidos se pueden probar directamente.

## Cómo se genera

La especificación se construye en tiempo de arranque a partir de dos fuentes:

1. **`src/config/swagger.ts`**: metadatos globales (`info`, `servers`, `tags`), esquemas de seguridad y **todos los `components.schemas`** reutilizables.
2. **Bloques `@swagger`** en cada `src/<dominio>/routes.ts`: cada handler documenta su endpoint justo encima de su `router.X(...)`.

`swagger-jsdoc` fusiona ambas fuentes y `swagger-ui-express` sirve la UI. El montaje se hace en `src/http/swagger.ts` y se llama desde `app.ts` **antes del `helmet` global**, porque la CSP estricta de la API (`default-src 'none'`) bloquearía los scripts inline de Swagger. Para `/api-docs` se aplica una CSP específica más permisiva.

## Añadir un endpoint nuevo

1. Abre el `routes.ts` del dominio.
2. Pega un bloque `@swagger` **inmediatamente encima** del `router.X(...)`.
3. Reinicia el backend (`swagger-jsdoc` lee los archivos al arrancar).

Ejemplo mínimo:

```typescript
/**
 * @swagger
 * /api/v1/recurso:
 *   get:
 *     summary: Listar recursos
 *     tags: [Recurso]
 *     responses:
 *       200:
 *         description: Lista de recursos.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Recurso' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/recurso', requireAuth, controller.list)

Reglas de mantenimiento
Un @swagger por router.X. Si un path tiene varios métodos (GET y POST), cada uno lleva su bloque.

Los schemas se definen una sola vez en swagger.ts y se referencian con $ref. No dupliques estructuras en los JSDoc.

Los responses comunes (Unauthorized, Forbidden, NotFound, Validation, Conflict, RateLimited) también viven en swagger.ts y se referencian con $ref.

Verificación contra la API real: después de añadir un endpoint, ejecútalo con curl o desde la UI y compara la respuesta real con el schema. Si hay diferencias, ajusta el schema en swagger.ts (no en el JSDoc). Los schemas de los dominios principales ya están verificados campo a campo contra la API real.

Producción: SWAGGER_ENABLED se resuelve a false por defecto cuando NODE_ENV=production. Si en algún momento se necesita en producción, protégelo con autenticación básica o expón solo la spec JSON tras un rol de administrador.

Generación de tipos para el frontend
Con la spec viva, se pueden generar tipos de TypeScript para el frontend sin duplicar interfaces a mano:

bash
# desde backend/
npx openapi-typescript http://localhost:3000/api-docs.json -o ../frontend/src/types/api.d.ts
En el frontend:

typescript
import type { components } from '@/types/api'
type Document = components['schemas']['Document']
type User     = components['schemas']['User']
Esto garantiza que si el backend cambia un campo y se actualiza el schema en swagger.ts, el frontend falla en compilación en lugar de fallar en producción.

CORS y el propio origen
Swagger UI se sirve desde http://localhost:3000 y hace peticiones al mismo origen. El navegador envía Origin: http://localhost:3000 en los POST, y el middleware cors de la API lo rechazaría si no estuviera en la allowlist. Para evitarlo, en app.ts se añade el propio origen a allowedOrigins solo cuando SWAGGER_ENABLED es true. No es un agujero de seguridad: una petición same-origin ya es de confianza por definición, y la entrada solo evita que el middleware la rechace antes de que llegue al handler.
# Spec 12 — APIs externas

> **Estado: IMPLEMENTED.** Las decisiones `EXT-1` a `EXT-14` de §2 y las cuatro
> decisiones abiertas de §13 están cerradas y en pie (A-1 sin `dryRun`, A-2 solo
> Photon, A-3 `get_weather` fuera de alcance, A-4 sin prefetch). Este spec usa la
> nomenclatura **EXT-1 a EXT-14**.
> **Fase:** 12 (integración con APIs externas: meteorología y mapa). Precedida de
> `01-authentication` … `11-ai`.
> **Base de datos:** `supabase/sql/01_schema.sql` (las columnas `latitude`,
> `longitude` y `timezone` de `communities` §4.2 ya existen), `02_rls.sql` y
> **`02m_external.sql`** (archivo nuevo, en este bloque: tabla `external_cache` +
> dos funciones `SECURITY DEFINER`).
> **Backend:** `backend/src/integrations/`.
> **Fuera de alcance** (bloques posteriores): el frontend (widget React de
> meteorología, mapa Leaflet, Recharts), el servidor MCP y las tools de IA que
> consuman estos datos. Ver §17.
>
> Este spec define la **integración del backend con APIs externas gratuitas** para
> los dos widgets que pide el enunciado §8: **meteorología** (Open-Meteo) y
> **mapa** (Photon), más el **geocodificado** de la dirección de una comunidad,
> que es lo que rellena sus coordenadas. La decisión de fondo, la misma en todo el
> bloque, es **EXT-1: el frontend nunca habla con el proveedor externo**; el
> backend es un proxy con caché, validación y normalización. Y **EXT-2: toda
> integración degrada sola**: si el proveedor cae, el resto del producto no se
> entera y el widget simplemente no aparece.

---

## 1. Objetivo

Que el detalle de una comunidad muestre **el tiempo que hace en su ubicación**
(temperatura actual, mínima y máxima del día) y **su mapa** (dónde está, su
dirección, los proveedores de servicios cercanos y los puntos de interés de
alrededor), **sin exponer ninguna clave al navegador** y **sin que un proveedor
externo caído rompa la página**.

Además, que la propia API pueda **rellenar las coordenadas** de una comunidad a
partir de su dirección postal (`latitude`/`longitude`, hoy anulables a propósito;
ver `01_schema.sql` §4.2), porque sin coordenadas no hay ni tiempo ni mapa.

Sin conexión a internet, o con las integraciones apagadas, la aplicación **sigue
siendo plenamente funcional**: los dos endpoints devuelven `data: null` con un
motivo, y la suite entera pasa sin salir a la red.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| **EXT-1** | **El frontend nunca llama al proveedor.** El backend es el único que habla con Open-Meteo y Photon; expone DTOs normalizados en `/communities/:communityId/...` | Llamar desde React con `fetch` directo, o con SDKs de mapas que incorporan el proveedor | `ARCHITECTURE.md` §8 ("el frontend nunca habla con el proveedor externo") y enunciado §8 ("no acoplar los componentes React a proveedores"). Sin claves en el cliente, sin CORS del proveedor, y el rate limit se controla en un solo sitio |
| **EXT-2** | **Degradación obligatoria.** Si el proveedor falla o no hay coordenadas, `weather` y `map` devuelven `200` con `data` parcial/nulo y `meta.reason`; **nunca un 5xx por un proveedor caído** | Propagar el `502` al cliente | El widget es accesorio; un 502 pintaría un error en la ficha de la comunidad por algo que no es culpa del usuario. §8 pide "degradar a `null`". La excepción es `geocode`, que sí es una acción explícita y falla ruidosamente (§7.3) |
| **EXT-3** | **Caché en `external_cache`** (tabla nueva, `jsonb`), accesible solo por dos funciones `SECURITY DEFINER` `app_external_cache_get`/`app_external_cache_put`, con TTL por tipo | Caché en memoria del proceso | Mismo patrón que `ai_cache` (§5.23): sobrevive a reinicios, es compartida y verificable desde SQL. La caché en memoria se pierde en cada deploy y en cada test, y deja el rate limit del proveedor a merced del número de instancias. Con $0 de presupuesto, repetir 1 000 veces una llamada que cambia cada 15 min es tirar la cuota |
| **EXT-4** | **Stale-while-error**: si hay caché caducada y el proveedor falla, se sirve la caché marcada `stale: true`; si no hay caché, `data: null` | Caducar estrictamente | Un dato de hace 40 min es mejor que ningún dato. `stale` es explícito para que el frontend pueda atenuarlo |
| **EXT-5** | **Interfaz por proveedor** (`WeatherProvider`, `GeocodingProvider`) + router por variable de entorno + **fake inyectable** en tests (mismo patrón que `LLMClient`, AI-4) | Acoplar el service a `fetch` de Open-Meteo/Photon | Cambiar de proveedor (o añadir Overpass para POIs, ver §13) debe ser cambiar una variable, no reescribir el service. Sin fake, probar el service exigiría salir a la red |
| **EXT-6** | Se usa **`fetch` nativo** (Node 20) con timeout por `AbortSignal`, `User-Agent` identificativo y parseo defensivo de JSON; **sin SDK** | `node-fetch`, SDK de proveedor | D-02 ya decidida para el LLM: una dependencia por proveedor ata el código a algo que cambia. Photon y Open-Meteo son HTTP/JSON plano |
| **EXT-7** | **`User-Agent` identificativo** en toda petición saliente (`EXTERNAL_USER_AGENT`), y atribución visible en el frontend (Open-Meteo CC-BY, OSM) | User-Agent por defecto de Node | Photon/OSM piden identificarse; `ARCHITECTURE.md` §8 lo exige para Photon y para las tiles |
| **EXT-8** | **Proveedores**: Open-Meteo (meteorología) y **Photon** (geocodificado y POIs por proximidad). **Nominatim descartado** | Nominatim, Overpass, proveedores de pago | `ARCHITECTURE.md` §8: Nominatim prohíbe el uso desde vibe-coding/low-code y exige 1 req/s; Photon cubre el caso. Overpass queda como decisión abierta (§13) para POIs con radio real |
| **EXT-9** | **Geocodificado bajo demanda**, con endpoint propio `POST .../geocode` restringido a `ADMIN`; **no** se llama al proveedor dentro de la transacción de alta/edición de comunidad | Geocodificar automáticamente en `POST`/`PATCH /communities` | Meter I/O de red dentro de una transacción de base de datos la alarga y puede dejarla colgada por un timeout ajeno. El alta sigue siendo local y rápida; quien quiere coordenadas (el frontend, tras crear la comunidad) llama a `geocode` |
| **EXT-10** | El geocodificado **solo escribe `latitude`/`longitude`**; **no** reescribe los campos de dirección del usuario. Devuelve la dirección normalizada para que el frontend la muestre y, si quiere, la guarde | Sobrescribir `city`/`postal_code`/etc. con lo que devuelve Photon | La dirección que escribe un vecino es la suya; "Avinguda Diagonal 1" y "Avenida Diagonal 1" son la misma coordenada y ninguna es "más correcta" que la otra. La máquina aporta la posición, no corrige a la persona |
| **EXT-11** | **`MAP_SEARCH_RADIUS_M`** (radio) y **`MAP_MAX_RESULTS`** (tope) acotan la búsqueda de POIs; los resultados se filtran por **distancia haversine** en el backend y se ordenan por cercanía | Confiar en el `limit` del proveedor | Photon no filtra por radio real: devuelve por cercanía a partir de una `lat`/`lon` de sesgo. Sin filtro propio, "proveedores cercanos" incluiría resultados a 20 km |
| **EXT-12** | **Separación proveedores / puntos de interés por categoría OSM** (`map/categories.ts`), no por un campo del proveedor | Devolver una lista única sin clasificar | El enunciado §8 distingue "proveedores cercanos" de "puntos de interés". La clasificación es una lista blanca de `osm_key`/`osm_value` con etiqueta en castellano; lo que no case va a `pois` |
| **EXT-13** | **`EXTERNAL_APIS_ENABLED`** como interruptor maestro; en `NODE_ENV=test` el router devuelve **siempre** un fake y nunca se sale a la red | Apagar por variable de proveedor | Igual que `AI_ENABLED` (D-6): apagar las integraciones un día sin cuota no debe exigir borrar variables ni desplegar. Y la suite no puede depender de la red ni de un tercero caído |
| **EXT-14** | Se **auditan** las actualizaciones de coordenadas (`audit_logs`, acción `community.geocode`) | No auditar | Cambia un dato persistente de la comunidad con una fuente externa; queda registro de quién lo pidió y con qué resultado |

---

## 3. Estado real del modelo de datos

### 3.1 `communities` (§4.2) — ya existe

Las tres columnas relevantes ya están creadas y **no se tocan**:

```
latitude   numeric(9,6)   -- anulable. NULL = "sin localizar todavía"
longitude  numeric(9,6)   -- anulable. NULL = "sin localizar todavía"
timezone   text not null default 'Europe/Madrid'
```

El `01_schema.sql` ya documenta la intención: *"Anulables a propósito (spec 02,
C-7). NULL significa 'sin localizar todavía', no 'en el centro del mapa'. Quien
las rellena es el bloque de integraciones, con la dirección."* Este es ese bloque.
`timezone` alimenta el parámetro `timezone` de Open-Meteo para que el "hoy" y las
horas de salida/puesta de sol sean locales.

`CommunityView` (`communities/service.ts`) ya expone `latitude`, `longitude` y
`timezone` como `number | null` / `string`; este bloque **no** cambia ese contrato.

### 3.2 `external_cache` — tabla nueva (§4.23)

```
cache_key   text primary key      -- hash normalizado del recurso (ver §5.2)
provider    text not null         -- 'open-meteo' | 'photon'
payload     jsonb not null        -- respuesta YA normalizada, no la cruda
expires_at  timestamptz not null  -- now() + ttl
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()
```

- RLS **habilitada sin política** (como `ai_cache`): nadie la lee por PostgREST.
- `app_runtime` **sin ningún privilegio de tabla**; solo `EXECUTE` sobre las dos
  funciones.
- Índice `external_cache_expires_idx (expires_at)` para el purgado oportunista.
- Se guarda el **payload normalizado** (el DTO), no la respuesta cruda del
  proveedor: si el contrato del proveedor cambia, la caché que se sirve sigue
  siendo del formato que entiende el frontend.

### 3.3 Funciones nuevas (`02m_external.sql`)

```
app_external_cache_get(p_key text)
  returns table (payload jsonb, expires_at timestamptz, is_fresh boolean)
  -- SECURITY DEFINER, STABLE (solo lee). Devuelve la fila AUNQUE esté caducada,
  -- para permitir el stale-while-error (EXT-4). `is_fresh = expires_at > now()`.

app_external_cache_put(p_key text, p_provider text, p_payload jsonb, p_ttl_seconds integer)
  returns void
  -- SECURITY DEFINER, VOLATILE (hace UPSERT). expires_at = now() + ttl.

app_external_cache_purge()
  returns integer
  -- SECURITY DEFINER, VOLATILE. Borra lo caducado; devuelve cuántas filas.
  -- Se invoca de forma oportunista (p. ej. tras un `put`), no por un job (D-4).
```

> Nota de implementación heredada del bloque 11: `get` es `STABLE` (solo `SELECT`)
> y `put`/`purge` son `VOLATILE` y se llaman con `$executeRaw`, **no** `$queryRaw`
> (Postgres rechaza `UPDATE`/`INSERT` dentro de una función no volátil y Prisma no
> sabe deserializar una columna `void`). Ver §15, criterios de aceptación, y la
> comprobación de volatilidad de `04_verify.sql` §19 que ya cazó el bug de
> `app_ai_cache_get`.

---

## 4. Alcance funcional

### 4.1 Widget de meteorología

Muestra, para la ubicación de la comunidad:

- Temperatura actual y sensación térmica.
- Mínima y máxima del día.
- Probabilidad de precipitación del día.
- Condición normalizada (`CLEAR`, `RAIN`, …) + código WMO crudo.
- Hora de salida y puesta de sol (en la zona horaria de la comunidad).
- Atribución de Open-Meteo (extremo a extremo; la pinta el frontend, fuera de
  alcance).

### 4.2 Widget de mapa

Muestra:

- **Ubicación** de la comunidad (`latitude`/`longitude`) y su **dirección**
  compuesta a partir de las columnas que ya existen.
- **Proveedores cercanos**: POIs cuya categoría OSM está en la lista de servicios
  (ferretería, fontanería, electricidad, farmacia, taller, …).
- **Puntos de interés**: el resto de POIs dentro del radio (parques, colegios,
  supermercados, transporte, hostelería, …).

### 4.3 Geocodificado

Un `ADMIN` puede pedir que se rellenen las coordenadas a partir de la dirección
guardada. Es la pieza que hace posibles las dos anteriores.

---

## 5. Modelo de datos y normalización

### 5.1 DTOs (contrato con el frontend)

```ts
type WeatherView = {
  location: { city: string; latitude: number; longitude: number; timezone: string }
  current: {
    temperatureC: number
    apparentTemperatureC: number | null
    weatherCode: number            // WMO crudo
    condition: WeatherCondition    // normalizado (ver §5.3)
    isDay: boolean
  }
  today: {
    minC: number
    maxC: number
    precipitationProbability: number | null
    sunrise: string | null         // ISO 8601 con offset de la zona de la comunidad
    sunset: string | null
  }
  updatedAt: string                // ISO: cuándo se obtuvo del proveedor
  source: string                   // 'open-meteo'
}

type MapView = {
  location: {
    addressLine1: string
    city: string
    province: string | null
    postalCode: string | null
    country: string
    latitude: number | null        // null si aún no se ha geocodificado
    longitude: number | null
    timezone: string
  }
  providers: PlaceView[]           // [] si degradado (§6.4)
  pois: PlaceView[]
  updatedAt: string | null
  source: string                   // 'photon'
}

type PlaceView = {
  name: string
  category: string                 // etiqueta en castellano (EXT-12)
  osmKey: string
  osmValue: string
  latitude: number
  longitude: number
  distanceM: number                // haversine, redondeado
  address: string | null           // compuesta si Photon la trae
}

type GeocodeResult = {
  latitude: number
  longitude: number
  formattedAddress: string | null
  source: string
}
```

### 5.2 Claves de caché

| Recurso | `cache_key` | TTL (`expires_at`) |
|---|---|---|
| Meteorología | `sha256('weather:' + round(lat,4) + ',' + round(lon,4) + ':' + timezone)` | `WEATHER_CACHE_TTL_MINUTES` (15) |
| Mapa / POIs | `sha256('map:' + round(lat,4) + ',' + round(lon,4) + ':' + radiusM + ':' + maxResults)` | `MAP_CACHE_TTL_MINUTES` (60) |
| Geocodificado | `sha256('geo:' + lower(trim(collapse(spaces(address)))))` | `GEOCODE_CACHE_TTL_HOURS` (168) |

- Redondear a 4 decimales (~11 m) agrupa comunidades vecinas en la misma entrada
  sin que el dato meteorológico cambie de forma perceptible.
- El `sha256` en `cache_key` evita meter direcciones (dato personal) en claro en
  la tabla.
- `provider` se guarda aparte para diagnóstico; no forma parte de la clave.

### 5.3 Normalización de meteorología

- Petición a Open-Meteo:
  `GET {OPEN_METEO_BASE_URL}/v1/forecast?latitude=&longitude=&current=temperature_2m,apparent_temperature,is_day,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone={tz}&forecast_days=1`
- Códigos WMO → `WeatherCondition` en `weather/normalize.ts` (tabla explícita,
  sin heurística de rangos sueltos), y de ahí a una etiqueta en castellano.
  Código desconocido → `UNKNOWN` (no se inventa).
- Valores ausentes → `null` en el campo, nunca `0` (un `0` falso de temperatura es
  peor que un hueco).

### 5.4 Normalización de mapa (Photon → proveedores/POIs)

- Petición a Photon:
  `GET {PHOTON_BASE_URL}/api/?lat=&lon=&limit={MAP_MAX_RESULTS}&lang=es`
  (GeoJSON `FeatureCollection`).
- `map/categories.ts` mapea `properties.osm_key`/`osm_value` a una categoría y a
  una etiqueta en castellano. Dos listas: `PROVIDER_CATEGORIES` y
  `POI_CATEGORIES`; sin match → `POI_CATEGORIES` genérico (`OTRO`).
- Distancia con haversine; se descarta lo que supera `MAP_SEARCH_RADIUS_M`
  (EXT-11); se ordena por `distanceM` ascendente y se corta a `MAP_MAX_RESULTS`.

---

## 6. Adaptadores y degradación

### 6.1 Interfaz

```ts
type WeatherProvider = {
  readonly name: string
  fetchWeather(input: { latitude: number; longitude: number; timezone: string; signal?: AbortSignal }): Promise<WeatherReading>
}

type GeocodingProvider = {
  readonly name: string
  geocode(input: { address: string; signal?: AbortSignal }): Promise<GeocodeResult | null>
  searchNearby(input: { latitude: number; longitude: number; radiusM: number; limit: number; signal?: AbortSignal }): Promise<PlaceView[]>
}
```

> **`WeatherReading` en lugar de `WeatherView`.** El proveedor devuelve (y la caché
> guarda) un `WeatherReading`: el `WeatherView` de §5.1 **sin** el bloque
> `location`. `location.city` es dato de la comunidad, no del proveedor, y la
> clave de caché (`weather:<lat>,<lon>:<tz>`) no incluye la ciudad; si la ciudad
> viajara dentro del payload cacheado, dos comunidades con las mismas coordenadas
> redondeadas compartirían entrada y la segunda recibiría el nombre de la primera.
> El service añade `location` al componer el DTO.
>
> El `signal` es opcional: `integrations/http.ts` aplica `AbortSignal.timeout`
> por defecto (§6.3) y solo se sustituye cuando un test inyecta el suyo.

Implementaciones: `weather/open-meteo.ts`, `map/photon.ts` (reales) y
`weather/fake.ts`, `map/fake.ts` (tests), con el mismo formato guionizable que
`FakeLLMClient` (lista de respuestas + `calls`). `integrations/providers.ts` es el
router: `getWeatherProvider()` / `getGeocodingProvider()`, con
`setWeatherProvider()` / `setGeocodingProvider()` / `resetProviders()` para tests.

### 6.2 Selección (`providers.ts`)

1. `EXTERNAL_APIS_ENABLED=false` → `null` (modo degradado, EXT-13).
2. `NODE_ENV=test` → fake (nunca red).
3. `WEATHER_PROVIDER=open-meteo` → `OpenMeteoProvider`; `MAP_PROVIDER=photon` →
   `PhotonProvider`.

### 6.3 Timeout y errores de red

`integrations/http.ts` centraliza `fetch` con `AbortSignal.timeout(EXTERNAL_HTTP_TIMEOUT_MS)`,
cabecera `User-Agent`, `Accept: application/json`, y convierte cualquier fallo
(network, timeout, `!response.ok`, JSON inválido, forma inesperada) en un
`ExternalProviderError`. El service **no** ve `Response` ni `fetch`.

### 6.4 Matriz de degradación

| Situación | `weather` | `map` | `geocode` |
|---|---|---|---|
| Todo bien | `200`, `data` completo | `200`, `data` completo | `200`, `data` + coords escritas |
| Hay caché fresca | `200`, `meta.cached=true`, sin llamar al proveedor | igual | igual |
| Proveedor cae, hay caché (aunque caducada) | `200`, `data` de caché, `meta.stale=true` | igual (POIs de caché) | `502 EXTERNAL_PROVIDER_ERROR` |
| Proveedor cae, sin caché | `200`, `data:null`, `meta.reason='PROVIDER_ERROR'` | `200`, `location` de BD + `providers:[]`/`pois:[]`, `meta.degraded=true` | `502` |
| Comunidad sin coordenadas | `200`, `data:null`, `meta.reason='NO_LOCATION'` | `200`, `location` con coords `null`, listas vacías, `meta.reason='NO_LOCATION'` | `422 GEOCODING_FAILED` (no hay dirección/coords que resolver) |
| `EXTERNAL_APIS_ENABLED=false` | `200`, `data:null`, `meta.reason='DISABLED'` | `200`, `location` de BD, listas vacías, `meta.reason='DISABLED'` | `503 EXTERNAL_NOT_CONFIGURED` |
| Dirección no resoluble | — | — | `422 GEOCODING_FAILED` |

`map.location` sale **siempre** de la base de datos (nunca `null`), porque es dato
propio: solo los POIs dependen del proveedor.

---

## 7. API

### 7.1 `GET /api/v1/communities/:communityId/weather`

- **Auth:** `requireAuth` + `requireCommunity()` (cualquier miembro activo; todos
  los roles, proveedor incluido).
- **Query:** ninguna.
- **200:** `{ data: WeatherView | null, meta: { cached, stale, degraded, reason?, source? } }`.
- **Errores:** `401` sin sesión; `403`/`404` por `requireCommunity` (ajena/inexistente, C-8).

### 7.2 `GET /api/v1/communities/:communityId/map`

- **Auth:** `requireAuth` + `requireCommunity()`.
- **200:** `{ data: MapView, meta: { cached, stale, degraded, reason?, source? } }`.
- **Errores:** igual que §7.1.

### 7.3 `POST /api/v1/communities/:communityId/geocode`

- **Auth:** `requireAuth` + `requireCommunityRole('ADMIN')`.
- **Body:** vacío. Usa la dirección guardada de la comunidad.
- **Comportamiento:** geocodifica → si encuentra coordenadas, hace `UPDATE` de
  `communities.latitude/longitude` y audita `community.geocode`; si no, `422`.
- **200:** `{ data: GeocodeResult }`.
- **Errores:** `401`; `403` si no es `ADMIN`; `422 GEOCODING_FAILED` si la
  dirección no resuelve; `502 EXTERNAL_PROVIDER_ERROR` si el proveedor cae o se
  agota el timeout; `503 EXTERNAL_NOT_CONFIGURED` si las integraciones están
  apagadas.

> **Decisión abierta A-1 (§13):** si `geocode` debe aceptar un cuerpo
> `{ address? }` para *previsualizar* coordenadas sin guardarlas (`dryRun`), útil
> en un formulario de alta antes del `POST /communities`. Por defecto, esta spec
> lo deja fuera (solo resuelve la dirección ya guardada).

---

## 8. Permisos

| Endpoint | Rol mínimo |
|---|---|
| `GET .../weather` | cualquier miembro activo |
| `GET .../map` | cualquier miembro activo |
| `POST .../geocode` | `ADMIN` |

El aislamiento entre comunidades lo impone `requireCommunity()`, como en el resto
del proyecto: un `communityId` ajeno y uno inexistente son el mismo
`403`/`404` (C-8). `geocode` es el único que escribe, y escribe una columna que
`PATCH /communities/:id` ya permitía tocar a un `ADMIN` (mismo nivel de permiso).

---

## 9. Configuración (env)

Todas **opcionales y con default**, como las de IA: sin configurar, la app arranca
y funciona en modo degradado.

| Variable | Default | Uso |
|---|---|---|
| `EXTERNAL_APIS_ENABLED` | `true` | Interruptor maestro (EXT-13) |
| `EXTERNAL_HTTP_TIMEOUT_MS` | `8000` | Timeout de cada llamada saliente |
| `EXTERNAL_USER_AGENT` | `CommunityHub (community-hub example)` | Identificación ante Photon/OSM (EXT-7) |
| `WEATHER_PROVIDER` | `open-meteo` | Router (§6.2) |
| `OPEN_METEO_BASE_URL` | `https://api.open-meteo.com` | Base del proveedor |
| `WEATHER_CACHE_TTL_MINUTES` | `15` | TTL meteorología (§5.2) |
| `MAP_PROVIDER` | `photon` | Router (§6.2) |
| `PHOTON_BASE_URL` | `https://photon.komoot.io` | Base del proveedor |
| `MAP_CACHE_TTL_MINUTES` | `60` | TTL POIs (§5.2) |
| `GEOCODE_CACHE_TTL_HOURS` | `168` | TTL geocodificado (una dirección no se mueve) |
| `MAP_SEARCH_RADIUS_M` | `1500` | Radio de POIs (EXT-11) |
| `MAP_MAX_RESULTS` | `25` | Tope de resultados (EXT-11) |

En `NODE_ENV=test` el router devuelve fake independientemente de lo anterior
(§6.2). No hay ninguna clave de API en este bloque: Open-Meteo y Photon son
anónimos.

---

## 10. Códigos de error nuevos (`http/errors.ts`)

| Código | HTTP | Cuándo |
|---|---|---|
| `EXTERNAL_PROVIDER_ERROR` | `502` | `geocode` cuando el proveedor falla o agota el timeout |
| `GEOCODING_FAILED` | `422` | La dirección no resuelve a coordenadas |
| `EXTERNAL_NOT_CONFIGURED` | `503` | `geocode` con `EXTERNAL_APIS_ENABLED=false` |

`weather` y `map` **no** añaden códigos de error: degradan con `meta.reason`
(EXT-2).

---

## 11. Validaciones y casos límite

1. `communityId` no-UUID → `400` (validación de ruta existente).
2. Comunidad ajena o inexistente → `403`/`404` (C-8), vía `requireCommunity`.
3. Comunidad sin `latitude`/`longitude` → `NO_LOCATION` (EXT-2, §6.4).
4. `latitude`/`longitude` fuera de rango (corrupción de datos) → se trata como
   `NO_LOCATION`; nunca se llama al proveedor con coordenadas inválidas.
5. Proveedor devuelve JSON sin los campos esperados → `ExternalProviderError`
   (degradación), no un `TypeError` a media normalización.
6. `timezone` inválida para Open-Meteo → se pide con `timezone=auto` como
   `fallback` y se registra; no rompe la respuesta.
7. Lista de POIs vacía (zona sin datos en OSM) → `providers:[]`/`pois:[]` con
   `200`, no un error: es un resultado válido.
8. `geocode` sin dirección que geocodificar (campos vacíos) → `422`.
9. `geocode` de una dirección que resuelve a varias → se toma la de mayor
   confianza de Photon (`properties.extent`/orden); no se pide desambiguación en
   este bloque.
10. Dirección editada después de geocodificar → las coordenadas guardadas pueden
    quedar desfasadas; no se invalida automáticamente. El frontend debe volver a
    llamar a `geocode` tras cambiar la dirección (documentado).
11. `EXTERNAL_APIS_ENABLED=false` → degradación (§6.4).
12. Timeout del proveedor → `ExternalProviderError` → degradación/`502` según
    endpoint.
13. Caché con `payload` de un formato antiguo (esquema cambiado entre versiones) →
    se valida al leer; si no encaja, se ignora y se refresca.

---

## 12. Estructura del backend

```
backend/src/integrations/
├── http.ts            # fetch + timeout + User-Agent + ExternalProviderError
├── cache.ts           # app_external_cache_get/put/purge + TTLs + claves (§5.2)
├── providers.ts       # router get/set/reset de los dos proveedores (§6.2)
├── errors.ts          # ExternalProviderError (interno, no HTTP)
├── types.ts           # DTOs (§5.1) e interfaces WeatherProvider/GeocodingProvider
├── validators.ts      # schemas zod de caché (payloads antiguos, §11.13)
├── weather/
│   ├── open-meteo.ts  # WeatherProvider real
│   ├── fake.ts        # WeatherProvider de test
│   └── normalize.ts   # WMO -> WeatherCondition -> etiqueta (§5.3)
├── map/
│   ├── photon.ts      # GeocodingProvider real
│   ├── fake.ts        # GeocodingProvider de test
│   ├── geo.ts         # haversine + filtro por radio + orden + recorte (§5.4)
│   └── categories.ts  # osm_key/osm_value -> categoría + etiqueta (§5.4)
├── service.ts         # orquesta: coords -> caché -> proveedor -> normaliza -> DTO
├── repository.ts      # lectura de communities y escritura de coords
├── controller.ts
└── routes.ts          # un router: las tres rutas cuelgan de /communities/:communityId
```

Montaje en `app.ts`: `app.use('/api/v1/communities', createExternalRouter())`.

### SQL y scripts

- Nuevo `supabase/sql/02m_external.sql` (tabla `external_cache`, RLS sin política,
  dos/tres funciones `SECURITY DEFINER`, GRANTs a `app_runtime` y revoke de
  PUBLIC, autocomprobación `do $$` como `02l`).
- `02_rls.sql`: `enable row level security` sobre `external_cache` (por coherencia
  con `ai_cache`; el `revoke all` también aquí).
- `01_schema.sql` §6: la comprobación "debe devolver 20" pasa a **21** (nueva
  tabla). Igual en cualquier conteo de tablas de `04_verify.sql`.
- `04_verify.sql`: nueva sección para la spec 12 (antes del INFORME) — existencia y
  `prosecdef`/`search_path` de las funciones, `external_cache` con RLS y sin
  privilegios para `app_runtime`, y **comprobación de volatilidad** de
  `app_external_cache_put`/`purge` (la que en el bloque 11 cazó el bug de
  `app_ai_cache_get`).
- `backend/prisma/apply-sql.ts`: `02m_external.sql` en `FILES` (tras `02l_ai.sql`).
- Modelo Prisma `ExternalCache` (para `$queryRaw`/`$executeRaw` tipados).

---

## 13. Decisiones abiertas (a cerrar en la revisión)

- **A-1 — `geocode` con vista previa.** ¿Se acepta `POST .../geocode` con
  `{ address?, dryRun? }` para previsualizar coordenadas sin guardar? Por defecto
  **no** (§7.3).
- **A-2 — POIs con radio real.** Photon no filtra por radio: sesga por cercanía y
  el filtro real lo hacemos nosotros (EXT-11). Si en pruebas la calidad es pobre,
  el sustituto natural es **Overpass API** (gratis, sin clave, consultas por
  radio) como `MAP_PROVIDER=overpass`, manteniendo `GeocodingProvider` en Photon
  para el geocodificado. Por defecto: **solo Photon** (EXT-8).
- **A-3 — `get_weather` como tool de IA.** El `ToolRegistry` del bloque 11
  (`ARCHITECTURE.md` §12) lista `get_weather()`, que no se implementó porque el
  service no existía. Ahora podría añadirse como tool de solo lectura. Por
  defecto: **fuera de alcance** de este bloque; se propone como bloque corto
  siguiente (una tool + su test), para no mezclar dos dominios en un commit.
- **A-4 — Caché y `prefetch`.** ¿El alta de una comunidad debería disparar un
  geocodificado *best-effort* en segundo plano (fire-and-forget) además del
  endpoint manual? Por defecto **no** (EXT-9): sin infraestructura de jobs en el
  proyecto (D-4 de la spec 08).

---

## 14. Tests

### Unit (`*.unit.test.ts`)

- `weather/normalize`: tabla WMO completa (cada código → condición + etiqueta) y
  código desconocido → `UNKNOWN`; campos ausentes → `null`.
- `map/categories`: clasificación proveedor/POI y etiquetas; `osm_key`/`osm_value`
  desconocidos → `OTRO`/`pois`.
- Haversine: distancia y orden; filtro por radio; recorte a `MAP_MAX_RESULTS`.
- `cache.ts`: construcción y normalización de claves (§5.2); elección de TTL.
- `open-meteo`/`photon` (con `fetch` mockeado): parseo, `!ok`, JSON inválido,
  timeout → `ExternalProviderError`.
- `service`: caché fresca → no llama al proveedor; proveedor cae con caché
  caducada → `stale:true`; proveedor cae sin caché → degradación.
- `providers.ts`: selección por env; `EXTERNAL_APIS_ENABLED=false` → `null`; fake
  en `NODE_ENV=test`.

### Integración (`integrations.api.integration.test.ts`)

Con los fakes inyectados vía `setWeatherProvider`/`setGeocodingProvider`:

1. `GET .../weather`: `200` con DTO correcto para un miembro; `401` anónimo;
   `403`/`404` comunidad ajena.
2. `weather` sin coordenadas → `200`, `data:null`, `meta.reason='NO_LOCATION'`.
3. `weather` con proveedor que falla y sin caché → degradación (`PROVIDER_ERROR`).
4. `weather` dos veces → la segunda `meta.cached=true` y el fake llamado una sola
   vez.
5. `GET .../map`: `200` con `location` + `providers`/`pois` separados y ordenados.
6. `map` con proveedor que falla → `location` presente, listas vacías,
   `degraded=true`.
7. `POST .../geocode`: `ADMIN` → `200` y `communities.latitude/longitude`
   actualizados (se leen de vuelta); audita `community.geocode`.
8. `geocode` `403` para no-ADMIN; `422` si no resuelve; `502` si el proveedor cae.
9. `EXTERNAL_APIS_ENABLED=false`: `weather`/`map` degradan con `DISABLED`;
   `geocode` → `503`.
10. Aislamiento: un miembro de A no obtiene datos de B (C-8) en los tres endpoints.

### SQL (`04_verify.sql`, nueva sección antes del INFORME)

- `external_cache` existe, con RLS habilitada y sin política.
- `app_runtime` sin privilegios de tabla sobre `external_cache`.
- Las funciones son `SECURITY DEFINER`, `search_path` fijo, no ejecutables por
  PUBLIC; `put`/`purge` son `VOLATILE` (comprobación de regresión del bloque 11).

### Criterio transversal

La suite entera pasa **sin conexión a internet** y sin ninguna clave (EXT-13),
igual que con la IA (AI-3).

---

## 15. Criterios de aceptación

1. `GET /communities/:id/weather` devuelve un `WeatherView` normalizado para un
   miembro, con `200`.
2. Un no-miembro recibe `403`/`404` (C-8); un anónimo, `401`.
3. Sin coordenadas, `weather` devuelve `200` con `data:null` y
   `meta.reason='NO_LOCATION'`, no un error.
4. Si el proveedor cae, `weather` / `map` degradan (`data:null` / listas vacías)
   y **nunca** devuelven `5xx`.
5. Con caché fresca, el proveedor no se vuelve a llamar en el TTL
   (`meta.cached=true`).
6. Con caché caducada y proveedor caído, se sirve la caché con `meta.stale=true`.
7. `GET /communities/:id/map` devuelve `location` (siempre, desde BD),
   `providers` y `pois` filtrados por radio y ordenados por distancia.
8. `POST /communities/:id/geocode` (solo `ADMIN`) rellena `latitude`/`longitude` y
   devuelve `GeocodeResult`; audita `community.geocode`.
9. `geocode` por un no-`ADMIN` → `403`; dirección irresoluble → `422`; proveedor
   caído → `502`.
10. `EXTERNAL_APIS_ENABLED=false` desactiva las integraciones: `weather`/`map`
    degradan con `meta.reason='DISABLED'`; `geocode` → `503`.
11. Ningún endpoint expone claves ni llama al proveedor desde el cliente (no hay
    claves: Open-Meteo y Photon son anónimos; la regla se mantiene para el futuro).
12. `external_cache` tiene RLS sin política y `app_runtime` no tiene privilegios de
    tabla; las funciones son `SECURITY DEFINER` con `search_path` fijo, no
    ejecutables por PUBLIC, y `put`/`purge` son `VOLATILE`.
13. La suite entera (unit + integración) pasa **sin red** y sin claves.
14. `npm run db:verify` termina sin excepciones, con la sección de la spec 12.
15. `npm run typecheck` y `npm run test:unit` en verde.

---

## 16. Documentación a actualizar (al implementar)

- `docs/API.md`: sección de los tres endpoints y los tres códigos de error nuevos.
- `docs/SECURITY.md` §8: recuento de endpoints (de 72 a **75**) y párrafo del
  bloque; nota de que no hay claves de proveedor y de la caché como control de
  cuota.
- `docs/README.md`: fila "APIs externas".
- `ARCHITECTURE.md` §8: marcar los endpoints como implementados y referenciar
  `specs/12-external-apis.md`.
- `.env.example`: las doce variables de §9.

---

## 17. Fuera de alcance

- **Frontend**: widget de meteorología en React, mapa con Leaflet/OSM tiles y la
  atribución visible. Este spec es solo de la API; la UI es del bloque de
  frontend. El frontend recibe DTOs normalizados y **no** conoce al proveedor
  (EXT-1).
- **Overpass API** para POIs con radio real: decisión abierta A-2; si se adopta,
  es un `MAP_PROVIDER` más detrás de la misma interfaz.
- **OSRM** (rutas/distancias): `ARCHITECTURE.md` §8 lo lista como opcional; no se
  usa en este bloque (EXT-8).
- **Tool de IA `get_weather`** y cualquier otra tool que consuma estos datos:
  fuera de alcance por A-3; el `ToolRegistry` ya existe y sería un bloque corto
  aparte.
- **Servidor MCP** (`ARCHITECTURE.md` §12) y su adaptador sobre el
  `ToolRegistry`: bloque propio.
- **Prefetch automático** al crear/editar comunidad: descartado por A-4 / EXT-9.
- **Proveedores de pago** (Google Maps, Mapbox, OpenWeather, …): descartados por
  el coste $0 (EXT-8); el diseño de adaptadores deja añadirlos sin tocar el
  service si algún día se justifica.
- **Notificaciones** meteorológicas o de cambios de mapa: no se generan.

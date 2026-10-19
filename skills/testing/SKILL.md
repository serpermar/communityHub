# Skill: testing

## Cuándo usarla
Al escribir o revisar tests de cualquier capa.

## Contexto que hay que tener presente
- **Unitarios** (`*.unit.test.ts`): sin base de datos, sin red. Arrancan en
  segundos. Corren con `npm run test:unit`.
- **Integración** (`*.integration.test.ts`): contra una base real, con RLS.
  Corren con `npm run test:integration`.
- Regla de los fixtures: **sembrar con privilegio, afirmar con restricción.** Los
  datos se crean con el rol `admin` (BYPASSRLS) y se comprueba con el rol de la
  aplicación / la API, que es donde las políticas mueren.
- Un test afirma sobre el ESTADO, no solo sobre la respuesta HTTP. Un 200 con el
  cuerpo inventado debe hacer fallar el test.

## Procedimiento
1. Decide la capa: si toca la base de datos o RLS, es integración.
2. Reutiliza los helpers de `src/__tests__/helpers.ts`.
3. Escribe el caso que fallaría si la protección no existiera (el "por si acaso
   no está").
4. Limpia lo que crees en `afterEach`/`afterAll`.
5. No llames a servicios externos reales: usa los dobles (LLM fake, weather
   fake).

## Errores típicos
- Un test "unitario" que abre conexión a base de datos.
- Comprobar solo el código HTTP y no la fila.
- Compartir contadores de rate limit entre tests.
- Dejar datos huérfanos que rompen el test siguiente.

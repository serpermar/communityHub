# Ejemplos: gestión de incidencias

## Ejemplo 1 — Ascensor parado
Entrada: "el ascensor lleva parado desde ayer por la tarde".

Clasificación esperada:
- categoría: `ELEVATOR`
- prioridad: `HIGH` (servicio esencial caído, sin riesgo inmediato)
- título: "Ascensor parado desde ayer por la tarde"
- `needsHumanReview`: `false` (confianza alta)
- `created_via` al confirmar: `AI_SUGGESTION`

## Ejemplo 2 — Fuga de agua en el garaje
Entrada: "hay agua saliendo por una junta en el garaje, cada vez más".

Clasificación esperada:
- categoría: `PLUMBING`
- prioridad: `CRITICAL` (riesgo de daños graves y posible riesgo eléctrico)
- `needsHumanReview`: `true` (siempre en `CRITICAL`)
- Acción: escalar de inmediato a la empresa mantenedora.

## Ejemplo 3 — Descripción ambigua
Entrada: "no sé, algo va mal en mi bloque".

Conducta esperada: NO inventar. Pedir más detalle antes de proponer nada.
El asistente responde que no puede clasificarlo sin saber qué falla.

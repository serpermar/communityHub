# Playbook: triage de incidencias

## Objetivo
Asignar categoría y prioridad correctas a una incidencia nueva en el menor tiempo
posible, y dejar claro si necesita revisión humana.

## Pasos
1. Lee la descripción completa y busca el síntoma concreto (qué falla, dónde,
   desde cuándo).
2. Elige la categoría entre `ELEVATOR`, `ELECTRICITY`, `PLUMBING`, `CLEANING`,
   `SECURITY`, `HEATING`, `OTHER`.
3. Fija la prioridad:
   - `CRITICAL`: riesgo para personas o para la habitabilidad (ascensor con gente
     dentro, fuga de gas, agua en zonas comunes).
   - `HIGH`: servicio esencial caído sin riesgo inmediato (ascensor parado, sin
     agua caliente en todo el edificio).
   - `MEDIUM`: molestia relevante pero con alternativa.
   - `LOW`: cosmética o que puede esperar.
4. Si la confianza de la clasificación es baja o la prioridad es `CRITICAL`,
   marca `needsHumanReview`.
5. Propón un título corto (una línea) y una descripción reescrita en tercera
   persona.

## Regla de oro
Ante duda entre dos prioridades, sube. Una incidencia cerrada antes de tiempo
cuesta más que una revisada de más.

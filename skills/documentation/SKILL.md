# Skill: documentación

## Cuándo usarla
Al escribir specs, README, docstrings, ADRs o al actualizar la documentación tras
un cambio.

## Contexto que hay que tener presente
- El proyecto sigue un flujo **SDD**: `IDEA → SPEC → REVIEW → PLAN →
  IMPLEMENTATION → TEST → SECURITY REVIEW → DOCS → MERGE`. La spec se aprueba
  antes de implementar.
- Las specs viven en `specs/` y su estado es explícito (`DRAFT`, `REVIEW`,
  `APPROVED`, `IMPLEMENTING`, `DONE`).
- La documentación explica el **porqué**, no el qué. El qué ya está en el código.

## Procedimiento
1. Antes de escribir, lee la spec del bloque y el código afectado.
2. Documenta las decisiones y sus alternativas descartadas, no solo el resultado.
3. Actualiza cada documento que quede desincronizado (arquitectura, README de
   docs, seguridad, API) en el mismo cambio.
4. Marca la spec con su estado final cuando el bloque se cierra.

## Reglas de estilo
- Castellano, directo, sin relleno.
- Sin emojis.
- Los ejemplos deben poder ejecutarse tal cual están escritos.

## Errores típicos
- Documentar la intención en vez de lo que hay.
- Dejar una spec en `APPROVED` después de implementar.
- Añadir un documento nuevo cuando lo correcto era ampliar uno existente.

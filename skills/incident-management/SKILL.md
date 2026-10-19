# Skill: gestión de incidencias

## Cuándo usarla
Al registrar, clasificar, priorizar, asignar, escalar o cerrar una incidencia de
una comunidad.

## Contexto que hay que tener presente
- Una incidencia siempre pertenece a una comunidad y tiene un `reporter`.
- La clasificación (categoría, prioridad, título) la puede proponer la IA, pero
  **crear la incidencia es una acción humana**. La IA solo produce borradores
  (`incident_drafts`) que alguien confirma.
- `created_via` distingue cómo nació la incidencia (`MANUAL`, `AI_SUGGESTION`).
  No es decorativo: deja rastro de qué decidió una persona y qué propuso la IA.
- Los estados y transiciones están en `playbooks/triage.md`, `escalado.md` y
  `cierre.md` de esta skill.

## Procedimiento
1. Determina la comunidad y comprueba pertenencia.
2. Si la descripción es ambigua, propón categoría y prioridad y pide confirmación
   humana (borrador), nunca crees directo.
3. Registra la incidencia con `created_via` correcto.
4. Sigue el playbook de triage para decidir prioridad y si hay que escalar.

## Errores típicos
- Confundir el borrador con la incidencia: confirmar un borrador es lo que crea
  la fila.
- Inventar la categoría cuando el clasificador no está configurado: hay que decir
  que no se sabe, no adivinar.

## Verificación
- Una incidencia creada por IA lleva `created_via = AI_SUGGESTION` y el
  `reporter_id` de la persona que la confirmó.
- `classify` nunca escribe en `incidents`.

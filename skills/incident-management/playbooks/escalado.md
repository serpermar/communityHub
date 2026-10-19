# Playbook: escalado de incidencias

## Objetivo
Decidir cuándo una incidencia deja de ser una tarea interna y hay que avisar a
terceros (seguros, empresa mantenedora, servicios de emergencia).

## Cuándo escalar
- `CRITICAL` o riesgo para personas: aviso inmediato, no esperar confirmación.
- Proveedor externo implicado (ascensor, calderas): avisar a la empresa
  mantenedora aunque el estado siga abierto.
- Que afecte a varias comunidades: es un problema de plataforma, no local.

## Pasos
1. Confirma el ámbito: ¿una comunidad o varias?
2. Registra el cambio de estado a `IN_PROGRESS` con nota de a quién se avisó.
3. Anota en la incidencia el contacto y la referencia externa, si la hay.
4. No cierres hasta tener confirmación de que el problema está resuelto.

## Regla de oro
Escalar no es abandonar: la incidencia sigue viva y con un responsable dentro de
la comunidad.

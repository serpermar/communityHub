# Playbook: cierre de incidencias

## Objetivo
Cerrar una incidencia solo cuando el problema está de verdad resuelto y queda
constancia de cómo se resolvió.

## Condiciones para cerrar
- El síntoma descrito ya no ocurre.
- Hay una nota de resolución (qué se hizo y quién).
- Si hubo coste, está registrado como gasto y enlazado.

## Pasos
1. Comprueba el estado actual con quien reportó (o con el responsable).
2. Cambia el estado a `RESOLVED` y, después, a `CLOSED`.
3. Escribe la nota de cierre: causa, acción y seguimiento si hace falta.
4. No borres incidencias: se conservan como histórico.

## Regla de oro
Una incidencia sin nota de cierre no está cerrada, está escondida.

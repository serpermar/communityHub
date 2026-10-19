# Skill: reservas de zonas comunes

## Cuándo usarla
Al consultar disponibilidad de zonas comunes, crear reservas, cancelarlas o
listar las reservas de un usuario o de la comunidad.

## Contexto que hay que tener presente
- Una reserva siempre es de una zona común de una comunidad concreta.
- No se puede reservar dos veces el mismo hueco: la colisión se detecta contra
  las reservas confirmadas, no contra las canceladas.
- La zona puede tener reglas propias (horario, duración máxima, aforo).
- Las reservas se acotan por RLS a la comunidad del actor.

## Procedimiento
1. Comprueba pertenencia a la comunidad.
- Comprueba disponibilidad en el rango pedido antes de crear.
- Al crear, valida que el rango esté dentro del horario permitido y que no se
  solape con otra reserva activa.
- Cancelar es cambiar de estado, no borrar: queda histórico.

## Errores típicos
- Ofrecer un hueco que ya está reservado por solapamiento de bordes (fin de una =
  inicio de otra).
- Permitir reservar en el pasado.
- Olvidar la zona horaria de la comunidad.

## Verificación
- Dos reservas solapadas en la misma zona: la segunda recibe conflicto.
- Cancelar una reserva libera el hueco para otra.

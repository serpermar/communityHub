# Skill: finanzas de la comunidad

## Cuándo usarla
Al consultar gastos, cuotas/recibos o el resumen financiero, o al razonar sobre
importes y saldos.

## Contexto que hay que tener presente
- Los datos económicos son **sensibles**: solo `ADMIN` los ve. Ni siquiera
  `PRESIDENT` por el hecho de serlo.
- Los importes son `numeric` en la base de datos; nunca se usan `float`. La
  aritmética se hace en decimal, no en coma flotante.
- `expenses` es de solo lectura para el rol de la aplicación: las escrituras van
  por función dedicada que deja rastro de auditoría.

## Procedimiento
1. Comprueba pertenencia y que el rol es `ADMIN`.
2. Al listar, respeta los filtros (fecha, categoría, importe, estado).
3. Al presentar un importe, incluye siempre la moneda y el redondeo a 2
   decimales.
4. El saldo se calcula como ingresos menos gastos; no lo inventes a partir de
   listados parciales.

## Errores típicos
- Sumar importes en coma flotante (0.1 + 0.2 ≠ 0.3).
- Mostrar un saldo calculado sobre una página filtrada, no sobre el total.
- Exponer datos económicos a un agente externo sin supervisión.

## Verificación
- Un `NEIGHBOR` no ve ninguna tool de finanzas en el catálogo.
- Los totales cuadran con la suma de las filas.

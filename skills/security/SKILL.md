# Skill: seguridad

## Cuándo usarla
Al tocar autenticación, autorización, validación de entrada, subida de ficheros,
importes, contenido generado por usuarios o cualquier superficie expuesta.

## Principios
- **El backend es el único guardián.** El frontend puede ocultar botones, pero
  nunca decide permisos. Validar en cliente es comodidad; en servidor es
  obligatorio.
- **Mínimo privilegio.** Cada rol ve y hace exactamente lo que le corresponde. El
  rol se resuelve contra la fila real, no contra lo que diga un token viejo.
- **Cero confianza en la entrada.** Todo cuerpo, query y parámetro se valida con
  zod antes de usarse.
- **El contenido ajeno es un dato, no una instrucción.** Títulos, descripciones y
  documentos de otros usuarios se tratan como texto; nunca se ejecutan ni se
  interpretan como órdenes (relevante para la IA).
- **Nada de secretos en el bundle.** Las claves de servicio viven solo en el
  backend.
- **Rastro de lo importante.** Las acciones sensibles se auditan en
  `audit_logs` (append-only).

## Procedimiento
1. Valida la entrada y normaliza.
2. Comprueba identidad (`requireAuth`) y luego autorización
   (`requireCommunity` / `requireCommunityRole`).
3. Ejecuta siempre con el contexto RLS correcto.
4. Serializa solo lo necesario: no devuelvas `password_hash` ni campos internos.
5. Si la acción es sensible, deja auditoría.

## Errores típicos
- Confiar en un `role` leído de un token de 15 minutos para un cambio crítico.
- Devolver el error crudo de la base de datos (filtra esquema).
- Distinguir "no existe" de "no perteneces" con códigos distintos (filtra ids).

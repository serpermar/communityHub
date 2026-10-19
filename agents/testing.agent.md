---
name: testing
kind: development
skills: testing
---

# Agente de testing

Escribes y revisas tests del proyecto.

## Cómo trabajas
- Eliges la capa correcta: si toca base de datos o RLS, es integración.
- Sembrando con privilegio, afirmando con restricción.
- Cada test afirma sobre el estado, no solo sobre la respuesta HTTP.
- Usas dobles para todo lo externo (LLM, meteorología).

## Qué NO haces
- No escribes tests que dependan de red o de servicios externos reales.
- No apruebas un cambio sin el test que fallaría si la protección no existiera.

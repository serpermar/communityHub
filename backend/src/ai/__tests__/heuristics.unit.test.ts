// ---------------------------------------------------------------------------
// Clasificacion por reglas (unitarios).
//
// La heuristica es la red de seguridad del modo degradado (AI-3): sin proveedor,
// `classify` no puede quedarse en blanco. Lo que se comprueba aqui:
//
//   - Detecta categoria por palabras (ascensor, agua, luz...), en castellano y
//     sin tildes.
//   - Sube la prioridad a CRITICAL/HIGH con las palabras de alarma.
//   - `needsHumanReview` es SIEMPRE true y la confianza nunca llega al umbral:
//     una regla de vocabulario no decide sola (AI-12).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { classifyByHeuristic } from '../heuristics.js'

describe('classifyByHeuristic', () => {
  it('detecta ELEVATOR por "ascensor"', () => {
    expect(classifyByHeuristic('El ascensor hace un ruido raro').category).toBe('ELEVATOR')
  })

  it('detecta PLUMBING por "fuga" y "agua"', () => {
    expect(classifyByHeuristic('Hay una fuga de agua en el baño').category).toBe('PLUMBING')
  })

  it('detecta ELECTRICITY por "luz"', () => {
    expect(classifyByHeuristic('No funciona la luz del portal').category).toBe('ELECTRICITY')
  })

  it('detecta HEATING por "caldera"', () => {
    expect(classifyByHeuristic('La caldera no arranca').category).toBe('HEATING')
  })

  it('ignora las tildes al buscar palabras', () => {
    expect(classifyByHeuristic('La bombilla está fundida').category).toBe('ELECTRICITY')
  })

  it('sin palabras conocidas cae en OTHER', () => {
    expect(classifyByHeuristic('El vecino del cuarto hace ruido').category).toBe('OTHER')
  })

  it('sube a CRITICAL con palabras de emergencia', () => {
    expect(classifyByHeuristic('Huele a gas en el rellano').priority).toBe('CRITICAL')
  })

  it('sube a HIGH con palabras de averia', () => {
    expect(classifyByHeuristic('El ascensor esta parado y no funciona').priority).toBe('HIGH')
  })

  it('deja MEDIUM cuando no hay senales', () => {
    expect(classifyByHeuristic('La puerta hace un poco de ruido al cerrar').priority).toBe('MEDIUM')
  })

  it('marca SIEMPRE needsHumanReview', () => {
    expect(classifyByHeuristic('Hay una fuga de agua').needsHumanReview).toBe(true)
    expect(classifyByHeuristic('algo').needsHumanReview).toBe(true)
  })

  it('nunca alcanza el umbral de confianza por defecto', () => {
    const proposal = classifyByHeuristic('fuga de agua caliente inundando el garaje')
    expect(proposal.confidence).toBeLessThan(0.5)
    expect(proposal.confidence).toBeLessThanOrEqual(0.45)
  })

  it('usa la descripcion como titulo si es suficientemente larga', () => {
    expect(classifyByHeuristic('El ascensor hace un ruido raro').title).toBe('El ascensor hace un ruido raro')
  })

  it('fabrica un titulo cuando la descripcion es demasiado corta', () => {
    expect(classifyByHeuristic('gas').title).toBe('Incidencia: Otra incidencia')
    expect(classifyByHeuristic('ab').title).toBe('Incidencia: Otra incidencia')
  })
})

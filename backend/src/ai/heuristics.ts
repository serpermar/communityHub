// ---------------------------------------------------------------------------
// Clasificacion por reglas, sin LLM (AI-3, AI-12).
//
// Es el modo degradado: sin clave, con la IA apagada o si el modelo no contesta,
// `classify` no puede quedarse en blanco. Devuelve una propuesta razonable a
// partir de palabras clave en castellano y, sobre todo, marca
// `needsHumanReview: true` siempre: una regla de vocabulario es una conjetura, y
// la spec dice que la duda se resuelve por revision humana, no por silencio.
//
// La confianza se queda por debajo del umbral por diseno (<= 0.45 con el umbral
// por defecto de 0.5) para que el forzado de `needsHumanReview` sea coherente y
// no dependa de que alguien suba el umbral.
// ---------------------------------------------------------------------------

import type { IncidentCategory, IncidentPriority, IncidentProposal } from './types.js'

type Rule = {
  category: IncidentCategory
  words: string[]
}

// El orden importa poco: se cuentan coincidencias y gana la categoria con mas.
// A igualdad, gana la primera de la lista, que va de lo mas especifico a lo mas
// generico.
const CATEGORY_RULES: Rule[] = [
  { category: 'ELEVATOR', words: ['ascensor', 'elevador', 'montacargas'] },
  {
    category: 'ELECTRICITY',
    words: ['luz', 'electric', 'bombilla', 'enchufe', 'cable', 'cortocircuito', 'apagon', 'cuadro electrico', 'interruptor'],
  },
  {
    category: 'PLUMBING',
    words: ['agua', 'fuga', 'tuberia', 'fontaner', 'atasc', 'desague', 'grifo', 'inodoro', 'humedad', 'gotera', 'cisterna'],
  },
  {
    category: 'CLEANING',
    words: ['limp', 'basura', 'suciedad', 'residuo', 'contenedor', 'escombro', 'desinfect', 'cristales'],
  },
  {
    category: 'SECURITY',
    words: ['segurid', 'robo', 'robar', 'intrus', 'allanamiento', 'cerradura', 'vandal', 'agresion', 'okupa'],
  },
  {
    category: 'HEATING',
    words: ['calefacc', 'caldera', 'radiador', 'calentador', 'termo', 'agua caliente'],
  },
]

const CRITICAL_WORDS = [
  'incendio',
  'fuego',
  'humo',
  'gas',
  'explosion',
  'electrocu',
  'atrapad',
  'inundacion',
  'emergencia',
  'peligro',
  'chispa',
  'desprendimiento',
]

const HIGH_WORDS = [
  'fuga',
  'inundando',
  'no funciona',
  'averia',
  'urgente',
  'roto',
  'rota',
  'sin agua',
  'sin luz',
  'parado',
  'bloqueado',
]

const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  ELEVATOR: 'Ascensor',
  ELECTRICITY: 'Electricidad',
  PLUMBING: 'Fontaneria',
  CLEANING: 'Limpieza',
  SECURITY: 'Seguridad',
  HEATING: 'Calefaccion',
  OTHER: 'Otra incidencia',
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function countMatches(haystack: string, words: string[]): number {
  return words.reduce((total, word) => (haystack.includes(word) ? total + 1 : total), 0)
}

function detectCategory(normalized: string): { category: IncidentCategory; matches: number } {
  let best: { category: IncidentCategory; matches: number } = { category: 'OTHER', matches: 0 }

  for (const rule of CATEGORY_RULES) {
    const matches = countMatches(normalized, rule.words)
    if (matches > best.matches) {
      best = { category: rule.category, matches }
    }
  }

  return best
}

function detectPriority(normalized: string): IncidentPriority {
  if (countMatches(normalized, CRITICAL_WORDS) > 0) return 'CRITICAL'
  if (countMatches(normalized, HIGH_WORDS) > 0) return 'HIGH'
  return 'MEDIUM'
}

function buildTitle(description: string, category: IncidentCategory): string {
  const trimmed = description.trim().replace(/\s+/g, ' ')
  if (trimmed.length >= 5) {
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
  }
  return `Incidencia: ${CATEGORY_LABELS[category]}`
}

/**
 * Propuesta heuristica. Nunca lanza: es la red de seguridad del clasificador.
 */
export function classifyByHeuristic(description: string): IncidentProposal {
  const normalized = normalize(description)
  const { category, matches } = detectCategory(normalized)
  const priority = detectPriority(normalized)

  // Confianza acotada por debajo del umbral: la heuristica no decide sola.
  const confidence = Math.min(0.45, 0.3 + matches * 0.05)

  return {
    category,
    priority,
    title: buildTitle(description, category),
    description: description.trim(),
    confidence,
    needsHumanReview: true,
  }
}

// ---------------------------------------------------------------------------
// Herramientas de los agentes de desarrollo (spec 17, D-2).
//
// Un agente de desarrollo NO es un actor de comunidad: no consulta datos de
// vecinos. Lo que hace es LEER el repositorio (codigo, specs, docs) para
// proponer un cambio que aplica una persona. Por eso estas tools:
//
//   - son de SOLO LECTURA por construccion: no hay ninguna funcion que escriba,
//     borre ni ejecute comandos;
//   - estan CONFINADAS a la raiz del repositorio: una ruta absoluta o con `..`
//     que escape la raiz lanza `VALIDATION_ERROR`, no lee;
//   - tienen topes (numero de ficheros, tamano y coincidencias) para no volcar
//     el repositorio entero en el contexto del modelo.
//
// El catalogo es deliberadamente minimo y compartido: `list_files`, `read_file`
// y `search_repo`. Ejecutar tests o escanear dependencias queda fuera de la
// spec 17 (ver §12).
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { badRequest } from '../../http/errors.js'

export type DevToolContext = { repoRoot: string }

export type DevToolResult = { result: unknown }

// `any` en `args` es deliberado, igual que en `ai/tools/registry.ts`: `runTool`
// ya ha validado los argumentos con el esquema zod antes de llegar a `run`.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type DevTool = {
  name: string
  description: string
  schema: z.ZodType
  parameters: Record<string, unknown>
  run: (args: any, ctx: DevToolContext) => Promise<DevToolResult>
}

/** La raiz del repositorio. Tanto en `src/agents/dev/` como en `dist/agents/dev/`
 *  el directorio sube cuatro niveles hasta la raiz. */
export function defaultRepoRoot(): string {
  return fileURLToPath(new URL('../../../../', import.meta.url))
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.vite',
  '.turbo',
  'playwright-report',
  'test-results',
  '.next',
  '.cache',
])

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.gz', '.tgz',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.mp3', '.wav', '.map',
])

const MAX_FILE_BYTES = 128 * 1024
const DEFAULT_LIST_LIMIT = 500
const DEFAULT_SEARCH_MAX = 200

function toPosix(pathname: string): string {
  return pathname.split(sep).join('/')
}

function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name)
}

function looksBinary(pathname: string): boolean {
  const dot = pathname.lastIndexOf('.')
  return dot >= 0 && BINARY_EXTENSIONS.has(pathname.slice(dot).toLowerCase())
}

/** Resuelve una ruta relativa DENTRO de la raiz; rechaza cualquier escape. */
function resolveInside(ctx: DevToolContext, rel: string): string {
  const root = resolve(ctx.repoRoot)
  const clean = rel.trim()

  if (clean === '' || clean === '.') return root

  if (isAbsolute(clean) || clean.split(/[\\/]/).includes('..')) {
    throw badRequest(`La ruta "${rel}" sale del repositorio.`)
  }

  const candidate = resolve(root, clean)

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw badRequest(`La ruta "${rel}" sale del repositorio.`)
  }

  return candidate
}

/** Recorre el arbol bajo `baseRel` y devuelve rutas relativas a la raiz. */
function walkFiles(ctx: DevToolContext, baseRel: string, limit: number): string[] {
  const root = resolve(ctx.repoRoot)
  const found: string[] = []
  const stack: string[] = [resolveInside(ctx, baseRel)]

  while (stack.length > 0 && found.length < limit) {
    const dir = stack.pop() as string

    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (found.length >= limit) break
      const abs = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue
        stack.push(abs)
      } else if (entry.isFile()) {
        found.push(toPosix(relative(root, abs)))
      }
    }
  }

  return found
}

/** Convierte un glob sencillo (`*`, `**`, `?`) en una regex anclada. */
function globToRegExp(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] ?? ''
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*'
        i += 1
      } else {
        out += '[^/]*'
      }
    } else if (ch === '?') {
      out += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  return new RegExp(`^${out}$`)
}

function parametersOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
}

function defineTool(tool: Omit<DevTool, 'parameters'>): DevTool {
  return { ...tool, parameters: parametersOf(tool.schema) }
}

const listFiles = defineTool({
  name: 'list_files',
  description:
    'Lista ficheros del repositorio (rutas relativas a la raiz). Excluye node_modules, .git, dist y demas carpetas ignoradas.',
  schema: z.object({
    path: z.string().optional(),
    glob: z.string().optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  }),
  async run(args, ctx) {
    const { path: base = '.', glob, limit = DEFAULT_LIST_LIMIT } = args as {
      path?: string
      glob?: string
      limit?: number
    }

    let files = walkFiles(ctx, base, limit)
    if (glob) {
      const re = globToRegExp(glob)
      files = files.filter((file) => re.test(file))
    }

    return { result: { files: files.slice(0, limit), truncated: files.length >= limit } }
  },
})

const readFile = defineTool({
  name: 'read_file',
  description:
    'Devuelve el contenido de un fichero del repositorio (tope 128 KB). La ruta debe quedar dentro de la raiz.',
  schema: z.object({ path: z.string().min(1) }),
  async run(args, ctx) {
    const { path: rel } = args as { path: string }
    const abs = resolveInside(ctx, rel)

    if (looksBinary(abs)) {
      return { result: { error: `"${rel}" parece un fichero binario; no se lee.` } }
    }

    if (!existsSync(abs) || !statSync(abs).isFile()) {
      return { result: { error: `No existe el fichero "${rel}".` } }
    }

    const raw = readFileSync(abs)
    const truncated = raw.byteLength > MAX_FILE_BYTES
    const content = raw.subarray(0, MAX_FILE_BYTES).toString('utf8')

    return { result: { path: toPosix(rel), content, truncated } }
  },
})

const searchRepo = defineTool({
  name: 'search_repo',
  description:
    'Busca una expresion regular en el codigo y devuelve coincidencias "ruta:linea: texto". Filtra por subcarpeta con `path`.',
  schema: z.object({
    pattern: z.string().min(1),
    path: z.string().optional(),
    max: z.number().int().min(1).max(1000).optional(),
  }),
  async run(args, ctx) {
    const { pattern, path: base = '.', max = DEFAULT_SEARCH_MAX } = args as {
      pattern: string
      path?: string
      max?: number
    }

    let re: RegExp
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      return { result: { error: `La expresion regular "${pattern}" no es valida.` } }
    }

    const files = walkFiles(ctx, base, 5000)
    const matches: { path: string; line: number; text: string }[] = []

    for (const file of files) {
      if (matches.length >= max) break
      if (looksBinary(file)) continue

      const abs = join(resolve(ctx.repoRoot), file)
      let size: number
      try {
        size = statSync(abs).size
      } catch {
        continue
      }
      if (size > MAX_FILE_BYTES) continue

      const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
      for (let i = 0; i < lines.length && matches.length < max; i += 1) {
        const line = lines[i] ?? ''
        if (re.test(line)) {
          matches.push({ path: file, line: i + 1, text: line.slice(0, 300) })
        }
      }
    }

    return { result: { matches, truncated: matches.length >= max } }
  },
})

export const DEV_TOOLS: DevTool[] = [listFiles, readFile, searchRepo]

export function findDevTool(name: string): DevTool | undefined {
  return DEV_TOOLS.find((tool) => tool.name === name)
}

/** El catalogo de dev tools tal como se le describe al modelo. */
export function devToolSpecs(tools: readonly DevTool[] = DEV_TOOLS) {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
}

/** Ejecuta una dev tool validando sus argumentos con zod. */
export async function runDevTool(
  name: string,
  args: unknown,
  ctx: DevToolContext,
  tools: readonly DevTool[] = DEV_TOOLS,
): Promise<DevToolResult> {
  const tool = findDevTool(name)
  const inCatalog = tool && tools.includes(tool)

  if (!inCatalog) {
    throw badRequest(`La herramienta de desarrollo "${name}" no existe.`)
  }

  const parsed = (tool as DevTool).schema.safeParse(args ?? {})

  if (!parsed.success) {
    throw badRequest(`Los argumentos de "${name}" no son validos.`, parsed.error.issues)
  }

  return (tool as DevTool).run(parsed.data, ctx)
}

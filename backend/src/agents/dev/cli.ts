// ---------------------------------------------------------------------------
// Entrypoint CLI de los agentes de desarrollo (spec 17, D-1, D-4).
//
//   npm run agent -- <testing|security|documentation> "<instruccion>" [--out <fichero>] [--prompt]
//
// No esta montado en la API HTTP a proposito (D-1): un agente de desarrollo no
// es un actor de comunidad. Se ejecuta en la maquina de quien desarrolla.
//
//   - Con proveedor LLM: imprime una PROPUESTA.
//   - Sin proveedor: imprime el PROMPT listo para pegar en el chat (D-4).
//   - `--prompt` fuerza el modo prompt aunque haya proveedor.
//   - `--out <fichero>` vuelca la salida a un fichero indicado por la persona.
//
// Nunca escribe en el repositorio salvo el `--out` explicito.
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs'
import { LLMProviderError } from '../../ai/llm/client.js'
import { AppError } from '../../http/errors.js'
import { runDevAgent } from './runner.js'

const USAGE = [
  'Uso: npm run agent -- <testing|security|documentation> "<instruccion>" [--out <fichero>] [--prompt]',
  '',
  'Ejemplos:',
  '  npm run agent -- testing "que endpoints no tienen test de integracion"',
  '  npm run agent -- security "revisa la validacion del endpoint de reservas"',
  '  npm run agent -- documentation "que specs no estan al dia respecto al codigo"',
].join('\n')

type Parsed = { name: string; instruction: string; out?: string; promptOnly: boolean }

function parseArgs(argv: string[]): Parsed | null {
  const positional: string[] = []
  let out: string | undefined
  let promptOnly = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) continue

    if (arg === '--prompt') {
      promptOnly = true
    } else if (arg === '--out') {
      out = argv[i + 1]
      i += 1
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length)
    } else {
      positional.push(arg)
    }
  }

  const [name, ...rest] = positional
  const instruction = rest.join(' ').trim()

  if (!name || !instruction) return null

  return { name, instruction, out, promptOnly }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    process.stdout.write(`${USAGE}\n`)
    return argv.length === 0 ? 1 : 0
  }

  const parsed = parseArgs(argv)

  if (!parsed) {
    process.stderr.write(`Falta el agente y/o la instruccion.\n\n${USAGE}\n`)
    return 1
  }

  try {
    const result = await runDevAgent(parsed.name, {
      instruction: parsed.instruction,
      client: parsed.promptOnly ? null : undefined,
    })

    if (result.mode === 'llm') {
      process.stderr.write(
        `[${result.agent}] ${result.toolCalls.length} tool call(s), ${result.tokensIn}+${result.tokensOut} tokens\n`,
      )
    } else {
      process.stderr.write(`[${result.agent}] modo prompt (--prompt o sin proveedor): listo para pegar en el chat.\n`)
    }

    const text = `${result.answer}\n`

    if (parsed.out) {
      writeFileSync(parsed.out, text, 'utf8')
      process.stderr.write(`Propuesta escrita en ${parsed.out}\n`)
    } else {
      process.stdout.write(text)
    }

    return 0
  } catch (error) {
    if (error instanceof AppError) {
      process.stderr.write(`Error (${error.code}): ${error.message}\n`)
      return 1
    }

    if (error instanceof LLMProviderError) {
      process.stderr.write(
        `El proveedor LLM no respondio: ${error.message}\n` +
          'Revisa la clave en backend/.env o usa --prompt para obtener el prompt sin llamar al modelo.\n',
      )
      return 1
    }

    process.stderr.write(`Error inesperado: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

main().then((code) => {
  process.exitCode = code
})

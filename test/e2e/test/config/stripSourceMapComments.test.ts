import type { TestUserConfig } from 'vitest/node'
import { expect, test } from 'vitest'
import { runInlineTests, ts } from '#test-utils'

const testFile = ts`
import type { Debugger } from 'node:inspector'
import { Session } from 'node:inspector/promises'
import { expect, inject, test } from 'vitest'

interface Point {
  x: number
  y: number
}

function fail(point: Point): never {
  throw new Error('failed at ' + point.x)
}

test('compiled source', async () => {
  const session = new Session()
  session.connect()
  const scripts: Debugger.ScriptParsedEventDataType[] = []
  session.on('Debugger.scriptParsed', ({ params }) => scripts.push(params))
  await session.post('Debugger.enable')
  session.disconnect()
  const script = scripts.find(s => s.url.endsWith('/basic.test.ts'))!

  const modules = (globalThis as any).__vitest_worker__.evaluatedModules.idToModuleMap.values()
  const module = [...modules].find(m => m.id.endsWith('/basic.test.ts'))
  let stack = ''
  try {
    fail({ x: 1, y: 2 })
  }
  catch (error: any) {
    stack = error.stack
  }

  expect({
    compiledHasSourceMap: script.sourceMapURL.startsWith('data:application/json;base64,'),
    metaCodeHasSourceMap: /\n\/\/# sourceMappingURL=data:application\/json;base64,[\w+/=]+\n/.test(module.meta.code),
    throwLocation: stack.split('\n')[1].match(/basic\.test\.ts:(\d+:\d+)/)?.[1],
  }).toEqual(inject('expected'))
})
`

function runWith(config: TestUserConfig, compiledHasSourceMap: boolean) {
  return runInlineTests(
    { 'basic.test.ts': testFile },
    {
      ...config,
      provide: {
        expected: { compiledHasSourceMap, metaCodeHasSourceMap: true, throwLocation: '12:9' },
      },
    },
  )
}

test('compiles modules without the inline source map and keeps stack traces mapped', async () => {
  const { stderr, testTree } = await runWith(
    { experimental: { stripSourceMapComments: true } },
    false,
  )
  expect(stderr).toBe('')
  expect(testTree()).toMatchInlineSnapshot(`
    {
      "basic.test.ts": {
        "compiled source": "passed",
      },
    }
  `)
})

test('compiles the inline source map by default', async () => {
  const { stderr, testTree } = await runWith({}, true)
  expect(stderr).toBe('')
  expect(testTree()).toMatchInlineSnapshot(`
    {
      "basic.test.ts": {
        "compiled source": "passed",
      },
    }
  `)
})

test('keeps the inline source map when coverage is enabled', async () => {
  const { stderr, testTree } = await runWith(
    {
      experimental: { stripSourceMapComments: true },
      coverage: { enabled: true, provider: 'v8', reporter: [] },
    },
    true,
  )
  expect(stderr).toBe('')
  expect(testTree()).toMatchInlineSnapshot(`
    {
      "basic.test.ts": {
        "compiled source": "passed",
      },
    }
  `)
})

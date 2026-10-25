import type { PoolRunnerInitializer, WorkerRequest } from 'vitest/node'
import type { TestFsStructure } from '../../test-utils'
import { expect, test } from 'vitest'
import { ForksPoolWorker } from 'vitest/node'
import { runInlineTests, StableTestFileOrderSorter } from '../../test-utils'

// Runs a non-isolated project in one process, but tells the process that it is
// isolated, so it resets modules and mocks before every file.
class ReusedProcessWorker extends ForksPoolWorker {
  override readonly name = 'reused-process'

  override send(message: WorkerRequest): void {
    if (message.type === 'start') {
      const config = { ...message.context.config, isolate: true }
      message = { ...message, context: { ...message.context, config } }
    }
    super.send(message)
  }
}

const reusedProcessPool: PoolRunnerInitializer = {
  name: 'reused-process',
  createPoolWorker: (options) => new ReusedProcessWorker(options),
}

function runInReusedProcess(structure: TestFsStructure, setupFiles?: string[]) {
  return runInlineTests(structure, {
    pool: reusedProcessPool,
    isolate: false,
    maxWorkers: 1,
    setupFiles,
    sequence: { sequencer: StableTestFileOrderSorter },
    experimental: { isolateMocksPerFile: true },
  })
}

test('vi.resetAllMocks and vi.clearAllMocks do not reach mocks of earlier files', async () => {
  const { stderr, errorTree } = await runInReusedProcess({
    './a.test.ts': `
import { expect, test, vi } from 'vitest'
test('creates a mock that outlives the file', () => {
  globalThis.leftover = vi.fn(() => 'kept')
  globalThis.leftover()
  expect(globalThis.leftover).toHaveBeenCalledTimes(1)
})
    `,
    './b.test.ts': `
import { expect, test, vi } from 'vitest'
test('resets only its own mocks', () => {
  vi.clearAllMocks()
  vi.resetAllMocks()
  expect(globalThis.leftover).toHaveBeenCalledTimes(1)
  expect(globalThis.leftover()).toBe('kept')
})
    `,
  })

  expect(stderr).toBe('')
  expect(errorTree()).toMatchInlineSnapshot(`
    {
      "a.test.ts": {
        "creates a mock that outlives the file": "passed",
      },
      "b.test.ts": {
        "resets only its own mocks": "passed",
      },
    }
  `)
})

test('a vi.doMock queued by an earlier file does not apply to the next file', async () => {
  const { stderr, errorTree } = await runInReusedProcess({
    './dep.ts': `export const value = 'real'`,
    './a.test.ts': `
import { test, vi } from 'vitest'
test('queues a mock after its last import', () => {
  vi.doMock('./dep', () => ({ value: 'mocked' }))
})
    `,
    './b.test.ts': `
import { expect, test } from 'vitest'
import { value } from './dep'
test('imports the real module', () => {
  expect(value).toBe('real')
})
    `,
  })

  expect(stderr).toBe('')
  expect(errorTree()).toMatchInlineSnapshot(`
    {
      "a.test.ts": {
        "queues a mock after its last import": "passed",
      },
      "b.test.ts": {
        "imports the real module": "passed",
      },
    }
  `)
})

test('mocked modules of an earlier file do not survive into the next file', async () => {
  const { stderr, errorTree } = await runInReusedProcess({
    './factory-dep.ts': `export const value = 'real'`,
    './import-mock-dep.ts': `export const value = 'real'`,
    './automock-dep.ts': `export const value = () => 'real'`,
    './a.test.ts': `
import { expect, test, vi } from 'vitest'
import { value as factory } from './factory-dep'
import { value as automock } from './automock-dep'
vi.mock('./factory-dep', () => ({ value: 'mocked' }))
vi.mock('./automock-dep')
test('mocks three modules', async () => {
  const importMock = await vi.importMock('./import-mock-dep')
  expect(factory).toBe('mocked')
  expect(automock()).toBeUndefined()
  expect(importMock.value).toBe('real')
})
    `,
    './b.test.ts': `
import { expect, test } from 'vitest'
import { value as factory } from './factory-dep'
import { value as importMock } from './import-mock-dep'
import { value as automock } from './automock-dep'
test('imports the real modules', () => {
  expect(factory).toBe('real')
  expect(importMock).toBe('real')
  expect(automock()).toBe('real')
})
    `,
  })

  expect(stderr).toBe('')
  expect(errorTree()).toMatchInlineSnapshot(`
    {
      "a.test.ts": {
        "mocks three modules": "passed",
      },
      "b.test.ts": {
        "imports the real modules": "passed",
      },
    }
  `)
})

test('an import started by an earlier file does not load into the next file', async () => {
  const { stderr, errorTree } = await runInReusedProcess(
    {
      './dep.ts': `export const value = 'real'`,
      './service.ts': `
import { value } from './dep'
export const read = () => value
      `,
      './setup.ts': `await new Promise((resolve) => setTimeout(resolve, 200))`,
      './a.test.ts': `
import { test } from 'vitest'
test('starts an import that runs after the file ends', () => {
  setTimeout(() => import('./service'), 50)
})
      `,
      './b.test.ts': `
import { expect, test, vi } from 'vitest'
import { read } from './service'
vi.mock('./dep', () => ({ value: 'mocked' }))
test('gets the mocked dependency', () => {
  expect(read()).toBe('mocked')
})
      `,
    },
    ['./setup.ts'],
  )

  expect(stderr).toBe('')
  expect(errorTree()).toMatchInlineSnapshot(`
    {
      "a.test.ts": {
        "starts an import that runs after the file ends": "passed",
      },
      "b.test.ts": {
        "gets the mocked dependency": "passed",
      },
    }
  `)
})

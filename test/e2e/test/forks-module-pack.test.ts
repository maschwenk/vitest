import { rmSync } from 'node:fs'
import { join } from 'pathe'
import { expect, test } from 'vitest'
import { runInlineTests } from '#test-utils'

// The forks pool stores every module of an environment in one pack file and
// workers read byte ranges from it. Multi-byte characters make byte offsets
// and string lengths differ (`test/unit/test/module-pack.test.ts` checks the
// ranges themselves).
const structure = {
  'utf8.js': `export const text = 'héllo 世界 🙂'`,
  'ascii.js': `export const ascii = 'plain'`,
  'both.js': `export { text } from './utf8.js'\nexport { ascii } from './ascii.js'`,
  // the second file runs in a new worker that reads the modules from the pack
  ...Object.fromEntries(
    ['first', 'second'].map((name) => [
      `${name}.test.js`,
      /* js */ `
      import { expect, test } from "vitest"
      import { ascii, text } from "./both.js"
      test("reads modules after multi-byte code", () => {
        expect(text).toBe("héllo 世界 🙂")
        expect(ascii).toBe("plain")
      })
    `,
    ]),
  ),
}

test('modules with multi-byte characters are read back from the pack', async () => {
  const { stderr, testTree } = await runInlineTests(structure, {
    pool: 'forks',
    maxWorkers: 1,
  })

  expect(stderr).toBe('')
  expect(testTree()).toMatchInlineSnapshot(`
    {
      "first.test.js": {
        "reads modules after multi-byte code": "passed",
      },
      "second.test.js": {
        "reads modules after multi-byte code": "passed",
      },
    }
  `)
})

test('modules served from fsModuleCache are packed too', async () => {
  const cachePath = join(import.meta.dirname, '../fixtures/.tmp-forks-module-pack-cache')
  rmSync(cachePath, { force: true, recursive: true })
  const config = {
    pool: 'forks' as const,
    maxWorkers: 1,
    fsModuleCache: true,
    fsModuleCachePath: cachePath,
  }

  try {
    // the first run fills the cache, the second reads every module from it
    for (const _ of [1, 2]) {
      const { stderr, testTree } = await runInlineTests(structure, config)
      expect(stderr).toBe('')
      expect(testTree()).toMatchObject({
        'first.test.js': { 'reads modules after multi-byte code': 'passed' },
        'second.test.js': { 'reads modules after multi-byte code': 'passed' },
      })
    }
  } finally {
    rmSync(cachePath, { force: true, recursive: true })
  }
})

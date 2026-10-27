import type { TransformResult } from 'vite'
import type { PackedModule } from '../../../packages/vitest/src/node/environments/modulePack'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { afterEach, expect, test } from 'vitest'
import { ModulePack } from '../../../packages/vitest/src/node/environments/modulePack'
import { readCachedCode } from '../../../packages/vitest/src/runtime/moduleRunner/cachedCode'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // the reader keeps the pack open for the life of the process, which
      // keeps Windows from removing the directory
    }
  }
})

function createPack() {
  const dir = mkdtempSync(join(tmpdir(), 'vitest-module-pack-'))
  dirs.push(dir)
  return new ModulePack(join(dir, 'ssr-1.pack'))
}

function read(packed: PackedModule) {
  return readCachedCode({
    cached: true,
    id: '/module.js',
    file: null,
    url: '/module.js',
    invalidate: false,
    tmp: packed.file,
    offset: packed.offset,
    length: packed.length,
  })
}

test('reads back every module, including the ones after multi-byte code', async () => {
  const pack = createPack()
  const codes = [
    `export const text = 'héllo 世界 🙂'`,
    `export const ascii = 'plain'`,
    '',
    `export const big = '${'x'.repeat(100_000)}'`,
  ]
  // fetches append concurrently
  const packed = await Promise.all(codes.map((code) => pack.add(code, undefined)))

  expect(packed.map(read)).toEqual(codes)
})

test('appends a transform result once', async () => {
  const pack = createPack()
  const transformResult = { code: 'export {}', map: null } as TransformResult

  const [first, second] = await Promise.all([
    pack.add(transformResult.code, transformResult),
    pack.add(transformResult.code, transformResult),
  ])
  const third = await pack.add(`export const other = 1`, undefined)

  expect(second).toBe(first)
  expect(transformResult.__vitestPack).toBe(first)
  expect(third.offset).toBe(first.length)
})

import type { TransformResult } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname } from 'pathe'

export interface PackedModule {
  file: string
  offset: number
  length: number
}

/**
 * Append-only file with the transformed code of every module that the forks
 * pool fetched in this session. An isolated worker imports the same modules
 * as the previous one, so instead of opening a separate tmp file per module
 * on every import, it opens the pack once and reads byte ranges from it.
 */
export class ModulePack {
  private size = 0
  private modules = new WeakMap<TransformResult, Promise<PackedModule>>()

  constructor(public readonly file: string) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '')
  }

  add(code: string, transformResult: TransformResult | null | undefined): Promise<PackedModule> {
    if (!transformResult) {
      return this.append(code)
    }
    let packed = this.modules.get(transformResult)
    if (!packed) {
      packed = this.append(code).then(
        (module) => {
          transformResult.__vitestPack = module
          return module
        },
        (error) => {
          this.modules.delete(transformResult)
          throw error
        },
      )
      this.modules.set(transformResult, packed)
    }
    return packed
  }

  private async append(code: string): Promise<PackedModule> {
    const buffer = Buffer.from(code, 'utf-8')
    // reserve the range synchronously so concurrent appends never overlap
    const offset = this.size
    this.size += buffer.byteLength
    const handle = await open(this.file, 'r+')
    try {
      let written = 0
      while (written < buffer.byteLength) {
        const { bytesWritten } = await handle.write(
          buffer,
          written,
          buffer.byteLength - written,
          offset + written,
        )
        written += bytesWritten
      }
    } finally {
      await handle.close()
    }
    return { file: this.file, offset, length: buffer.byteLength }
  }
}

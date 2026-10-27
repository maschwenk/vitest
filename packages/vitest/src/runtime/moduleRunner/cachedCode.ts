import type { FetchCachedFileSystemResult } from '../../types/general'
import fs from 'node:fs'

// captured before test files can mock or spy on `fs`
const { openSync, readFileSync, readSync } = fs

// one descriptor per pack, kept for the life of the worker process: opening
// the pack once and reading byte ranges skips the path lookup and the
// open/stat/close that a separate file per module costs on every import
const packDescriptors = new Map<string, number>()

export function readCachedCode(result: FetchCachedFileSystemResult): string {
  const { offset, length } = result
  if (offset == null || length == null) {
    return readFileSync(result.tmp, 'utf-8')
  }

  let fd = packDescriptors.get(result.tmp)
  if (fd == null) {
    fd = openSync(result.tmp, 'r')
    packDescriptors.set(result.tmp, fd)
  }

  const buffer = Buffer.allocUnsafe(length)
  let bytesRead = 0
  while (bytesRead < length) {
    const read = readSync(fd, buffer, bytesRead, length - bytesRead, offset + bytesRead)
    if (read === 0) {
      throw new Error(`Unexpected end of ${result.tmp} while reading ${result.id}`)
    }
    bytesRead += read
  }
  return buffer.toString('utf-8')
}

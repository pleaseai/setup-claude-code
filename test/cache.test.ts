import * as os from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCacheKey, getRestoreKeys } from '../src/cache'
import * as installer from '../src/installer'

describe('cache', () => {
  const platform = os.platform()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getCacheKey', () => {
    it('should generate key for specific version', async () => {
      const key = await getCacheKey('1.0.0')

      expect(key).toBe(`claude-code-${platform}-1.0.0`)
    })

    it('should generate key for latest version with date', async () => {
      const key = await getCacheKey('latest')

      expect(key).toMatch(new RegExp(`^claude-code-${platform}-latest-\\d{4}-\\d{2}-\\d{2}$`))
    })

    it('should generate key for stable version with resolved version number', async () => {
      // Mock fetchStableVersion to return a specific version
      vi.spyOn(installer, 'fetchStableVersion').mockResolvedValue('2.0.27')

      const key = await getCacheKey('stable')

      expect(key).toBe(`claude-code-${platform}-2.0.27`)
      expect(installer.fetchStableVersion).toHaveBeenCalledOnce()
    })
  })

  describe('getRestoreKeys', () => {
    it('should generate restore keys', () => {
      const keys = getRestoreKeys('1.0.0')

      expect(keys).toEqual([
        `claude-code-${platform}-1.0.0-`,
        `claude-code-${platform}-`,
      ])
    })

    it('should generate restore keys for latest', () => {
      const keys = getRestoreKeys('latest')

      expect(keys).toEqual([
        `claude-code-${platform}-latest-`,
        `claude-code-${platform}-`,
      ])
    })
  })
})

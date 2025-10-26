import * as exec from '@actions/exec'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addOrUpdateMarketplace, installPlugins, parseList, parsePluginList, validateMarketplaceSource, validatePluginName } from '../src/plugins'

describe('plugins', () => {
  describe('parseList', () => {
    it('should parse comma-separated list', () => {
      const result = parseList('item1,item2,item3')

      expect(result).toEqual(['item1', 'item2', 'item3'])
    })

    it('should parse newline-separated list', () => {
      const result = parseList('item1\nitem2\nitem3')

      expect(result).toEqual(['item1', 'item2', 'item3'])
    })

    it('should parse mixed comma and newline separated list', () => {
      const result = parseList('item1,item2\nitem3\nitem4,item5')

      expect(result).toEqual(['item1', 'item2', 'item3', 'item4', 'item5'])
    })

    it('should handle YAML multiline format with pipes', () => {
      const yamlMultiline = `owner1/repo1
owner2/repo2
owner3/repo3`

      const result = parseList(yamlMultiline)

      expect(result).toEqual(['owner1/repo1', 'owner2/repo2', 'owner3/repo3'])
    })

    it('should trim whitespace from items', () => {
      const result = parseList('  item1  ,  item2  \n  item3  ')

      expect(result).toEqual(['item1', 'item2', 'item3'])
    })

    it('should filter out empty items', () => {
      const result = parseList('item1,,\n\nitem2,,,\n\n\nitem3')

      expect(result).toEqual(['item1', 'item2', 'item3'])
    })
  })

  describe('parsePluginList', () => {
    it('should parse comma-separated plugin list', () => {
      const result = parsePluginList('plugin1@marketplace,plugin2@marketplace')

      expect(result).toEqual(['plugin1@marketplace', 'plugin2@marketplace'])
    })

    it('should trim whitespace from plugin names', () => {
      const result = parsePluginList('plugin1@marketplace , plugin2@marketplace  ,  plugin3@marketplace')

      expect(result).toEqual([
        'plugin1@marketplace',
        'plugin2@marketplace',
        'plugin3@marketplace',
      ])
    })

    it('should filter out empty plugin names', () => {
      const result = parsePluginList('plugin1@marketplace,,plugin2@marketplace,  ,')

      expect(result).toEqual(['plugin1@marketplace', 'plugin2@marketplace'])
    })

    it('should handle single plugin', () => {
      const result = parsePluginList('single-plugin@marketplace')

      expect(result).toEqual(['single-plugin@marketplace'])
    })

    it('should return empty array for empty string', () => {
      const result = parsePluginList('')

      expect(result).toEqual([])
    })

    it('should return empty array for whitespace only', () => {
      const result = parsePluginList('   ,  ,  ')

      expect(result).toEqual([])
    })

    it('should handle plugins without marketplace suffix', () => {
      const result = parsePluginList('plugin1,plugin2,plugin3')

      expect(result).toEqual(['plugin1', 'plugin2', 'plugin3'])
    })
  })

  describe('validatePluginName', () => {
    describe('valid plugin names', () => {
      it('should accept simple plugin name', () => {
        expect(() => validatePluginName('simple-plugin')).not.toThrow()
      })

      it('should accept plugin with marketplace suffix', () => {
        expect(() => validatePluginName('plugin@marketplace')).not.toThrow()
      })

      it('should accept scoped plugin name', () => {
        expect(() => validatePluginName('dev-tools@passionfactory')).not.toThrow()
      })

      it('should accept plugin with slashes', () => {
        expect(() => validatePluginName('org/plugin@marketplace')).not.toThrow()
      })

      it('should accept plugin with dots', () => {
        expect(() => validatePluginName('plugin.name@marketplace')).not.toThrow()
      })

      it('should accept plugin with underscores', () => {
        expect(() => validatePluginName('plugin_name@marketplace')).not.toThrow()
      })

      it('should accept numeric plugin names', () => {
        expect(() => validatePluginName('plugin123@marketplace')).not.toThrow()
      })
    })

    describe('path traversal attacks', () => {
      it('should reject plugin name with ../ (Unix)', () => {
        expect(() => validatePluginName('../etc/passwd')).toThrow('path traversal detected')
      })

      it('should reject plugin name with ..\\ (Windows)', () => {
        expect(() => validatePluginName('..\\windows\\system32')).toThrow('path traversal detected')
      })

      it('should reject plugin name with embedded ../', () => {
        expect(() => validatePluginName('plugin/../../../etc')).toThrow('path traversal detected')
      })
    })

    describe('length limit', () => {
      it('should reject plugin names exceeding 512 characters', () => {
        const longName = 'a'.repeat(513)
        expect(() => validatePluginName(longName)).toThrow('exceeds maximum length of 512 characters')
      })

      it('should accept plugin names at exactly 512 characters', () => {
        const maxName = 'a'.repeat(512)
        expect(() => validatePluginName(maxName)).not.toThrow()
      })
    })

    describe('character validation', () => {
      it('should reject plugin name with spaces', () => {
        expect(() => validatePluginName('plugin with spaces')).toThrow('contains disallowed characters')
      })

      it('should reject plugin name with special characters', () => {
        expect(() => validatePluginName('plugin;rm -rf /')).toThrow('contains disallowed characters')
      })

      it('should reject plugin name with shell metacharacters', () => {
        expect(() => validatePluginName('plugin$(whoami)')).toThrow('contains disallowed characters')
      })

      it('should reject plugin name with pipe character', () => {
        expect(() => validatePluginName('plugin|echo')).toThrow('contains disallowed characters')
      })

      it('should reject plugin name with backticks', () => {
        expect(() => validatePluginName('plugin`cmd`')).toThrow('contains disallowed characters')
      })

      it('should reject plugin name with quotes', () => {
        expect(() => validatePluginName('plugin"test"')).toThrow('contains disallowed characters')
      })
    })

    describe('unicode normalization', () => {
      it('should normalize unicode (NFC) before validation', () => {
        // Valid plugin name with normalization (no special chars after normalization)
        const validName = 'plugin-name@marketplace'
        expect(() => validatePluginName(validName.normalize('NFC'))).not.toThrow()
      })

      it('should reject non-ASCII characters even after normalization', () => {
        // Combining characters normalize to non-ASCII, which should be rejected
        const denormalized = 'plugin\u0301' // results in 'plugiń'
        expect(() => validatePluginName(denormalized)).toThrow('contains disallowed characters')
      })

      it('should detect path traversal after normalization', () => {
        // Unicode lookalike for '../'
        expect(() => validatePluginName('\u2024\u2024/')).toThrow()
      })
    })
  })

  describe('validateMarketplaceSource', () => {
    describe('valid marketplace sources', () => {
      it('should accept GitHub repo format', () => {
        expect(() => validateMarketplaceSource('owner/repo')).not.toThrow()
      })

      it('should accept GitHub repo with hyphens', () => {
        expect(() => validateMarketplaceSource('my-org/my-repo')).not.toThrow()
      })

      it('should accept HTTPS Git URL', () => {
        expect(() => validateMarketplaceSource('https://github.com/owner/repo.git')).not.toThrow()
      })

      it('should accept HTTP Git URL', () => {
        expect(() => validateMarketplaceSource('http://gitlab.com/owner/repo.git')).not.toThrow()
      })

      it('should accept HTTPS JSON URL', () => {
        expect(() => validateMarketplaceSource('https://example.com/marketplace.json')).not.toThrow()
      })

      it('should accept local relative path with ./', () => {
        expect(() => validateMarketplaceSource('./my-marketplace')).not.toThrow()
      })

      it('should accept local relative path with ../', () => {
        expect(() => validateMarketplaceSource('../shared-marketplace')).not.toThrow()
      })

      it('should accept absolute path', () => {
        expect(() => validateMarketplaceSource('/opt/marketplace')).not.toThrow()
      })
    })

    describe('path traversal attacks', () => {
      it('should reject non-local path with embedded ../', () => {
        expect(() => validateMarketplaceSource('malicious/../../../etc/passwd')).toThrow('path traversal detected')
      })

      it('should reject non-local path with ..\\ (Windows)', () => {
        expect(() => validateMarketplaceSource('malicious\\..\\..\\windows')).toThrow('path traversal detected')
      })

      it('should allow legitimate local relative paths', () => {
        expect(() => validateMarketplaceSource('../marketplace')).not.toThrow()
        expect(() => validateMarketplaceSource('./marketplace')).not.toThrow()
      })
    })

    describe('length limit', () => {
      it('should reject marketplace source exceeding 512 characters', () => {
        const longSource = `https://example.com/${'a'.repeat(500)}`
        expect(() => validateMarketplaceSource(longSource)).toThrow('exceeds maximum length of 512 characters')
      })

      it('should accept marketplace source at exactly 512 characters', () => {
        const maxSource = `https://example.com/${'a'.repeat(492)}`
        expect(() => validateMarketplaceSource(maxSource)).not.toThrow()
      })
    })

    describe('format validation', () => {
      it('should reject invalid format (not GitHub, Git URL, or local path)', () => {
        expect(() => validateMarketplaceSource('invalid format')).toThrow('must be GitHub (owner/repo), Git URL, or local path')
      })

      it('should reject empty string', () => {
        expect(() => validateMarketplaceSource('')).toThrow()
      })

      it('should reject malformed GitHub repo', () => {
        expect(() => validateMarketplaceSource('owner/repo/extra')).toThrow()
      })
    })

    describe('unicode normalization', () => {
      it('should normalize unicode (NFC) before validation', () => {
        // Valid marketplace source with normalization
        const validSource = 'owner/repo'
        expect(() => validateMarketplaceSource(validSource.normalize('NFC'))).not.toThrow()
      })

      it('should reject non-ASCII characters even after normalization', () => {
        // Combining characters normalize to non-ASCII, which should be rejected
        const denormalized = 'owner/repo\u0301' // results in 'owner/repó'
        expect(() => validateMarketplaceSource(denormalized)).toThrow()
      })

      it('should detect path traversal after normalization', () => {
        expect(() => validateMarketplaceSource('malicious\u2024\u2024/')).toThrow()
      })
    })
  })

  describe('installPlugins integration', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should fail fast with validation error when plugin name is invalid', async () => {
      const invalidPlugin = '../malicious-plugin'

      await expect(installPlugins(invalidPlugin))
        .rejects
        .toThrow('Invalid plugin name "../malicious-plugin": path traversal detected')
    })

    it('should not call executeClaudeCommand when validation fails', async () => {
      const execSpy = vi.spyOn(exec, 'getExecOutput')
      const invalidPlugin = 'plugin;rm -rf /'

      await expect(installPlugins(invalidPlugin))
        .rejects
        .toThrow('contains disallowed characters')

      // Verify exec was never called
      expect(execSpy).not.toHaveBeenCalled()

      execSpy.mockRestore()
    })

    it('should validate all plugins and fail on first invalid without processing remaining', async () => {
      const execSpy = vi.spyOn(exec, 'getExecOutput').mockResolvedValue({
        exitCode: 0,
        stdout: 'Installed successfully',
        stderr: '',
      })

      // First plugin is valid, second is invalid with path traversal
      const mixedList = 'valid-plugin,../malicious,another-valid'

      await expect(installPlugins(mixedList))
        .rejects
        .toThrow('path traversal detected')

      // Verify only the first valid plugin was installed before hitting the invalid one
      expect(execSpy).toHaveBeenCalledTimes(1)
      expect(execSpy).toHaveBeenCalledWith(
        'claude',
        ['plugin', 'install', 'valid-plugin'],
        expect.objectContaining({ silent: false }),
      )

      execSpy.mockRestore()
    })

    it('should install all plugins when all are valid', async () => {
      const execSpy = vi.spyOn(exec, 'getExecOutput').mockResolvedValue({
        exitCode: 0,
        stdout: 'Installed successfully',
        stderr: '',
      })

      const validList = 'plugin1@marketplace,plugin2@marketplace,plugin3@marketplace'
      const result = await installPlugins(validList)

      expect(result).toEqual(['plugin1@marketplace', 'plugin2@marketplace', 'plugin3@marketplace'])
      expect(execSpy).toHaveBeenCalledTimes(3)

      execSpy.mockRestore()
    })
  })

  describe('addOrUpdateMarketplace integration', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should fail with validation error when marketplace source is invalid', async () => {
      const invalidSource = 'malicious/../../../etc/passwd'

      await expect(addOrUpdateMarketplace(invalidSource))
        .rejects
        .toThrow('Invalid marketplace source')
    })

    it('should not check installation status when validation fails', async () => {
      const execSpy = vi.spyOn(exec, 'getExecOutput')
      const invalidSource = 'invalid format with spaces'

      await expect(addOrUpdateMarketplace(invalidSource))
        .rejects
        .toThrow('must be GitHub (owner/repo), Git URL, or local path')

      // Verify no CLI commands were executed
      expect(execSpy).not.toHaveBeenCalled()

      execSpy.mockRestore()
    })

    it('should accept valid marketplace sources', async () => {
      const execSpy = vi.spyOn(exec, 'getExecOutput')
        .mockResolvedValueOnce({
          // marketplace list (none found)
          exitCode: 0,
          stdout: '',
          stderr: '',
        })
        .mockResolvedValueOnce({
          // marketplace add
          exitCode: 0,
          stdout: 'Added successfully',
          stderr: '',
        })

      const validSource = 'owner/repo'
      const result = await addOrUpdateMarketplace(validSource)

      expect(result).toBe(true) // Newly added
      expect(execSpy).toHaveBeenCalledTimes(2)

      execSpy.mockRestore()
    })
  })
})

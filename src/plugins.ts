import * as core from '@actions/core'
import * as exec from '@actions/exec'

export interface MarketplaceInfo {
  name: string
  repo: string
}

/**
 * Security constants for input validation
 */
const MAX_PLUGIN_NAME_LENGTH = 512
const PLUGIN_NAME_PATTERN = /^[@\w.\-/]+$/

/**
 * Validate plugin name to prevent injection attacks
 * Based on Anthropic's security validation from claude-code-action
 * @see https://github.com/anthropics/claude-code-action/commit/d4c0979
 *
 * Security measures:
 * - Unicode normalization (NFC) to prevent homoglyph attacks
 * - Path traversal detection (basic ../ and ..\ patterns)
 * - Length limit (512 characters)
 * - Character whitelist (alphanumeric, @, -, _, /, .)
 *
 * @param pluginName - Plugin name to validate
 * @throws Error if validation fails
 */
export function validatePluginName(pluginName: string): void {
  // Normalize unicode to prevent homoglyph attacks
  const normalized = pluginName.normalize('NFC')

  // Check for path traversal attempts
  if (normalized.includes('../') || normalized.includes('..\\')) {
    throw new Error(`Invalid plugin name "${pluginName}": path traversal detected`)
  }

  // Enforce length limit
  if (normalized.length > MAX_PLUGIN_NAME_LENGTH) {
    throw new Error(`Invalid plugin name "${pluginName}": exceeds maximum length of ${MAX_PLUGIN_NAME_LENGTH} characters`)
  }

  // Validate character set (alphanumeric, @, -, _, /, .)
  if (!PLUGIN_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid plugin name "${pluginName}": contains disallowed characters. Only alphanumeric, @, -, _, /, and . are allowed`)
  }
}

/**
 * Validate marketplace source to prevent injection attacks
 * Supports multiple formats but validates for security
 *
 * @param source - Marketplace source to validate
 * @throws Error if validation fails
 */
export function validateMarketplaceSource(source: string): void {
  // Normalize unicode to prevent homoglyph attacks
  const normalized = source.normalize('NFC')

  // Check for path traversal in non-local paths only
  // Local paths starting with ./ or ../ are permitted (e.g., ../marketplace, ./local/path)
  // Non-local paths embedding ../ or ..\ are rejected (e.g., malicious/../etc)
  const isLocalPath = normalized.startsWith('./') || normalized.startsWith('../')
  if (!isLocalPath && (normalized.includes('../') || normalized.includes('..\\'))) {
    throw new Error(`Invalid marketplace source "${source}": path traversal detected`)
  }

  // Enforce length limit
  if (normalized.length > MAX_PLUGIN_NAME_LENGTH) {
    throw new Error(`Invalid marketplace source "${source}": exceeds maximum length of ${MAX_PLUGIN_NAME_LENGTH} characters`)
  }

  // Basic validation for different source types
  const isGitHubRepo = /^[\w-]+\/[\w-]+$/.test(normalized)
  const isGitUrl = normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.endsWith('.git')
  const isLocalPathValid = normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('/')

  if (!isGitHubRepo && !isGitUrl && !isLocalPathValid) {
    throw new Error(`Invalid marketplace source "${source}": must be GitHub (owner/repo), Git URL, or local path`)
  }
}

/**
 * Execute a claude command with unified error handling
 * Based on Anthropic's executeClaudeCommand pattern
 *
 * @param args - Command arguments to pass to claude CLI
 * @throws Error if command fails
 */
async function executeClaudeCommand(args: string[]): Promise<exec.ExecOutput> {
  const result = await exec.getExecOutput('claude', args, {
    silent: false,
    ignoreReturnCode: false, // Throws for non-zero exit codes
  })

  return result
}

/**
 * Check if a marketplace is already installed
 */
export async function isMarketplaceInstalled(repo: string): Promise<MarketplaceInfo | null> {
  try {
    const result = await exec.getExecOutput('claude', ['plugin', 'marketplace', 'list'], {
      silent: true,
    })

    const lines = result.stdout.split('\n')

    // Parse output to find marketplace by repo
    // Expected format: "  ❯ marketplace-name"
    //                  "    Source: GitHub (owner/repo)"
    let currentMarketplaceName: string | null = null

    for (const line of lines) {
      // Check if line is a marketplace name (starts with ❯)
      const nameMatch = line.match(/^\s*❯\s*(\S.*)$/)
      if (nameMatch) {
        currentMarketplaceName = nameMatch[1].trim()
        continue
      }

      // Check if line contains the repo
      if (currentMarketplaceName) {
        const repoMatch = line.match(/Source:\s*GitHub\s*\(([^)]+)\)/)
        if (repoMatch && repoMatch[1] === repo) {
          return {
            name: currentMarketplaceName,
            repo,
          }
        }
      }
    }

    return null
  }
  catch (error) {
    core.warning(`Failed to check if marketplace "${repo}" is installed: ${error}`)
    core.warning('Will attempt to add marketplace anyway')
    return null
  }
}

/**
 * Add or update a plugin marketplace with security validation
 * Supports multiple formats:
 * - GitHub: owner/repo
 * - Git URL: https://gitlab.com/company/plugins.git
 * - Local path: ./my-marketplace or ./path/to/marketplace.json
 * - Remote URL: https://url.of/marketplace.json
 */
export async function addOrUpdateMarketplace(source: string): Promise<boolean> {
  // Validate marketplace source for security
  validateMarketplaceSource(source)

  core.info(`📦 Checking plugin marketplace: ${source}`)

  // For GitHub repos, check if already installed
  // For other sources, we'll just try to add and handle errors
  const isGitHubRepo = /^[\w-]+\/[\w-]+$/.test(source)

  if (isGitHubRepo) {
    const existing = await isMarketplaceInstalled(source)

    if (existing) {
      core.info(`  ✅ Marketplace already installed: ${existing.name}`)
      core.info('  🔄 Updating marketplace...')

      await executeClaudeCommand(['plugin', 'marketplace', 'update', existing.name])
      core.info('  ✅ Marketplace updated successfully')
      return false // Not newly added
    }
  }

  // Add new marketplace (works for all source types)
  core.info('  📦 Adding marketplace...')

  await executeClaudeCommand(['plugin', 'marketplace', 'add', source])
  core.info('  ✅ Marketplace added successfully')
  return true // Newly added
}

/**
 * Parse a multiline or comma-separated string into array
 * Supports both formats:
 * - Comma-separated: "item1,item2,item3"
 * - Newline-separated: "item1\nitem2\nitem3"
 * - Mixed: "item1,item2\nitem3"
 */
export function parseList(input: string): string[] {
  return input
    .split(/[\n,]/) // Split by newline or comma
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

/**
 * Parse plugin list string into array
 */
export function parsePluginList(pluginList: string): string[] {
  return parseList(pluginList)
}

/**
 * Add or update multiple plugin marketplaces
 */
export async function addOrUpdateMarketplaces(marketplacesInput: string): Promise<number> {
  const marketplaces = parseList(marketplacesInput)

  if (marketplaces.length === 0) {
    core.warning('No marketplaces specified to add')
    return 0
  }

  core.info(`📦 Processing ${marketplaces.length} marketplace(s)...`)

  let addedOrUpdated = 0

  for (const marketplace of marketplaces) {
    try {
      const wasAdded = await addOrUpdateMarketplace(marketplace)
      addedOrUpdated++

      if (wasAdded) {
        core.info(`  ✅ Added: ${marketplace}`)
      }
      else {
        core.info(`  ✅ Updated: ${marketplace}`)
      }
    }
    catch (error) {
      throw new Error(`Failed to process marketplace "${marketplace}": ${error}`)
    }
  }

  core.info(`✅ Processed ${addedOrUpdated} marketplace(s) successfully`)

  return addedOrUpdated
}

/**
 * Install multiple plugins with security validation
 */
export async function installPlugins(pluginList: string): Promise<string[]> {
  const plugins = parsePluginList(pluginList)

  if (plugins.length === 0) {
    core.warning('No plugins specified to install')
    return []
  }

  core.info(`📥 Installing ${plugins.length} plugin(s)...`)

  const installed: string[] = []

  for (const plugin of plugins) {
    // Validate plugin name for security
    validatePluginName(plugin)

    core.info(`  Installing: ${plugin}`)

    await executeClaudeCommand(['plugin', 'install', plugin])
    core.info('    ✅ Installed successfully')
    installed.push(plugin)
  }

  core.info(`✅ All ${installed.length} plugin(s) installed successfully`)

  return installed
}

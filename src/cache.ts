import * as os from 'node:os'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import { fetchStableVersion } from './installer'
import { getClaudePaths, getCurrentDate } from './utils'

export interface CacheOptions {
  version: string
}

/**
 * Generate cache key for Claude Code installation
 */
export async function getCacheKey(version: string): Promise<string> {
  const platform = os.platform()

  if (version === 'latest') {
    const date = getCurrentDate()
    return `claude-code-${platform}-latest-${date}`
  }
  else if (version === 'stable') {
    // Resolve 'stable' to actual version number to create valid cache key
    const resolvedVersion = await fetchStableVersion()
    return `claude-code-${platform}-${resolvedVersion}`
  }
  else {
    return `claude-code-${platform}-${version}`
  }
}

/**
 * Generate cache restore keys (fallback keys)
 */
export function getRestoreKeys(version: string): string[] {
  const platform = os.platform()

  return [
    `claude-code-${platform}-${version}-`,
    `claude-code-${platform}-`,
  ]
}

/**
 * Get paths to cache
 */
export function getCachePaths(): string[] {
  const paths = getClaudePaths()
  return [paths.bin, paths.data]
}

/**
 * Restore Claude Code from cache
 */
export async function restoreCache(options: CacheOptions): Promise<boolean> {
  const { version } = options

  const cachePaths = getCachePaths()
  const primaryKey = await getCacheKey(version)
  const restoreKeys = getRestoreKeys(version)

  core.info(`Cache primary key: ${primaryKey}`)
  core.debug(`Cache restore keys: ${restoreKeys.join(', ')}`)
  core.debug(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    const cacheKey = await cache.restoreCache(cachePaths, primaryKey, restoreKeys)

    if (cacheKey) {
      core.info(`✅ Cache restored from key: ${cacheKey}`)
      return true
    }
    else {
      core.info('Cache not found')
      return false
    }
  }
  catch (error) {
    core.warning(`Failed to restore cache: ${error}`)
    return false
  }
}

/**
 * Save Claude Code to cache
 */
export async function saveCache(options: CacheOptions): Promise<void> {
  const { version } = options

  const cachePaths = getCachePaths()
  const primaryKey = await getCacheKey(version)

  core.info(`Saving to cache with key: ${primaryKey}`)
  core.debug(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    await cache.saveCache(cachePaths, primaryKey)
    core.info('✅ Cache saved successfully')
  }
  catch (error) {
    // Don't fail the action if cache save fails
    core.warning(`Failed to save cache: ${error}`)
  }
}

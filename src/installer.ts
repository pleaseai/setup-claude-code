import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import { getPlatform } from './utils'

const GCS_BUCKET = 'https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases'

export interface InstallOptions {
  version: string
  target?: string
}

/**
 * Install Claude Code CLI
 */
export async function installClaudeCode(options: InstallOptions): Promise<void> {
  const { version, target } = options

  core.info(`📥 Installing Claude Code version: ${version}`)

  // Detect platform
  const platform = getPlatform()
  core.info(`Detected platform: ${platform.platform}`)

  // Always download stable version (which has the most up-to-date installer)
  const stableVersion = await fetchStableVersion()
  core.info(`Using installer version: ${stableVersion}`)

  // Download and verify binary
  const binaryPath = await downloadAndVerifyBinary(stableVersion, platform.platform)

  // Run claude install command
  await runInstaller(binaryPath, target)

  // Clean up downloaded binary
  fs.unlinkSync(binaryPath)

  core.info('✅ Claude Code installation completed')
}

/**
 * Fetch the stable version from GCS
 */
export async function fetchStableVersion(): Promise<string> {
  const url = `${GCS_BUCKET}/stable`
  core.debug(`Fetching stable version from: ${url}`)

  const version = await tc.downloadTool(url)
  const content = fs.readFileSync(version, 'utf-8').trim()

  if (!content) {
    throw new Error('Failed to fetch stable version')
  }

  core.debug(`Stable version: ${content}`)
  return content
}

/**
 * Download manifest and extract checksum
 */
async function getChecksum(version: string, platform: string): Promise<string> {
  const url = `${GCS_BUCKET}/${version}/manifest.json`
  core.debug(`Fetching manifest from: ${url}`)

  const manifestPath = await tc.downloadTool(url)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

  const platformData = manifest.platforms?.[platform]
  if (!platformData || !platformData.checksum) {
    throw new Error(`Platform ${platform} not found in manifest`)
  }

  const checksum = platformData.checksum
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error(`Invalid checksum format: ${checksum}`)
  }

  core.debug(`Checksum for ${platform}: ${checksum}`)
  return checksum
}

/**
 * Download and verify Claude Code binary
 */
async function downloadAndVerifyBinary(version: string, platform: string): Promise<string> {
  const expectedChecksum = await getChecksum(version, platform)

  const url = `${GCS_BUCKET}/${version}/${platform}/claude`
  core.info(`Downloading Claude Code from: ${url}`)

  const downloadPath = await tc.downloadTool(url)

  // Verify checksum
  const actualChecksum = await calculateSHA256(downloadPath)
  if (actualChecksum !== expectedChecksum) {
    fs.unlinkSync(downloadPath)
    throw new Error(`Checksum verification failed. Expected: ${expectedChecksum}, Got: ${actualChecksum}`)
  }

  core.info('✅ Checksum verification passed')

  // Make executable
  fs.chmodSync(downloadPath, 0o755)

  return downloadPath
}

/**
 * Calculate SHA256 checksum of a file
 */
async function calculateSHA256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', data => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Run the Claude Code installer
 */
async function runInstaller(binaryPath: string, target?: string): Promise<void> {
  core.info('Setting up Claude Code...')

  const args = ['install']
  if (target) {
    args.push(target)
  }

  await exec.exec(binaryPath, args)
}

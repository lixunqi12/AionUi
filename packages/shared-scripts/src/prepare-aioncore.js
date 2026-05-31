/**
 * Prepare aioncore binary for packaging.
 *
 * Resolution order:
 *  1. AIONCORE_LOCAL_BIN / AIONUI_BACKEND_LOCAL_BIN
 *  2. GitHub release download (requires version or defaults to "latest")
 *
 * Output: {projectRoot}/resources/bundled-aioncore/{platform}-{arch}/aioncore[.exe]
 *
 * @module prepare-aioncore
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GITHUB_OWNER = 'iOfficeAI';
const GITHUB_REPO = 'AionCore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function removeDirectorySafe(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function copyFileSafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function ensureExecutableMode(filePath) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {}
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

function getBinaryName(platform) {
  return platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function getRustTarget(platform, arch) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  return `${normalizedArch}-${normalizedPlatform}`;
}

function readForkConfig(projectRoot, platform, arch) {
  try {
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const config = pkg.aioncoreFork;
    if (!config || typeof config !== 'object') return null;

    const targetKeys = [`${platform}-${arch}`, platform];
    if (Array.isArray(config.platforms) && !config.platforms.some((entry) => targetKeys.includes(entry))) {
      return null;
    }

    if (!config.version && !config.ref) return null;
    return {
      owner: config.owner || GITHUB_OWNER,
      repo: config.repo || GITHUB_REPO,
      version: config.version || config.ref,
      ref: config.ref || config.version,
      gitUrl: config.gitUrl || null,
      buildFromSource: config.buildFromSource === true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve the actual version tag when "latest" is requested.
 * Uses GitHub API via `gh` CLI (needs GH_TOKEN in CI) or falls back to
 * `curl` with an optional Authorization header (GITHUB_TOKEN / GH_TOKEN).
 */
function resolveLatestTag() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  // 1. Try gh CLI (honours GH_TOKEN automatically)
  try {
    const out = execSync(`gh api repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest --jq .tag_name`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();
    if (out) return out;
  } catch {
    // gh CLI not available or no token — fall back to curl
  }

  // 2. Curl with optional token to avoid rate-limit 403
  try {
    const authArgs = token ? ['-H', `Authorization: token ${token}`] : [];
    const args = ['-fsSL', ...authArgs, `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`];
    const out = execFileSync('curl', args, { encoding: 'utf-8', timeout: 15000 });
    const tag = JSON.parse(out).tag_name;
    if (tag) return tag;
  } catch {
    // network issue or rate-limited
  }

  return null;
}

/**
 * Build the release asset filename for the given platform/arch/tag.
 *
 * Expected asset naming convention:
 *   aioncore-v0.1.0-aarch64-apple-darwin.tar.gz
 */
function getAssetName(platform, arch, tag) {
  const archMap = { x64: 'x86_64', arm64: 'aarch64' };
  const platformMap = {
    darwin: 'apple-darwin',
    linux: 'unknown-linux-gnu',
    win32: 'pc-windows-msvc',
  };
  const normalizedArch = archMap[arch];
  const normalizedPlatform = platformMap[platform];
  if (!normalizedArch || !normalizedPlatform) return null;
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return `aioncore-${tag}-${normalizedArch}-${normalizedPlatform}${ext}`;
}

function getDownloadUrl(assetName, tag, owner = GITHUB_OWNER, repo = GITHUB_REPO) {
  return `https://github.com/${owner}/${repo}/releases/download/${tag}/${assetName}`;
}

function downloadFile(url, outputPath) {
  console.log(`  Downloading aioncore from ${url}`);
  if (process.platform === 'win32') {
    const ps = `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${outputPath.replace(/'/g, "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 120000,
    });
    return;
  }
  try {
    execFileSync('curl', ['-L', '--fail', '--silent', '--show-error', '-o', outputPath, url], { timeout: 120000 });
  } catch {
    execFileSync('wget', ['-q', '-O', outputPath, url], { timeout: 120000 });
  }
}

function extractArchive(archivePath, outputDir, platform) {
  ensureDirectory(outputDir);
  if (platform === 'win32' || archivePath.endsWith('.zip')) {
    if (platform === 'win32') {
      const ps = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`;
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    } else {
      execFileSync('unzip', ['-o', archivePath, '-d', outputDir]);
    }
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', outputDir]);
  }
}

function findBinaryInDir(dir, binaryName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === binaryName) return fullPath;
    if (entry.isDirectory()) {
      const found = findBinaryInDir(fullPath, binaryName);
      if (found) return found;
    }
  }
  return null;
}

function downloadAndExtract(platform, arch, tag, owner = GITHUB_OWNER, repo = GITHUB_REPO) {
  const assetName = getAssetName(platform, arch, tag);
  if (!assetName) {
    throw new Error(`Unsupported aioncore target: ${platform}-${arch}`);
  }

  const url = getDownloadUrl(assetName, tag, owner, repo);
  const tempDir = path.join(os.tmpdir(), 'aioncore-prepare', tag, `${platform}-${arch}`);
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extracted');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  downloadFile(url, archivePath);
  extractArchive(archivePath, extractDir, platform);

  const binaryName = getBinaryName(platform);
  const binaryPath = findBinaryInDir(extractDir, binaryName);
  if (!binaryPath) {
    throw new Error(`Binary ${binaryName} not found in downloaded archive`);
  }

  return { binaryPath, tempDir, url };
}

function buildFromSource(platform, arch, tag, forkConfig) {
  const rustTarget = getRustTarget(platform, arch);
  if (!rustTarget) {
    throw new Error(`Unsupported source-build target: ${platform}-${arch}`);
  }

  const binaryName = getBinaryName(platform);
  const repoUrl = forkConfig.gitUrl || `https://github.com/${forkConfig.owner}/${forkConfig.repo}.git`;
  const sourceRef = forkConfig.ref || tag;
  const tempDir = path.join(os.tmpdir(), 'aioncore-source-build', tag, `${platform}-${arch}`);
  const sourceDir = path.join(tempDir, 'source');

  removeDirectorySafe(tempDir);
  ensureDirectory(tempDir);

  console.log(`  Building aioncore from source: ${repoUrl} @ ${sourceRef} (${rustTarget})`);
  execFileSync('git', ['clone', '--depth', '1', '--branch', sourceRef, repoUrl, sourceDir], {
    stdio: 'inherit',
    timeout: 120000,
  });

  try {
    const activeToolchain = execFileSync('rustup', ['show', 'active-toolchain'], {
      cwd: sourceDir,
      encoding: 'utf-8',
      timeout: 30000,
    })
      .trim()
      .split(/\s+/)[0];
    const rustupArgs = activeToolchain
      ? ['target', 'add', rustTarget, '--toolchain', activeToolchain]
      : ['target', 'add', rustTarget];
    execFileSync('rustup', rustupArgs, {
      stdio: 'inherit',
      timeout: 120000,
    });
  } catch (error) {
    console.warn(`  rustup target add ${rustTarget} failed or was unavailable: ${error.message}`);
  }

  execFileSync('cargo', ['build', '--release', '--target', rustTarget, '-p', 'aionui-app', '--bin', 'aioncore'], {
    cwd: sourceDir,
    stdio: 'inherit',
    timeout: 1800000,
    env: {
      ...process.env,
      AIONUI_EMBED_BUN: process.env.AIONUI_EMBED_BUN || '1',
      CARGO_HTTP_TIMEOUT: process.env.CARGO_HTTP_TIMEOUT || '600',
      CARGO_NET_RETRY: process.env.CARGO_NET_RETRY || '10',
    },
  });

  const binaryPath = path.join(sourceDir, 'target', rustTarget, 'release', binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Source build completed but binary was not found: ${binaryPath}`);
  }

  return {
    binaryPath,
    tempDir,
    sourceDetail: {
      repo: repoUrl,
      ref: sourceRef,
      target: rustTarget,
    },
  };
}

function localBinaryPath() {
  const candidate = process.env.AIONCORE_LOCAL_BIN || process.env.AIONUI_BACKEND_LOCAL_BIN || '';
  if (!candidate.trim()) return null;
  const resolved = path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Local aioncore binary not found: ${resolved}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Prepare aioncore binary for packaging.
 *
 * @param {object} options - Configuration options
 * @param {string} options.projectRoot - Project root directory
 * @param {string} options.platform - Target platform (process.platform)
 * @param {string} options.arch - Target architecture (process.arch)
 * @param {string} options.version - Backend version (default: 'latest')
 * @returns {{ prepared: true; dir: string; sourceType: string }}
 */
function prepareAioncore(options) {
  const { projectRoot, platform, arch, version = 'latest' } = options;
  const runtimeKey = `${platform}-${arch}`;
  const forkConfig = readForkConfig(projectRoot, platform, arch);

  // Resolve the actual version tag — asset filenames include the tag
  let tag;
  if (forkConfig) {
    tag = forkConfig.version.startsWith('v') ? forkConfig.version : `v${forkConfig.version}`;
    console.log(`Using fork aioncore config for ${runtimeKey}: ${forkConfig.owner}/${forkConfig.repo}@${tag}`);
  } else if (version === 'latest') {
    const resolved = resolveLatestTag();
    if (!resolved) {
      throw new Error('Failed to resolve latest aioncore release tag from GitHub API');
    }
    tag = resolved;
    console.log(`Resolved aioncore "latest" → ${tag}`);
  } else {
    tag = version.startsWith('v') ? version : `v${version}`;
  }

  const targetDir = path.join(projectRoot, 'resources', 'bundled-aioncore', runtimeKey);
  const binaryName = getBinaryName(platform);
  const targetBinaryPath = path.join(targetDir, binaryName);

  console.log(`Preparing aioncore for ${runtimeKey} (version: ${tag})`);

  removeDirectorySafe(targetDir);
  ensureDirectory(targetDir);

  let sourcePath = null;
  let sourceType = 'none';
  let sourceDetail = {};
  let tempDir = null;

  // 1. Download from GitHub releases
  const localPath = localBinaryPath();
  if (localPath) {
    sourcePath = localPath;
    sourceType = 'local';
    sourceDetail = {
      path: localPath,
      commit: process.env.AIONCORE_SOURCE_COMMIT || undefined,
      repo: process.env.AIONCORE_SOURCE_REPO || undefined,
    };
    console.log(`  Using local aioncore binary: ${localPath}`);
  }

  // 2. Download from GitHub releases
  if (!sourcePath) {
    try {
      const result = forkConfig
        ? downloadAndExtract(platform, arch, tag, forkConfig.owner, forkConfig.repo)
        : downloadAndExtract(platform, arch, tag);
      sourcePath = result.binaryPath;
      tempDir = result.tempDir;
      sourceType = 'download';
      sourceDetail = { url: result.url };
      console.log(`  Downloaded from GitHub releases`);
    } catch (error) {
      console.warn(`  Download failed: ${error.message}`);
    }
  }

  // Build from source for fork targets whose release assets are not available yet.
  if (!sourcePath && forkConfig?.buildFromSource) {
    const result = buildFromSource(platform, arch, tag, forkConfig);
    sourcePath = result.binaryPath;
    tempDir = result.tempDir;
    sourceType = 'source-build';
    sourceDetail = result.sourceDetail;
  }

  // Write result
  if (sourcePath) {
    copyFileSafe(sourcePath, targetBinaryPath);
    ensureExecutableMode(targetBinaryPath);

    // The release tag is the authoritative version — the aioncore
    // binary does not expose a --version flag (it has --app-version which
    // takes a value, not a self-report).
    const manifest = {
      platform,
      arch,
      version: tag,
      generatedAt: new Date().toISOString(),
      sourceType,
      source: sourceDetail,
      files: [binaryName],
    };

    writeJson(path.join(targetDir, 'manifest.json'), manifest);
    console.log(
      `  Bundled aioncore prepared: resources/bundled-aioncore/${runtimeKey}/${binaryName} [source=${sourceType}]`
    );

    if (tempDir) removeDirectorySafe(tempDir);
    return { prepared: true, dir: targetDir, sourceType };
  }

  throw new Error(`aioncore binary not found for ${runtimeKey} (tag: ${tag})`);
}

module.exports = { prepareAioncore };

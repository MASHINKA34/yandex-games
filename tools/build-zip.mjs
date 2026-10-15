import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import AdmZip from 'adm-zip';
import { build } from 'vite';
import { ROOT, loadGame } from './games.mjs';
import { createLogger, installProcessHandlers, since } from './log.mjs';

const baseLog = createLogger('zip');
installProcessHandlers(baseLog);
let log = baseLog;

const MB = 1024 * 1024;
const MAX_BYTES = 100 * MB;
const WARN_BYTES = 25 * MB;
const SAFE_PATH = /^[A-Za-z0-9._\-/]+$/;
const SDK_TAG = /<script\b[^>]*\bsrc=["']\/sdk\.js["'][^>]*>/gi;
const YANDEX_S3 = /https?:\/\/[^"'\s]*(?:games\.s3\.yandex\.net|yandex[^"'\s]*\.s3)/i;
const FORBIDDEN = [
  { test: (name) => name === 'sdk.js', reason: 'Yandex SDK must come from the platform, not from the archive' },
  { test: (name) => name === 'debugcheck.js', reason: 'debug checker is for dev builds only' },
  { test: (name) => name.endsWith('.map'), reason: 'source maps must not be shipped' },
  { test: (name) => name.endsWith('.aseprite') || name.endsWith('.ase'), reason: 'art sources must not be shipped' },
  { test: (name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name), reason: 'tests must not be shipped' },
];
const FORBIDDEN_DIRS = ['node_modules', '.git', 'e2e'];

function parseArgs(argv) {
  const [game, ...rest] = argv;
  const args = { game, build: true };
  for (const flag of rest) {
    if (flag === '--no-build') args.build = false;
    else throw new Error(`unknown argument "${flag}", supported: --no-build`);
  }
  return args;
}

async function step(name, run) {
  const startedAt = performance.now();
  log.info(`${name}: start`);
  try {
    const result = await run();
    log.info(`${name}: done in ${since(startedAt)}ms`);
    return result;
  } catch (error) {
    log.error(`${name}: failed after ${since(startedAt)}ms`, { error });
    throw Object.assign(new Error(`step "${name}" failed`), { logged: true });
  }
}

function listFiles(dir) {
  const walk = (current) =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = join(current, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  return walk(dir).map((full) => ({ full, path: relative(dir, full).split(sep).join('/'), bytes: statSync(full).size }));
}

function formatBytes(bytes) {
  if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fileTable(files) {
  const width = Math.max(4, ...files.map((file) => file.path.length));
  const rows = files.map((file) => `  ${file.path.padEnd(width)}  ${formatBytes(file.bytes).padStart(10)}`);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  return [`  ${'file'.padEnd(width)}  ${'size'.padStart(10)}`, ...rows, `  ${'total'.padEnd(width)}  ${formatBytes(total).padStart(10)}`].join('\n');
}

function checkRelease(files) {
  const problems = [];
  const warnings = [];
  const indexFiles = files.filter((file) => file.path.split('/').pop() === 'index.html');
  if (!files.some((file) => file.path === 'index.html')) problems.push({ check: 'index.html in root', detail: 'dist has no index.html at the root' });
  if (indexFiles.length > 1) problems.push({ check: 'single index.html', detail: `found ${indexFiles.length}: ${indexFiles.map((file) => file.path).join(', ')}` });

  for (const file of files) {
    if (!SAFE_PATH.test(file.path)) problems.push({ check: 'file names', detail: `"${file.path}" has spaces, non-latin or special characters` });
    const segments = file.path.toLowerCase().split('/');
    const name = segments[segments.length - 1] ?? '';
    for (const rule of FORBIDDEN) if (rule.test(name)) problems.push({ check: 'forbidden file', detail: `${file.path}: ${rule.reason}` });
    const badDir = segments.slice(0, -1).find((segment) => FORBIDDEN_DIRS.includes(segment));
    if (badDir) problems.push({ check: 'forbidden folder', detail: `${file.path}: ${badDir}/ must not be shipped` });
    if (/\.(html|js|css|json)$/.test(name) && YANDEX_S3.test(readFileSync(file.full, 'utf8'))) {
      problems.push({ check: 'no Yandex S3 URLs', detail: `${file.path} contains an absolute Yandex S3 URL (requirement 1.7)` });
    }
  }

  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > MAX_BYTES) problems.push({ check: 'size', detail: `unpacked size ${formatBytes(total)} exceeds ${formatBytes(MAX_BYTES)}` });
  else if (total > WARN_BYTES) warnings.push({ check: 'size', detail: `unpacked size ${formatBytes(total)} is above the ${formatBytes(WARN_BYTES)} target` });

  const index = files.find((file) => file.path === 'index.html');
  if (index) {
    const html = readFileSync(index.full, 'utf8');
    const sdkTags = html.match(SDK_TAG) ?? [];
    if (sdkTags.length !== 1) problems.push({ check: 'sdk script tag', detail: `index.html must reference /sdk.js exactly once, found ${sdkTags.length}` });
    if (/debugcheck/i.test(html)) problems.push({ check: 'no debug checker', detail: 'index.html references debugcheck' });
  }
  return { problems, warnings, total };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const game = loadGame(args.game);
  log = baseLog.child(game.name);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      log.warn(`received ${signal}, stopping; the archive may be incomplete and is rebuilt on the next run`);
      process.exit(1);
    });
  }
  const { version } = game.config;
  const zipDir = join(ROOT, 'dist');
  const zipPath = join(zipDir, `${game.name}-${version}.zip`);
  const startedAt = performance.now();
  log.info(`release archive for ${game.name}`, { version, appId: game.config.appId, build: args.build, out: relative(ROOT, zipPath) });

  if (existsSync(zipPath)) {
    rmSync(zipPath);
    log.info('removed previous archive with the same version', { file: relative(ROOT, zipPath) });
  }

  if (args.build) {
    await step('vite build', () => build({ configFile: join(game.dir, 'vite.config.ts'), logLevel: 'warn' }));
  } else if (!existsSync(game.distDir)) {
    throw new Error(`--no-build given but ${relative(ROOT, game.distDir)} does not exist`);
  }

  const files = await step('scan dist', () => {
    const found = listFiles(game.distDir).sort((a, b) => a.path.localeCompare(b.path));
    log.info(`found ${found.length} files in ${relative(ROOT, game.distDir)}`);
    return found;
  });

  const report = await step('release checks', () => checkRelease(files));
  log.info(`release files:\n${fileTable(files)}`);
  for (const warning of report.warnings) log.warn(`check "${warning.check}": ${warning.detail}`);
  if (report.problems.length > 0) {
    for (const problem of report.problems) log.error(`check "${problem.check}" failed: ${problem.detail}`);
    log.error(`release archive not created: ${report.problems.length} problem(s)`, { game: game.name, version });
    process.exitCode = 1;
    return;
  }

  await step('pack zip', () => {
    mkdirSync(zipDir, { recursive: true });
    const zip = new AdmZip();
    for (const file of files) {
      const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      zip.addLocalFile(file.full, folder);
    }
    zip.writeZip(zipPath);
  });

  await step('verify zip', () => {
    const entries = new AdmZip(zipPath).getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName);
    const expected = files.map((file) => file.path);
    const missing = expected.filter((path) => !entries.includes(path));
    const extra = entries.filter((path) => !expected.includes(path));
    if (missing.length > 0 || extra.length > 0) throw new Error(`zip content mismatch: missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`);
    log.info('zip entries match dist', { entries: entries.length });
  });

  log.info(`release archive ready in ${since(startedAt)}ms`, {
    file: relative(ROOT, zipPath),
    zipSize: formatBytes(statSync(zipPath).size),
    unpacked: formatBytes(report.total),
    files: files.length,
  });
}

main().catch((error) => {
  if (error?.logged) log.error(`build-zip failed: ${error.message}`, { argv: process.argv.slice(2).join(' ') });
  else log.error('build-zip failed', { argv: process.argv.slice(2).join(' '), error });
  process.exitCode = 1;
});

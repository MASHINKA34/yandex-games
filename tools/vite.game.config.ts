import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';
import { CHECKER_PATH, MOCK_SDK_PATH, ROOT, mockSdkSource, readYgConfig } from './games.mjs';
import { createLogger } from './log.mjs';

export interface YgConfig {
  appId: number | null;
  title: Record<string, string>;
  version: string;
  orientation: 'portrait' | 'landscape';
  baseWidth: number;
  baseHeight: number;
  devPort: number;
}

const log = createLogger('vite');
const FORBIDDEN_NAMES = ['sdk.js', 'debugcheck.js'];
const SAFE_NAME = /[^A-Za-z0-9._-]/g;

function sanitizeFileName(name: string): string {
  return name.replace(/\0/g, '').replace(SAFE_NAME, '_');
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function isForbidden(file: string): boolean {
  const name = file.split(/[\\/]/).pop() ?? '';
  return FORBIDDEN_NAMES.includes(name) || name.endsWith('.map');
}

function devSdkPlugin(yg: YgConfig, checker: boolean): Plugin {
  return {
    name: 'yg-dev-sdk',
    apply: 'serve',
    configureServer(server) {
      log.info('mock SDK served at /sdk.js', { file: relative(ROOT, MOCK_SDK_PATH), appId: yg.appId });
      if (checker) {
        if (!existsSync(CHECKER_PATH)) {
          throw new Error(`--checker requested but ${relative(ROOT, CHECKER_PATH)} is missing`);
        }
        log.info('checker mode: /debugcheck.js injected after /sdk.js', { file: relative(ROOT, CHECKER_PATH) });
      }
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/sdk.js') {
          log.debug('GET /sdk.js -> mock', { referer: req.headers.referer });
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(mockSdkSource(yg.appId));
          return;
        }
        if (checker && path === '/debugcheck.js') {
          log.debug('GET /debugcheck.js -> vendor checker');
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(readFileSync(CHECKER_PATH, 'utf8'));
          return;
        }
        next();
      });
    },
    transformIndexHtml() {
      return checker ? [{ tag: 'script', attrs: { src: '/debugcheck.js' }, injectTo: 'head' }] : [];
    },
  };
}

function releaseGuardPlugin(): Plugin {
  let outDir = '';
  let publicDir = '';
  let buildFailed = false;
  return {
    name: 'yg-release-guard',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
    },
    buildStart() {
      const inPublic = walk(publicDir).filter(isForbidden);
      if (inPublic.length > 0) {
        const files = inPublic.map((file) => relative(ROOT, file));
        log.error('release build stopped: forbidden files in public/', { files });
        throw new Error(`forbidden files in public/ would be copied to the release: ${files.join(', ')}`);
      }
    },
    buildEnd(error) {
      buildFailed = Boolean(error);
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/<script\s+src="\/sdk\.js"><\/script>/g, '<script src="/sdk.js"></script>');
      },
    },
    closeBundle() {
      if (buildFailed) {
        log.warn('release guard skipped: build failed before writing dist', { outDir: relative(ROOT, outDir) });
        return;
      }
      const files = walk(outDir);
      const leaked = files.filter(isForbidden);
      if (leaked.length > 0) {
        const names = leaked.map((file) => relative(outDir, file));
        for (const file of leaked) rmSync(file, { force: true });
        log.error('release build had forbidden files, removed them from dist', { outDir: relative(ROOT, outDir), files: names });
        throw new Error(`release build contained forbidden files (removed from dist): ${names.join(', ')}`);
      }
      log.info('release guard passed', { outDir: relative(ROOT, outDir), files: files.length });
    },
  };
}

export function createGameConfig(gameDir: string): UserConfig {
  const yg = readYgConfig(gameDir) as YgConfig;
  const checker = process.env.YG_CHECKER === '1';
  return {
    root: gameDir,
    base: './',
    publicDir: 'public',
    plugins: [devSdkPlugin(yg, checker), releaseGuardPlugin()],
    resolve: {
      alias: {
        '@yg/core': join(ROOT, 'packages', 'core', 'src'),
        '@yg/sdk': join(ROOT, 'packages', 'sdk', 'src'),
      },
    },
    optimizeDeps: {
      include: ['phaser'],
    },
    server: {
      host: 'localhost',
      port: yg.devPort,
      strictPort: true,
    },
    preview: {
      host: 'localhost',
      port: yg.devPort,
      strictPort: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2019',
      assetsInlineLimit: 0,
      sourcemap: false,
      minify: 'esbuild',
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          sanitizeFileName,
          manualChunks(id) {
            return /[\\/]node_modules[\\/]phaser[\\/]/.test(id) ? 'phaser' : undefined;
          },
        },
      },
    },
  };
}

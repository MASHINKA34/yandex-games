import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createServer } from 'vite';
import { CHECKER_PATH, ROOT, loadGame } from './games.mjs';
import { createLogger, installProcessHandlers, since } from './log.mjs';

const log = createLogger('dev');
installProcessHandlers(log);

function parseArgs(argv) {
  const [game, ...rest] = argv;
  const args = { game, checker: false, port: undefined };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--checker') {
      args.checker = true;
    } else if (flag === '--port') {
      const value = rest[i + 1];
      args.port = Number(value);
      if (!Number.isInteger(args.port) || args.port <= 0 || args.port > 65535) {
        throw new Error(`--port needs a number 1-65535, got "${value ?? ''}"`);
      }
      i += 1;
    } else {
      throw new Error(`unknown argument "${flag}", supported: --checker, --port <number>`);
    }
  }
  return args;
}

let server;

async function stop(exitCode) {
  process.exitCode = exitCode;
  if (server) {
    const startedAt = performance.now();
    try {
      await server.close();
      log.info(`dev server closed in ${since(startedAt)}ms`);
    } catch (error) {
      log.error('dev server close failed', { error });
      process.exitCode = 1;
    }
  }
  setTimeout(() => process.exit(), 1000).unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const game = loadGame(args.game);
  if (args.checker && !existsSync(CHECKER_PATH)) {
    throw new Error(`--checker requested but ${relative(ROOT, CHECKER_PATH)} does not exist`);
  }
  if (args.checker) process.env.YG_CHECKER = '1';

  const port = args.port ?? game.config.devPort;
  log.info(`starting dev server for ${game.name}`, {
    version: game.config.version,
    appId: game.config.appId,
    port,
    checker: args.checker,
    node: process.version,
  });

  const startedAt = performance.now();
  server = await createServer({
    configFile: join(game.dir, 'vite.config.ts'),
    server: { port },
  });
  await server.listen();
  log.info(`dev server ready in ${since(startedAt)}ms`, { url: server.resolvedUrls?.local[0] ?? `http://localhost:${port}/` });
  server.printUrls();

  let closing = false;
  const onSignal = (signal) => {
    if (closing) return;
    closing = true;
    log.info(`received ${signal}, closing dev server`);
    void stop(0);
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}

main().catch((error) => {
  log.error('dev server failed to start', { argv: process.argv.slice(2).join(' '), error });
  void stop(1);
});

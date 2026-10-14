import ygConfig from '../yg.config.json';
import { createLogger, installGlobalHandlers } from './log';
import { initSdk, sdkLang } from './yg';

installGlobalHandlers();
const log = createLogger('main');

log.info('game starting', {
  game: 'flea',
  version: ygConfig.version,
  mode: import.meta.env.MODE,
  appId: ygConfig.appId,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});

initSdk()
  .then(() => log.info('boot finished', { lang: sdkLang() }))
  .catch((error: unknown) => log.error('boot failed', { error }));

import { fileURLToPath } from 'node:url';
import { createE2eConfig } from '../../tools/playwright.game.config';

export default createE2eConfig(fileURLToPath(new URL('.', import.meta.url)));

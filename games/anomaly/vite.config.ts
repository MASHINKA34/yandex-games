import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createGameConfig } from '../../tools/vite.game.config';

export default defineConfig(createGameConfig(fileURLToPath(new URL('.', import.meta.url))));

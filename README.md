# yandex-games

Две игры для Яндекс Игр на Phaser 3 и TypeScript: «Аномалия: Ночная смена» (`games/anomaly`) и «Барахолка: Торг уместен» (`games/flea`). Общий код в `packages/`, сборка и проверки в `tools/`.

Нужен Node 22.12+, 24 или 26+.

    npm install
    npx playwright install chromium
    npm run dev:anomaly

Локально вместо настоящего SDK подключается мок `packages/sdk/mock/sdk.js`, в углу страницы будет плашка MOCK SDK. Уровень логов меняется параметром `?log=debug`. С флагом `npm run dev:anomaly -- --checker` подключается чекер из `vendor/yg-debug-checker`, панель открывается командой `YGDebugChecker.open()` в консоли браузера.

Проверить игру с настоящим SDK во фрейме Яндекса: запустить `npm run dev:anomaly -- --no-hmr`, затем `npm run proxy:anomaly` и открыть черновик игры с `?draft=true&game_url=https://localhost:8080` (сертификат прокси самоподписанный, его нужно один раз принять на `https://localhost:8080`).

Архив для консоли:

    npm run zip:anomaly
    npm run check:anomaly

Zip появится в `dist/`. Для второй игры всё то же самое с `flea` вместо `anomaly`.

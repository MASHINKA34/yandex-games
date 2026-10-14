# yandex-games

Две игры для Яндекс Игр на Phaser 3 и TypeScript: «Аномалия: Ночная смена» (`games/anomaly`) и «Барахолка: Торг уместен» (`games/flea`). Общий код в `packages/`, сборка и проверки в `tools/`.

Нужен Node 22.12+, 24 или 26+.

    npm install
    npx playwright install chromium
    npm run dev:anomaly

Локально вместо настоящего SDK подключается мок `packages/sdk/mock/sdk.js`, в углу страницы будет плашка MOCK SDK. Уровень логов меняется параметром `?log=debug`. Проверить игру с настоящим SDK во фрейме Яндекса можно через `npm run proxy:anomaly` при запущенном dev-сервере.

Архив для консоли:

    npm run zip:anomaly
    npm run check:anomaly

Zip появится в `dist/`, отчёт проверки в `reports/check-anomaly.json`. Для второй игры всё то же самое с `flea` вместо `anomaly`.

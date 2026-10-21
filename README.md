# Жимолость

Дневник тренировок в Telegram Mini App: программы, упражнения, подходы, веса и история прогресса. У каждого Telegram-аккаунта свой профиль. Приложение открывается из меню бота или кнопки в ответе на `/start` и `/app`.

## Возможности

- План тренировок, запись подходов, таймер отдыха и статистика.
- Первый запуск с выбором параметров и готовой программы.
- Фото профиля Telegram, если пользователь делится им с Mini App; при отсутствии фото — первая буква имени.
- Настраиваемые сообщения после тренировки и недельные обзоры.
- Админское меню для аккаунтов с назначенной сервером ролью.

## Архитектура

Frontend — React/Vite; API — Node.js с отдельными файлами данных профилей. Docker Compose запускает web, API и Telegram-бота на обычном сервере. Публичный HTTPS может обслуживать Cloudflare Tunnel или внешний reverse proxy.

API проверяет подпись исходной строки Telegram `initData`, после чего находит профиль по подписанному Telegram ID. Имя, username, аватар и `initDataUnsafe` не дают доступа к чужим данным или административной роли. Персональные запросы сохраняют проверку владельца профиля.

AI coach и MCP — отдельные опциональные возможности; их включение требует отдельной настройки. Личные загрузки фото/видео в текущем Telegram-развёртывании отключены.

## Локальный запуск

Нужен Node.js 22 или новее:

```sh
npm --prefix api ci --ignore-scripts --omit=optional
npm --prefix frontend ci --ignore-scripts
node scripts/dev.mjs
```

Открыть http://localhost:5174. Этот preview хранит данные отдельно в `.cache/telegram-local-preview`, не читает рабочий `.env` и не запускает Telegram polling или отправку сообщений.

Для проверки Telegram-потока на локальном HTTP-стенде нужны пакет Playwright и установленный Google Chrome:

```sh
node scripts/check-telegram-local.mjs /absolute/path/to/playwright
```

Стенд использует синтетическую подпись, отдельные тестовые профили и локальный эмулятор Bot API. Это не проверка настоящего Telegram WebView. Скриншоты и результат сохраняются в `.cache/telegram-check-*`.

## Развёртывание

Настройки сервера и бота задаются через `.env` по образцу `.env.telegram.example`. Токен бота остаётся только на сервере. Для наших изменений нужно собирать образы из этого репозитория; готовые сторонние образы их не содержат.

Подробности: [локальная разработка и Docker](integration/LOCAL_DEV.md), [бот](integration/BOT.md), [обновление исходной основы](UPSTREAM.md). Перед обновлением рабочего сервера сохраняйте резервную копию данных.

## Лицензии и происхождение

Сервис создан на основе [openGym](https://github.com/DuarteSantos8/openGym) и распространяется с сохранением [LICENSE](LICENSE) и [NOTICE.md](NOTICE.md). Исходники адаптации находятся в [ветке Telegram Mini App](https://github.com/tehnalive/openGym/tree/telegram-mini-app).

Exercise media © Aliaksandr Makatserchyk, [Gym visual](https://gymvisual.com/), gymvisual.com. Media licensed for use in openGym only; see [NOTICE.md](NOTICE.md). Ограничения на материалы упражнений сохраняются.

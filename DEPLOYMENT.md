# Пошаговое руководство по деплою Funding Finder V2

## Содержание
1. [Подготовка (rotate секретов)](#1-подготовка-rotate-секретов)
2. [Создание репозитория на GitHub](#2-создание-репозитория-на-github)
3. [Deploy на Render (бесплатный)](#3-deploy-на-render-бесплатный)
4. [Локальный запуск через Docker](#4-локальный-запуск-через-docker)
5. [Альтернативы: Railway / Fly.io](#5-альтернативы-railway--flyio)
6. [Настройка Telegram MiniApp](#6-настройка-telegram-miniapp)
7. [Проверка после деплоя](#7-проверка-после-деплоя)
8. [Устранение проблем](#8-устранение-проблем)

---

## 1. Подготовка (rotate секретов)

**Почему это критично:** в `.env` коммитились реальные ключи — их нужно сменить перед деплоем в продакшн.

```bash
# 1. Telegram Bot Token — зайди в @BotFather → /mybots → выбор бота → API Token → Revoke
#    Скопируй новый токен

# 2. OpenRouter API Key — зайди на openrouter.ai/keys → удалить старый → создать новый

# 3. Crypto Pay Token — зайди в @CryptoBot → Crypto Pay → API Tokens → Revoke旧 → создать новый

# 4. JWT_SECRET и WEBHOOK_SECRET — сгенерируй случайные строки:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Скопируй вывод — это будет JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Скопируй вывод — это будет WEBHOOK_SECRET
```

**Запиши все новые значения** — они понадобятся на следующем шаге.

---

## 2. Создание репозитория на GitHub

```bash
# Перейди в папку проекта
cd funding-finder-v2

# Инициализируй git (если ещё не инициализирован)
git init

# Добавь все файлы (кроме .env и node_modules — они в .gitignore)
git add .

# Создай первый коммит
git commit -m "feat: Funding Finder v2 — production ready"

# Создай репозиторий на github.com:
#   → Кнопка "+" → "New repository"
#   → Имя: funding-finder-v2
#   → Public или Private
#   → НЕ ставь галочку "Add a README" (репо уже содержит код)
#   → Нажми "Create repository"

# Свяжи локальный репозиторий с удалённым
git remote add origin https://github.com/TVOY_USERNAME/funding-finder-v2.git

# Закинь код
git push -u origin master
```

---

## 3. Deploy на Render (бесплатный)

Render — лучший бесплатный вариант. База данных PostgreSQL бесплатно 90 дней, потом $7/мес.

### 3.1 Регистрация

1. Зайди на [render.com](https://render.com)
2. Нажми **Get Started** → выбери **Sign up with GitHub**
3. Разреши доступ к твоему репозиторию

### 3.2 Создание PostgreSQL базы данных

> **Зачем:** PostgreSQL — основа приложения. Хранит пользователей, алерты, результаты сканирования, платежи.

1. На дашборде нажми **New +** → **PostgreSQL**
2. Заполни:
   - **Name:** `funding-finder-db`
   - **Database:** `funding_finder`
   - **User:** `postgres`
   - **Region:** выбери ближайший к тебе (Europe)
   - **Plan:** **Free**
3. Нажми **Create Database**
4. Дождись статуса **Available** (~30 секунд)
5. Скопируй **Internal Database URL** — она выглядит так:
   ```
   postgresql://postgres:abc123xyz@dpg-xxxx.oregon-postgres.render.com:5432/funding_finder
   ```

> **Важно:** этот URL содержит пароль. Нигде его не публикуй.

### 3.3 Деплой Backend (API сервер)

> **Зачем:** это сервер, который сканирует биржи, обрабатывает алерты, управляет платежами, общается с Telegram.

1. На дашборде нажми **New +** → **Web Service**
2. Подключи репозиторий `funding-finder-v2`
3. Настрой:
   - **Name:** `funding-finder-api`
   - **Runtime:** `Node`
   - **Region:** тот же, что и база данных
   - **Branch:** `master`
   - **Build Command:**
     ```
     cd backend && npm install && npx prisma generate && npm run build
     ```
   - **Start Command:**
     ```
     cd backend && npx prisma migrate deploy && node dist/index.js
     ```
   - **Plan:** Free

> **Что делает Build Command:**
> - `npm install` — ставит зависимости (Express, Prisma, Zod, BullMQ и т.д.)
> - `npx prisma generate` — генерирует Prisma Client (типизированный доступ к БД)
> - `npm run build` — компилирует TypeScript в JavaScript (`dist/`)

> **Что делает Start Command:**
> - `npx prisma migrate deploy` — применяет миграции (создаёт таблицы)
> - `node dist/index.js` — запускает сервер

4. Добавь **Environment Variables** (нажми **Add Environment Variable**):

   | Key | Value | Где взять |
   |-----|-------|-----------|
    | `DATABASE_URL` | `postgresql://postgres:abc123xyz@...` | Из шага 3.2 |
    | `DIRECT_URL` | прямой (не-pooled) URL БД | Internal Database URL из шага 3.2 (нужен для `migrate deploy`; без него используется `db push`) |
   | `NODE_ENV` | `production` | Фиксированное значение |
   | `PORT` | `3000` | Фиксированное значение |
   | `TELEGRAM_BOT_TOKEN` | `123456:ABC-DEF...` | Из шага 1 |
   | `OPENROUTER_API_KEY` | `sk-or-v1-...` | Из шага 1 |
   | `AI_MODEL` | `x-ai/grok-4.1-fast:free` | Модель AI |
   | `CRYPTO_PAY_API_TOKEN` | `123456:ABC...` | Из шага 1 |
   | `CRYPTO_BOT_USERNAME` | `CryptoBot` | Имя твоего крипто-бота |
   | `CRYPTO_PAY_NETWORK` | `testnet` или `mainnet` | Сначала testnet! |
   | `WEBHOOK_SECRET` | `случайная_строка` | Из шага 1 |
   | `JWT_SECRET` | `случайная_строка` | Из шага 1 |
   | `CORS_ORIGINS` | `https://t.me` | Разрешённые домены |

5. Нажми **Create Web Service**
6. Дождись статусус **Live** (~2-3 минуты)

### 3.4 Деплой Frontend (SPA)

> **Зачем:** это интерфейс пользователя — страница сканирования, арбитража, профиля.

1. На дашборде нажми **New +** → **Static Site**
2. Подключи тот же репозиторий
3. Настрой:
   - **Name:** `funding-finder`
   - **Branch:** `master`
   - **Build Command:**
     ```
     cd frontend && npm install && npm run build
     ```
   - **Publish Directory:**
     ```
     frontend/dist
     ```
4. Добавь Environment Variable:

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://funding-finder-api.onrender.com` |

5. Нажми **Create Static Site**
6. Дождись статуса **Live**

> **Почему VITE_API_URL:** React приложение собирается (`npm run build`) и хранится как статика. Оно не знает, где API сервер. `VITE_API_URL` подставляется при сборке и говорит: "все запросы к API отправляй на этот URL".

### 3.5 Проверка

1. Открой URL фронтенда (типа `https://funding-finder.onrender.com`)
2. Должна загрузиться страница сканирования
3. Открой консоль браузера (F12) — проверь, что API запросы идут на правильный URL
4. Проверь health check: `https://funding-finder-api.onrender.com/api/health`
   Должен вернуть `{"status":"ok","timestamp":"..."}`

---

## 4. Локальный запуск через Docker

> **Зачем:** для локальной разработки или если хочешь запустить всё на своём сервере.

### 4.1 Установка Docker

```bash
# Windows: скачай Docker Desktop с https://docker.com/products/docker-desktop
# Mac:brew install --cask docker
# Linux: sudo apt install docker.io docker-compose-v2
```

### 4.2 Подготовка

```bash
cd funding-finder-v2

# Создай .env файл из примера
cp backend/.env.example backend/.env

# Отредактируй backend/.env — заполни реальными значениями:
#   DATABASE_URL=postgresql://postgres:postgres@db:5432/funding_finder
#   TELEGRAM_BOT_TOKEN=...
#   OPENROUTER_API_KEY=...
#   и т.д.
```

### 4.3 Запуск

```bash
# Собери и запусти все контейнеры
docker-compose up --build

# Или в фоновом режиме
docker-compose up --build -d
```

**Что запустится:**
- `db` — PostgreSQL 16 (порт 5432, хранит данные в `postgres_data` volume)
- `backend` — Express API (порт 3000, ждёт пока БД станет доступна)
- `frontend` — nginx с React SPA (порт 80)

### 4.4 Проверка

```bash
# Health check
curl http://localhost:3000/api/health

# Frontend
# Открой http://localhost в браузере
```

### 4.5 Управление

```bash
# Остановить
docker-compose down

# Остановить и удалить данные БД
docker-compose down -v

# Посмотреть логи
docker-compose logs -f backend
docker-compose logs -f frontend
```

---

## 5. Альтернативы: Railway / Fly.io

### Railway (лучший DX, $20 кредит)

```bash
# Установи CLI
npm install -g @railway/cli

# Логин
railway login

# Инициализируй проект
cd funding-finder-v2
railway init

# Добавь PostgreSQL
railway add postgresql

# Установи переменные окружения
railway variables set DATABASE_URL="..."
railway variables set TELEGRAM_BOT_TOKEN="..."
railway variables set OPENROUTER_API_KEY="..."
railway variables set JWT_SECRET="$(openssl rand -hex 32)"
railway variables set WEBHOOK_SECRET="$(openssl rand -hex 32)"
railway variables set NODE_ENV="production"

# Деплой
railway up
```

### Fly.io (глобальное деплоивание, $5 кредит)

```bash
# Установи Fly CLI
curl -L https://fly.io/install.sh | sh

# Логин
flyctl auth login

# Создай приложение
cd funding-finder-v2/backend
flyctl launch

# Добавь PostgreSQL
flyctl postgres create --name funding-finder-db

# Установи секреты
flyctl secrets set DATABASE_URL="postgresql://..."
flyctl secrets set TELEGRAM_BOT_TOKEN="..."
flyctl secrets set OPENROUTER_API_KEY="..."
flyctl secrets set JWT_SECRET="$(openssl rand -hex 32)"
flyctl secrets set WEBHOOK_SECRET="$(openssl rand -hex 32)"
flyctl secrets set NODE_ENV="production"

# Деплой
flyctl deploy
```

---

## 6. Настройка Telegram MiniApp

### 6.1 Создание MiniApp

1. Напиши своему боту в Telegram команду:
   ```
   /newapp
   ```
   Или зайди в [@BotFather](https://t.me/BotFather) → выбери бота → **Bot Settings** → **Menu Button** → **Configure menu button**

2. Заполни:
   - **App Name:** `Funding Finder`
   - **Description:** `Мониторинг фандинг ставок криптовалют`
   - **URL:** `https://funding-finder.onrender.com` (URL твоего фронтенда)
   - **Mini App URL:** тот же URL
   - **Photo:** загрузи логотип (рекомендуется 640x640)

3. Нажми **Save**

### 6.2 Проверка

1. Открой бота в Telegram
2. Нажми кнопку **Menu** (или **Open App**)
3. Должна открыться мини-аппа

---

## 7. Проверка после деплоя

### Health Check
```bash
curl https://funding-finder-api.onrender.com/api/health
# Ожидаемый ответ: {"status":"ok","timestamp":"..."}
```

### API Endpoints (без авторизации)
```bash
# Сканирование (нужен.telegram initData)
curl -H "x-telegram-init-data: ..." https://funding-finder-api.onrender.com/api/scan

# AI History (публичный)
curl https://funding-finder-api.onrender.com/api/ai/history
```

### С WebSocket
```bash
# Подключение (нужен.telegram initData)
wss://funding-finder-api.onrender.com/ws?initData=...
```

### Логи
- Render: Dashboard → Backend Service → **Logs**
- Docker: `docker-compose logs -f backend`
- Railway: Dashboard → Deployment → **Logs**

### Что проверить
- [ ] Health check отвечает 200
- [ ] Фронтенд загружается
- [ ] Авторизация работает (в Telegram MiniApp)
- [ ] Сканирование бирж возвращает данные
- [ ] AI анализ работает (нужен Pro план)
- [ ] Платежи работают (Crypto Pay)
- [ ] WebSocket подключается
- [ ] Алерты создаются и срабатывают
- [ ] Метрики доступны: `/api/metrics`
- [ ] Swagger документация: `/docs`

---

## 8. Устранение проблем

### Проблема: "Application failed to start"
**Решение:**
1. Проверь логи в дашборде Render/Railway
2. Убедись, что `DATABASE_URL` правильный
3. Проверь, что Prisma migrations прошли успешно

### Проблема: "Cannot connect to database"
**Решение:**
1. Проверь, что PostgreSQL запущен
2. Проверь `DATABASE_URL` — формат: `postgresql://user:pass@host:5432/db`
3. Убедись, что хост доступен из твоей сети

### Проблема: "TELEGRAM_BOT_TOKEN is required"
**Решение:**
- В Render: добавь переменную окружения в дашборде
- В Docker: добавь в `backend/.env`

### Проблема: "CORS error" в браузере
**Решение:**
1. Проверь `CORS_ORIGINS` — должен содержать домен фронтенда
2. Формат: `https://funding-finder.onrender.com`

### Проблема: "Rate limit exceeded" на API
**Решение:**
- Это ограничения Render free tier (спад после 15 минут неактивности)
- Решение: перейти на платный план или использовать keep-alive сервис

### Проблема: Frontend не находит API
**Решение:**
1. Проверь `VITE_API_URL` — должен быть URL backend сервиса
2. Убедись, что backend деплой завершился успешно

### Проблема: WebSocket не подключается
**Решение:**
1. Проверь, что backend поддерживает WebSocket (`/ws` путь)
2. В Render: WebSocket работает автоматически
3. Проверь nginx конфиг: `proxy_pass http://backend:3000/ws`

### Проблема: "Build failed" на Render
**Решение:**
1. Проверь версию Node.js (нужна 18+)
2. Убедись, что `package.json` корректный
3. Проверь логи сборки

---

## 9. Production hardening (обязательно перед релизом)

### Бэкапы базы данных
Платёжные данные и подписки хранятся в PostgreSQL. Без бэкапов потеря БД =
потеря пользователей и выручки. Настрой автоматические бэкапы:
- Render: Dashboard → PostgreSQL → **Backups** (включено по умолчанию, PITR на платных планах).
- Railway/Fly: включи managed backups или `pg_dump` по расписанию (cron).
- Проверь восстановление хотя бы один раз.

### Redis для горизонтального масштабирования
По умолчанию кэш, circuit breaker, job queue (BullMQ) и дедупликация webhook —
в памяти процесса. Это корректно для **одного инстанса**. Если поднимаешь
несколько инстансов (load balancer), задай `REDIS_URL`:
- BullMQ начнёт использовать Redis для очередей сканирования/алертов.
- Дедупликация webhook (`/api/webhook/crypto-pay`, `/payment`) переедет в Redis
  и будет корректной между инстансами.
- Без `REDIS_URL` сервис работает на одном инстансе (лог предупредит об этом).

### Секреты
- В репозитории только `.env.example` — реальные `.env` в `.gitignore`.
- Перед деплоем обязательно сгенерируй уникальные `JWT_SECRET`, `WEBHOOK_SECRET`
  и `ENCRYPTION_KEY` (≥32 символов). `ENCRYPTION_KEY` обязателен в проде
  (иначе ключи бирж шифруются небезопасным фолбэком).
- `CRYPTO_PAY_API_TOKEN`: без него webhook Crypto Pay отклоняет все запросы
  (ожидаемо в testnet/симуляции).

### Проверка подписи Crypto Pay
Вебхук проверяет HMAC-SHA256 по **сырым байтам** запроса (`rawBody`), а не по
повторно сериализованному JSON, и сверяет оплаченную сумму с ценой плана.
Убедись, что заголовок `Crypto-Pay-API-Signature` приходит неизменённым
(не переупаковывай body прокси/ингрессом).

## Ссылки
- [Render Docs](https://render.com/docs)
- [Railway Docs](https://docs.railway.app)
- [Fly.io Docs](https://fly.io/docs)
- [Telegram MiniApp Docs](https://core.telegram.org/bots/webapps)
- [Prisma Docs](https://www.prisma.io/docs)

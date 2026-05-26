# Humlinker Backend

NestJS API with a layered, clean-architecture folder layout.

## Structure

```
src/
├── config/          # Environment and app configuration
├── database/        # Database module (ORM, connections)
├── common/          # Shared constants, interfaces, pipes, decorators
├── guards/          # Route guards
├── interceptors/    # Cross-cutting request/response handlers
├── filters/         # Exception filters
├── jobs/            # Scheduled and background tasks
├── integrations/    # External service adapters
└── modules/         # Feature modules
```

## Setup

```bash
npm install
cp .env.example .env
# Configure DATABASE_URL and JWT_SECRET in .env
npm run prisma:generate
npm run prisma:migrate
```

## Run

```bash
npm run start:dev
```

API base path: `http://localhost:3000/api/v1`

### Health

- `GET /api/v1/health` (public)

### Auth (public)

- `POST /api/v1/auth/register` — body: `RegisterUserDto`, returns `{ user, token }`
- `POST /api/v1/auth/login` — body: `{ identifier, password }`, returns `{ user, token }`

### Users (JWT required)

- `GET /api/v1/users/me`
- `GET /api/v1/users/:id`
- `PATCH /api/v1/users/me`
- `PATCH /api/v1/users/me/password`
- `GET /api/v1/users/search?q=...&limit=10`

Send `Authorization: Bearer <token>` on protected routes.

## Test

```bash
npm run test
npm run test:e2e
```

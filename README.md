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
```

## Run

```bash
npm run start:dev
```

API base path: `http://localhost:3000/api/v1`

Health check: `GET /api/v1/health`

## Test

```bash
npm run test
npm run test:e2e
```

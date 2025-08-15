# Jam Band — Backend

A TypeScript Express.js backend for the Jam Band application. It provides REST endpoints, WebSocket/Socket.IO handlers for real-time room features, and WebRTC signaling support for voice.

## Quick overview

- Language: TypeScript
- Framework: Express (HTTP) + Socket-based handlers for real-time features
- Purpose: Room management, real-time chat/voice signaling, and basic user/connection orchestration

## Requirements

- Node.js v18+ (or Bun-compatible runtime where supported)
- npm or yarn

## Getting started (local development)

1. Install dependencies

```bash
npm install
```

2. Copy the environment example and edit values

```bash
cp env.local.example .env.local
# or: cp env.local.example .env
```

3. Start the dev server (hot reload)

```bash
npm run dev
```

By default the server listens on http://localhost:3001 (see `PORT` env var).

## Available scripts

- `npm run dev` — Start development server with hot reload
- `npm run build` — Build the project for production
- `npm run start` — Start the production server (after build)
- `npm run clean` — Remove build artifacts
- `npm run type-check` — Run TypeScript type checks

Check `package.json` for exact script definitions.

## Environment variables

Important variables (see `env.local.example`):

- `PORT` — Server port (default: 3001)
- `NODE_ENV` — `development` or `production`
- `DISABLE_VOICE_RATE_LIMIT` — Set to `true` to disable voice rate limiting in dev/testing
- `VOICE_OFFER_RATE_LIMIT`, `VOICE_ANSWER_RATE_LIMIT`, `VOICE_ICE_RATE_LIMIT` — Numeric limits per minute per user

Always store production secrets securely and do not commit `.env` to source control.

## API endpoints

The backend exposes a small HTTP surface in addition to real-time socket handlers. Common endpoints:

- `GET /` — Welcome message
- `GET /health` — Health check

Socket and signaling events are implemented under `src/handlers` and `src/socket` (see code for full event names and payload shapes).

## WebRTC / Voice rate limiting

To protect signaling and voice traffic the app applies per-user rate limits:

- voice_offer: default 60/min (≈1/sec)
- voice_answer: default 60/min (≈1/sec)
- voice_ice_candidate: default 200/min (≈3.3/sec)

Recovery and safety:

- Exponential backoff for reconnection attempts (2s, 4s, 8s)
- Temporary extra attempts for users who recently hit limits
- Development bypass via `DISABLE_VOICE_RATE_LIMIT=true`

Adjust limits carefully — raising them can increase server and network load.

## WebRTC configuration

Default STUN servers configured:

- stun:stun.l.google.com:19302
- stun:stun1.l.google.com:19302
- stun:stun2.l.google.com:19302

For production, add TURN servers for reliable connectivity behind restrictive NATs/firewalls.

## Troubleshooting

- "Rate limit exceeded" — wait or lower client request frequency; for dev set `DISABLE_VOICE_RATE_LIMIT=true`.
- Audio not heard by audience — check client audio settings, browser permissions, and server logs for signaling errors.
- Frequent disconnects — check network/firewall, and review logs in `logs/` for errors and stack traces.

## Project layout (top-level)

```
src/
├── index.ts            # App bootstrap (HTTP + socket)
├── config/             # Environment and socket configuration
├── handlers/           # Socket event handlers (e.g. RoomHandlers)
├── middleware/         # Express middleware
├── routes/             # HTTP routes
├── security/           # Security helpers
├── services/           # Business logic and services
├── socket/             # Socket server wiring
├── types/              # TypeScript types and interfaces
└── validation/         # Request/payload validation
```

## Logs

Runtime logs are written to the `logs/` folder. Check `error-*.log` and `combined-*.log` for recent errors and access logs.

## Deployment notes

- Use environment variables to configure runtime behavior.
- Ensure TLS/SSL (see `.ssl/` in repo) for production endpoints or sit behind a TLS-terminating proxy/load balancer.
- Add TURN servers for WebRTC in production.

## Contributing

1. Create a feature branch from `main`.
2. Run tests and linters locally (if present).
3. Open a PR with a short description and link to any related issue.

## License

This project uses the repository license (check `LICENSE` if present).

## Contact / Support

If you hit issues, open an issue in the repository with logs and reproduction steps.

---

Small, focused README intended to help new contributors and operators get started quickly. If you'd like I can also:

- add a short `docker-compose` example for local dev
- provide a minimal Postman collection or OpenAPI spec for the HTTP endpoints
- extract environment variables into a clearer `env.local.example` with descriptions

Tell me which of those you'd like next.
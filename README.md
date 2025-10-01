# Jam Band — Backend

A TypeScript Express.js backend for the Jam Band application with **dual room architecture**:
- **Perform Rooms**: Real-time jamming sessions with ultra-low latency audio sync
- **Produce Rooms (Future)**: Revolutionary collaborative DAW for multi-user music production

Provides REST endpoints, WebSocket/Socket.IO handlers for real-time features, and WebRTC signaling support for voice communication.

## Quick overview

- **Language**: TypeScript
- **Framework**: Express (HTTP) + Socket.IO for real-time features
- **Runtime**: Node.js 18+ (Bun compatible)
- **Architecture**: Domain-Driven Design (DDD) with modular bounded contexts
- **Room Types**: 
  - **Perform Room** (Current): Live jamming with ephemeral sessions
  - **Produce Room** (Future): Collaborative DAW with persistent projects
- **Purpose**: Room management, real-time collaboration, WebRTC voice, and audio processing

## Requirements

- Node.js v18+ or Bun runtime
- Package manager: npm, yarn, or bun
- For HTTPS development: mkcert (recommended) or OpenSSL

## Getting started (local development)

1. Install dependencies

```bash
npm install
# or with Bun:
bun install
```

2. Copy the environment example and edit values

```bash
cp env.local.example .env.local
```

3. Start the development server (hot reload)

```bash
npm run start:dev
# or with TypeScript watch mode:
npm run start:dev:gc  # with garbage collection monitoring
```

By default the server listens on http://localhost:3001 (see `PORT` env var).

### HTTPS Development Setup

For WebRTC testing, HTTPS is required:

```bash
# Generate SSL certificates (requires mkcert)
bun run scripts/generate-ssl.js

# Or validate existing HTTPS setup
bun run test:https:validate
```

## Available scripts

### Development
- `npm run start:dev` — Start development server with hot reload (tsx)
- `npm run start:dev:gc` — Development with garbage collection monitoring
- `npm run build` — Build the project for production
- `npm run start` — Start the production server
- `npm run start:prod` — Production server with optimized memory settings

### Testing

#### New Comprehensive Testing Framework (42 tests total)
- `npm test -- tests/` — Run all new framework tests (RECOMMENDED)
- `npm run test:regression` — **CRITICAL**: Run 14 regression tests (use before/after adding features)
- `npm run test:unit` — Run 7 unit tests for isolated components
- `npm run test:integration` — Run 17 integration tests for complete workflows
- `npm run test:e2e` — Run 4 end-to-end tests for API/WebSocket validation
- `npm run test:watch` — Run tests in watch mode
- `npm run test:coverage` — Generate test coverage reports
- `npm run test:ci` — Run tests for CI/CD

#### Legacy Testing
- `npm run test` — Run all tests (includes legacy tests with many failures)
- `npm run test:webrtc` — WebRTC functionality tests
- `npm run test:https` — HTTPS/TLS configuration tests
- `npm run test:load` — Load testing and performance tests
- `npm run test:performance` — Performance monitoring tests

**IMPORTANT**: Use `npm test` (Jest) not `bun test` for the testing framework to work properly.

### Quality & Maintenance
- `npm run lint` — Run ESLint
- `npm run lint:fix` — Fix linting issues automatically
- `npm run clean` — Remove build artifacts
- `npm run type-check` — Run TypeScript type checks

### Deployment
- `npm run docker:build` — Build Docker image
- `npm run docker:run` — Run Docker container
- `npm run railway:deploy` — Deploy to Railway
- `npm run railway:logs` — View Railway deployment logs

Check `package.json` for exact script definitions.

## Environment variables

Important variables (see `env.local.example` and `env.production.example`):

### Core Configuration
- `PORT` — Server port (default: 3001)
- `NODE_ENV` — `development` or `production`
- `LOG_LEVEL` — Logging level (`info`, `warn`, `error`)

### Security & CORS
- `JWT_SECRET` — Secret key for JWT tokens
- `FRONTEND_URL` — Frontend origin for CORS
- `CORS_STRICT_MODE` — Enable strict CORS validation
- `RATE_LIMIT_WINDOW_MS` — Rate limiting window
- `RATE_LIMIT_MAX_REQUESTS` — Max requests per window

### WebRTC & Voice
- `WEBRTC_ENABLED` — Enable WebRTC functionality
- `WEBRTC_REQUIRE_HTTPS` — Require HTTPS for WebRTC (production)
- `WEBRTC_STUN_SERVERS` — STUN server configuration
- `DISABLE_VOICE_RATE_LIMIT` — Disable voice rate limiting (dev only)
- `VOICE_OFFER_RATE_LIMIT`, `VOICE_ANSWER_RATE_LIMIT`, `VOICE_ICE_RATE_LIMIT` — Voice signaling limits

### SSL/TLS (Development & Production)
- `USE_SSL` / `SSL_ENABLED` — Enable HTTPS
- `SSL_KEY_PATH`, `SSL_CERT_PATH` — SSL certificate paths

### Performance
- `ENABLE_PERFORMANCE_MONITORING` — Enable performance tracking
- `DISABLE_SYNTH_RATE_LIMIT` — Disable synthesizer rate limiting

### Future: Collaborative DAW (Produce Rooms)
- `DATABASE_URL` — PostgreSQL connection for persistent projects
- `REDIS_URL` — Redis cache for real-time operations
- `ENABLE_COLLABORATIVE_FEATURES` — Feature flag for collaborative DAW
- `PROJECT_STORAGE_PATH` — File storage path for audio files
- `MAX_PROJECT_SIZE_MB` — Maximum project file size limit
- `OPERATIONAL_TRANSFORM_ENABLED` — Enable advanced conflict resolution

Always store production secrets securely and do not commit `.env` files to source control.

## Room Architecture 🏗️

### Current Implementation (Perform Rooms)
- **Live Jamming**: Real-time instrument synchronization across users
- **Ephemeral Sessions**: Temporary rooms focused on live performance
- **WebRTC Voice**: Ultra-low latency voice chat optimized for musical timing
- **Real-time Sync**: Metronome, instruments, effects synchronized via Socket.IO
- **Session Management**: User presence, instrument swapping, room ownership

### Future Implementation (Produce Rooms)
*See `COLLABORATIVE_DAW_BACKEND_PLAN.md` for detailed architecture*

- **🎯 Collaborative DAW**: Multiple users editing tracks simultaneously like Google Docs for music
- **🎨 Canvas-style Interface**: Miro/Figma-like collaboration patterns for music production
- **📊 Real-time Timeline Editing**: Multi-user track creation, region recording, MIDI editing
- **👥 Presence Tracking**: Live cursors, selections, and user activity indicators
- **🔄 Conflict Resolution**: Operational Transform for handling simultaneous edits
- **💾 Project Persistence**: Save/load collaborative projects with version history
- **🎚️ Collaborative Mixing**: Multiple users adjusting mix parameters in real-time

#### Future Backend Extensions
```typescript
// New domain structure for collaborative production
src/domains/collaborative-production/
├── entities/     # Project, Track, Region, TimelineEvent
├── services/     # CollaborativeProjectService, TimelineService
├── handlers/     # CollaborativeEditingHandler, PresenceTrackingHandler
└── repositories/ # ProjectRepository, VersionHistoryRepository
```

#### Database Schema (Future)
- **PostgreSQL**: Projects, tracks, regions with JSONB flexibility
- **Redis**: Real-time operation caching and presence data
- **File Storage**: Audio files with database references
- **Version Control**: Project snapshots and operational transform logs

## API endpoints

The backend exposes REST endpoints and real-time Socket.IO handlers:

### HTTP REST API
- `GET /health` — Health check with environment info
- `GET /health/simple` — Simple health check
- `GET /rooms` — List active rooms
- `POST /rooms` — Create new room (with validation)
- `POST /rooms/:roomId/leave` — Leave room
- `PUT /rooms/:roomId/settings` — Update room settings
- `GET /performance/*` — Performance monitoring endpoints

### Real-time Events (Socket.IO)

#### Current Events (Perform Rooms)
- **Room Management**: `join_room`, `leave_room`, `room_created`, etc.
- **Voice/WebRTC**: `voice_offer`, `voice_answer`, `ice_candidate`
- **Chat**: `send_message`, `receive_message`
- **Audio**: `note_played`, `metronome_sync`
- **Instruments**: `instrument_swap`, `instrument_mute`

#### Future Events (Produce Rooms)
- **Timeline Operations**: `timeline_track_create`, `timeline_region_move`, `timeline_region_record`
- **Presence Tracking**: `presence_cursor_move`, `presence_selection_change`, `presence_focus_change`
- **Collaborative Editing**: `project_save`, `project_export`, `project_version_create`
- **Mixing**: `mixing_parameter_change`, `mixing_automation_add`

See `src/handlers/` and domain-specific handlers for complete event specifications.

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

## Testing & Quality Assurance

### New Comprehensive Testing Framework ✅
**42 tests total** - Use `npm test -- tests/` to run the new framework

- **Regression Tests (14)**: **CRITICAL** - Detect when new features break existing functionality
- **Integration Tests (17)**: Complete room lifecycle and WebRTC workflows  
- **Unit Tests (7)**: Isolated component testing with proper mocking
- **End-to-End Tests (4)**: API endpoints and WebSocket integration

### Framework Features
- **Anti-Regression Protection**: Run `npm run test:regression` before/after adding features
- **Comprehensive Coverage**: Room management, user workflows, effect chains, performance benchmarks
- **Advanced Test Utilities**: TestEnvironment, MockFactory, TestLogger, performance measurement
- **Proper Cleanup**: No test interference, isolated test environments
- **TypeScript Integration**: Full type safety with Jest and ts-jest

### Legacy Testing
- **Performance Tests**: Load testing with concurrent users
- **HTTPS Tests**: WebRTC over TLS validation  
- **Edge Case Tests**: Boundary conditions and error scenarios
- **WebRTC Integration**: Voice communication and signaling tests

### Performance Monitoring
- Real-time performance metrics collection
- Automated regression detection built into tests
- Memory usage and connection health monitoring
- Performance optimization recommendations
- Load testing with up to 100 concurrent users

### Development Tools
- **ESLint** with TypeScript rules
- **Jest** with comprehensive test framework (use `npm test` not `bun test`)
- **TypeScript** strict mode
- **Hot reload** development server
- **SSL certificate** generation scripts

## Troubleshooting

### Common Issues
- **Rate limit exceeded** — Wait or set `DISABLE_VOICE_RATE_LIMIT=true` for development
- **HTTPS required** — Use `bun run test:https:validate` to check SSL setup
- **WebRTC connection fails** — Ensure both frontend and backend use HTTPS
- **Audio not heard** — Check browser permissions and WebRTC signaling logs
- **Memory leaks** — Monitor with `npm run start:dev:gc`
- **Performance issues** — Run `npm run test:performance` for analysis

### Debug Commands
```bash
npm run test:https:validate     # Validate HTTPS configuration
npm run test:load              # Run load tests
npm run test:performance       # Performance monitoring
bun run scripts/validate-https-setup.ts  # Comprehensive HTTPS check
```

## Project layout

```
src/
├── index.ts                    # Application bootstrap
├── config/                     # Environment and configuration
├── middleware/                 # Express middleware (CORS, security, rate limiting)
├── routes/                     # HTTP REST endpoints
├── services/                   # Core business services
├── handlers/                   # Legacy socket handlers
├── domains/                    # Domain-Driven Design modules
│   ├── audio-processing/       # Audio effects and note handling
│   ├── lobby-management/       # Lobby and room discovery
│   ├── real-time-communication/# Chat and WebRTC signaling
│   ├── room-management/        # Room lifecycle and membership (Perform Rooms)
│   ├── user-management/        # User approval and authentication
│   └── collaborative-production/ # 🚀 FUTURE: Collaborative DAW domain
│       ├── domain/
│       │   ├── entities/       # Project, Track, Region, TimelineEvent
│       │   ├── services/       # CollaborativeProjectService, TimelineService
│       │   └── repositories/   # ProjectRepository, VersionHistoryRepository
│       ├── infrastructure/
│       │   ├── handlers/       # CollaborativeEditingHandler, PresenceTrackingHandler
│       │   └── persistence/    # PostgresProjectRepository, RedisPresenceCache
│       └── application/        # CollaborativeProductionService
├── shared/                     # Shared infrastructure
│   ├── infrastructure/         # DI container, monitoring, caching
│   └── domain/                 # Common domain models
├── testing/                    # Test utilities and infrastructure
├── utils/                      # Common utilities
├── types/                      # TypeScript type definitions (includes room types)
└── validation/                 # Request validation schemas

scripts/                        # Development and testing scripts
tests/                          # 🚀 NEW: Comprehensive testing framework (42 tests)
├── setup.ts                    # Global Jest test configuration
├── helpers/                    # TestEnvironment, MockFactory, TestLogger
├── fixtures/                   # Standardized test data and factories
├── utils/                      # Advanced testing utilities (performance, validation)
├── unit/                       # Unit tests (7 tests)
├── integration/                # Integration tests (17 tests)
├── e2e/                       # End-to-end tests (4 tests)
├── regression/                # **CRITICAL** regression tests (14 tests)
└── README.md                  # Complete testing documentation
logs/                           # Runtime logs (development)
COLLABORATIVE_DAW_BACKEND_PLAN.md # 📋 Detailed architecture plan for Produce Rooms
```

## Logs

Runtime logs are written to the `logs/` folder. Check `error-*.log` and `combined-*.log` for recent errors and access logs.

## Deployment

### Railway (Recommended)
```bash
npm run railway:deploy      # Deploy to Railway
npm run railway:logs        # View logs
npm run railway:status      # Check deployment status
```

### Docker
```bash
npm run docker:build        # Build container
npm run docker:run          # Run locally
```

### Production Checklist
- ✅ Set `NODE_ENV=production`
- ✅ Configure HTTPS/TLS (required for WebRTC)
- ✅ Set secure `JWT_SECRET`
- ✅ Configure CORS with your frontend URL
- ✅ Add TURN servers for WebRTC (production)
- ✅ Enable rate limiting (`DISABLE_*_RATE_LIMIT=false`)
- ✅ Set appropriate `LOG_LEVEL` (warn/error)
- ✅ Configure SSL certificates or use TLS-terminating proxy

## Implementation Roadmap 🗺️

### Phase 1: Foundation (Current ✅)
- ✅ **Room Types**: Support for `'perform' | 'produce'` room types
- ✅ **Domain Architecture**: DDD structure ready for collaborative features
- ✅ **Real-time Infrastructure**: Socket.IO namespaces for room isolation  
- ✅ **Session Management**: User presence and room lifecycle management
- ✅ **WebRTC Integration**: Voice chat with rate limiting and optimization

### Phase 2: Collaborative DAW Foundation (Future)
- [ ] **Database Integration**: PostgreSQL + Redis for persistent projects
- [ ] **Project Management**: Basic project CRUD operations
- [ ] **Track & Region Models**: Core data structures for timeline editing
- [ ] **Real-time Sync**: Timeline operations via Socket.IO events
- [ ] **Basic Conflict Resolution**: Last-write-wins for MVP

### Phase 3: Advanced Collaboration (Future)
- [ ] **Presence Tracking**: Real-time user cursors and activity indicators
- [ ] **Operational Transform**: Google Docs-style conflict resolution
- [ ] **Version History**: Project snapshots and change tracking
- [ ] **Collaborative Mixing**: Multi-user parameter adjustments
- [ ] **Project Export**: Save and share completed projects

*See `COLLABORATIVE_DAW_BACKEND_PLAN.md` for detailed technical specifications.*

## Contributing

### **CRITICAL: New Feature Development Workflow** 🚨

1. **Before implementing any new feature:**
   ```bash
   npm run test:regression  # Ensure all 14 regression tests pass
   ```

2. Implement your feature following the architecture guidelines

3. **After implementing your feature:**
   ```bash
   npm run test:regression  # Verify no existing functionality broke
   npm test -- tests/      # Run full comprehensive test suite (42 tests)
   ```

4. **If regression tests fail:** Your feature broke existing functionality and MUST be fixed before proceeding

### Standard Contribution Process

1. Create a feature branch from `main`
2. Follow the critical testing workflow above
3. Run linters: `npm run lint` and `npm run lint:fix`
4. Open a PR with description and link to related issue
5. For collaborative DAW features, refer to `COLLABORATIVE_DAW_BACKEND_PLAN.md`

**Testing Framework Usage:**
- Use `npm test -- tests/` (Jest) **NOT** `bun test` for the testing framework
- The comprehensive testing framework protects against regressions
- All 42 tests must pass before merging features

## License

This project uses the repository license (check `LICENSE` if present).

## Contact / Support

If you hit issues, open an issue in the repository with logs and reproduction steps.

For questions about the **collaborative DAW architecture**, refer to `COLLABORATIVE_DAW_BACKEND_PLAN.md` for comprehensive technical planning.

---

## Architecture Documentation

- **`README.md`** (this file): Current implementation and future roadmap
- **`COLLABORATIVE_DAW_BACKEND_PLAN.md`**: Detailed technical architecture for Produce Rooms
- **Domain folders**: Individual domain documentation and specifications
- **Tests**: Integration and performance test specifications

This backend is architected to support both **live jamming sessions** (current) and **revolutionary collaborative music production** (future) in a single, scalable platform! 🎵✨
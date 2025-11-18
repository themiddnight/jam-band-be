import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import { createServer as createHttpsServer } from "https";
import fs from "fs";
import path from "path";

// Import our modular components
import { config } from "./config/environment";
import { corsMiddleware, corsDebugMiddleware } from "./middleware/cors";
import { apiLimiter, cleanupExpiredRateLimits } from "./middleware/rateLimit";
import {
  requestLogger,
  securityHeaders,
  sanitizeInput,
} from "./middleware/security";
import {
  requestMonitor,
  performanceMonitor,
  errorMonitor,
} from "./middleware/monitoring";
import { compressionMiddleware } from "./middleware/compression";
import { createSocketServer } from "./config/socket";
import { createRoutes } from "./routes";
import { RoomService } from "./services/RoomService";
import { RoomHandlers } from "./handlers/RoomHandlers";
import {
  RoomLifecycleHandler,
  RoomMembershipHandler,
} from "./domains/room-management/infrastructure/handlers";
import { VoiceConnectionHandler } from "./domains/real-time-communication/infrastructure/handlers/VoiceConnectionHandler";
import { AudioRoutingHandler } from "./domains/audio-processing/infrastructure/handlers";
import { ApprovalWorkflowHandler } from "./domains/user-management/infrastructure/handlers/ApprovalWorkflowHandler";
import { InstrumentSwapHandler } from "./domains/room-management/infrastructure/handlers/InstrumentSwapHandler";

// Repository and Domain Services
import { RepositoryServiceFactory } from "./domains/room-management/infrastructure/services/RepositoryServiceFactory";

import { MetronomeService } from "./services/MetronomeService";
import { ChatHandler } from "./domains/real-time-communication/infrastructure/handlers/ChatHandler";
import { MetronomeHandler } from "./domains/room-management/infrastructure/handlers/MetronomeHandler";
import { NotePlayingHandler } from "./domains/audio-processing/infrastructure/handlers/NotePlayingHandler";
import { ArrangeRoomStateService } from "./services/ArrangeRoomStateService";
import { ArrangeRoomHandler } from "./domains/arrange-room/infrastructure/handlers/ArrangeRoomHandler";

import { NamespaceManager } from "./services/NamespaceManager";
import { RoomSessionManager } from "./services/RoomSessionManager";
import { NamespaceEventHandlers } from "./handlers/NamespaceEventHandlers";
import { PerformanceMonitoringService } from "./services/PerformanceMonitoringService";
import { ConnectionHealthService } from "./services/ConnectionHealthService";
import { NamespaceCleanupService } from "./services/NamespaceCleanupService";
import { ConnectionOptimizationService } from "./services/ConnectionOptimizationService";
import { loggingService } from "./services/LoggingService";

// Event System
import { EventSystemInitializer } from "./shared/infrastructure/events/EventSystemInitializer";

const app = express();

// Determine server type based on environment
let server;

if (config.nodeEnv === "development" && config.ssl.enabled) {
  // Development mode - use HTTPS for WebRTC
  try {
    const keyPath = path.join(process.cwd(), config.ssl.keyPath);
    const certPath = path.join(process.cwd(), config.ssl.certPath);

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      server = createHttpsServer(
        {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        },
        app
      );
      loggingService.logInfo(
        "Development: Using HTTPS with self-signed certificates"
      );
    } else {
      throw new Error("SSL certificates not found");
    }
  } catch (error) {
    loggingService.logError(error as Error, { context: "SSL setup" });
    loggingService.logInfo("SSL certificates not found, falling back to HTTP");
    loggingService.logInfo("WebRTC may not work properly in development");
    server = createServer(app);
  }
} else {
  // Production mode or HTTP only - use HTTP (Railway will handle SSL termination)
  server = createServer(app);
  if (config.nodeEnv === "production") {
    loggingService.logInfo("Production: Using HTTP (SSL handled by Railway)");
  } else {
    loggingService.logInfo("Development: Using HTTP mode");
  }
}

const io = createSocketServer(server);

// Initialize services
const namespaceManager = new NamespaceManager(io);
const roomSessionManager = new RoomSessionManager();
const roomService = new RoomService(roomSessionManager);

// Initialize event system
const eventSystemInitializer = new EventSystemInitializer(io, namespaceManager);
const eventBus = eventSystemInitializer.initialize();

// Initialize repository services and bridge
const repositoryFactory = RepositoryServiceFactory.getInstance();
const roomApplicationService = repositoryFactory.getRoomApplicationService();

// Initialize repositories with existing data (async operation)
repositoryFactory.initializeWithLegacyData(roomService).catch((error) => {
  loggingService.logError(error instanceof Error ? error : new Error("Failed to initialize repositories with legacy data"), { context: 'repository-initialization' });
});

// Initialize performance monitoring services
const performanceMonitoring = PerformanceMonitoringService.getInstance(
  namespaceManager,
  roomSessionManager
);
const connectionHealth = ConnectionHealthService.getInstance(
  performanceMonitoring
);
const namespaceCleanup = NamespaceCleanupService.getInstance(
  namespaceManager,
  roomSessionManager,
  performanceMonitoring
);

// Only enable connection optimization in production - it interferes with development
const connectionOptimization =
  config.nodeEnv === "production"
    ? ConnectionOptimizationService.getInstance(io, performanceMonitoring)
    : null;

// Initialize other domain handlers
const voiceConnectionHandler = new VoiceConnectionHandler(
  roomService,
  io,
  roomSessionManager
);
const audioRoutingHandler = new AudioRoutingHandler(
  roomService,
  io,
  roomSessionManager,
  namespaceManager
);

// Initialize services needed by RoomHandlers
const metronomeService = new MetronomeService(io, roomService);

// Initialize arrange room services (before room lifecycle handler)
const arrangeRoomStateService = new ArrangeRoomStateService();

// Initialize room lifecycle handler with event bus
const roomLifecycleHandler = new RoomLifecycleHandler(
  roomService,
  io,
  namespaceManager,
  roomSessionManager,
  metronomeService,
  audioRoutingHandler,
  eventBus,
  arrangeRoomStateService
);
const roomMembershipHandler = new RoomMembershipHandler(
  roomService,
  io,
  namespaceManager,
  roomSessionManager
);
const approvalWorkflowHandler = new ApprovalWorkflowHandler(
  roomService,
  io,
  namespaceManager,
  roomSessionManager
);
const chatHandler = new ChatHandler(
  roomService,
  namespaceManager,
  roomSessionManager
);
const metronomeHandler = new MetronomeHandler(
  roomService,
  metronomeService,
  roomSessionManager,
  namespaceManager
);
const notePlayingHandler = new NotePlayingHandler(
  roomService,
  io,
  namespaceManager,
  roomSessionManager
);
const instrumentSwapHandler = new InstrumentSwapHandler(
  roomService,
  io,
  namespaceManager,
  roomSessionManager
);

// Initialize arrange room handler
const arrangeRoomHandler = new ArrangeRoomHandler(
  arrangeRoomStateService,
  roomSessionManager,
  roomService
);

const roomHandlers = new RoomHandlers(
  roomService,
  roomSessionManager,
  roomLifecycleHandler,
  roomMembershipHandler,
  approvalWorkflowHandler,
  roomApplicationService
);
const namespaceEventHandlers = new NamespaceEventHandlers(
  roomHandlers,
  voiceConnectionHandler,
  approvalWorkflowHandler,
  roomSessionManager,
  audioRoutingHandler,
  chatHandler,
  metronomeHandler,
  notePlayingHandler,
  instrumentSwapHandler,
  arrangeRoomHandler
);

// Set up namespace event handlers
namespaceManager.setEventHandlers(namespaceEventHandlers);

// Set performance monitoring services on namespace event handlers
if (connectionOptimization) {
  namespaceEventHandlers.setPerformanceServices(
    performanceMonitoring,
    connectionHealth,
    connectionOptimization
  );
} else {
  namespaceEventHandlers.setPerformanceServices(
    performanceMonitoring,
    connectionHealth
  );
}

// Initialize lobby monitor namespace for latency monitoring
// Requirements: 2.1, 9.1, 9.5
namespaceManager.createLobbyMonitorNamespace();
loggingService.logInfo(
  "Lobby monitor namespace initialized for latency monitoring"
);

// Security middleware (order matters!)
app.use(helmet());
app.use(securityHeaders);

// Compression middleware (should be early in the chain)
app.use(compressionMiddleware);

// Monitoring middleware (order matters!)
app.use(requestMonitor);
app.use(performanceMonitor);

// Security middleware
app.use(requestLogger);
app.use(corsDebugMiddleware); // Add CORS debugging
app.use(corsMiddleware);

// Rate limiting for API endpoints
app.use("/api", apiLimiter);

// Body parsing and sanitization with optimized limits
app.use(
  express.json({
    limit: "1mb",
    strict: true,
    verify: (req, res, buf) => {
      // Store raw body for potential verification
      (req as any).rawBody = buf;
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "100kb",
  })
);

app.use(sanitizeInput);

// Routes
app.use("/api", createRoutes(roomHandlers, roomLifecycleHandler));

// Performance monitoring routes (skip if optimization service is disabled)
import { createPerformanceRoutes } from "./routes/performance";
if (connectionOptimization) {
  app.use(
    "/api/performance",
    createPerformanceRoutes(
      performanceMonitoring,
      connectionHealth,
      namespaceCleanup,
      connectionOptimization
    )
  );
}

// Error monitoring middleware (must be last)
app.use(errorMonitor);

// Log application startup
loggingService.logInfo("Application starting up", {
  environment: config.nodeEnv,
  port: config.port,
  sslEnabled: config.ssl.enabled,
  timestamp: new Date().toISOString(),
});

// Periodic cleanup tasks
setInterval(() => {
  const deletedRooms = roomService.cleanupExpiredGraceTime();
  // Clean up namespaces for deleted rooms
  deletedRooms.forEach((roomId) => {
    namespaceManager.cleanupRoomNamespace(roomId);
    namespaceManager.cleanupApprovalNamespace(roomId);
    // Broadcast to all clients that the room was closed
    io.emit("room_closed_broadcast", { roomId });
    loggingService.logInfo(
      "Cleaned up expired room after grace period expiration",
      { roomId }
    );
  });
}, 30000); // Run every 30 seconds

// Clean up expired rate limit entries
setInterval(cleanupExpiredRateLimits, 5 * 60 * 1000); // Run every 5 minutes

// Clean up expired sessions
setInterval(() => {
  roomSessionManager.cleanupExpiredSessions();
}, 10 * 60 * 1000); // Run every 10 minutes

// Log cleanup task
setInterval(() => {
  loggingService.cleanupOldLogs();
}, 60 * 60 * 1000); // Run every hour

server.listen(Number(config.port), "0.0.0.0", () => {
  const protocol =
    config.nodeEnv === "development" && config.ssl.enabled ? "https" : "http";

  loggingService.logInfo("Server started successfully", {
    port: config.port,
    protocol,
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
  });

  loggingService.logInfo("Security features enabled", {
    features: [
      "Rate limiting",
      "Input validation",
      "WebRTC validation",
      "Comprehensive logging",
      "Performance monitoring",
    ],
    timestamp: new Date().toISOString(),
  });

  if (config.nodeEnv === "development" && config.ssl.enabled) {
    loggingService.logInfo("Development: HTTPS enabled for WebRTC support");
  } else if (config.nodeEnv === "production") {
    loggingService.logInfo("Production: HTTP mode (SSL handled by Railway)");
  } else {
    loggingService.logInfo("Development: HTTP mode");
  }
});

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  loggingService.logInfo(`Received ${signal}, starting graceful shutdown`);

  server.close(() => {
    loggingService.logInfo("HTTP server closed");

    // Shutdown performance monitoring services
    performanceMonitoring.shutdown();
    connectionHealth.shutdown();
    namespaceCleanup.shutdown();
    if (connectionOptimization) {
      connectionOptimization.shutdown();
    }

    // Shutdown namespace manager
    namespaceManager.shutdown();

    // Cleanup approval session manager
    approvalWorkflowHandler.getApprovalSessionManager().cleanup();

    // Cleanup event system
    eventSystemInitializer.cleanup();

    loggingService.logInfo("Graceful shutdown complete");
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    loggingService.logError(new Error("Forced shutdown after timeout"));
    process.exit(1);
  }, 30000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

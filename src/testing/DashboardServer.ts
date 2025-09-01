import { createServer, IncomingMessage, ServerResponse } from 'http';
import { MigrationDashboard } from './MigrationDashboard';

export interface DashboardServerConfig {
  port: number;
  enableCORS: boolean;
  enableWebSocket: boolean;
}

/**
 * HTTP server for serving the migration dashboard
 * Provides REST API and real-time WebSocket updates
 */
export class DashboardServer {
  private server: any;
  private dashboard: MigrationDashboard;
  private config: DashboardServerConfig;
  private clients: Set<ServerResponse> = new Set();

  constructor(dashboard: MigrationDashboard, config: Partial<DashboardServerConfig> = {}) {
    this.dashboard = dashboard;
    this.config = {
      port: 3002,
      enableCORS: true,
      enableWebSocket: false,
      ...config
    };

    this.server = createServer(this.handleRequest.bind(this));
    this.setupDashboardListeners();
  }

  /**
   * Setup dashboard event listeners for real-time updates
   */
  private setupDashboardListeners(): void {
    this.dashboard.on('dashboardUpdated', (data) => {
      this.broadcastUpdate('dashboard_updated', data);
    });

    this.dashboard.on('statusUpdated', (status) => {
      this.broadcastUpdate('status_updated', status);
    });

    this.dashboard.on('errorAdded', (error) => {
      this.broadcastUpdate('error_added', { error });
    });

    this.dashboard.on('warningAdded', (warning) => {
      this.broadcastUpdate('warning_added', { warning });
    });

    this.dashboard.on('rollbackTriggered', (rollbackStatus) => {
      this.broadcastUpdate('rollback_triggered', rollbackStatus);
    });
  }

  /**
   * Handle HTTP requests
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Enable CORS if configured
    if (this.config.enableCORS) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || '';
    const method = req.method || 'GET';

    try {
      if (method === 'GET' && url === '/') {
        this.serveDashboardHTML(res);
      } else if (method === 'GET' && url === '/api/dashboard') {
        this.serveDashboardData(res);
      } else if (method === 'GET' && url === '/api/status') {
        this.serveStatus(res);
      } else if (method === 'GET' && url === '/api/metrics') {
        this.serveMetrics(res);
      } else if (method === 'POST' && url === '/api/rollback') {
        this.handleRollback(req, res);
      } else if (method === 'GET' && url === '/api/stream') {
        this.handleEventStream(res);
      } else {
        this.serve404(res);
      }
    } catch (error) {
      this.serveError(res, error);
    }
  }

  /**
   * Serve dashboard HTML
   */
  private serveDashboardHTML(res: ServerResponse): void {
    const html = this.dashboard.generateHTMLDashboard();
    
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  }

  /**
   * Serve dashboard data as JSON
   */
  private serveDashboardData(res: ServerResponse): void {
    const data = this.dashboard.getDashboardData();
    const json = JSON.stringify(data, null, 2);
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json)
    });
    res.end(json);
  }

  /**
   * Serve migration status
   */
  private serveStatus(res: ServerResponse): void {
    const data = this.dashboard.getDashboardData();
    const json = JSON.stringify(data.migrationStatus, null, 2);
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json)
    });
    res.end(json);
  }

  /**
   * Serve performance metrics
   */
  private serveMetrics(res: ServerResponse): void {
    const data = this.dashboard.getDashboardData();
    const metrics = {
      performance: data.performanceSummary,
      system: data.systemMetrics,
      rollback: data.rollbackStatus
    };
    const json = JSON.stringify(metrics, null, 2);
    
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json)
    });
    res.end(json);
  }

  /**
   * Handle rollback request
   */
  private handleRollback(req: IncomingMessage, res: ServerResponse): void {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const reason = data.reason || 'Manual rollback triggered from dashboard';
        
        // Trigger rollback
        this.dashboard.emit('rollbackTriggered', { 
          canRollback: true, 
          reason,
          criticalIssues: 1 
        });

        const response = JSON.stringify({ 
          success: true, 
          message: 'Rollback triggered',
          reason 
        });
        
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(response)
        });
        res.end(response);
      } catch (error) {
        this.serveError(res, error);
      }
    });
  }

  /**
   * Handle Server-Sent Events stream
   */
  private handleEventStream(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Add client to set for broadcasting
    this.clients.add(res);

    // Send initial data
    const data = this.dashboard.getDashboardData();
    this.sendSSEMessage(res, 'dashboard_updated', data);

    // Handle client disconnect
    req.on('close', () => {
      this.clients.delete(res);
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      this.sendSSEMessage(res, 'ping', { timestamp: Date.now() });
    }, 30000);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.clients.delete(res);
    });
  }

  /**
   * Send Server-Sent Event message
   */
  private sendSSEMessage(res: ServerResponse, event: string, data: any): void {
    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(message);
    } catch (error) {
      console.error('Error sending SSE message:', error);
    }
  }

  /**
   * Broadcast update to all connected clients
   */
  private broadcastUpdate(event: string, data: any): void {
    const deadClients: ServerResponse[] = [];

    for (const client of this.clients) {
      try {
        this.sendSSEMessage(client, event, data);
      } catch (error) {
        deadClients.push(client);
      }
    }

    // Remove dead clients
    deadClients.forEach(client => this.clients.delete(client));
  }

  /**
   * Serve 404 error
   */
  private serve404(res: ServerResponse): void {
    const html = `
<!DOCTYPE html>
<html>
<head><title>404 Not Found</title></head>
<body>
    <h1>404 Not Found</h1>
    <p>The requested resource was not found.</p>
    <p><a href="/">Return to Dashboard</a></p>
</body>
</html>`;

    res.writeHead(404, {
      'Content-Type': 'text/html',
      'Content-Length': Buffer.byteLength(html)
    });
    res.end(html);
  }

  /**
   * Serve error response
   */
  private serveError(res: ServerResponse, error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const response = JSON.stringify({ 
      error: 'Internal Server Error',
      message: errorMessage 
    });

    res.writeHead(500, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(response)
    });
    res.end(response);
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, (err: any) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Migration dashboard server started on port ${this.config.port}`);
          console.log(`Dashboard URL: http://localhost:${this.config.port}`);
          console.log(`API URL: http://localhost:${this.config.port}/api/dashboard`);
          resolve();
        }
      });
    });
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all client connections
      for (const client of this.clients) {
        try {
          client.end();
        } catch (error) {
          // Ignore errors when closing connections
        }
      }
      this.clients.clear();

      this.server.close(() => {
        console.log('Migration dashboard server stopped');
        resolve();
      });
    });
  }

  /**
   * Get server URL
   */
  getURL(): string {
    return `http://localhost:${this.config.port}`;
  }

  /**
   * Get API endpoints
   */
  getAPIEndpoints(): Record<string, string> {
    const baseURL = this.getURL();
    return {
      dashboard: `${baseURL}/`,
      data: `${baseURL}/api/dashboard`,
      status: `${baseURL}/api/status`,
      metrics: `${baseURL}/api/metrics`,
      rollback: `${baseURL}/api/rollback`,
      stream: `${baseURL}/api/stream`
    };
  }
}
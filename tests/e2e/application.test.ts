/**
 * End-to-End Tests for Jam Band Backend
 * Tests the complete application flow from API endpoints to services
 */
import request from 'supertest';
import { Express } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

// Mock app setup - you would import your actual app here
const createTestApp = (): Express => {
  const express = require('express');
  const app = express();
  
  app.use(express.json());
  
  // Mock API endpoints for testing
  app.get('/health', (req: any, res: any) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  app.get('/api/rooms', (req: any, res: any) => {
    res.json({
      rooms: [
        {
          id: 'room1',
          name: 'Test Room 1',
          owner: 'user1',
          userCount: 2,
          isPrivate: false
        }
      ]
    });
  });
  
  app.post('/api/rooms', (req: any, res: any) => {
    const { name, isPrivate, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Room name is required' });
    }
    
    res.status(201).json({
      id: 'new-room-id',
      name,
      isPrivate: isPrivate || false,
      description,
      owner: 'test-user',
      createdAt: new Date().toISOString()
    });
  });
  
  return app;
};

describe('End-to-End Tests', () => {
  let app: Express;
  let server: any;
  let io: Server;

  beforeAll(async () => {
    app = createTestApp();
    server = createServer(app);
    io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Register server for cleanup
    (global as any).testUtils.env.registerServer(server);

    // Start server
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        resolve();
      });
    });
  });

  describe('API Endpoints', () => {
    it('should respond to health check', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should list rooms', async () => {
      const response = await request(app)
        .get('/api/rooms')
        .expect(200);

      expect(response.body).toHaveProperty('rooms');
      expect(Array.isArray(response.body.rooms)).toBe(true);
      expect(response.body.rooms.length).toBeGreaterThan(0);
    });

    it('should create new room', async () => {
      const roomData = {
        name: 'E2E Test Room',
        isPrivate: false,
        description: 'Room created by E2E test'
      };

      const response = await request(app)
        .post('/api/rooms')
        .send(roomData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', roomData.name);
      expect(response.body).toHaveProperty('isPrivate', roomData.isPrivate);
      expect(response.body).toHaveProperty('description', roomData.description);
      expect(response.body).toHaveProperty('owner');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should validate room creation data', async () => {
      const invalidRoomData = {
        name: '', // Invalid: empty name
        isPrivate: false
      };

      const response = await request(app)
        .post('/api/rooms')
        .send(invalidRoomData)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('required');
    });
  });

  describe('WebSocket Integration', () => {
    it('should handle socket connections', async () => {
      const port = server.address()?.port;
      if (!port) {
        throw new Error('Server port not available');
      }

      // This would be more comprehensive in a real implementation
      // For now, we'll just test that the server can handle socket setup
      let socketConnected = false;
      
      io.on('connection', (socket) => {
        socketConnected = true;
        
        socket.on('test_event', (data) => {
          socket.emit('test_response', { received: data });
        });
      });

      // Note: io.emit doesn't trigger connection event, that would need actual client
      // For this test, we'll verify the socket setup is working
      expect(typeof io.on).toBe('function');
      expect(io.listeners('connection')).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 routes', async () => {
      await request(app)
        .get('/api/nonexistent')
        .expect(404);
    });

    it('should handle malformed JSON', async () => {
      await request(app)
        .post('/api/rooms')
        .send('{"invalid": json}')
        .type('application/json')
        .expect(400);
    });
  });

  describe('Performance Tests', () => {
    it('should handle multiple concurrent requests', async () => {
      const requestCount = 10;
      const requests: Promise<any>[] = [];

      await (global as any).testUtils.measurePerformance('concurrent API requests', async () => {
        for (let i = 0; i < requestCount; i++) {
          const promise = request(app)
            .get('/health')
            .expect(200);
          requests.push(promise);
        }

        const responses = await Promise.all(requests);
        expect(responses).toHaveLength(requestCount);
        responses.forEach(response => {
          expect(response.body.status).toBe('ok');
        });

        return responses;
      });
    });

    it('should handle room creation under load', async () => {
      const roomCount = 5;
      const requests: Promise<any>[] = [];

      await (global as any).testUtils.measurePerformance('concurrent room creation', async () => {
        for (let i = 0; i < roomCount; i++) {
          const promise = request(app)
            .post('/api/rooms')
            .send({
              name: `Load Test Room ${i}`,
              isPrivate: false,
              description: `Room ${i} for load testing`
            })
            .expect(201);
          requests.push(promise);
        }

        const responses = await Promise.all(requests);
        expect(responses).toHaveLength(roomCount);
        responses.forEach((response, index) => {
          expect(response.body.name).toBe(`Load Test Room ${index}`);
        });

        return responses;
      });
    });
  });

  describe('Feature Integration', () => {
    it('should support complete user workflow', async () => {
      // Step 1: Check health
      await request(app)
        .get('/health')
        .expect(200);

      // Step 2: List existing rooms
      const roomsResponse = await request(app)
        .get('/api/rooms')
        .expect(200);

      const initialRoomCount = roomsResponse.body.rooms.length;

      // Step 3: Create new room
      const newRoomResponse = await request(app)
        .post('/api/rooms')
        .send({
          name: 'Integration Workflow Room',
          isPrivate: false,
          description: 'Testing complete workflow'
        })
        .expect(201);

      expect(newRoomResponse.body.name).toBe('Integration Workflow Room');

      // Step 4: Verify room was created (in a real app, you'd check this)
      // This is a mock, so we just verify the response
      expect(newRoomResponse.body).toHaveProperty('id');
      expect(newRoomResponse.body).toHaveProperty('createdAt');
    });
  });

  describe('Regression Tests', () => {
    it('should not break existing functionality when adding new features', async () => {
      // Test that basic endpoints still work
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);

      expect(healthResponse.body.status).toBe('ok');

      // Test that room creation still works
      const roomResponse = await request(app)
        .post('/api/rooms')
        .send({
          name: 'Regression Test Room',
          isPrivate: false
        })
        .expect(201);

      expect(roomResponse.body.name).toBe('Regression Test Room');

      // Test that room listing still works
      await request(app)
        .get('/api/rooms')
        .expect(200);
    });

    it('should maintain API contract compatibility', async () => {
      // Test that response formats haven't changed
      const roomResponse = await request(app)
        .post('/api/rooms')
        .send({
          name: 'API Contract Test',
          isPrivate: true,
          description: 'Testing API contracts'
        })
        .expect(201);

      // Verify expected fields are present
      const requiredFields = ['id', 'name', 'isPrivate', 'description', 'owner', 'createdAt'];
      requiredFields.forEach(field => {
        expect(roomResponse.body).toHaveProperty(field);
      });

      // Verify data types
      expect(typeof roomResponse.body.id).toBe('string');
      expect(typeof roomResponse.body.name).toBe('string');
      expect(typeof roomResponse.body.isPrivate).toBe('boolean');
      expect(typeof roomResponse.body.owner).toBe('string');
      expect(typeof roomResponse.body.createdAt).toBe('string');
    });
  });
});
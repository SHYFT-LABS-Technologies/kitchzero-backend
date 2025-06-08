import request from 'supertest';

jest.mock('../src/services/DatabaseService', () => ({
  __esModule: true,
  default: {
    query: jest.fn().mockResolvedValue({ rows: [{ current_time: new Date() }] }),
    healthCheck: jest.fn().mockResolvedValue({ 
      healthy: true, 
      stats: { totalConnections: 5, idleConnections: 3, waitingClients: 0 }
    }),
    close: jest.fn().mockResolvedValue(undefined),
  },
}));

import app from '../src/server';

describe('API Basic Tests', () => {
  describe('Health Endpoints', () => {
    it('should return health status', async () => {
      const response = await request(app).get('/health');
      
      expect([200, 503]).toContain(response.status);
      expect(response.body.status).toBeDefined();
    });

    it('should return API status', async () => {
      const response = await request(app).get('/api/v1/status');

      expect(response.status).toBe(200);
      expect(response.body.name).toBe('KitchZero API');
      expect(response.body.version).toBe('1.0.0');
    });
  });

  describe('Validation Tests', () => {
    it('should validate login input', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'ab', // Too short
          password: 'short' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toBeDefined();
    });

    it('should require all login fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('should validate tenant creation input', async () => {
      const response = await request(app)
        .post('/api/v1/admin/tenants')
        .send({
          name: 'x', // Too short
          slug: 'X', // Invalid format (uppercase)
          type: 'invalid' // Invalid type
        });

      expect(response.status).toBe(401); // Should require auth first
    });
  });

  describe('Security Tests', () => {
    it('should require authentication for protected routes', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Access token required');
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 routes', async () => {
      const response = await request(app).get('/non-existent-route');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send('invalid-json')
        .set('Content-Type', 'application/json');

      expect([400, 500]).toContain(response.status);
    });
  });
});
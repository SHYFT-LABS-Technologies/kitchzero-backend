import { Router } from 'express';
import { config } from '../config';

const router = Router();

const apiDocs = {
  info: {
    title: 'KitchZero API',
    version: '1.0.0',
    description: 'Multi-tenant restaurant/hotel management system API',
    contact: {
      name: 'API Support',
      email: 'support@kitchzero.com',
    },
  },
  servers: [
    {
      url: `http://${config.server.host}:${config.server.port}`,
      description: 'Development server',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns system health status',
        responses: {
          200: { description: 'System is healthy' },
          503: { description: 'System is unhealthy' },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        summary: 'User login',
        description: 'Authenticate user and return JWT tokens',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  username: { type: 'string', minLength: 3, maxLength: 50 },
                  password: { type: 'string', minLength: 8 },
                },
                required: ['username', 'password'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Login successful' },
          400: { description: 'Validation error' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        summary: 'Refresh access token',
        description: 'Get new access token using refresh token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string' },
                },
                required: ['refreshToken'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Token refreshed successfully' },
          401: { description: 'Invalid refresh token' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
};

router.get('/', (req, res) => {
  res.json(apiDocs);
});

router.get('/swagger.json', (req, res) => {
  res.json({
    openapi: '3.0.0',
    ...apiDocs,
  });
});

export default router;
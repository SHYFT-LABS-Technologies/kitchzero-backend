import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';

console.log('🚀 Starting KitchZero server...');

// Check for critical environment variables early
const requiredEnvVars = ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('💡 Please check your .env file');
  console.error('🔍 Current environment variables:');
  console.error('   NODE_ENV:', process.env.NODE_ENV);
  console.error('   DB_HOST:', process.env.DB_HOST);
  console.error('   DB_NAME:', process.env.DB_NAME);
  console.error('   DB_USERNAME:', process.env.DB_USERNAME);
  console.error('   DB_PASSWORD:', process.env.DB_PASSWORD ? '***SET***' : 'NOT SET');
  console.error('   JWT_ACCESS_SECRET:', process.env.JWT_ACCESS_SECRET ? '***SET***' : 'NOT SET');
  console.error('   JWT_REFRESH_SECRET:', process.env.JWT_REFRESH_SECRET ? '***SET***' : 'NOT SET');
  process.exit(1);
}

// Rest of your server.ts code remains the same...
try {
  // Import config after env check
  const { config } = require('./config');
  console.log('✅ Configuration loaded');

  const logger = require('./utils/logger').default;
  console.log('✅ Logger initialized');

  const { errorHandler, asyncHandler, notFoundHandler } = require('./utils/errors');
  console.log('✅ Error handlers loaded');

  const { AuthService } = require('./services/AuthService');
  const { AuthMiddleware } = require('./middleware/auth');
  const { UserService } = require('./services/UserService');
  const { TenantService } = require('./services/TenantService');
  const { BranchService } = require('./services/BranchService');
  const { validate, validateRefreshToken } = require('./middleware/validation');
  const { requestLogger, generalRateLimit, loginRateLimit } = require('./middleware/security');
  const db = require('./services/DatabaseService').default;
  console.log('✅ Services loaded');

  // Try to load waste management service
  let WasteManagementService;
  try {
    WasteManagementService = require('./services/WasteManagementService').WasteManagementService;
    console.log('✅ Waste Management Service loaded');
  } catch (error) {
    console.log('⚠️  Waste Management Service not loaded (will create placeholder)');
  }

  const app = express();

  // Trust proxy for accurate IP addresses
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3001',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3000'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Requested-With',
      'X-Request-ID',
      'X-Request-Timestamp',
      'X-CSP-Nonce',
      'Accept',
      'Origin',
      'User-Agent',
      'Cache-Control'
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-Rate-Limit-Remaining',
      'X-Rate-Limit-Reset'
    ],
    optionsSuccessStatus: 200,
    preflightContinue: false
  }));

  // Basic middleware
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting
  app.use(generalRateLimit);

  // Request logging middleware
  app.use((req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.http(req, res, duration);
    });

    next();
  });

  // Enhanced health check endpoint
  app.get('/health', asyncHandler(async (req: express.Request, res: express.Response) => {
    const startTime = Date.now();

    try {
      // Check database health
      const dbHealth = await db.healthCheck();

      const healthStatus = {
        status: dbHealth.healthy ? 'OK' : 'UNHEALTHY',
        timestamp: new Date().toISOString(),
        environment: config.environment,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: dbHealth,
        responseTime: Date.now() - startTime,
        version: '1.0.0',
      };

      const statusCode = dbHealth.healthy ? 200 : 503;
      res.status(statusCode).json(healthStatus);

    } catch (error: any) {
      logger.error('Health check failed:', error);
      res.status(503).json({
        status: 'UNHEALTHY',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        responseTime: Date.now() - startTime,
      });
    }
  }));

  // Add status endpoint
  app.get('/api/v1/status', (req, res) => {
    res.json({
      name: 'KitchZero API',
      version: '1.0.0',
      environment: config.environment,
      timestamp: new Date().toISOString(),
    });
  });

  // Database test endpoint
  app.get('/api/v1/db-test', asyncHandler(async (req: express.Request, res: express.Response) => {
    try {
      const startTime = Date.now();

      const timeResult = await db.query('SELECT NOW() as current_time');

      let userCount = 0;
      try {
        const userResult = await db.query('SELECT COUNT(*) as count FROM users');
        userCount = parseInt(userResult.rows[0].count);
      } catch (e) {
        logger.warn('Users table not found, might need to run db:setup');
      }

      const tablesResult = await db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);

      const duration = Date.now() - startTime;

      res.json({
        status: 'Database connected successfully',
        timestamp: timeResult.rows[0].current_time,
        user_count: userCount,
        database: config.database.name,
        tables: tablesResult.rows.map((row: any) => row.table_name),
        query_time: duration,
      });
    } catch (error: any) {
      logger.error('Database connection failed:', error);
      res.status(500).json({
        status: 'Database connection failed',
        error: error.message,
        database: config.database.name,
      });
    }
  }));

  // Auth endpoints
  app.post('/api/v1/auth/login',
    loginRateLimit,
    validate('login'),
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const { username, password } = req.body;

      try {
        const result = await AuthService.login(
          username,
          password,
          req.ip || 'unknown',
          req.get('User-Agent') || ''
        );

        res.json({
          success: true,
          message: 'Login successful',
          data: result,
        });

      } catch (error: any) {
        res.status(401).json({
          success: false,
          message: error.message,
        });
      }
    })
  );

  app.post('/api/v1/auth/refresh',
    validateRefreshToken,
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const { refreshToken } = req.body;

      try {
        const result = await AuthService.refreshToken(refreshToken);

        res.json({
          success: true,
          message: 'Token refreshed successfully',
          data: result,
        });

      } catch (error: any) {
        res.status(401).json({
          success: false,
          message: error.message,
        });
      }
    })
  );

  app.post('/api/v1/auth/change-password',
    AuthMiddleware.authenticate,
    validate('changePassword'),
    asyncHandler(async (req: any, res: express.Response): Promise<void> => {
      const { currentPassword, newPassword } = req.body;

      try {
        await AuthService.changePassword(req.user.id, currentPassword, newPassword);

        res.json({
          success: true,
          message: 'Password changed successfully',
        });
        return;
      } catch (error: any) {
        res.status(400).json({
          success: false,
          message: error.message,
        });
        return;
      }
    })
  );

  app.post('/api/v1/auth/change-credentials',
    AuthMiddleware.authenticate,
    validate('changeCredentials'),
    asyncHandler(async (req: any, res: express.Response): Promise<void> => {
      const { currentPassword, newUsername, newPassword } = req.body;

      try {
        await AuthService.changeCredentials(req.user.id, currentPassword, newUsername, newPassword);

        const updatedUserResult = await db.query(
          'SELECT id, username, email, role, tenant_id, branch_id, is_active, must_change_password FROM users WHERE id = $1',
          [req.user.id]
        );

        const updatedUser = updatedUserResult.rows[0];

        res.json({
          success: true,
          message: 'Credentials changed successfully.',
          data: {
            user: {
              id: updatedUser.id,
              username: updatedUser.username,
              email: updatedUser.email,
              role: updatedUser.role,
              tenantId: updatedUser.tenant_id,
              branchId: updatedUser.branch_id,
              isActive: updatedUser.is_active,
              mustChangePassword: updatedUser.must_change_password,
            }
          }
        });
        return;
      } catch (error: any) {
        res.status(400).json({
          success: false,
          message: error.message,
        });
        return;
      }
    })
  );

  app.get('/api/v1/auth/me',
    AuthMiddleware.authenticate,
    asyncHandler(async (req: any, res: express.Response) => {
      try {
        const result = await db.query(
          'SELECT id, username, email, role, tenant_id, branch_id, is_active, must_change_password FROM users WHERE id = $1',
          [req.user.id]
        );

        if (result.rows.length === 0) {
          res.status(404).json({
            success: false,
            message: 'User not found',
          });
          return;
        }

        const user = result.rows[0];
        res.json({
          success: true,
          data: {
            user: {
              id: user.id,
              username: user.username,
              email: user.email,
              role: user.role,
              tenantId: user.tenant_id,
              branchId: user.branch_id,
              isActive: user.is_active,
              mustChangePassword: user.must_change_password,
            }
          },
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          message: 'Failed to get user data',
        });
      }
    })
  );

  app.post('/api/v1/auth/logout',
    AuthMiddleware.authenticate,
    asyncHandler(async (req: any, res: express.Response) => {
      const { refreshToken } = req.body;

      if (refreshToken) {
        try {
          await db.query(
            'UPDATE refresh_tokens SET is_revoked = true WHERE token = $1 AND user_id = $2',
            [refreshToken, req.user.id]
          );

          logger.audit('user_logout', req.user.id, {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
          });
        } catch (error: any) {
          logger.error('Error revoking refresh token:', {
            error: error.message,
            stack: error.stack,
            userId: req.user.id,
          });
        }
      }

      res.json({
        success: true,
        message: 'Logout successful',
      });
    })
  );

  // Placeholder for waste management routes
  if (WasteManagementService) {
    try {
      const wasteManagementRoutes = require('./routes/waste-management').default;
      app.use('/api/v1/waste-management', wasteManagementRoutes);
      console.log('✅ Waste management routes loaded');
    } catch (error) {
      console.log('⚠️  Waste management routes not loaded, will create placeholder');

      // Create placeholder routes
      app.get('/api/v1/waste-management/status', (req, res) => {
        res.json({
          success: true,
          message: 'Waste management module not fully configured yet',
          features: 'Coming soon',
        });
      });
    }
  } else {
    // Create placeholder routes when service is not loaded
    app.get('/api/v1/waste-management/status', (req, res) => {
      res.json({
        success: true,
        message: 'Waste management module not fully configured yet',
        features: 'Coming soon',
      });
    });
  }

  // Basic admin endpoints
  app.get('/api/v1/admin/users',
    AuthMiddleware.authenticate,
    AuthMiddleware.authorize(['super_admin']),
    validate('pagination', 'query'),
    asyncHandler(async (req: express.Request, res: express.Response) => {
      try {
        const { page, limit } = req.query as any;

        const result = await db.query(`
          SELECT id, username, email, role, is_active, must_change_password, 
                 created_at, last_login_at, tenant_id, branch_id
          FROM users 
          WHERE deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2
        `, [limit, (page - 1) * limit]);

        const countResult = await db.query('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL');
        const total = parseInt(countResult.rows[0].count);

        res.json({
          success: true,
          data: {
            users: result.rows,
            pagination: {
              current: page,
              pages: Math.ceil(total / limit),
              total,
              limit,
            },
          },
        });

      } catch (error: any) {
        logger.error('Users list error:', error);
        res.status(500).json({
          success: false,
          message: 'Failed to fetch users',
        });
      }
    })
  );

  // Debug endpoint
  app.get('/api/v1/debug/user/:username',
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const { username } = req.params;

      try {
        const result = await db.query(
          'SELECT id, username, must_change_password, created_at, updated_at FROM users WHERE username = $1',
          [username]
        );

        res.json({
          success: true,
          data: result.rows[0] || null,
        });
      } catch (error: any) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    })
  );

  // 404 handler
  app.use('*', notFoundHandler);

  // Error handling middleware
  app.use(errorHandler);

  // Start server
  const server = app.listen(config.server.port, config.server.host, () => {
    console.log('✅ KitchZero API Server started successfully!');
    console.log(`📍 Server: http://${config.server.host}:${config.server.port}`);
    console.log(`🌍 Environment: ${config.environment}`);
    console.log(`📊 Health: http://${config.server.host}:${config.server.port}/health`);
    console.log(`🔧 DB Test: http://${config.server.host}:${config.server.port}/api/v1/db-test`);
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    server.close(async () => {
      try {
        await db.close();
        console.log('Database connections closed');
      } catch (error: unknown) {
        const err = error as Error;
        console.error('Error closing database:', err.message);
      }

      console.log('Server closed. Process terminated.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

} catch (error: unknown) {
  const err = error as Error;
  console.error('❌ Failed to start server:', err.message);
  if (err.stack) {
    console.error('Stack trace:', err.stack);
  }
  process.exit(1);
}

export default {};
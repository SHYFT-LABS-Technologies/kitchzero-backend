import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import logger from './utils/logger';
import { errorHandler, asyncHandler, notFoundHandler } from './utils/errors';
import { AuthService } from './services/AuthService';
import { AuthMiddleware } from './middleware/auth';
import { UserService } from './services/UserService';
import { TenantService } from './services/TenantService';
import { BranchService } from './services/BranchService';
import { validate, validateRefreshToken } from './middleware/validation';
import { requestLogger, generalRateLimit, loginRateLimit } from './middleware/security';
import db from './services/DatabaseService';

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'], // Added X-Requested-With
}));

// Basic middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(generalRateLimit);

// Request logging middleware using new logger
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
    
    // Check basic system health
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

// Add detailed database health endpoint
app.get('/health/database', asyncHandler(async (req: express.Request, res: express.Response) => {
  try {
    const dbHealth = await db.healthCheck();
    res.json({
      healthy: dbHealth.healthy,
      ...dbHealth.stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}));

// Database test endpoint (enhanced)
app.get('/api/v1/db-test', asyncHandler(async (req: express.Request, res: express.Response) => {
  try {
    const startTime = Date.now();
    
    // Test basic connection
    const timeResult = await db.query('SELECT NOW() as current_time');
    
    // Test user count
    let userCount = 0;
    try {
      const userResult = await db.query('SELECT COUNT(*) as count FROM users');
      userCount = parseInt(userResult.rows[0].count);
    } catch (e) {
      logger.warn('Users table not found, might need to run db:setup');
    }
    
    // Test tables exist
    const tablesResult = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    const duration = Date.now() - startTime;
    logger.performance('database_test', duration);

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

// JWT Login endpoint with validation
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

// Token refresh endpoint with validation
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

// Change password with validation
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
      return; // Add explicit return
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return; // Add explicit return
    }
  })
);

// Create tenant with validation
app.post('/api/v1/admin/tenants', 
  AuthMiddleware.authenticate, 
  AuthMiddleware.authorize(['super_admin']),
  validate('createTenant'),
  asyncHandler(async (req: any, res: express.Response) => {
    const { name, slug, type, settings } = req.body;

    try {
      const newTenant = await TenantService.createTenant({
        name,
        slug,
        type,
        settings,
      }, req.user.id);

      res.status(201).json({
        success: true,
        message: 'Tenant created successfully',
        data: { tenant: newTenant },
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Create user with validation
app.post('/api/v1/admin/users', 
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  validate('createUser'),
  asyncHandler(async (req: any, res: express.Response): Promise<void> => {
    const { username, email, password, role, tenantId, branchId } = req.body;

    // Tenant admins can only create users within their tenant
    if (req.user.role === 'tenant_admin') {
      if (tenantId && tenantId !== req.user.tenantId) {
        res.status(403).json({
          success: false,
          message: 'Cannot create users outside your tenant',
        });
        return;
      }
      // Force tenant ID for tenant admins
      req.body.tenantId = req.user.tenantId;
    }

    try {
      const newUser = await UserService.createUser({
        username,
        email,
        password,
        role,
        tenantId: req.body.tenantId,
        branchId,
      }, req.user.id);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: { user: newUser },
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Get users with pagination validation
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

// Logout endpoint
app.post('/api/v1/auth/logout', 
  AuthMiddleware.authenticate, 
  asyncHandler(async (req: any, res: express.Response) => {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      try {
        // Revoke the refresh token
        await db.query(
          'UPDATE refresh_tokens SET is_revoked = true WHERE token = $1 AND user_id = $2',
          [refreshToken, req.user.id]
        );
        
        logger.audit('user_logout', req.user.id, {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });
      } catch (error: any) {
        // Fix: Cast error to any or handle properly
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

// 404 handler
app.use('*', notFoundHandler);

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown with database cleanup
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(async () => {
    try {
      await db.close();
      logger.info('Database connections closed');
    } catch (error: any) {
      // Fix: Cast error to any or handle properly
      logger.error('Error closing database:', {
        error: error.message,
        stack: error.stack,
        signal,
      });
    }
    
    logger.info('Server closed. Process terminated.');
    process.exit(0);
  });
};

// Start server
const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`🚀 KitchZero API Server started`);
  logger.info(`📍 Server: http://${config.server.host}:${config.server.port}`);
  logger.info(`🌍 Environment: ${config.environment}`);
  logger.info(`📊 Health: http://${config.server.host}:${config.server.port}/health`);
  logger.info(`🔧 DB Test: http://${config.server.host}:${config.server.port}/api/v1/db-test`);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
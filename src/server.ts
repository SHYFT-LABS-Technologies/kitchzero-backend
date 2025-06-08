import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import logger from './utils/logger';
import { errorHandler, asyncHandler } from './utils/errors';
import { AuthService } from './services/AuthService';
import { AuthMiddleware } from './middleware/auth';
import { JWTUtils } from './utils/jwt';
import { UserService } from './services/UserService';
import { TenantService } from './services/TenantService';
import { BranchService } from './services/BranchService';

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001', 'http://localhost:3000'], // Add Vite's default port
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// Basic middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  });
  
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: config.environment,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Database test endpoint
app.get('/api/v1/db-test', asyncHandler(async (req: express.Request, res: express.Response) => {
  try {
    const { Client } = require('pg');
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    await client.connect();
    
    // Test basic connection
    const timeResult = await client.query('SELECT NOW() as current_time');
    
    // Test user count
    let userCount = 0;
    try {
      const userResult = await client.query('SELECT COUNT(*) as count FROM users');
      userCount = parseInt(userResult.rows[0].count);
    } catch (e) {
      // Table might not exist yet
      logger.warn('Users table not found, might need to run db:setup');
    }
    
    // Test tables exist
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    await client.end();

    res.json({
      status: 'Database connected successfully',
      timestamp: timeResult.rows[0].current_time,
      user_count: userCount,
      database: config.database.name,
      tables: tablesResult.rows.map((row: any) => row.table_name),
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

// API status endpoint
app.get('/api/v1/status', (req, res) => {
  res.json({
    name: 'KitchZero API',
    version: '1.0.0',
    environment: config.environment,
    timestamp: new Date().toISOString(),
    authentication: 'JWT enabled',
    features: ['Multi-tenant', 'User Management', 'Branch Management', 'Role-based Access'],
    endpoints: {
      // Authentication
      auth: {
        login: 'POST /api/v1/auth/login',
        refresh: 'POST /api/v1/auth/refresh', 
        logout: 'POST /api/v1/auth/logout',
        me: 'GET /api/v1/auth/me',
        changePassword: 'POST /api/v1/auth/change-password',
      },
      // Super Admin
      admin: {
        users: 'GET /api/v1/admin/users',
        createUser: 'POST /api/v1/admin/users',
        updateUser: 'PUT /api/v1/admin/users/:userId',
        deleteUser: 'DELETE /api/v1/admin/users/:userId',
        resetPassword: 'POST /api/v1/admin/users/:userId/reset-password',
        tenants: 'GET /api/v1/admin/tenants',
        createTenant: 'POST /api/v1/admin/tenants',
        getTenant: 'GET /api/v1/admin/tenants/:tenantId',
        updateTenant: 'PUT /api/v1/admin/tenants/:tenantId',
        deleteTenant: 'DELETE /api/v1/admin/tenants/:tenantId',
      },
      // Tenant Admin & Branch Admin
      tenant: {
        info: 'GET /api/v1/tenant/info',
        users: 'GET /api/v1/tenant/users',
        branches: 'GET /api/v1/tenant/branches',
        createBranch: 'POST /api/v1/tenant/branches',
        getBranch: 'GET /api/v1/tenant/branches/:branchId',
        updateBranch: 'PUT /api/v1/tenant/branches/:branchId',
        deleteBranch: 'DELETE /api/v1/tenant/branches/:branchId',
        createBranchAdmin: 'POST /api/v1/tenant/branches/:branchId/admins',
      },
      // System
      system: {
        health: 'GET /health',
        dbTest: 'GET /api/v1/db-test',
        status: 'GET /api/v1/status',
      },
    },
    roles: {
      super_admin: 'Full system access - manage all tenants and users',
      tenant_admin: 'Manage tenant settings, branches, and users within tenant',
      branch_admin: 'Manage operations within assigned branch',
    },
  });
});

// Simple auth test endpoint
app.post('/api/v1/auth/test-login', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required',
    });
  }
  
  logger.security('Login attempt', {
    username,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
  });

  // Test with database
  try {
    const { Client } = require('pg');
    const bcrypt = require('bcryptjs');
    
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    await client.connect();
    
    const result = await client.query(
      'SELECT id, username, password, role, is_active, must_change_password FROM users WHERE username = $1',
      [username]
    );
    
    await client.end();

    if (result.rows.length === 0) {
      logger.security('Login failed - user not found', { username });
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const user = result.rows[0];
    
    if (!user.is_active) {
      logger.security('Login failed - user inactive', { username });
      return res.status(401).json({
        success: false,
        message: 'Account is inactive',
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      logger.security('Login failed - invalid password', { username });
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    logger.audit('successful_login', user.id, {
      username: user.username,
      ip: req.ip,
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: user.must_change_password,
      },
      note: 'This is a test endpoint. Real JWT implementation coming next.',
    });

  } catch (error: any) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login',
    });
  }
}));

// Users list endpoint (simple)
app.get('/api/v1/users', asyncHandler(async (req: express.Request, res: express.Response) => {
  try {
    const { Client } = require('pg');
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    await client.connect();
    
    const result = await client.query(`
      SELECT id, username, email, role, is_active, must_change_password, 
             created_at, last_login_at
      FROM users 
      ORDER BY created_at DESC
    `);
    
    await client.end();

    res.json({
      success: true,
      data: {
        users: result.rows,
        total: result.rows.length,
      },
    });

  } catch (error: any) {
    logger.error('Users list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message,
    });
  }
}));

// Create tenant endpoint (simple)
app.post('/api/v1/tenants', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { name, slug, type } = req.body;
  
  if (!name || !slug || !type) {
    return res.status(400).json({
      success: false,
      message: 'Name, slug, and type are required',
    });
  }

  try {
    const { Client } = require('pg');
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    await client.connect();
    
    const result = await client.query(`
      INSERT INTO tenants (name, slug, type, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, true, NOW(), NOW())
      RETURNING id, name, slug, type, is_active, created_at
    `, [name, slug, type]);
    
    await client.end();

    logger.audit('tenant_created', 'system', {
      tenantId: result.rows[0].id,
      name,
      slug,
      type,
    });

    res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      data: { tenant: result.rows[0] },
    });

  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(409).json({
        success: false,
        message: 'Tenant slug already exists',
      });
    }
    
    logger.error('Tenant creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create tenant',
      error: error.message,
    });
  }
}));

// JWT Login endpoint
app.post('/api/v1/auth/login', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required',
    });
  }

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
}));

// Token refresh endpoint
app.post('/api/v1/auth/refresh', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Refresh token is required',
    });
  }

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
}));

// Get current user profile
app.get('/api/v1/auth/me', AuthMiddleware.authenticate, (req: any, res: express.Response) => {
  res.json({
    success: true,
    data: { user: req.user },
  });
});

// Change password
app.post('/api/v1/auth/change-password', AuthMiddleware.authenticate, asyncHandler(async (req: any, res: express.Response) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Current password and new password are required',
    });
  }

  try {
    await AuthService.changePassword(req.user.id, currentPassword, newPassword);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });

  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
}));

// Protected users endpoint (Super Admin only)
app.get('/api/v1/admin/users', 
  AuthMiddleware.authenticate, 
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    // Your existing users code here
    // ... (same as before)
  })
);

// Logout endpoint
app.post('/api/v1/auth/logout', AuthMiddleware.authenticate, asyncHandler(async (req: any, res: express.Response) => {
  const { refreshToken } = req.body;
  
  if (refreshToken) {
    try {
      const { Client } = require('pg');
      const client = new Client({
        host: config.database.host,
        port: config.database.port,
        user: config.database.username,
        password: config.database.password,
        database: config.database.name,
      });

      await client.connect();
      
      // Revoke the refresh token
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = true WHERE token = $1 AND user_id = $2',
        [refreshToken, req.user.id]
      );
      
      await client.end();
      
      logger.audit('user_logout', req.user.id, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });
    } catch (error) {
      logger.error('Error revoking refresh token:', error);
    }
  }

  res.json({
    success: true,
    message: 'Logout successful',
  });
}));

// Protected users endpoint (Super Admin only)
app.get('/api/v1/admin/users', 
  AuthMiddleware.authenticate, 
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    try {
      const { Client } = require('pg');
      const client = new Client({
        host: config.database.host,
        port: config.database.port,
        user: config.database.username,
        password: config.database.password,
        database: config.database.name,
      });

      await client.connect();
      
      const result = await client.query(`
        SELECT id, username, email, role, is_active, must_change_password, 
               created_at, last_login_at, tenant_id, branch_id
        FROM users 
        ORDER BY created_at DESC
      `);
      
      await client.end();

      res.json({
        success: true,
        data: {
          users: result.rows,
          total: result.rows.length,
        },
      });

    } catch (error: any) {
      logger.error('Users list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users',
        error: error.message,
      });
    }
  })
);

// Protected tenant creation (Super Admin only)
app.post('/api/v1/admin/tenants', 
  AuthMiddleware.authenticate, 
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { name, slug, type } = req.body;
    
    if (!name || !slug || !type) {
      return res.status(400).json({
        success: false,
        message: 'Name, slug, and type are required',
      });
    }

    try {
      const { Client } = require('pg');
      const client = new Client({
        host: config.database.host,
        port: config.database.port,
        user: config.database.username,
        password: config.database.password,
        database: config.database.name,
      });

      await client.connect();
      
      const result = await client.query(`
        INSERT INTO tenants (name, slug, type, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, true, NOW(), NOW())
        RETURNING id, name, slug, type, is_active, created_at
      `, [name, slug, type]);
      
      await client.end();

      logger.audit('tenant_created', (req as any).user?.id || 'system', {
        tenantId: result.rows[0].id,
        name,
        slug,
        type,
      });

      res.status(201).json({
        success: true,
        message: 'Tenant created successfully',
        data: { tenant: result.rows[0] },
      });

    } catch (error: any) {
      if (error.code === '23505') { // Unique violation
        return res.status(409).json({
          success: false,
          message: 'Tenant slug already exists',
        });
      }
      
      logger.error('Tenant creation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create tenant',
        error: error.message,
      });
    }
  })
);

// === USER MANAGEMENT ROUTES ===

// Create user (Super Admin or Tenant Admin)
app.post('/api/v1/admin/users', 
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { username, email, password, role, tenantId, branchId } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Username, password, and role are required',
      });
    }

    // Tenant admins can only create users within their tenant
    if (req.user.role === 'tenant_admin') {
      if (tenantId && tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          message: 'Cannot create users outside your tenant',
        });
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

// Update user
app.put('/api/v1/admin/users/:userId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { userId } = req.params;
    const updateData = req.body;

    try {
      const updatedUser = await UserService.updateUser(userId, updateData, req.user.id);

      res.json({
        success: true,
        message: 'User updated successfully',
        data: { user: updatedUser },
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Delete user
app.delete('/api/v1/admin/users/:userId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { userId } = req.params;

    try {
      await UserService.deleteUser(userId, req.user.id);

      res.json({
        success: true,
        message: 'User deleted successfully',
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Reset user password
app.post('/api/v1/admin/users/:userId/reset-password',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin', 'tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { userId } = req.params;

    try {
      const tempPassword = await UserService.resetUserPassword(userId, req.user.id);

      res.json({
        success: true,
        message: 'Password reset successfully',
        data: { tempPassword },
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Get users by tenant (for tenant admins)
app.get('/api/v1/tenant/users',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    try {
      const result = await UserService.getUsersByTenant(req.user.tenantId, page, limit);

      res.json({
        success: true,
        data: result,
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// === TENANT MANAGEMENT ROUTES ===

// Get all tenants (Super Admin only)
app.get('/api/v1/admin/tenants',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    try {
      const result = await TenantService.getTenants(page, limit);

      res.json({
        success: true,
        data: result,
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Get tenant by ID
app.get('/api/v1/admin/tenants/:tenantId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const { tenantId } = req.params;

    try {
      const tenant = await TenantService.getTenantById(tenantId);

      res.json({
        success: true,
        data: { tenant },
      });

    } catch (error: any) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Update tenant
app.put('/api/v1/admin/tenants/:tenantId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { tenantId } = req.params;
    const updateData = req.body;

    try {
      const updatedTenant = await TenantService.updateTenant(tenantId, updateData, req.user.id);

      res.json({
        success: true,
        message: 'Tenant updated successfully',
        data: { tenant: updatedTenant },
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Delete tenant
app.delete('/api/v1/admin/tenants/:tenantId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['super_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { tenantId } = req.params;

    try {
      await TenantService.deleteTenant(tenantId, req.user.id);

      res.json({
        success: true,
        message: 'Tenant deleted successfully',
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Get current tenant info (for tenant admins)
app.get('/api/v1/tenant/info',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    if (!req.user.tenantId) {
      return res.status(400).json({
        success: false,
        message: 'User is not associated with a tenant',
      });
    }

    try {
      const tenant = await TenantService.getTenantById(req.user.tenantId);

      res.json({
        success: true,
        data: { tenant },
      });

    } catch (error: any) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// === BRANCH MANAGEMENT ROUTES ===

// Create branch (Tenant Admin only)
app.post('/api/v1/tenant/branches',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { name, address, city, state, zipCode, country, phone, email, settings } = req.body;

    if (!name || !address || !city || !state || !zipCode || !country) {
      return res.status(400).json({
        success: false,
        message: 'Name, address, city, state, zipCode, and country are required',
      });
    }

    try {
      const newBranch = await BranchService.createBranch({
        tenantId: req.user.tenantId,
        name,
        address,
        city,
        state,
        zipCode,
        country,
        phone,
        email,
        settings,
      }, req.user.id);

      res.status(201).json({
        success: true,
        message: 'Branch created successfully',
        data: { branch: newBranch },
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Get branches for current tenant
app.get('/api/v1/tenant/branches',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    try {
      const result = await BranchService.getBranchesByTenant(req.user.tenantId, page, limit);

      res.json({
        success: true,
        data: result,
      });

    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Get branch by ID
app.get('/api/v1/tenant/branches/:branchId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin', 'branch_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { branchId } = req.params;

    try {
      const branch = await BranchService.getBranchById(branchId);

      // Check if branch belongs to user's tenant
      if (req.user.role !== 'super_admin' && branch.tenant_id !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Branch does not belong to your tenant',
        });
      }

      res.json({
        success: true,
        data: { branch },
      });

    } catch (error: any) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Update branch
app.put('/api/v1/tenant/branches/:branchId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { branchId } = req.params;
    const updateData = req.body;

    try {
      // First verify branch belongs to user's tenant
      const branch = await BranchService.getBranchById(branchId);
      if (branch.tenant_id !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Branch does not belong to your tenant',
        });
      }

      const updatedBranch = await BranchService.updateBranch(branchId, updateData, req.user.id);

      res.json({
        success: true,
        message: 'Branch updated successfully',
        data: { branch: updatedBranch },
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Delete branch
app.delete('/api/v1/tenant/branches/:branchId',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { branchId } = req.params;

    try {
      // First verify branch belongs to user's tenant
      const branch = await BranchService.getBranchById(branchId);
      if (branch.tenant_id !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Branch does not belong to your tenant',
        });
      }

      await BranchService.deleteBranch(branchId, req.user.id);

      res.json({
        success: true,
        message: 'Branch deleted successfully',
      });

    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  })
);

// Create branch admin (Tenant Admin only)
app.post('/api/v1/tenant/branches/:branchId/admins',
  AuthMiddleware.authenticate,
  AuthMiddleware.authorize(['tenant_admin']),
  asyncHandler(async (req: any, res: express.Response) => {
    const { branchId } = req.params;
    const { username, email, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
      });
    }

    try {
      // Verify branch belongs to user's tenant
      const branch = await BranchService.getBranchById(branchId);
      if (branch.tenant_id !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Branch does not belong to your tenant',
        });
      }

      const newUser = await UserService.createUser({
        username,
        email,
        password,
        role: 'branch_admin',
        tenantId: req.user.tenantId,
        branchId,
      }, req.user.id);

      res.status(201).json({
        success: true,
        message: 'Branch admin created successfully',
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    availableEndpoints: {
      status: 'GET /api/v1/status',
      health: 'GET /health',
      dbTest: 'GET /api/v1/db-test',
      testLogin: 'POST /api/v1/auth/test-login',
      users: 'GET /api/v1/users',
      createTenant: 'POST /api/v1/tenants',
    },
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
const server = app.listen(config.server.port, config.server.host, () => {
  logger.info(`🚀 KitchZero API Server started`);
  logger.info(`📍 Server: http://${config.server.host}:${config.server.port}`);
  logger.info(`🌍 Environment: ${config.environment}`);
  logger.info(`📊 Health: http://${config.server.host}:${config.server.port}/health`);
  logger.info(`🔧 DB Test: http://${config.server.host}:${config.server.port}/api/v1/db-test`);
  logger.info(`👥 Users: http://${config.server.host}:${config.server.port}/api/v1/users`);
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('Server closed. Process terminated.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
import { Request, Response, NextFunction } from 'express';
import { JWTUtils } from '../utils/jwt';
import logger from '../utils/logger';
import db from '../services/DatabaseService';

interface AuthenticatedRequest extends Request {
  user?: any;
  tenant?: any;
}

export class AuthMiddleware {
  // Enhanced JWT Authentication with tenant context
  static authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          success: false,
          message: 'Access token required',
        });
        return;
      }

      const token = authHeader.substring(7);
      const payload = JWTUtils.verifyAccessToken(token);

      // Get user with tenant information
      const result = await db.query(`
        SELECT 
          u.id, u.username, u.email, u.role, u.tenant_id, u.branch_id, u.is_active,
          t.name as tenant_name, t.slug as tenant_slug, t.is_active as tenant_active,
          t.subscription_status
        FROM users u
        LEFT JOIN tenants t ON u.tenant_id = t.id
        WHERE u.id = $1 AND u.deleted_at IS NULL
      `, [payload.userId]);

      if (result.rows.length === 0) {
        res.status(401).json({
          success: false,
          message: 'User not found',
        });
        return;
      }

      const user = result.rows[0];

      // Check if user is active
      if (!user.is_active) {
        res.status(401).json({
          success: false,
          message: 'Account is inactive',
        });
        return;
      }

      // For non-super admins, check tenant status
      if (user.role !== 'super_admin') {
        if (!user.tenant_id) {
          res.status(401).json({
            success: false,
            message: 'No tenant associated with user',
          });
          return;
        }

        if (!user.tenant_active) {
          res.status(401).json({
            success: false,
            message: 'Tenant account is inactive',
          });
          return;
        }

        if (user.subscription_status === 'cancelled' || user.subscription_status === 'suspended') {
          res.status(401).json({
            success: false,
            message: 'Tenant subscription is not active',
          });
          return;
        }
      }

      // Add user and tenant context to request
      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        tenantId: user.tenant_id,
        branchId: user.branch_id,
      };

      req.tenant = user.tenant_id ? {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
        subscriptionStatus: user.subscription_status,
      } : null;

      logger.audit('token_verified', req.user.id, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        tenantId: req.user.tenantId,
      });

      next();
    } catch (error: any) {
      logger.security('Authentication failed', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        error: error.message,
      });

      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }
  };

  // Enhanced role-based authorization with tenant context
  static authorize = (allowedRoles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
        return;
      }

      if (!allowedRoles.includes(req.user.role)) {
        logger.security('Authorization failed', {
          userId: req.user.id,
          role: req.user.role,
          requiredRoles: allowedRoles,
          tenantId: req.user.tenantId,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });

        res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
        });
        return;
      }

      next();
    };
  };

  // Strict tenant isolation middleware
  static enforceTenantIsolation = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    // Super admin can access all data
    if (req.user.role === 'super_admin') {
      next();
      return;
    }

    // For tenant/branch admins, ensure they can only access their own tenant's data
    if (!req.user.tenantId) {
      res.status(403).json({
        success: false,
        message: 'No tenant context available',
      });
      return;
    }

    // Check for tenant ID in request parameters, body, or query
    const requestTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;

    if (requestTenantId && req.user.tenantId !== requestTenantId) {
      logger.security('Tenant isolation violation attempt', {
        userId: req.user.id,
        userTenantId: req.user.tenantId,
        requestedTenantId: requestTenantId,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.status(403).json({
        success: false,
        message: 'Access denied: Cannot access other tenant\'s data',
      });
      return;
    }

    next();
  };

  // Branch-level access control
  static enforceBranchAccess = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
      return;
    }

    // Super admin and tenant admin can access all branches within their tenant
    if (req.user.role === 'super_admin' || req.user.role === 'tenant_admin') {
      next();
      return;
    }

    // Branch admin can only access their own branch
    if (req.user.role === 'branch_admin') {
      const requestBranchId = req.params.branchId || req.body.branchId || req.query.branchId;

      if (requestBranchId && req.user.branchId !== requestBranchId) {
        logger.security('Branch access violation attempt', {
          userId: req.user.id,
          userBranchId: req.user.branchId,
          requestedBranchId: requestBranchId,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });

        res.status(403).json({
          success: false,
          message: 'Access denied: Cannot access other branch\'s data',
        });
        return;
      }
    }

    next();
  };

  // Middleware to automatically inject tenant context into database queries
  static injectTenantContext = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (req.user && req.user.role !== 'super_admin') {
      // Automatically add tenant context to request body for database operations
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        if (!req.body.tenantId && req.user.tenantId) {
          req.body.tenantId = req.user.tenantId;
        }
      }
    }
    next();
  };
}
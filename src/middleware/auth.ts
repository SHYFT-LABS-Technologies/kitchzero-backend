import { Request, Response, NextFunction } from 'express';
import { JWTUtils } from '../utils/jwt';
import logger from '../utils/logger';

interface AuthenticatedRequest extends Request {
  user?: any;
}

export class AuthMiddleware {
  // JWT Authentication middleware
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
      
      // Verify token
      const payload = JWTUtils.verifyAccessToken(token);
      
      // Get user from database to ensure they still exist and are active
      const { Client } = require('pg');
      const { config } = require('../config');
      
      const client = new Client({
        host: config.database.host,
        port: config.database.port,
        user: config.database.username,
        password: config.database.password,
        database: config.database.name,
      });

      await client.connect();
      
      const result = await client.query(
        'SELECT id, username, email, role, tenant_id, branch_id, is_active FROM users WHERE id = $1',
        [payload.userId]
      );
      
      await client.end();

      if (result.rows.length === 0 || !result.rows[0].is_active) {
        res.status(401).json({
          success: false,
          message: 'User not found or inactive',
        });
        return;
      }

      // Add user to request
      req.user = {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
        role: result.rows[0].role,
        tenantId: result.rows[0].tenant_id,
        branchId: result.rows[0].branch_id,
      };

      logger.audit('token_verified', req.user.id, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
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

  // Role-based authorization
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

  // Tenant isolation middleware
static enforceTenantIsolation = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
   if (!req.user) {
     res.status(401).json({
       success: false,
       message: 'Authentication required',
     });
     return;
   }

   // Super admin can access all tenants
   if (req.user.role === 'super_admin') {
     next();
     return;
   }

   // Extract tenant ID from request (URL parameter, body, or query)
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
       message: 'Access denied: Tenant isolation violation',
     });
     return;
   }

   next();
 };
}
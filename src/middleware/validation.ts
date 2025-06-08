import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Validation schemas
export const schemas = {
  // Auth schemas
  login: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required(),
    password: Joi.string().min(8).max(128).required(),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .min(12)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
      .required()
      .messages({
        'string.pattern.base': 'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character'
      }),
  }),

  // User schemas
  createUser: Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required(),
    email: Joi.string().email().optional(),
    password: Joi.string()
      .min(12)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
      .required(),
    role: Joi.string().valid('tenant_admin', 'branch_admin').required(),
    tenantId: Joi.string().uuid().optional(),
    branchId: Joi.string().uuid().optional(),
  }),

  updateUser: Joi.object({
    email: Joi.string().email().optional(),
    isActive: Joi.boolean().optional(),
    role: Joi.string().valid('super_admin', 'tenant_admin', 'branch_admin').optional(),
    tenantId: Joi.string().uuid().optional(),
    branchId: Joi.string().uuid().optional(),
  }).min(1), // At least one field required

  // Tenant schemas
  createTenant: Joi.object({
    name: Joi.string().min(2).max(255).required(),
    slug: Joi.string().alphanum().min(2).max(100).lowercase().required(),
    type: Joi.string().valid('restaurant', 'hotel').required(),
    settings: Joi.object().optional(),
  }),

  updateTenant: Joi.object({
    name: Joi.string().min(2).max(255).optional(),
    settings: Joi.object().optional(),
    isActive: Joi.boolean().optional(),
    subscriptionStatus: Joi.string().valid('trial', 'active', 'suspended', 'cancelled').optional(),
    subscriptionEndDate: Joi.date().optional(),
  }).min(1),

  // Branch schemas
  createBranch: Joi.object({
    name: Joi.string().min(2).max(255).required(),
    address: Joi.string().min(5).max(500).required(),
    city: Joi.string().min(2).max(100).required(),
    state: Joi.string().min(2).max(100).required(),
    zipCode: Joi.string().min(2).max(20).required(),
    country: Joi.string().min(2).max(100).required(),
    phone: Joi.string().pattern(/^[\+]?[1-9][\d]{0,15}$/).optional(),
    email: Joi.string().email().optional(),
    settings: Joi.object().optional(),
  }),

  // Pagination schema
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
  }),

  // UUID parameter schema
  uuidParam: Joi.object({
    id: Joi.string().uuid().required(),
    userId: Joi.string().uuid().optional(),
    tenantId: Joi.string().uuid().optional(),
    branchId: Joi.string().uuid().optional(),
  }),
};

// Validation middleware factory
export const validate = (schemaType: keyof typeof schemas, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const schema = schemas[schemaType];
    if (!schema) {
      logger.error('Invalid schema type:', schemaType);
      return res.status(500).json({
        success: false,
        message: 'Internal validation error',
      });
    }

    const dataToValidate = req[property];
    const { error, value } = schema.validate(dataToValidate, {
      abortEarly: false, // Return all errors
      allowUnknown: false, // Don't allow unknown fields
      stripUnknown: true, // Remove unknown fields
      convert: true, // Convert types (string to number, etc.)
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      logger.security('Validation failed', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        errors: errorDetails,
      });

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    // Replace request data with validated/sanitized data
    (req as any)[property] = value;
    next();
  };
};

// Custom validation for complex scenarios
export const validateRefreshToken = (req: Request, res: Response, next: NextFunction): void => {
  const { refreshToken } = req.body;
  
  if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.length < 10) {
    return res.status(400).json({
      success: false,
      message: 'Valid refresh token is required',
    });
  }
  
  next();
};
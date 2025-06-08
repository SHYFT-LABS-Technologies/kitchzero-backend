import { Request, Response, NextFunction } from 'express';
import logger from './logger';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, true, 'VALIDATION_ERROR');
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, true, 'AUTH_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, true, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, true, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(message, 409, true, 'CONFLICT_ERROR');
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed') {
    super(message, 500, true, 'DATABASE_ERROR');
  }
}

// Enhanced global error handler
export const errorHandler = (error: any, req: Request, res: Response, next: NextFunction): void => {
  // Default error properties
  let statusCode = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';

  // Handle known error types
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code || 'APP_ERROR';
  } else if (error.code === '23505') {
    // PostgreSQL unique constraint violation
    statusCode = 409;
    message = 'Resource already exists';
    code = 'DUPLICATE_ERROR';
  } else if (error.code === '23503') {
    // PostgreSQL foreign key constraint violation
    statusCode = 400;
    message = 'Referenced resource does not exist';
    code = 'REFERENCE_ERROR';
  } else if (error.name === 'ValidationError') {
    // Joi validation error
    statusCode = 400;
    message = 'Validation failed';
    code = 'VALIDATION_ERROR';
  }

  // Log error details (but not sensitive information)
  const errorLog = {
    message: error.message,
    stack: error.stack,
    statusCode,
    code,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
  };

  if (statusCode >= 500) {
    logger.error('Server error occurred:', errorLog);
  } else {
    logger.warn('Client error occurred:', errorLog);
  }

  // Don't expose sensitive information in production
  const response: any = {
    success: false,
    message,
    code,
  };

  // Add stack trace only in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = error.stack;
    response.details = error.details;
  }

  res.status(statusCode).json(response);
};

// Fixed async error wrapper
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void | any>) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Transform database errors into more user-friendly messages
      if (error.code === 'ECONNREFUSED') {
        next(new DatabaseError('Database connection failed'));
      } else if (error.code === '28P01') {
        next(new DatabaseError('Database authentication failed'));
      } else {
        next(error);
      }
    });
  };
};
// 404 handler
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path} not found`);
  next(error);
};
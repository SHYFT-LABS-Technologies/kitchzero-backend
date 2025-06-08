import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from '../config';
import logger from '../utils/logger';

// Rate limiting configuration
export const createRateLimit = (windowMs: number, max: number, message: string) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.security('Rate limit exceeded', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
      });
      
      res.status(429).json({
        success: false,
        message,
      });
    },
  });
};

// General rate limiting
export const generalRateLimit = createRateLimit(
  config.rateLimit.windowMs,
  config.rateLimit.maxRequests,
  'Too many requests from this IP, please try again later'
);

// Login rate limiting
export const loginRateLimit = createRateLimit(
  config.rateLimit.loginWindowMs,
  config.rateLimit.maxLoginAttempts,
  'Too many login attempts from this IP, please try again later'
);

// Helmet security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  // Basic sanitization - you can extend this
  if (req.body && typeof req.body === 'object') {
    for (const key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
      }
    }
  }
  next();
};

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: (req as any).user?.id,
    };

    if (res.statusCode >= 400) {
      logger.warn('HTTP request completed with error', logData);
    } else {
      logger.info('HTTP request completed', logData);
    }
  });

  next();
};

// Security event middleware
export const securityEventLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Log suspicious patterns
  const suspiciousPatterns = [
    /\.\./,  // Directory traversal
    /<script/i,  // XSS attempts
    /union.*select/i,  // SQL injection
    /eval\(/i,  // Code injection
  ];

  const requestData = JSON.stringify({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData) || pattern.test(req.url)) {
      logger.security('Suspicious request pattern detected', {
        pattern: pattern.source,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        path: req.path,
        method: req.method,
        data: requestData,
      });
      break;
    }
  }

  next();
};
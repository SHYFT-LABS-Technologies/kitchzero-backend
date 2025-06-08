import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import { config } from '../config';
import logger from './logger';

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
  tenantId?: string;
  branchId?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

export class JWTUtils {
  // Generate access token (15 minutes)
  static generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>): string {
    const options: SignOptions = {
      expiresIn: '15m', // Hardcoded for TypeScript compatibility
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithm: 'HS256',
    };

    return jwt.sign(payload, config.jwt.accessSecret, options);
  }

  // Generate refresh token (7 days)
  static generateRefreshToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>): string {
    const options: SignOptions = {
      expiresIn: '7d', // Hardcoded for TypeScript compatibility
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithm: 'HS256',
    };

    return jwt.sign(payload, config.jwt.refreshSecret, options);
  }

  // Verify access token
  static verifyAccessToken(token: string): JWTPayload {
    try {
      const options: VerifyOptions = {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithms: ['HS256'],
      };

      return jwt.verify(token, config.jwt.accessSecret, options) as JWTPayload;
    } catch (error: any) {
      logger.security('Invalid access token', { error: error.message });
      throw new Error('Invalid access token');
    }
  }

  // Verify refresh token
  static verifyRefreshToken(token: string): JWTPayload {
    try {
      const options: VerifyOptions = {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithms: ['HS256'],
      };

      return jwt.verify(token, config.jwt.refreshSecret, options) as JWTPayload;
    } catch (error: any) {
      logger.security('Invalid refresh token', { error: error.message });
      throw new Error('Invalid refresh token');
    }
  }

  // Generate cryptographically secure random token
  static generateSecureToken(length: number = 32): string {
    const crypto = require('crypto');
    return crypto.randomBytes(length).toString('hex');
  }

  // Validate password strength
  static validatePasswordStrength(password: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (password.length < 12) {
      errors.push('Password must be at least 12 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Hash sensitive data for logging (one-way)
  static hashForLogging(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 8);
  }

  // Generate CSRF token
  static generateCSRFToken(): string {
    return this.generateSecureToken(32);
  }
}
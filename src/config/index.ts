import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: path.join(__dirname, '../../', envFile) });

interface Config {
  environment: string;
  server: {
    port: number;
    host: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    username: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
    issuer: string;
    audience: string;
  };
  security: {
    bcryptRounds: number;
    maxLoginAttempts: number;
    lockoutTime: number; // in minutes
    sessionSecret: string;
    csrfSecret: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
    maxLoginAttempts: number;
    loginWindowMs: number;
  };
  logging: {
    level: string;
    directory: string;
  };
}

const validateConfig = (): void => {
  const required = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'SESSION_SECRET',
    'CSRF_SECRET',
    'DB_NAME',
    'DB_USERNAME',
    'DB_PASSWORD'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    // In test environment, provide more helpful error message
    if (process.env.NODE_ENV === 'test') {
      console.error('❌ Missing test environment variables:', missing.join(', '));
      console.error('💡 Make sure .env.test file exists with all required variables');
    }
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate JWT secrets strength (warn only in test)
  if ((process.env.JWT_ACCESS_SECRET || '').length < 32) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Warning: JWT_ACCESS_SECRET should be at least 32 characters long for security');
    }
  }
  if ((process.env.JWT_REFRESH_SECRET || '').length < 32) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Warning: JWT_REFRESH_SECRET should be at least 32 characters long for security');
    }
  }
};

// Helper function to parse expiration time
const parseExpiresIn = (value: string | undefined, defaultValue: string): string | number => {
  if (!value) return defaultValue;
  
  // If it's a number string, return as number (seconds)
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  
  // Otherwise return as string (e.g., "15m", "7d")
  return value;
};

validateConfig();

export const config: Config = {
  environment: process.env.NODE_ENV || 'development',
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || 'localhost',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'kitchzero_dev',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'dev_password',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'fallback-access-secret-not-secure-please-change',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret-not-secure-please-change',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'kitchzero-api',
    audience: process.env.JWT_AUDIENCE || 'kitchzero-client',
  },
  security: {
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    lockoutTime: parseInt(process.env.LOCKOUT_TIME || '30', 10),
    sessionSecret: process.env.SESSION_SECRET || 'fallback-session-secret-not-secure',
    csrfSecret: process.env.CSRF_SECRET || 'fallback-csrf-secret-not-secure',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    maxLoginAttempts: parseInt(process.env.RATE_LIMIT_LOGIN_ATTEMPTS || '20', 10),
    loginWindowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || '3600000', 10), // 1 hour
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    directory: process.env.LOG_DIR || 'logs',
  },
};
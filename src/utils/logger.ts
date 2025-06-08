import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';
import path from 'path';

interface LogMeta {
  [key: string]: any;
}

class Logger {
  private winston: winston.Logger;

  constructor() {
    // Create logs directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync(config.logging.directory)) {
      fs.mkdirSync(config.logging.directory, { recursive: true });
    }

    this.winston = winston.createLogger({
      level: config.logging.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: {
        service: 'kitchzero-api',
        environment: config.environment,
      },
      transports: [
        // Console transport for development
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
              return `${timestamp} [${level}]: ${message} ${metaStr}`;
            })
          ),
        }),

        // File transport for all logs
        new DailyRotateFile({
          filename: path.join(config.logging.directory, 'application-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: winston.format.json(),
        }),

        // Error logs separate file
        new DailyRotateFile({
          filename: path.join(config.logging.directory, 'error-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '30d',
          format: winston.format.json(),
        }),

        // Security logs separate file
        new DailyRotateFile({
          filename: path.join(config.logging.directory, 'security-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          level: 'warn',
          maxSize: '20m',
          maxFiles: '30d',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
            winston.format.printf((info) => {
              if (info.type === 'security') {
                return JSON.stringify(info);
              }
              return '';
            })
          ),
        }),
      ],
    });

    // Handle uncaught exceptions
    this.winston.exceptions.handle(
      new winston.transports.File({
        filename: path.join(config.logging.directory, 'exceptions.log'),
      })
    );

    // Handle unhandled promise rejections
    this.winston.rejections.handle(
      new winston.transports.File({
        filename: path.join(config.logging.directory, 'rejections.log'),
      })
    );
  }

  info(message: string, meta?: LogMeta): void {
    this.winston.info(message, meta);
  }

  // Fix: Accept any type and convert to LogMeta
  error(message: string, meta?: any): void {
    const logMeta: LogMeta = this.formatMeta(meta);
    this.winston.error(message, logMeta);
  }

  warn(message: string, meta?: any): void {
    const logMeta: LogMeta = this.formatMeta(meta);
    this.winston.warn(message, logMeta);
  }

  debug(message: string, meta?: LogMeta): void {
    this.winston.debug(message, meta);
  }

  // Helper method to safely convert any type to LogMeta
  private formatMeta(meta: any): LogMeta {
    if (!meta) return {};
    
    if (meta instanceof Error) {
      return {
        name: meta.name,
        message: meta.message,
        stack: meta.stack,
      };
    }
    
    if (typeof meta === 'object' && meta !== null) {
      try {
        return JSON.parse(JSON.stringify(meta));
      } catch {
        return { value: String(meta) };
      }
    }
    
    return { value: String(meta) };
  }

  // Security-specific logging method
  security(message: string, meta: LogMeta = {}): void {
    this.winston.warn(message, {
      ...meta,
      type: 'security',
      severity: 'high',
      timestamp: new Date().toISOString(),
    });
  }

  // Audit logging method
  audit(action: string, userId: string, details: LogMeta = {}): void {
    this.winston.info(`AUDIT: ${action}`, {
      action,
      userId,
      ...details,
      type: 'audit',
      timestamp: new Date().toISOString(),
    });
  }

  // Performance logging
  performance(operation: string, duration: number, meta: LogMeta = {}): void {
    this.winston.info(`PERFORMANCE: ${operation}`, {
      operation,
      duration,
      ...meta,
      type: 'performance',
    });
  }

  // HTTP request logging
  http(req: any, res: any, duration: number): void {
    const logData: LogMeta = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id,
      type: 'http',
    };

    if (res.statusCode >= 500) {
      this.error('HTTP request failed', logData);
    } else if (res.statusCode >= 400) {
      this.warn('HTTP request error', logData);
    } else {
      this.info('HTTP request completed', logData);
    }
  }
}

export default new Logger();
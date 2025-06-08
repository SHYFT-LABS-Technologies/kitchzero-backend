import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config';
import path from 'path';

class Logger {
  info(message: string, meta?: any): void {
    console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  error(message: string, meta?: any): void {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  warn(message: string, meta?: any): void {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  debug(message: string, meta?: any): void {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }

  // Security-specific logging method
  security(message: string, meta: any = {}): void {
    console.log(`[SECURITY] ${message}`, JSON.stringify(meta));
  }

  // Audit logging method
  audit(action: string, userId: string, details: any = {}): void {
    console.log(`[AUDIT] ${action} by ${userId}`, JSON.stringify(details));
  }
}

export default new Logger();
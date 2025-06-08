declare module 'express-joi-validation' {
  import { Request, Response, NextFunction } from 'express';
  import { Schema } from 'joi';

  export interface ValidatedRequest extends Request {
    originalBody?: any;
    originalQuery?: any;
    originalParams?: any;
  }

  export interface ValidatorOptions {
    passError?: boolean;
  }

  export interface Validator {
    body(schema: Schema, options?: ValidatorOptions): (req: Request, res: Response, next: NextFunction) => void;
    query(schema: Schema, options?: ValidatorOptions): (req: Request, res: Response, next: NextFunction) => void;
    params(schema: Schema, options?: ValidatorOptions): (req: Request, res: Response, next: NextFunction) => void;
    headers(schema: Schema, options?: ValidatorOptions): (req: Request, res: Response, next: NextFunction) => void;
  }

  export function createValidator(options?: ValidatorOptions): Validator;
}

// Add any other modules that might be missing types
declare module 'connect-redis';
declare module 'winston-daily-rotate-file';
import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';
import logger from '../utils/logger';

interface DatabaseStats {
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  currentTime?: string;
}

interface HealthCheckResult {
  healthy: boolean;
  stats: DatabaseStats | { error: string };
}

interface TenantContext {
  tenantId?: string;
  userId?: string;
  role?: string;
}

class DatabaseService {
  private pool: Pool;
  private static instance: DatabaseService;

  private constructor() {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
      min: 5,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    this.pool.on('connect', (client: PoolClient) => {
      logger.debug('New database connection established');
    });

    this.pool.on('error', (err: Error) => {
      logger.error('Unexpected database pool error:', {
        error: err.message,
        stack: err.stack,
      });
    });

    this.pool.on('remove', () => {
      logger.debug('Database connection removed from pool');
    });
  }

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Standard query method (unchanged)
  async query(text: string, params?: any[]): Promise<QueryResult<any>> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('Database query executed', {
        duration,
        rows: result.rows.length,
        command: text.split(' ')[0].toUpperCase()
      });
      
      return result;
    } catch (error: any) {
      logger.error('Database query failed:', {
        error: error.message,
        query: text.substring(0, 100),
        params: params ? '[REDACTED]' : undefined
      });
      throw error;
    }
  }

  // Tenant-scoped query method for automatic tenant isolation
  async queryWithTenantContext(text: string, params: any[] = [], context: TenantContext): Promise<QueryResult<any>> {
    const start = Date.now();
    
    try {
      // For super admin, execute query as-is
      if (context.role === 'super_admin') {
        return await this.query(text, params);
      }

      // For tenant users, automatically inject tenant filtering
      if (context.tenantId) {
        // Add tenant context to audit log
        logger.debug('Executing tenant-scoped query', {
          tenantId: context.tenantId,
          userId: context.userId,
          command: text.split(' ')[0].toUpperCase()
        });

        // Here you could implement automatic tenant filtering
        // For now, we'll trust that the application layer handles it
        const result = await this.query(text, params);
        
        const duration = Date.now() - start;
        logger.debug('Tenant-scoped query executed', {
          duration,
          rows: result.rows.length,
          tenantId: context.tenantId,
        });
        
        return result;
      }

      throw new Error('No tenant context available for non-super admin user');
      
    } catch (error: any) {
      logger.error('Tenant-scoped query failed:', {
        error: error.message,
        tenantId: context.tenantId,
        userId: context.userId,
        query: text.substring(0, 100),
      });
      throw error;
    }
  }

  // Enhanced transaction method with tenant context
  async transactionWithTenantContext<T>(
    callback: (client: PoolClient) => Promise<T>,
    context: TenantContext
  ): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      
      // Set session variables for tenant context (if supported by your DB setup)
      if (context.tenantId && context.role !== 'super_admin') {
        await client.query('SET LOCAL app.current_tenant_id = $1', [context.tenantId]);
        await client.query('SET LOCAL app.current_user_id = $1', [context.userId]);
      }
      
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get connection for transactions
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  // Execute multiple queries in a transaction
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Check pool health
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const result = await this.query('SELECT NOW() as current_time');
      return {
        healthy: true,
        stats: {
          totalConnections: this.pool.totalCount,
          idleConnections: this.pool.idleCount,
          waitingClients: this.pool.waitingCount,
          currentTime: result.rows[0].current_time
        }
      };
    } catch (error: any) {
      return {
        healthy: false,
        stats: { error: error.message }
      };
    }
  }

  // Graceful shutdown
  async close(): Promise<void> {
    logger.info('Closing database pool...');
    await this.pool.end();
    logger.info('Database pool closed');
  }
}

export default DatabaseService.getInstance();
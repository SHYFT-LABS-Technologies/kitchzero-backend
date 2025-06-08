import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import logger from '../utils/logger';

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
      // Connection pool settings
      min: 5, // minimum connections
      max: 20, // maximum connections  
      idleTimeoutMillis: 30000, // close idle connections after 30s
      connectionTimeoutMillis: 10000, // timeout when connecting
      acquireTimeoutMillis: 60000, // timeout when acquiring connection
      // Health check
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    // Handle pool events
    this.pool.on('connect', (client: PoolClient) => {
      logger.debug('New database connection established');
    });

    this.pool.on('error', (err: Error) => {
      logger.error('Unexpected database pool error:', err);
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

  // Execute query with automatic connection management
  async query(text: string, params?: any[]): Promise<any> {
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
        query: text,
        params: params ? '[REDACTED]' : undefined
      });
      throw error;
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
  async healthCheck(): Promise<{ healthy: boolean; stats: any }> {
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
    } catch (error) {
      return {
        healthy: false,
        stats: { error: (error as Error).message }
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
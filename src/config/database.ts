import { Sequelize } from 'sequelize';
import { config } from './index';
import logger from '../utils/logger';

class Database {
  public sequelize: Sequelize;

  constructor() {
    this.sequelize = new Sequelize(
      config.database.name,
      config.database.username,
      config.database.password,
      {
        host: config.database.host,
        port: config.database.port,
        dialect: 'postgres',
        logging: (msg) => logger.debug(msg),
        pool: {
          max: 20,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
        dialectOptions: {
          ssl: config.environment === 'production' ? {
            require: true,
            rejectUnauthorized: false
          } : false,
        },
        define: {
          timestamps: true,
          underscored: true,
          paranoid: true, // Enables soft deletes
        },
      }
    );
  }

  async connect(): Promise<void> {
    try {
      await this.sequelize.authenticate();
      logger.info('Database connection established successfully');
    } catch (error) {
      logger.error('Unable to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.sequelize.close();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error closing database connection:', error);
      throw error;
    }
  }

  async sync(force = false): Promise<void> {
    try {
      await this.sequelize.sync({ force });
      logger.info('Database synchronized');
    } catch (error) {
      logger.error('Database sync failed:', error);
      throw error;
    }
  }
}

export default new Database();
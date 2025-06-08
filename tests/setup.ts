// Global test setup (runs after env-setup.ts)
import { config } from '../src/config';

// Verify environment is properly set
console.log('🔧 Test configuration:', {
  environment: config.environment,
  database: config.database.name,
  logLevel: config.logging.level,
});

// Increase timeout for slow operations
jest.setTimeout(30000);

// Global test setup
beforeAll(() => {
  console.log('🧪 Starting test suite...');
});

afterAll(() => {
  console.log('✅ Test suite completed');
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
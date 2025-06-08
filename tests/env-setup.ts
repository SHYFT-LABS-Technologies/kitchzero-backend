import dotenv from 'dotenv';
import path from 'path';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../.env.test') });

// Ensure critical environment variables are set
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

// Set required variables if not already set
if (!process.env.JWT_ACCESS_SECRET) {
  process.env.JWT_ACCESS_SECRET = 'test-super-secure-access-secret-minimum-32-characters-long-abcdef123456789';
}

if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-super-secure-refresh-secret-minimum-32-characters-long-xyz987654321';
}

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-super-secure-session-secret-minimum-32-characters-long-session123456';
}

if (!process.env.CSRF_SECRET) {
  process.env.CSRF_SECRET = 'test-super-secure-csrf-secret-minimum-32-characters-long-csrf654321';
}

if (!process.env.DB_USERNAME) {
  process.env.DB_USERNAME = 'postgres';
}

if (!process.env.DB_PASSWORD) {
  process.env.DB_PASSWORD = 'MySecurePassword123!';
}

if (!process.env.DB_NAME) {
  process.env.DB_NAME = 'kitchzero_test';
}

console.log('🧪 Test environment configured');
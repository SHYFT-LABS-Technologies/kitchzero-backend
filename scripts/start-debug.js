console.log('🔍 Starting debug process...');

// Load environment variables first
require('dotenv').config();

// Check Node.js version
console.log('Node.js version:', process.version);

// Check environment
console.log('Environment variables check:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- DB_HOST:', process.env.DB_HOST);
console.log('- DB_PORT:', process.env.DB_PORT);
console.log('- DB_NAME:', process.env.DB_NAME);
console.log('- DB_USERNAME:', process.env.DB_USERNAME);
console.log('- DB_PASSWORD:', process.env.DB_PASSWORD ? '***SET***' : 'NOT SET');
console.log('- JWT_ACCESS_SECRET:', process.env.JWT_ACCESS_SECRET ? '***SET***' : 'NOT SET');
console.log('- JWT_REFRESH_SECRET:', process.env.JWT_REFRESH_SECRET ? '***SET***' : 'NOT SET');

// Try to load dependencies
console.log('\n📦 Checking dependencies...');

try {
  require('dotenv');
  console.log('✅ dotenv loaded');
} catch (e) {
  console.log('❌ dotenv failed:', e.message);
}

try {
  require('express');
  console.log('✅ express loaded');
} catch (e) {
  console.log('❌ express failed:', e.message);
}

try {
  require('pg');
  console.log('✅ pg loaded');
} catch (e) {
  console.log('❌ pg failed:', e.message);
}

try {
  require('typescript');
  console.log('✅ typescript loaded');
} catch (e) {
  console.log('❌ typescript failed:', e.message);
}

try {
  require('ts-node');
  console.log('✅ ts-node loaded');
} catch (e) {
  console.log('❌ ts-node failed:', e.message);
}

console.log('\n🚀 Starting actual server...');

try {
  require('ts-node/register');
  require('../src/server.ts');
} catch (error) {
  console.error('❌ Server failed to start:', error.message);
  if (error.stack) {
    console.error('Full error:', error);
  }
}
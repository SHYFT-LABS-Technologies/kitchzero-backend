const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Running build verification...');

try {
  // Clean previous builds
  console.log('🧹 Cleaning previous builds...');
  try {
    execSync('npm run clean', { stdio: 'inherit' });
  } catch (e) {
    console.log('Clean command not available, continuing...');
  }

  // Type check source code
  console.log('🔍 Type checking source code...');
  execSync('npm run type-check', { stdio: 'inherit' });

  // Type check tests
  console.log('🔍 Type checking tests...');
  execSync('npm run type-check:test', { stdio: 'inherit' });

  // Build production code
  console.log('🏗️ Building production code...');
  execSync('npm run build', { stdio: 'inherit' });

  // Verify build output
  const distPath = path.join(__dirname, '../dist');
  if (!fs.existsSync(distPath)) {
    throw new Error('Build failed: dist directory not created');
  }

  const serverPath = path.join(distPath, 'server.js');
  if (!fs.existsSync(serverPath)) {
    throw new Error('Build failed: server.js not found in dist');
  }

  console.log('✅ Build verification passed');

  // Run tests
  console.log('🧪 Running tests...');
  execSync('npm test', { stdio: 'inherit' });

  console.log('🎉 All checks passed!');

} catch (error) {
  console.error('❌ Build verification failed:', error.message);
  process.exit(1);
}
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Client } = pg;
const hash = await bcrypt.hash('TempPass2024!', 12);

// Determine the appropriate host based on environment
const determineHost = () => {
  console.log('🔍 Determining Host - NODE_ENV:', process.env.NODE_ENV);
  if (process.env.NODE_ENV === 'docker') {
    // Use the service name from docker-compose
    const host = process.env.DB_HOST_DOCKER || 'postgres';
    console.log(`   Using Docker host: ${host}`);
    return host;
  }
  return process.env.DB_HOST || 'localhost';
};

// Read from environment variables with fallbacks
const dbConfig = {
  host: determineHost(),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'DeeMishu997#',
  database: process.env.DB_NAME || 'kitchzero_dev',
};

console.log('🔧 Database configuration:');
console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
console.log(`   Username: ${dbConfig.user}`);
console.log(`   Target Database: ${dbConfig.database}`);
console.log(`   Password: ${'*'.repeat(dbConfig.password.length)}`);

// Add connection test function
async function testConnection() {
  console.log('🔍 Testing database connection...');
  
  const testClient = new Client({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: 'postgres',
    connectTimeoutMillis: 10000,
  });

  try {
    await testClient.connect();
    console.log('✅ Database connection successful');
    const result = await testClient.query('SELECT NOW() as current_time, version() as postgres_version');
    console.log(`   PostgreSQL Version: ${result.rows[0].postgres_version.split(' ')[0]}`);
    await testClient.end();
    return true;
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    return false;
  }
}

async function setupDatabase() {
  // First, connect to the default 'postgres' database to create our database
  const adminClient = new Client({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: 'postgres',
  });

  try {
    console.log('🔌 Connecting to PostgreSQL...');
    await adminClient.connect();
    
    // Create database if it doesn't exist
    try {
      await adminClient.query(`CREATE DATABASE ${dbConfig.database}`);
      console.log(`✅ Database '${dbConfig.database}' created successfully`);
    } catch (error) {
      if (error.code === '42P04') {
        console.log(`ℹ️  Database '${dbConfig.database}' already exists`);
      } else {
        throw error;
      }
    }
    
    await adminClient.end();
    
    // Now connect to our target database
    const dbClient = new Client({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
    });
    
    console.log(`🔌 Connecting to database '${dbConfig.database}'...`);
    await dbClient.connect();
    
    console.log('📦 Setting up database schema...');
    
    // Create UUID extension
    await dbClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('   ✓ UUID extension enabled');
    
    // Create tenants table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('restaurant', 'hotel')),
        settings JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        subscription_status VARCHAR(20) DEFAULT 'trial' CHECK (subscription_status IN ('trial', 'active', 'suspended', 'cancelled')),
        subscription_end_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);
    console.log('   ✓ Tenants table created');
    
    // Create branches table BEFORE users table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        zip_code VARCHAR(20) NOT NULL,
        country VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(255),
        settings JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);
    console.log('   ✓ Branches table created');
    
    // Create users table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'tenant_admin', 'branch_admin')),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT TRUE,
        is_email_verified BOOLEAN DEFAULT FALSE,
        must_change_password BOOLEAN DEFAULT TRUE,
        last_login_at TIMESTAMP,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);
    console.log('   ✓ Users table created');
    
    // Create refresh_tokens table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        is_revoked BOOLEAN DEFAULT FALSE,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Refresh tokens table created');
    
    // Create audit_logs table
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        resource_type VARCHAR(100) NOT NULL,
        resource_id UUID,
        before_values JSONB,
        after_values JSONB,
        ip_address INET NOT NULL,
        user_agent TEXT NOT NULL,
        session_id VARCHAR(255),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Audit logs table created');
    
    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_branch_id ON users(branch_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
      'CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_branches_tenant_id ON branches(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)',
    ];
    
    for (const indexQuery of indexes) {
      await dbClient.query(indexQuery);
    }
    console.log('   ✓ Database indexes created');
    
    console.log('👤 Creating default super admin user...');
    
    // Create super admin user (password: TempPass2024!)
    const result = await dbClient.query(`
      INSERT INTO users (username, password, role, is_active, must_change_password)
      VALUES ('superadmin', $1, 'super_admin', true, true)
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username
    `, [hash]);
    
    if (result.rows.length > 0) {
      console.log(`   ✅ Super admin user created: ${result.rows[0].username}`);
    } else {
      console.log(`   ℹ️  Super admin user already exists`);
    }
    
    // Verify table creation
    const tableCheck = await dbClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📊 Tables created:');
    tableCheck.rows.forEach(row => {
      console.log(`   ✓ ${row.table_name}`);
    });
    
    // Count records
    const userCount = await dbClient.query('SELECT COUNT(*) as count FROM users');
    console.log(`\n👥 Users in database: ${userCount.rows[0].count}`);
    
    await dbClient.end();
    
    console.log('\n🎉 Database setup completed successfully!');
    console.log('\n🔑 Super Admin Credentials:');
    console.log('   Username: superadmin');
    console.log('   Password: TempPass2024!');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 PostgreSQL is not running. Try: docker-compose up -d postgres');
    }
    process.exit(1);
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting database setup...\n');
  
  const canConnect = await testConnection();
  if (!canConnect) {
    console.error('\n💡 Make sure PostgreSQL is running: docker-compose up -d postgres');
    process.exit(1);
  }
  
  await setupDatabase();
}

main();
require('dotenv').config();
const { Client } = require('pg');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'DeeMishu997#',
  database: process.env.DB_NAME || 'kitchzero_dev',
};

async function checkDatabaseStatus() {
  console.log('🔍 Database Configuration:');
  console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
  console.log(`   Database: ${dbConfig.database}`);
  console.log(`   Username: ${dbConfig.user}`);
  console.log(`   Password: ${dbConfig.password ? '***SET***' : 'NOT SET'}`);

  const client = new Client(dbConfig);

  try {
    console.log('\n🔍 Checking database connection...');
    await client.connect();
    
    // Check tables
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('\n📊 Found tables:');
    if (result.rows.length === 0) {
      console.log('   ❌ No tables found! Run: npm run db:setup');
    } else {
      result.rows.forEach(row => {
        console.log(`   ✓ ${row.table_name}`);
      });
    }

    // Check if we have basic tables
    const basicTables = ['users', 'tenants', 'branches', 'refresh_tokens'];
    console.log('\n🔍 Basic Tables Status:');
    for (const table of basicTables) {
      const exists = result.rows.some(row => row.table_name === table);
      console.log(`   ${exists ? '✓' : '❌'} ${table}`);
    }

    // Check if we have waste management tables
    const wasteManagementTables = [
      'categories', 'units', 'suppliers', 'products', 
      'inventory_purchases', 'inventory_purchase_items', 
      'inventory_stock', 'waste_categories', 'waste_records'
    ];

    console.log('\n🔍 Waste Management Tables Status:');
    for (const table of wasteManagementTables) {
      const exists = result.rows.some(row => row.table_name === table);
      console.log(`   ${exists ? '✓' : '❌'} ${table}`);
    }

    // Check user count
    try {
      const userResult = await client.query('SELECT COUNT(*) as count FROM users');
      console.log(`\n👥 Users in database: ${userResult.rows[0].count}`);
    } catch (e) {
      console.log('\n👥 Cannot query users table - might need to run db:setup');
    }

    await client.end();
    console.log('\n✅ Database check completed');
    
  } catch (error) {
    console.error('\n❌ Database connection failed:', error.message);
    console.error('\n💡 Troubleshooting steps:');
    console.error('   1. Make sure PostgreSQL is running: docker-compose up -d postgres');
    console.error('   2. Check your .env file configuration');
    console.error('   3. Run database setup: npm run db:setup');
  }
}

checkDatabaseStatus();
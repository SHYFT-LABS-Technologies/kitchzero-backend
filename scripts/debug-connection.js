require('dotenv').config();
const { Client } = require('pg');

async function debugConnection() {
  console.log('🔍 Environment Variables:');
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   DB_HOST: ${process.env.DB_HOST}`);
  console.log(`   DB_PORT: ${process.env.DB_PORT}`);
  console.log(`   DB_USERNAME: ${process.env.DB_USERNAME}`);
  console.log(`   DB_PASSWORD: ${process.env.DB_PASSWORD}`);
  console.log(`   DB_NAME: ${process.env.DB_NAME}`);

  // Test connection to localhost (where script connects)
  const localClient = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'DeeMishu997#',
    database: 'kitchzero_dev',
  });

  try {
    console.log('\n🔍 Testing connection to localhost:5432...');
    await localClient.connect();
    
    // Check if tables exist here
    const result = await localClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('📊 Tables found on localhost:');
    if (result.rows.length === 0) {
      console.log('   ❌ No tables found!');
    } else {
      result.rows.forEach(row => {
        console.log(`   ✓ ${row.table_name}`);
      });
    }
    
    // Check users
    try {
      const userResult = await localClient.query('SELECT COUNT(*) as count FROM users');
      console.log(`👥 Users count: ${userResult.rows[0].count}`);
    } catch (error) {
      console.log(`❌ Cannot query users table: ${error.message}`);
    }
    
    await localClient.end();
    
  } catch (error) {
    console.error('❌ Connection to localhost failed:', error.message);
  }

  // Test connection to Docker container (where you're checking)
  console.log('\n🔍 Testing connection via Docker exec...');
  console.log('   (This simulates what you see when you run docker exec)');
}

debugConnection();
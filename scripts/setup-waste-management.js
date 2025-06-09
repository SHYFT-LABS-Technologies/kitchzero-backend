import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

const determineHost = () => {
  if (process.env.NODE_ENV === 'docker') {
    return process.env.DB_HOST_DOCKER || 'postgres';
  }
  return process.env.DB_HOST || 'localhost';
};

const dbConfig = {
  host: determineHost(),
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'DeeMishu997#',
  database: process.env.DB_NAME || 'kitchzero_dev',
};

async function setupWasteManagement() {
  const client = new Client(dbConfig);

  try {
    console.log('🚀 Setting up waste management tables...');
    await client.connect();

    // 1. System settings table for currency and other configs
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key VARCHAR(100) UNIQUE NOT NULL,
        value JSONB NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Categories for ingredients/products
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP,
        UNIQUE(tenant_id, name)
      )
    `);

    // 3. Units of measurement
    await client.query(`
      CREATE TABLE IF NOT EXISTS units (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(50) NOT NULL UNIQUE,
        symbol VARCHAR(10) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('weight', 'volume', 'count', 'portion')),
        base_unit VARCHAR(50),
        conversion_factor DECIMAL(15,6) DEFAULT 1.0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 4. Suppliers
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        address TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `);

    // 5. Products/Ingredients master
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        category_id UUID REFERENCES categories(id),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        unit_id UUID REFERENCES units(id) NOT NULL,
        perishable BOOLEAN DEFAULT TRUE,
        shelf_life_days INTEGER,
        minimum_stock DECIMAL(15,3) DEFAULT 0,
        average_cost_per_unit DECIMAL(15,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP,
        UNIQUE(tenant_id, name)
      )
    `);

    // 6. Inventory purchases
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_purchases (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        supplier_id UUID REFERENCES suppliers(id),
        purchase_date DATE NOT NULL,
        invoice_number VARCHAR(100),
        total_amount DECIMAL(15,2),
        currency VARCHAR(3) DEFAULT 'LKR',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 7. Inventory purchase items
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_purchase_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        purchase_id UUID REFERENCES inventory_purchases(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        quantity DECIMAL(15,3) NOT NULL,
        unit_cost DECIMAL(15,2) NOT NULL,
        total_cost DECIMAL(15,2) NOT NULL,
        expiry_date DATE,
        batch_number VARCHAR(100),
        received_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 8. Current inventory stock
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_stock (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        purchase_item_id UUID REFERENCES inventory_purchase_items(id),
        current_quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
        reserved_quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
        batch_number VARCHAR(100),
        expiry_date DATE,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch_id, product_id, purchase_item_id)
      )
    `);

    // 9. Waste categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS waste_categories (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        color VARCHAR(7) DEFAULT '#FF6B6B',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, name)
      )
    `);

    // 10. Waste records
    await client.query(`
      CREATE TABLE IF NOT EXISTS waste_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products(id) ON DELETE CASCADE,
        waste_category_id UUID REFERENCES waste_categories(id),
        stock_id UUID REFERENCES inventory_stock(id),
        waste_date DATE NOT NULL,
        quantity DECIMAL(15,3) NOT NULL,
        cost_per_unit DECIMAL(15,2),
        total_cost DECIMAL(15,2),
        reason TEXT,
        waste_stage VARCHAR(50) CHECK (waste_stage IN ('raw', 'preparation', 'cooking', 'serving', 'expired')),
        recorded_by UUID REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert ONLY essential default units (no product-specific data)
    const defaultUnits = [
      ['Kilogram', 'kg', 'weight', null, 1.0],
      ['Gram', 'g', 'weight', 'kg', 0.001],
      ['Liter', 'L', 'volume', null, 1.0],
      ['Milliliter', 'ml', 'volume', 'L', 0.001],
      ['Piece', 'pcs', 'count', null, 1.0],
      ['Portion', 'portion', 'portion', null, 1.0],
      ['Dozen', 'dozen', 'count', 'pcs', 12.0],
      ['Bottle', 'bottle', 'count', null, 1.0],
      ['Pack', 'pack', 'count', null, 1.0],
      ['Bag', 'bag', 'count', null, 1.0]
    ];

    for (const [name, symbol, type, baseUnit, factor] of defaultUnits) {
      await client.query(`
        INSERT INTO units (name, symbol, type, base_unit, conversion_factor)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name) DO NOTHING
      `, [name, symbol, type, baseUnit, factor]);
    }

    // Insert only basic system settings (no pre-loaded business data)
    await client.query(`
      INSERT INTO system_settings (key, value, description)
      VALUES 
        ('default_currency', '"LKR"', 'Default currency for the system'),
        ('supported_currencies', '["LKR", "USD", "EUR"]', 'List of supported currencies'),
        ('waste_alert_threshold', '5.0', 'Percentage threshold for waste alerts'),
        ('inventory_low_stock_threshold', '10.0', 'Percentage threshold for low stock alerts'),
        ('fifo_enforcement', 'true', 'Enforce FIFO for inventory management')
      ON CONFLICT (key) DO NOTHING
    `);

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_inventory_stock_branch_product ON inventory_stock(branch_id, product_id)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_stock_expiry ON inventory_stock(expiry_date) WHERE expiry_date IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS idx_waste_records_branch_date ON waste_records(branch_id, waste_date)',
      'CREATE INDEX IF NOT EXISTS idx_waste_records_product ON waste_records(product_id)',
      'CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_inventory_purchases_branch ON inventory_purchases(branch_id)',
    ];

    for (const indexQuery of indexes) {
      await client.query(indexQuery);
    }

    console.log('✅ Waste management tables created successfully (no pre-loaded data)!');

    await client.end();
  } catch (error) {
    console.error('❌ Error setting up waste management:', error.message);
    process.exit(1);
  }
}

setupWasteManagement();
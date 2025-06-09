import db from './DatabaseService';
import logger from '../utils/logger';

export interface CreateProductData {
  tenantId: string;
  categoryId?: string;
  name: string;
  description?: string;
  unitId: string;
  perishable: boolean;
  shelfLifeDays?: number;
  minimumStock?: number;
  averageCostPerUnit?: number;
}

export interface CreateWasteRecordData {
  tenantId: string;
  branchId: string;
  productId: string;
  wasteCategoryId: string;
  stockId?: string;
  wasteDate: string;
  quantity: number;
  costPerUnit?: number;
  reason?: string;
  wasteStage: 'raw' | 'preparation' | 'cooking' | 'serving' | 'expired';
  notes?: string;
}

export interface InventoryPurchaseData {
  tenantId: string;
  branchId: string;
  supplierId?: string;
  purchaseDate: string;
  invoiceNumber?: string;
  items: {
    productId: string;
    quantity: number;
    unitCost: number;
    expiryDate?: string;
    batchNumber?: string;
  }[];
}

export class WasteManagementService {
  // Product Management
  static async createProduct(productData: CreateProductData, createdBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
        INSERT INTO products (tenant_id, category_id, name, description, unit_id, perishable, 
                            shelf_life_days, minimum_stock, average_cost_per_unit)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        productData.tenantId,
        productData.categoryId,
        productData.name,
        productData.description,
        productData.unitId,
        productData.perishable,
        productData.shelfLifeDays,
        productData.minimumStock || 0,
        productData.averageCostPerUnit || 0
      ]);

      const product = result.rows[0];

      logger.audit('product_created', createdBy, {
        productId: product.id,
        tenantId: product.tenant_id,
        name: product.name,
      });

      return product;
    });
  }

  // Inventory Purchase
  static async createInventoryPurchase(purchaseData: InventoryPurchaseData, createdBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      // Calculate total amount
      const totalAmount = purchaseData.items.reduce((sum, item) =>
        sum + (item.quantity * item.unitCost), 0);

      // Create purchase record
      const purchaseResult = await client.query(`
        INSERT INTO inventory_purchases (tenant_id, branch_id, supplier_id, purchase_date, 
                                       invoice_number, total_amount, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        purchaseData.tenantId,
        purchaseData.branchId,
        purchaseData.supplierId,
        purchaseData.purchaseDate,
        purchaseData.invoiceNumber,
        totalAmount,
        createdBy
      ]);

      const purchase = purchaseResult.rows[0];

      // Create purchase items and update stock
      for (const item of purchaseData.items) {
        const totalCost = item.quantity * item.unitCost;

        // Create purchase item
        const itemResult = await client.query(`
          INSERT INTO inventory_purchase_items (purchase_id, product_id, quantity, unit_cost, 
                                              total_cost, expiry_date, batch_number, received_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `, [
          purchase.id,
          item.productId,
          item.quantity,
          item.unitCost,
          totalCost,
          item.expiryDate,
          item.batchNumber,
          purchaseData.purchaseDate
        ]);

        const purchaseItem = itemResult.rows[0];

        // Update or create stock record
        await client.query(`
          INSERT INTO inventory_stock (tenant_id, branch_id, product_id, purchase_item_id, 
                                     current_quantity, batch_number, expiry_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (branch_id, product_id, purchase_item_id) 
          DO UPDATE SET 
            current_quantity = inventory_stock.current_quantity + $5,
            last_updated = NOW()
        `, [
          purchaseData.tenantId,
          purchaseData.branchId,
          item.productId,
          purchaseItem.id,
          item.quantity,
          item.batchNumber,
          item.expiryDate
        ]);

        // Update product average cost
        await client.query(`
          UPDATE products 
          SET average_cost_per_unit = (
            SELECT AVG(unit_cost) 
            FROM inventory_purchase_items ipi
            WHERE ipi.product_id = $1
          )
          WHERE id = $1
        `, [item.productId]);
      }

      logger.audit('inventory_purchase_created', createdBy, {
        purchaseId: purchase.id,
        branchId: purchase.branch_id,
        totalAmount: purchase.total_amount,
        itemsCount: purchaseData.items.length,
      });

      return purchase;
    });
  }

  // Waste Record
  static async createWasteRecord(wasteData: CreateWasteRecordData, recordedBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      // Get cost per unit if not provided
      let costPerUnit = wasteData.costPerUnit;
      if (!costPerUnit) {
        const productResult = await client.query(
          'SELECT average_cost_per_unit FROM products WHERE id = $1',
          [wasteData.productId]
        );
        costPerUnit = productResult.rows[0]?.average_cost_per_unit || 0;
      }

      const totalCost = wasteData.quantity * costPerUnit;

      // Create waste record
      const result = await client.query(`
        INSERT INTO waste_records (tenant_id, branch_id, product_id, waste_category_id, 
                                 stock_id, waste_date, quantity, cost_per_unit, total_cost, 
                                 reason, waste_stage, recorded_by, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `, [
        wasteData.tenantId,
        wasteData.branchId,
        wasteData.productId,
        wasteData.wasteCategoryId,
        wasteData.stockId,
        wasteData.wasteDate,
        wasteData.quantity,
        costPerUnit,
        totalCost,
        wasteData.reason,
        wasteData.wasteStage,
        recordedBy,
        wasteData.notes
      ]);

      const wasteRecord = result.rows[0];

      // Update stock if stock_id provided
      if (wasteData.stockId) {
        await client.query(`
          UPDATE inventory_stock 
          SET current_quantity = current_quantity - $1,
              last_updated = NOW()
          WHERE id = $2 AND current_quantity >= $1
        `, [wasteData.quantity, wasteData.stockId]);
      }

      logger.audit('waste_record_created', recordedBy, {
        wasteRecordId: wasteRecord.id,
        productId: wasteRecord.product_id,
        quantity: wasteRecord.quantity,
        totalCost: wasteRecord.total_cost,
        wasteStage: wasteRecord.waste_stage,
      });

      return wasteRecord;
    });
  }

  // Get waste analytics for a branch
  static async getWasteAnalytics(branchId: string, startDate: string, endDate: string): Promise<any> {
    const result = await db.query(`
      SELECT 
        p.name as product_name,
        wc.name as waste_category,
        wr.waste_stage,
        SUM(wr.quantity) as total_quantity,
        SUM(wr.total_cost) as total_cost,
        COUNT(*) as incident_count,
        AVG(wr.quantity) as avg_quantity_per_incident,
        u.symbol as unit_symbol
      FROM waste_records wr
      JOIN products p ON wr.product_id = p.id
      JOIN units u ON p.unit_id = u.id
      LEFT JOIN waste_categories wc ON wr.waste_category_id = wc.id
      WHERE wr.branch_id = $1 
        AND wr.waste_date BETWEEN $2 AND $3
      GROUP BY p.id, p.name, wc.name, wr.waste_stage, u.symbol
      ORDER BY total_cost DESC
    `, [branchId, startDate, endDate]);

    // Get summary statistics
    const summaryResult = await db.query(`
      SELECT 
        SUM(wr.total_cost) as total_waste_cost,
        SUM(wr.quantity) as total_waste_quantity,
        COUNT(DISTINCT wr.product_id) as products_wasted,
        COUNT(*) as total_incidents,
        AVG(wr.total_cost) as avg_cost_per_incident
      FROM waste_records wr
      WHERE wr.branch_id = $1 
        AND wr.waste_date BETWEEN $2 AND $3
    `, [branchId, startDate, endDate]);

    return {
      details: result.rows,
      summary: summaryResult.rows[0] || {},
    };
  }

  // Get inventory status for a branch
  static async getInventoryStatus(branchId: string): Promise<any> {
    const result = await db.query(`
      SELECT 
        p.id,
        p.name,
        p.minimum_stock,
        c.name as category_name,
        u.name as unit_name,
        u.symbol as unit_symbol,
        COALESCE(SUM(ist.current_quantity), 0) as total_quantity,
        COALESCE(SUM(ist.reserved_quantity), 0) as reserved_quantity,
        COALESCE(SUM(ist.current_quantity) - SUM(ist.reserved_quantity), 0) as available_quantity,
        MIN(ist.expiry_date) as earliest_expiry,
        COUNT(CASE WHEN ist.expiry_date <= CURRENT_DATE + INTERVAL '3 days' THEN 1 END) as expiring_soon_batches,
        COALESCE(AVG(p.average_cost_per_unit), 0) as avg_cost_per_unit
      FROM products p
      LEFT JOIN inventory_stock ist ON p.id = ist.product_id AND ist.branch_id = $1
      LEFT JOIN categories c ON p.category_id = c.id
      JOIN units u ON p.unit_id = u.id
      WHERE p.tenant_id = (SELECT tenant_id FROM branches WHERE id = $1)
        AND p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.minimum_stock, c.name, u.name, u.symbol
      ORDER BY p.name
    `, [branchId]);

    return result.rows.map(row => ({
      ...row,
      is_low_stock: parseFloat(row.total_quantity) <= parseFloat(row.minimum_stock),
      has_expiring_items: parseInt(row.expiring_soon_batches) > 0,
    }));
  }

  // Get expiring items for a branch
  static async getExpiringItems(branchId: string, daysAhead: number = 7): Promise<any> {
    const result = await db.query(`
      SELECT 
        ist.id as stock_id,
        p.name as product_name,
        ist.current_quantity,
        ist.expiry_date,
        ist.batch_number,
        u.symbol as unit_symbol,
        p.average_cost_per_unit,
        (ist.current_quantity * p.average_cost_per_unit) as estimated_loss,
        EXTRACT(DAY FROM (ist.expiry_date - CURRENT_DATE)) as days_to_expiry
      FROM inventory_stock ist
      JOIN products p ON ist.product_id = p.id
      JOIN units u ON p.unit_id = u.id
      WHERE ist.branch_id = $1
        AND ist.current_quantity > 0
        AND ist.expiry_date IS NOT NULL
        AND ist.expiry_date <= CURRENT_DATE + INTERVAL '%s days'
      ORDER BY ist.expiry_date ASC, estimated_loss DESC
    `.replace('%s', daysAhead.toString()), [branchId]);

    return result.rows;
  }

  // Get units
  static async getUnits(): Promise<any> {
    const result = await db.query(`
      SELECT id, name, symbol, type, base_unit, conversion_factor
      FROM units 
      WHERE is_active = true 
      ORDER BY type, name
    `);

    return result.rows;
  }

  // Get categories for a tenant
  static async getCategories(tenantId: string): Promise<any> {
    const result = await db.query(`
      SELECT id, name, description
      FROM categories 
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY name
    `, [tenantId]);

    return result.rows;
  }

  // Get waste categories for a tenant
  static async getWasteCategories(tenantId: string): Promise<any> {
    const result = await db.query(`
      SELECT id, name, description, color
      FROM waste_categories 
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY name
    `, [tenantId]);

    return result.rows;
  }

  // Get suppliers for a tenant
  static async getSuppliers(tenantId: string): Promise<any> {
    const result = await db.query(`
      SELECT id, name, contact_person, phone, email, address
      FROM suppliers 
      WHERE tenant_id = $1 AND deleted_at IS NULL AND is_active = true
      ORDER BY name
    `, [tenantId]);

    return result.rows;
  }

  // Get products for a tenant
  static async getProducts(tenantId: string): Promise<any> {
    const result = await db.query(`
      SELECT 
        p.id, p.name, p.description, p.perishable, p.shelf_life_days,
        p.minimum_stock, p.average_cost_per_unit,
        c.name as category_name,
        u.name as unit_name, u.symbol as unit_symbol
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      JOIN units u ON p.unit_id = u.id
      WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.name
    `, [tenantId]);

    return result.rows;
  }

  // Category Management
  static async createCategory(categoryData: any, createdBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
      INSERT INTO categories (tenant_id, name, description, is_active)
      VALUES ($1, $2, $3, true)
      RETURNING *
    `, [categoryData.tenantId, categoryData.name, categoryData.description]);

      const category = result.rows[0];

      logger.audit('category_created', createdBy, {
        categoryId: category.id,
        tenantId: category.tenant_id,
        name: category.name,
      });

      return category;
    });
  }

  static async updateCategory(categoryId: string, updateData: any, updatedBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
      UPDATE categories 
      SET name = $1, description = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [updateData.name, updateData.description, categoryId]);

      const category = result.rows[0];

      logger.audit('category_updated', updatedBy, {
        categoryId: category.id,
        name: category.name,
      });

      return category;
    });
  }

  static async deleteCategory(categoryId: string, deletedBy: string): Promise<void> {
    return await db.transaction(async (client) => {
      await client.query(
        'UPDATE categories SET deleted_at = NOW(), is_active = false WHERE id = $1',
        [categoryId]
      );

      logger.audit('category_deleted', deletedBy, { categoryId });
    });
  }

  // Supplier Management
  static async createSupplier(supplierData: any, createdBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
      INSERT INTO suppliers (tenant_id, name, contact_person, phone, email, address, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
    `, [
        supplierData.tenantId,
        supplierData.name,
        supplierData.contactPerson,
        supplierData.phone,
        supplierData.email,
        supplierData.address
      ]);

      const supplier = result.rows[0];

      logger.audit('supplier_created', createdBy, {
        supplierId: supplier.id,
        name: supplier.name,
      });

      return supplier;
    });
  }

  static async updateSupplier(supplierId: string, updateData: any, updatedBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
      UPDATE suppliers 
      SET name = $1, contact_person = $2, phone = $3, email = $4, address = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `, [
        updateData.name,
        updateData.contactPerson,
        updateData.phone,
        updateData.email,
        updateData.address,
        supplierId
      ]);

      const supplier = result.rows[0];

      logger.audit('supplier_updated', updatedBy, {
        supplierId: supplier.id,
        name: supplier.name,
      });

      return supplier;
    });
  }

  static async deleteSupplier(supplierId: string, deletedBy: string): Promise<void> {
    return await db.transaction(async (client) => {
      await client.query(
        'UPDATE suppliers SET deleted_at = NOW(), is_active = false WHERE id = $1',
        [supplierId]
      );

      logger.audit('supplier_deleted', deletedBy, { supplierId });
    });
  }

  // Waste Category Management
  static async createWasteCategory(wasteCategoryData: any, createdBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
      INSERT INTO waste_categories (tenant_id, name, description, color, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING *
    `, [
        wasteCategoryData.tenantId,
        wasteCategoryData.name,
        wasteCategoryData.description,
        wasteCategoryData.color || '#FF6B6B'
      ]);

      const wasteCategory = result.rows[0];

      logger.audit('waste_category_created', createdBy, {
        wasteCategoryId: wasteCategory.id,
        name: wasteCategory.name,
      });

      return wasteCategory;
    });
  }

  static async updateWasteCategory(wasteCategoryId: string, updateData: any, updatedBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      const result = await client.query(`
     UPDATE waste_categories 
     SET name = $1, description = $2, color = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING *
   `, [updateData.name, updateData.description, updateData.color, wasteCategoryId]);

      const wasteCategory = result.rows[0];

      logger.audit('waste_category_updated', updatedBy, {
        wasteCategoryId: wasteCategory.id,
        name: wasteCategory.name,
      });

      return wasteCategory;
    });
  }

  static async deleteWasteCategory(wasteCategoryId: string, deletedBy: string): Promise<void> {
    return await db.transaction(async (client) => {
      await client.query(
        'UPDATE waste_categories SET deleted_at = NOW(), is_active = false WHERE id = $1',
        [wasteCategoryId]
      );

      logger.audit('waste_category_deleted', deletedBy, { wasteCategoryId });
    });
  }

  // Update system settings
  static async updateSystemSettings(settings: any, updatedBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      for (const [key, value] of Object.entries(settings)) {
        await client.query(`
       INSERT INTO system_settings (key, value, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET 
         value = EXCLUDED.value,
         updated_at = NOW()
     `, [key, JSON.stringify(value), `Updated by ${updatedBy}`]);
      }

      logger.audit('system_settings_updated', updatedBy, { settings });

      return await this.getSystemSettings();
    });
  }
}
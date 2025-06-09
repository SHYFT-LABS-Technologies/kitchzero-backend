import { config } from '../config';
import logger from '../utils/logger';
import db from './DatabaseService';
import bcrypt from 'bcryptjs';

export interface CreateTenantData {
  name: string;
  slug: string;
  type: 'restaurant' | 'hotel';
  settings?: Record<string, any>;
  adminUser: {
    username: string;
    email?: string;
    password: string;
  };
}

export interface UpdateTenantData {
  name?: string;
  settings?: Record<string, any>;
  isActive?: boolean;
  subscriptionStatus?: 'trial' | 'active' | 'suspended' | 'cancelled';
  subscriptionEndDate?: Date;
}

export class TenantService {
  // Create a new tenant with admin user (for super admin only)
  static async createTenant(tenantData: CreateTenantData, createdBy: string): Promise<any> {
    return await db.transaction(async (client) => {
      // Check if slug already exists
      const existingTenant = await client.query(
        'SELECT id FROM tenants WHERE slug = $1',
        [tenantData.slug]
      );

      if (existingTenant.rows.length > 0) {
        throw new Error('Tenant slug already exists');
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(tenantData.slug)) {
        throw new Error('Slug must contain only lowercase letters, numbers, and hyphens');
      }

      // Check if admin username already exists
      const existingUser = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [tenantData.adminUser.username]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('Admin username already exists');
      }

      // Create tenant
      const tenantResult = await client.query(`
        INSERT INTO tenants (name, slug, type, settings, is_active, subscription_status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, true, 'trial', NOW(), NOW())
        RETURNING id, name, slug, type, settings, is_active, subscription_status, created_at
      `, [tenantData.name, tenantData.slug, tenantData.type, JSON.stringify(tenantData.settings || {})]);

      const newTenant = tenantResult.rows[0];

      // Hash password for admin user
      const hashedPassword = await bcrypt.hash(tenantData.adminUser.password, config.security.bcryptRounds);

      // Create tenant admin user
      const userResult = await client.query(`
        INSERT INTO users (username, email, password, role, tenant_id, is_active, must_change_password, created_at, updated_at)
        VALUES ($1, $2, $3, 'tenant_admin', $4, true, false, NOW(), NOW())
        RETURNING id, username, email, role
      `, [
        tenantData.adminUser.username,
        tenantData.adminUser.email,
        hashedPassword,
        newTenant.id
      ]);

      const adminUser = userResult.rows[0];

      logger.audit('tenant_created', createdBy, {
        tenantId: newTenant.id,
        name: newTenant.name,
        slug: newTenant.slug,
        type: newTenant.type,
        adminUserId: adminUser.id,
        adminUsername: adminUser.username,
      });

      return {
        tenant: newTenant,
        adminUser: {
          id: adminUser.id,
          username: adminUser.username,
          email: adminUser.email,
          role: adminUser.role,
        }
      };
    });
  }

  // Get tenant information (with proper access control)
  static async getTenantById(tenantId: string, requestingUserId: string, requestingUserRole: string): Promise<any> {
    // Check access permissions
    if (requestingUserRole !== 'super_admin') {
      // Non-super admins can only access their own tenant
      const userCheck = await db.query(
        'SELECT tenant_id FROM users WHERE id = $1',
        [requestingUserId]
      );

      if (userCheck.rows.length === 0 || userCheck.rows[0].tenant_id !== tenantId) {
        throw new Error('Access denied: Cannot access other tenant\'s information');
      }
    }

    const result = await db.query(`
      SELECT t.*,
             COUNT(DISTINCT u.id) as user_count,
             COUNT(DISTINCT b.id) as branch_count
      FROM tenants t
      LEFT JOIN users u ON t.id = u.tenant_id AND u.deleted_at IS NULL
      LEFT JOIN branches b ON t.id = b.tenant_id AND b.deleted_at IS NULL
      WHERE t.id = $1 AND t.deleted_at IS NULL
      GROUP BY t.id
    `, [tenantId]);

    if (result.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    return result.rows[0];
  }

  // Get all tenants (super admin only)
  static async getTenants(page: number = 1, limit: number = 10, requestingUserRole: string): Promise<any> {
    if (requestingUserRole !== 'super_admin') {
      throw new Error('Access denied: Only super admins can view all tenants');
    }

    const offset = (page - 1) * limit;

    // Get tenants count
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM tenants WHERE deleted_at IS NULL'
    );

    // Get tenants with stats
    const tenantsResult = await db.query(`
      SELECT t.*,
             COUNT(DISTINCT u.id) as user_count,
             COUNT(DISTINCT b.id) as branch_count,
             MAX(u.last_login_at) as last_activity
      FROM tenants t
      LEFT JOIN users u ON t.id = u.tenant_id AND u.deleted_at IS NULL
      LEFT JOIN branches b ON t.id = b.tenant_id AND b.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    return {
      tenants: tenantsResult.rows,
      pagination: {
        current: page,
        pages: totalPages,
        total,
        limit,
      },
    };
  }

  // Update tenant (super admin or tenant admin for their own tenant)
  static async updateTenant(
    tenantId: string, 
    updateData: UpdateTenantData, 
    updatedBy: string,
    requestingUserRole: string,
    requestingUserTenantId?: string
  ): Promise<any> {
    return await db.transaction(async (client) => {
      // Check access permissions
      if (requestingUserRole !== 'super_admin') {
        if (requestingUserRole !== 'tenant_admin' || requestingUserTenantId !== tenantId) {
          throw new Error('Access denied: Cannot update other tenant\'s information');
        }

        // Tenant admins cannot change subscription status or active status
        if (updateData.subscriptionStatus !== undefined || updateData.isActive !== undefined) {
          throw new Error('Access denied: Cannot modify subscription or active status');
        }
      }

      // Get current tenant data
      const currentTenant = await client.query(
        'SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL',
        [tenantId]
      );

      if (currentTenant.rows.length === 0) {
        throw new Error('Tenant not found');
      }

      const tenant = currentTenant.rows[0];

      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      if (updateData.name !== undefined) {
        updateFields.push(`name = $${paramCount}`);
        updateValues.push(updateData.name);
        paramCount++;
      }

      if (updateData.settings !== undefined) {
        updateFields.push(`settings = $${paramCount}`);
        updateValues.push(JSON.stringify(updateData.settings));
        paramCount++;
      }

      if (updateData.isActive !== undefined && requestingUserRole === 'super_admin') {
        updateFields.push(`is_active = $${paramCount}`);
        updateValues.push(updateData.isActive);
        paramCount++;
      }

      if (updateData.subscriptionStatus !== undefined && requestingUserRole === 'super_admin') {
        updateFields.push(`subscription_status = $${paramCount}`);
        updateValues.push(updateData.subscriptionStatus);
        paramCount++;
      }

      if (updateData.subscriptionEndDate !== undefined && requestingUserRole === 'super_admin') {
        updateFields.push(`subscription_end_date = $${paramCount}`);
        updateValues.push(updateData.subscriptionEndDate);
        paramCount++;
      }

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(tenantId);

      const updateQuery = `
        UPDATE tenants 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount} AND deleted_at IS NULL
        RETURNING *
      `;

      const result = await client.query(updateQuery, updateValues);
      const updatedTenant = result.rows[0];

      logger.audit('tenant_updated', updatedBy, {
        tenantId,
        beforeValues: tenant,
        afterValues: updatedTenant,
        updatedBy,
        requestingUserRole,
      });

      return updatedTenant;
    });
  }

  // Soft delete tenant (super admin only)
  static async deleteTenant(tenantId: string, deletedBy: string, requestingUserRole: string): Promise<void> {
    if (requestingUserRole !== 'super_admin') {
      throw new Error('Access denied: Only super admins can delete tenants');
    }

    return await db.transaction(async (client) => {
      // Get tenant data before deletion
      const tenant = await client.query(
        'SELECT name, slug FROM tenants WHERE id = $1',
        [tenantId]
      );

      if (tenant.rows.length === 0) {
        throw new Error('Tenant not found');
      }

      // Soft delete tenant
      await client.query(
        'UPDATE tenants SET deleted_at = NOW(), is_active = false WHERE id = $1',
        [tenantId]
      );

      // Soft delete all users in this tenant
      await client.query(
        'UPDATE users SET deleted_at = NOW(), is_active = false WHERE tenant_id = $1',
        [tenantId]
      );

      // Soft delete all branches in this tenant
      await client.query(
        'UPDATE branches SET deleted_at = NOW(), is_active = false WHERE tenant_id = $1',
        [tenantId]
      );

      logger.audit('tenant_deleted', deletedBy, {
        tenantId,
        name: tenant.rows[0].name,
        slug: tenant.rows[0].slug,
      });
    });
  }

  // Get tenant dashboard stats
  static async getTenantDashboardStats(tenantId: string, requestingUserId: string, requestingUserRole: string): Promise<any> {
    // Check access permissions
    if (requestingUserRole !== 'super_admin') {
      const userCheck = await db.query(
        'SELECT tenant_id FROM users WHERE id = $1',
        [requestingUserId]
      );

      if (userCheck.rows.length === 0 || userCheck.rows[0].tenant_id !== tenantId) {
        throw new Error('Access denied: Cannot access other tenant\'s data');
      }
    }

    const stats = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND deleted_at IS NULL) as user_count,
        (SELECT COUNT(*) FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL) as branch_count,
        (SELECT COUNT(*) FROM products WHERE tenant_id = $1 AND deleted_at IS NULL) as product_count,
        (SELECT COUNT(*) FROM categories WHERE tenant_id = $1 AND deleted_at IS NULL) as category_count,
        (SELECT COUNT(*) FROM suppliers WHERE tenant_id = $1 AND deleted_at IS NULL) as supplier_count,
        (SELECT COALESCE(SUM(total_cost), 0) FROM waste_records WHERE tenant_id = $1 AND waste_date >= CURRENT_DATE - INTERVAL '30 days') as monthly_waste_cost,
        (SELECT COUNT(*) FROM waste_records WHERE tenant_id = $1 AND waste_date >= CURRENT_DATE - INTERVAL '30 days') as monthly_waste_incidents
    `, [tenantId]);

    return stats.rows[0];
  }
}
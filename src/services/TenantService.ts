import { config } from '../config';
import logger from '../utils/logger';

export interface CreateTenantData {
  name: string;
  slug: string;
  type: 'restaurant' | 'hotel';
  settings?: Record<string, any>;
}

export interface UpdateTenantData {
  name?: string;
  settings?: Record<string, any>;
  isActive?: boolean;
  subscriptionStatus?: 'trial' | 'active' | 'suspended' | 'cancelled';
  subscriptionEndDate?: Date;
}

export class TenantService {
  static async createTenant(tenantData: CreateTenantData, createdBy: string): Promise<any> {
    const { Client } = require('pg');
    
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    try {
      await client.connect();

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

      // Create tenant
      const result = await client.query(`
        INSERT INTO tenants (name, slug, type, settings, is_active, subscription_status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, true, 'trial', NOW(), NOW())
        RETURNING id, name, slug, type, settings, is_active, subscription_status, created_at
      `, [tenantData.name, tenantData.slug, tenantData.type, JSON.stringify(tenantData.settings || {})]);

      const newTenant = result.rows[0];

      logger.audit('tenant_created', createdBy, {
        tenantId: newTenant.id,
        name: newTenant.name,
        slug: newTenant.slug,
        type: newTenant.type,
      });

      return newTenant;

    } finally {
      await client.end();
    }
  }

  static async updateTenant(tenantId: string, updateData: UpdateTenantData, updatedBy: string): Promise<any> {
    const { Client } = require('pg');
    
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    try {
      await client.connect();

      // Get current tenant data
      const currentTenant = await client.query(
        'SELECT * FROM tenants WHERE id = $1',
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

      if (updateData.isActive !== undefined) {
        updateFields.push(`is_active = $${paramCount}`);
        updateValues.push(updateData.isActive);
        paramCount++;
      }

      if (updateData.subscriptionStatus !== undefined) {
        updateFields.push(`subscription_status = $${paramCount}`);
        updateValues.push(updateData.subscriptionStatus);
        paramCount++;
      }

      if (updateData.subscriptionEndDate !== undefined) {
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
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await client.query(updateQuery, updateValues);
      const updatedTenant = result.rows[0];

      logger.audit('tenant_updated', updatedBy, {
        tenantId,
        beforeValues: tenant,
        afterValues: updatedTenant,
      });

      return updatedTenant;

    } finally {
      await client.end();
    }
  }

  static async getTenants(page: number = 1, limit: number = 10): Promise<any> {
    const { Client } = require('pg');
    
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    try {
      await client.connect();

      const offset = (page - 1) * limit;

      // Get tenants count
      const countResult = await client.query(
        'SELECT COUNT(*) as count FROM tenants WHERE deleted_at IS NULL'
      );

      // Get tenants with stats
      const tenantsResult = await client.query(`
        SELECT t.*,
               COUNT(u.id) as user_count,
               COUNT(b.id) as branch_count
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

    } finally {
      await client.end();
    }
  }

  static async getTenantById(tenantId: string): Promise<any> {
    const { Client } = require('pg');
    
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    try {
      await client.connect();

      const result = await client.query(`
        SELECT t.*,
               COUNT(u.id) as user_count,
               COUNT(b.id) as branch_count
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

    } finally {
      await client.end();
    }
  }

  static async deleteTenant(tenantId: string, deletedBy: string): Promise<void> {
    const { Client } = require('pg');
    
    const client = new Client({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.name,
    });

    try {
      await client.connect();

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

    } finally {
      await client.end();
    }
  }
}
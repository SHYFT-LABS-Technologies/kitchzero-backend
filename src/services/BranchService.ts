import { config } from '../config';
import logger from '../utils/logger';

export interface CreateBranchData {
  tenantId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  phone?: string;
  email?: string;
  settings?: Record<string, any>;
}

export interface UpdateBranchData {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  settings?: Record<string, any>;
  isActive?: boolean;
}

export class BranchService {
  static async createBranch(branchData: CreateBranchData, createdBy: string): Promise<any> {
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

      // Validate tenant exists and is active
      const tenant = await client.query(
        'SELECT id, name FROM tenants WHERE id = $1 AND is_active = true AND deleted_at IS NULL',
        [branchData.tenantId]
      );

      if (tenant.rows.length === 0) {
        throw new Error('Tenant not found or inactive');
      }

      // Create branch
      const result = await client.query(`
        INSERT INTO branches (tenant_id, name, address, city, state, zip_code, country, phone, email, settings, is_active, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NOW(), NOW())
        RETURNING *
      `, [
        branchData.tenantId,
        branchData.name,
        branchData.address,
        branchData.city,
        branchData.state,
        branchData.zipCode,
        branchData.country,
        branchData.phone,
        branchData.email,
        JSON.stringify(branchData.settings || {})
      ]);

      const newBranch = result.rows[0];

      logger.audit('branch_created', createdBy, {
        branchId: newBranch.id,
        tenantId: newBranch.tenant_id,
        name: newBranch.name,
        city: newBranch.city,
      });

      return newBranch;

    } finally {
      await client.end();
    }
  }

  static async updateBranch(branchId: string, updateData: UpdateBranchData, updatedBy: string): Promise<any> {
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

      // Get current branch data
      const currentBranch = await client.query(
        'SELECT * FROM branches WHERE id = $1 AND deleted_at IS NULL',
        [branchId]
      );

      if (currentBranch.rows.length === 0) {
        throw new Error('Branch not found');
      }

      const branch = currentBranch.rows[0];

      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      Object.keys(updateData).forEach(key => {
        if (updateData[key as keyof UpdateBranchData] !== undefined) {
          if (key === 'settings') {
            updateFields.push(`${key} = $${paramCount}`);
            updateValues.push(JSON.stringify(updateData[key as keyof UpdateBranchData]));
          } else {
            updateFields.push(`${key} = $${paramCount}`);
            updateValues.push(updateData[key as keyof UpdateBranchData]);
          }
          paramCount++;
        }
      });

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(branchId);

      const updateQuery = `
        UPDATE branches 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await client.query(updateQuery, updateValues);
      const updatedBranch = result.rows[0];

      logger.audit('branch_updated', updatedBy, {
        branchId,
        beforeValues: branch,
        afterValues: updatedBranch,
      });

      return updatedBranch;

    } finally {
      await client.end();
    }
  }

  static async getBranchesByTenant(tenantId: string, page: number = 1, limit: number = 10): Promise<any> {
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

      // Get branches count
      const countResult = await client.query(
        'SELECT COUNT(*) as count FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL',
        [tenantId]
      );

      // Get branches with user count
      const branchesResult = await client.query(`
        SELECT b.*,
               COUNT(u.id) as user_count
        FROM branches b
        LEFT JOIN users u ON b.id = u.branch_id AND u.deleted_at IS NULL
        WHERE b.tenant_id = $1 AND b.deleted_at IS NULL
        GROUP BY b.id
        ORDER BY b.created_at DESC
        LIMIT $2 OFFSET $3
      `, [tenantId, limit, offset]);

      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      return {
        branches: branchesResult.rows,
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

  static async getBranchById(branchId: string): Promise<any> {
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
        SELECT b.*,
               t.name as tenant_name,
               t.type as tenant_type,
               COUNT(u.id) as user_count
        FROM branches b
        JOIN tenants t ON b.tenant_id = t.id
        LEFT JOIN users u ON b.id = u.branch_id AND u.deleted_at IS NULL
        WHERE b.id = $1 AND b.deleted_at IS NULL
        GROUP BY b.id, t.name, t.type
      `, [branchId]);

      if (result.rows.length === 0) {
        throw new Error('Branch not found');
      }

      return result.rows[0];

    } finally {
      await client.end();
    }
  }

  static async deleteBranch(branchId: string, deletedBy: string): Promise<void> {
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

      // Get branch data before deletion
      const branch = await client.query(
        'SELECT name, tenant_id FROM branches WHERE id = $1',
        [branchId]
      );

      if (branch.rows.length === 0) {
        throw new Error('Branch not found');
      }

      // Soft delete branch
      await client.query(
        'UPDATE branches SET deleted_at = NOW(), is_active = false WHERE id = $1',
        [branchId]
      );

      // Soft delete all users in this branch
      await client.query(
        'UPDATE users SET deleted_at = NOW(), is_active = false WHERE branch_id = $1',
        [branchId]
      );

      logger.audit('branch_deleted', deletedBy, {
        branchId,
        name: branch.rows[0].name,
        tenantId: branch.rows[0].tenant_id,
      });

    } finally {
      await client.end();
    }
  }
}
import bcrypt from 'bcryptjs';
import { config } from '../config';
import logger from '../utils/logger';
import { JWTUtils } from '../utils/jwt';

export interface CreateUserData {
  username: string;
  email?: string;
  password: string;
  role: 'tenant_admin' | 'branch_admin';
  tenantId?: string;
  branchId?: string;
}

export interface UpdateUserData {
  email?: string;
  isActive?: boolean;
  role?: string;
  tenantId?: string;
  branchId?: string;
}

export class UserService {
  static async createUser(userData: CreateUserData, createdBy: string): Promise<any> {
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

      // Validate password strength
      const passwordValidation = JWTUtils.validatePasswordStrength(userData.password);
      if (!passwordValidation.isValid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Check if username already exists
      const existingUser = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [userData.username]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('Username already exists');
      }

      // Check if email already exists (if provided)
      if (userData.email) {
        const existingEmail = await client.query(
          'SELECT id FROM users WHERE email = $1',
          [userData.email]
        );

        if (existingEmail.rows.length > 0) {
          throw new Error('Email already exists');
        }
      }

      // Validate tenant exists (if provided)
      if (userData.tenantId) {
        const tenant = await client.query(
          'SELECT id FROM tenants WHERE id = $1 AND is_active = true',
          [userData.tenantId]
        );

        if (tenant.rows.length === 0) {
          throw new Error('Tenant not found or inactive');
        }
      }

      // Validate branch exists and belongs to tenant (if provided)
      if (userData.branchId) {
        const branch = await client.query(
          'SELECT id FROM branches WHERE id = $1 AND tenant_id = $2 AND is_active = true',
          [userData.branchId, userData.tenantId]
        );

        if (branch.rows.length === 0) {
          throw new Error('Branch not found or does not belong to tenant');
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, config.security.bcryptRounds);

      // Create user
      const result = await client.query(`
        INSERT INTO users (username, email, password, role, tenant_id, branch_id, is_active, must_change_password, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, true, true, NOW(), NOW())
        RETURNING id, username, email, role, tenant_id, branch_id, is_active, must_change_password, created_at
      `, [userData.username, userData.email, hashedPassword, userData.role, userData.tenantId, userData.branchId]);

      const newUser = result.rows[0];

      logger.audit('user_created', createdBy, {
        createdUserId: newUser.id,
        username: newUser.username,
        role: newUser.role,
        tenantId: newUser.tenant_id,
      });

      return {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        tenantId: newUser.tenant_id,
        branchId: newUser.branch_id,
        isActive: newUser.is_active,
        mustChangePassword: newUser.must_change_password,
        createdAt: newUser.created_at,
      };

    } finally {
      await client.end();
    }
  }

  static async updateUser(userId: string, updateData: UpdateUserData, updatedBy: string): Promise<any> {
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

      // Get current user data
      const currentUser = await client.query(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );

      if (currentUser.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = currentUser.rows[0];

      // Check if email is being changed and doesn't conflict
      if (updateData.email && updateData.email !== user.email) {
        const existingEmail = await client.query(
          'SELECT id FROM users WHERE email = $1 AND id != $2',
          [updateData.email, userId]
        );

        if (existingEmail.rows.length > 0) {
          throw new Error('Email already exists');
        }
      }

      // Build update query dynamically
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      if (updateData.email !== undefined) {
        updateFields.push(`email = $${paramCount}`);
        updateValues.push(updateData.email);
        paramCount++;
      }

      if (updateData.isActive !== undefined) {
        updateFields.push(`is_active = $${paramCount}`);
        updateValues.push(updateData.isActive);
        paramCount++;
      }

      if (updateData.role !== undefined) {
        updateFields.push(`role = $${paramCount}`);
        updateValues.push(updateData.role);
        paramCount++;
      }

      if (updateData.tenantId !== undefined) {
        updateFields.push(`tenant_id = $${paramCount}`);
        updateValues.push(updateData.tenantId);
        paramCount++;
      }

      if (updateData.branchId !== undefined) {
        updateFields.push(`branch_id = $${paramCount}`);
        updateValues.push(updateData.branchId);
        paramCount++;
      }

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      updateFields.push(`updated_at = NOW()`);
      updateValues.push(userId);

      const updateQuery = `
        UPDATE users 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, username, email, role, tenant_id, branch_id, is_active, must_change_password, updated_at
      `;

      const result = await client.query(updateQuery, updateValues);
      const updatedUser = result.rows[0];

      logger.audit('user_updated', updatedBy, {
        updatedUserId: userId,
        beforeValues: user,
        afterValues: updatedUser,
      });

      return {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role,
        tenantId: updatedUser.tenant_id,
        branchId: updatedUser.branch_id,
        isActive: updatedUser.is_active,
        mustChangePassword: updatedUser.must_change_password,
        updatedAt: updatedUser.updated_at,
      };

    } finally {
      await client.end();
    }
  }

  static async deleteUser(userId: string, deletedBy: string): Promise<void> {
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

      // Get user data before deletion
      const user = await client.query(
        'SELECT username, role FROM users WHERE id = $1',
        [userId]
      );

      if (user.rows.length === 0) {
        throw new Error('User not found');
      }

      // Soft delete (set deleted_at timestamp)
      await client.query(
        'UPDATE users SET deleted_at = NOW(), is_active = false WHERE id = $1',
        [userId]
      );

      // Revoke all refresh tokens
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1',
        [userId]
      );

      logger.audit('user_deleted', deletedBy, {
        deletedUserId: userId,
        username: user.rows[0].username,
        role: user.rows[0].role,
      });

    } finally {
      await client.end();
    }
  }

  static async getUsersByTenant(tenantId: string, page: number = 1, limit: number = 10): Promise<any> {
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

      // Get users count
      const countResult = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND deleted_at IS NULL',
        [tenantId]
      );

      // Get users with pagination
      const usersResult = await client.query(`
        SELECT u.id, u.username, u.email, u.role, u.tenant_id, u.branch_id, u.is_active, 
               u.must_change_password, u.last_login_at, u.created_at,
               b.name as branch_name
        FROM users u
        LEFT JOIN branches b ON u.branch_id = b.id
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL
        ORDER BY u.created_at DESC
        LIMIT $2 OFFSET $3
      `, [tenantId, limit, offset]);

      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / limit);

      return {
        users: usersResult.rows,
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

  static async resetUserPassword(userId: string, resetBy: string): Promise<string> {
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

      // Generate temporary password
      const tempPassword = JWTUtils.generateSecureToken(8);
      const hashedPassword = await bcrypt.hash(tempPassword, config.security.bcryptRounds);

      // Update user password
      await client.query(
        'UPDATE users SET password = $1, must_change_password = true WHERE id = $2',
        [hashedPassword, userId]
      );

      // Revoke all refresh tokens
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1',
        [userId]
      );

      logger.audit('password_reset', resetBy, {
        resetUserId: userId,
      });

      return tempPassword;

    } finally {
      await client.end();
    }
  }
}
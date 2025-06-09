import bcrypt from 'bcryptjs';
import { config } from '../config';
import logger from '../utils/logger';
import { JWTUtils } from '../utils/jwt';
import db from './DatabaseService';

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
  branchId?: string;
}

export class UserService {
  // Create user with tenant context validation
  static async createUser(
    userData: CreateUserData, 
    createdBy: string,
    createdByRole: string,
    createdByTenantId?: string
  ): Promise<any> {
    return await db.transaction(async (client) => {
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

      // Determine tenant context
      let targetTenantId = userData.tenantId;

      if (createdByRole === 'super_admin') {
        // Super admin can create users for any tenant
        if (!targetTenantId) {
          throw new Error('Tenant ID is required when creating users as super admin');
        }
      } else if (createdByRole === 'tenant_admin') {
        // Tenant admin can only create users for their own tenant
        targetTenantId = createdByTenantId;
        if (userData.tenantId && userData.tenantId !== createdByTenantId) {
          throw new Error('Cannot create users for other tenants');
        }
      } else {
        throw new Error('Insufficient permissions to create users');
      }

      // Validate tenant exists and is active
      const tenant = await client.query('SELECT id, is_active FROM tenants WHERE id = $1 AND deleted_at IS NULL',
       [targetTenantId]
     );

     if (tenant.rows.length === 0) {
       throw new Error('Tenant not found or inactive');
     }

     if (!tenant.rows[0].is_active) {
       throw new Error('Cannot create users for inactive tenant');
     }

     // Validate branch exists and belongs to tenant (if provided)
     if (userData.branchId) {
       const branch = await client.query(
         'SELECT id FROM branches WHERE id = $1 AND tenant_id = $2 AND is_active = true AND deleted_at IS NULL',
         [userData.branchId, targetTenantId]
       );

       if (branch.rows.length === 0) {
         throw new Error('Branch not found or does not belong to tenant');
       }
     }

     // Validate role assignment permissions
     if (createdByRole === 'tenant_admin' && userData.role === 'tenant_admin') {
       throw new Error('Tenant admins cannot create other tenant admins');
     }

     // Hash password
     const hashedPassword = await bcrypt.hash(userData.password, config.security.bcryptRounds);

     // Create user
     const result = await client.query(`
       INSERT INTO users (username, email, password, role, tenant_id, branch_id, is_active, must_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, true, NOW(), NOW())
       RETURNING id, username, email, role, tenant_id, branch_id, is_active, must_change_password, created_at
     `, [userData.username, userData.email, hashedPassword, userData.role, targetTenantId, userData.branchId]);

     const newUser = result.rows[0];

     logger.audit('user_created', createdBy, {
       createdUserId: newUser.id,
       username: newUser.username,
       role: newUser.role,
       tenantId: newUser.tenant_id,
       branchId: newUser.branch_id,
       createdByRole,
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
   });
 }

 // Get users with tenant context validation
 static async getUsersByTenant(
   tenantId: string, 
   page: number = 1, 
   limit: number = 10,
   requestingUserId: string,
   requestingUserRole: string,
   requestingUserTenantId?: string
 ): Promise<any> {
   // Check access permissions
   if (requestingUserRole === 'super_admin') {
     // Super admin can view users from any tenant
   } else if (requestingUserRole === 'tenant_admin' || requestingUserRole === 'branch_admin') {
     // Tenant/branch admins can only view users from their own tenant
     if (requestingUserTenantId !== tenantId) {
       throw new Error('Access denied: Cannot view users from other tenants');
     }
   } else {
     throw new Error('Insufficient permissions to view users');
   }

   const offset = (page - 1) * limit;

   // Get users count
   const countResult = await db.query(
     'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND deleted_at IS NULL',
     [tenantId]
   );

   // Get users with pagination
   const usersResult = await db.query(`
     SELECT u.id, u.username, u.email, u.role, u.tenant_id, u.branch_id, u.is_active, 
            u.must_change_password, u.last_login_at, u.created_at,
            b.name as branch_name,
            t.name as tenant_name
     FROM users u
     LEFT JOIN branches b ON u.branch_id = b.id
     LEFT JOIN tenants t ON u.tenant_id = t.id
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
 }

 // Update user with proper access control
 static async updateUser(
   userId: string, 
   updateData: UpdateUserData, 
   updatedBy: string,
   updatingUserRole: string,
   updatingUserTenantId?: string
 ): Promise<any> {
   return await db.transaction(async (client) => {
     // Get current user data
     const currentUser = await client.query(
       'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
       [userId]
     );

     if (currentUser.rows.length === 0) {
       throw new Error('User not found');
     }

     const user = currentUser.rows[0];

     // Check access permissions
     if (updatingUserRole === 'super_admin') {
       // Super admin can update any user
     } else if (updatingUserRole === 'tenant_admin') {
       // Tenant admin can only update users in their own tenant
       if (user.tenant_id !== updatingUserTenantId) {
         throw new Error('Access denied: Cannot update users from other tenants');
       }
       // Tenant admin cannot update other tenant admins
       if (user.role === 'tenant_admin' && user.id !== updatedBy) {
         throw new Error('Access denied: Cannot update other tenant admins');
       }
     } else {
       throw new Error('Insufficient permissions to update users');
     }

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

     // Validate branch belongs to the same tenant if being updated
     if (updateData.branchId) {
       const branch = await client.query(
         'SELECT id FROM branches WHERE id = $1 AND tenant_id = $2 AND is_active = true AND deleted_at IS NULL',
         [updateData.branchId, user.tenant_id]
       );

       if (branch.rows.length === 0) {
         throw new Error('Branch not found or does not belong to user\'s tenant');
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

     if (updateData.role !== undefined && updatingUserRole === 'super_admin') {
       updateFields.push(`role = $${paramCount}`);
       updateValues.push(updateData.role);
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
       updatingUserRole,
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
   });
 }

 // Delete user with proper access control
 static async deleteUser(
   userId: string, 
   deletedBy: string,
   deletingUserRole: string,
   deletingUserTenantId?: string
 ): Promise<void> {
   return await db.transaction(async (client) => {
     // Get user data before deletion
     const user = await client.query(
       'SELECT username, role, tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL',
       [userId]
     );

     if (user.rows.length === 0) {
       throw new Error('User not found');
     }

     const userData = user.rows[0];

     // Check access permissions
     if (deletingUserRole === 'super_admin') {
       // Super admin can delete any user
     } else if (deletingUserRole === 'tenant_admin') {
       // Tenant admin can only delete users in their own tenant
       if (userData.tenant_id !== deletingUserTenantId) {
         throw new Error('Access denied: Cannot delete users from other tenants');
       }
       // Tenant admin cannot delete other tenant admins
       if (userData.role === 'tenant_admin' && userId !== deletedBy) {
         throw new Error('Access denied: Cannot delete other tenant admins');
       }
     } else {
       throw new Error('Insufficient permissions to delete users');
     }

     // Prevent self-deletion
     if (userId === deletedBy) {
       throw new Error('Cannot delete your own account');
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
       username: userData.username,
       role: userData.role,
       tenantId: userData.tenant_id,
       deletingUserRole,
     });
   });
 }

 // Reset user password with proper access control
 static async resetUserPassword(
   userId: string, 
   resetBy: string,
   resetByRole: string,
   resetByTenantId?: string
 ): Promise<string> {
   return await db.transaction(async (client) => {
     // Get user data
     const user = await client.query(
       'SELECT username, role, tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL',
       [userId]
     );

     if (user.rows.length === 0) {
       throw new Error('User not found');
     }

     const userData = user.rows[0];

     // Check access permissions
     if (resetByRole === 'super_admin') {
       // Super admin can reset any user's password
     } else if (resetByRole === 'tenant_admin') {
       // Tenant admin can only reset passwords for users in their own tenant
       if (userData.tenant_id !== resetByTenantId) {
         throw new Error('Access denied: Cannot reset passwords for users from other tenants');
       }
       // Tenant admin cannot reset other tenant admin passwords
       if (userData.role === 'tenant_admin' && userId !== resetBy) {
         throw new Error('Access denied: Cannot reset other tenant admin passwords');
       }
     } else {
       throw new Error('Insufficient permissions to reset passwords');
     }

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
       username: userData.username,
       resetByRole,
     });

     return tempPassword;
   });
 }
}
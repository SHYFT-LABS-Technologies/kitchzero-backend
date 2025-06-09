import bcrypt from 'bcryptjs';
import { JWTUtils } from '../utils/jwt';
import { config } from '../config';
import logger from '../utils/logger';
import db from './DatabaseService';

export interface LoginResult {
  user: {
    id: string;
    username: string;
    email?: string;
    role: string;
    tenantId?: string;
    branchId?: string;
    mustChangePassword: boolean;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  static async login(username: string, password: string, ipAddress: string, userAgent: string): Promise<LoginResult> {
    try {
      // Find user by username or email
      const result = await db.query(
        'SELECT id, username, email, password, role, tenant_id, branch_id, is_active, must_change_password, failed_login_attempts, locked_until FROM users WHERE username = $1 OR email = $1',
        [username]
      );

      if (result.rows.length === 0) {
        logger.security('Login attempt with invalid username', {
          username,
          ip: ipAddress,
          userAgent,
        });
        throw new Error('Invalid credentials');
      }

      const user = result.rows[0];

      // Check if user is active
      if (!user.is_active) {
        logger.security('Login attempt with inactive user', {
          userId: user.id,
          username: user.username,
          ip: ipAddress,
          userAgent,
        });
        throw new Error('Account is inactive');
      }

      // Check if user is locked
      if (user.locked_until && new Date() < new Date(user.locked_until)) {
        logger.security('Login attempt with locked user', {
          userId: user.id,
          username: user.username,
          lockedUntil: user.locked_until,
          ip: ipAddress,
          userAgent,
        });
        throw new Error('Account is locked due to failed login attempts');
      }

      // Validate password
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        // Increment failed attempts
        const newFailedAttempts = user.failed_login_attempts + 1;
        let lockUntil = null;

        if (newFailedAttempts >= config.security.maxLoginAttempts) {
          lockUntil = new Date(Date.now() + config.security.lockoutTime * 60 * 1000);
        }

        await db.query(
          'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
          [newFailedAttempts, lockUntil, user.id]
        );

        logger.security('Login attempt with invalid password', {
          userId: user.id,
          username: user.username,
          failedAttempts: newFailedAttempts,
          ip: ipAddress,
          userAgent,
        });

        throw new Error('Invalid credentials');
      }

      // Reset failed attempts on successful login
      await db.query(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = $1',
        [user.id]
      );

      // Generate tokens
      const tokenPayload = {
        userId: user.id,
        username: user.username,
        role: user.role,
        tenantId: user.tenant_id,
        branchId: user.branch_id,
      };

      const accessToken = JWTUtils.generateAccessToken(tokenPayload);
      const refreshToken = JWTUtils.generateRefreshToken(tokenPayload);

      // Store refresh token in database
      await db.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
      );

      logger.audit('user_login', user.id, {
        ip: ipAddress,
        userAgent,
      });

      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          tenantId: user.tenant_id,
          branchId: user.branch_id,
          mustChangePassword: user.must_change_password, // Use ONLY the database value
        },
        accessToken,
        refreshToken,
        expiresIn: 15 * 60,
      };
    } catch (error: any) {
      logger.error('Authentication error:', {
        error: error.message,
        stack: error.stack,
        username,
        ip: ipAddress,
      });
      throw error;
    }
  }

  static async refreshToken(refreshTokenValue: string): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      // Verify refresh token
      const payload = JWTUtils.verifyRefreshToken(refreshTokenValue);

      // Check if refresh token exists in database and is not revoked
      const tokenResult = await db.query(
        'SELECT id, user_id, expires_at, is_revoked FROM refresh_tokens WHERE token = $1',
        [refreshTokenValue]
      );

      if (tokenResult.rows.length === 0 || tokenResult.rows[0].is_revoked) {
        throw new Error('Invalid refresh token');
      }

      const tokenRecord = tokenResult.rows[0];

      if (new Date() > new Date(tokenRecord.expires_at)) {
        throw new Error('Refresh token expired');
      }

      // Get user data
      const userResult = await db.query(
        'SELECT id, username, role, tenant_id, branch_id, is_active FROM users WHERE id = $1',
        [tokenRecord.user_id]
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        throw new Error('User not found or inactive');
      }

      const user = userResult.rows[0];

      // Generate new access token
      const newAccessToken = JWTUtils.generateAccessToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        tenantId: user.tenant_id,
        branchId: user.branch_id,
      });

      logger.audit('token_refresh', user.id);

      return {
        accessToken: newAccessToken,
        expiresIn: 15 * 60, // 15 minutes in seconds
      };
    } catch (error: any) {
      logger.error('Token refresh error:', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  static async changeCredentials(userId: string, currentPassword: string, newUsername: string, newPassword: string): Promise<void> {
    return await db.transaction(async (client) => {
      // Get user
      const result = await client.query(
        'SELECT id, username, password, must_change_password FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = result.rows[0];
      console.log('🔍 Before update - User data:', {
        id: user.id,
        username: user.username,
        must_change_password: user.must_change_password
      });

      // Validate current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        throw new Error('Current password is incorrect');
      }

      // Check if new username already exists (excluding current user)
      const existingUser = await client.query(
        'SELECT id FROM users WHERE username = $1 AND id != $2',
        [newUsername, userId]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('Username already exists');
      }

      // Validate new password strength
      const passwordValidation = JWTUtils.validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, config.security.bcryptRounds);

      // Update username, password, and EXPLICITLY set must_change_password to false
      const updateResult = await client.query(
        'UPDATE users SET username = $1, password = $2, must_change_password = false, updated_at = NOW() WHERE id = $3 RETURNING username, must_change_password',
        [newUsername, hashedPassword, userId]
      );

      console.log('✅ After update - User data:', updateResult.rows[0]);

      // Revoke all existing refresh tokens (force re-login)
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1',
        [userId]
      );

      logger.audit('credentials_changed', userId, {
        oldUsername: user.username,
        newUsername: newUsername,
      });
    });
  }

  static async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    return await db.transaction(async (client) => {
      // Get user
      const result = await client.query(
        'SELECT id, password FROM users WHERE id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      const user = result.rows[0];

      // Validate current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

      if (!isCurrentPasswordValid) {
        throw new Error('Current password is incorrect');
      }

      // Validate new password strength
      const passwordValidation = JWTUtils.validatePasswordStrength(newPassword);

      if (!passwordValidation.isValid) {
        throw new Error(`Password validation failed: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, config.security.bcryptRounds);

      // Update password
      await client.query(
        'UPDATE users SET password = $1, must_change_password = false WHERE id = $2',
        [hashedPassword, userId]
      );

      // Revoke all existing refresh tokens
      await client.query(
        'UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1',
        [userId]
      );

      logger.audit('password_change', userId);
    });
  }

}
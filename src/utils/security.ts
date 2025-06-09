export class SecurityUtils {
  // Input sanitization
  static sanitizeInput(input: string): string {
    return input
      .replace(/[<>]/g, '') // Remove potential HTML
      .replace(/javascript:/gi, '') // Remove javascript: protocols
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  }

  // XSS prevention for dynamic content
  static escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Validate URLs to prevent open redirects
  static isValidRedirectUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url, window.location.origin);
      // Only allow same origin redirects
      return parsedUrl.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  // Generate secure nonce for CSP
  static generateNonce(): string {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
  }

  // Secure logging that doesn't expose sensitive data
  static secureLog(message: string, data?: any): void {
    if (import.meta.env.MODE === 'development') {
      // In development, log everything
      console.log(message, data);
    } else {
      // In production, only log non-sensitive info
      const sanitizedData = data ? this.sanitizeLogData(data) : undefined;
      console.log(message, sanitizedData);
    }
  }

  private static sanitizeLogData(data: any): any {
    if (typeof data === 'string') {
      // Mask potential tokens or passwords
      return data.replace(/(?:token|password|key).*?[:=]\s*["']?([^"'\s]+)["']?/gi, 
        (match, value) => match.replace(value, '*'.repeat(8)));
    }
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        if (/(?:token|password|key|secret)/i.test(key)) {
          sanitized[key] = '*'.repeat(8);
        } else {
          sanitized[key] = this.sanitizeLogData(value);
        }
      }
      return sanitized;
    }
    return data;
  }
}
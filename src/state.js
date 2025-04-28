/**
 * Generate a secure state parameter for OAuth flow
 */
export function generateStateParameter() {
  const timestamp = Date.now().toString(36);
  // Add a bit more randomness
  const random = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  return `secure-${timestamp}-${random}`;
} 
import Resolver from '@forge/resolver';
import { storage, webTrigger, asUser, route } from '@forge/api';
import crypto from 'crypto'; // For secure random generation
import { refreshOAuthToken } from './oauth'; // Needed by internal getUserAuthStatus

const resolver = new Resolver();

// 🔍 Context for global page (admin/user + secret + URLs)
resolver.define('getPageContext', async ({ context }) => {
  console.log('🚨 Context received:', JSON.stringify(context, null, 2));

  let accountId = context?.user?.accountId || null;

  if (!accountId) {
    try {
      const response = await asUser().requestJira(route`/rest/api/3/myself`);
      const data = await response.json();
      accountId = data.accountId || null;
    } catch (err) {
      console.error('❌ Failed to get user context via api.asUser():', err);
    }
  }

  if (!accountId) {
    return {
      accountId: null,
      isAdmin: false,
      secret: null,
      zapierWebhookUrl: null,
      error: 'No user context available (even via fallback)'
    };
  }

  const res = await asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  const data = await res.json();
  const isAdmin = data?.permissions?.ADMINISTER?.havePermission || false;
  const secret = isAdmin ? await storage.get('zapier-secret') : null;

  // Fetch Zapier Webhook URL if admin
  let zapierWebhookUrl = null;
  if (isAdmin) {
    try {
      zapierWebhookUrl = await webTrigger.getUrl('zapier-webhook-trigger');
      console.log(`[getPageContext] Fetched Zapier webhook URL: ${zapierWebhookUrl}`);
    } catch (err) {
      console.error(`[getPageContext] ❌ Failed to get Zapier webhook URL: ${err.message}`);
      // Don't fail the whole request, just log the error
    }
  }

  // Check if user has authenticated with OAuth
  const userAuth = await checkUserAuthentication(accountId);

  return {
    accountId,
    isAdmin,
    secret,
    zapierWebhookUrl,
    authenticated: userAuth.authenticated,
    expiresAt: userAuth.expiresAt,
    timestamp: userAuth.timestamp,
    error: null
  };
});

// 🔐 Generate a new Zapier secret
resolver.define('setNewSecret', async () => {
  const newSecret = generateRandomSecret();
  await storage.set('zapier-secret', newSecret);
  return newSecret;
});

// 🔗 Provide OAuth login URL (secure via env vars)
resolver.define('getOAuthLoginUrl', async ({ context }) => {
  const functionName = 'getOAuthLoginUrl';
  console.log(`[${functionName}] Generating OAuth URL...`);
  try {
    const CLIENT_ID = process.env.CLIENT_ID;
    if (!CLIENT_ID) throw new Error('OAuth Client ID configuration missing');

    let redirectUri;
    try {
      redirectUri = await webTrigger.getUrl('oauth-callback-trigger');
      console.log(`[${functionName}] Redirect URI: ${redirectUri}`);
    } catch (urlError) {
      console.error(`[${functionName}] Failed to get webtrigger URL:`, urlError);
      throw new Error('Failed to generate redirect URL.');
    }

    const authUrl = constructOAuthUrl(CLIENT_ID, redirectUri); // Call helper without state
    console.log(`[${functionName}] Constructed OAuth URL.`);
    return authUrl;
  } catch (error) {
    console.error(`[${functionName}] Error: ${error.message}`, error);
    throw new Error(`Failed to generate authorization URL: ${error.message}`);
  }
});

/**
 * Construct the OAuth URL with all required parameters
 */
function constructOAuthUrl(clientId, redirectUri) {
  const encodedRedirectUri = encodeURIComponent(redirectUri);
  const scopes = 'read:me read:account read:jira-user write:jira-work offline_access';
  const encodedScopes = encodeURIComponent(scopes);

  // Construct URL without state
  return `https://auth.atlassian.com/authorize`
    + `?audience=api.atlassian.com`
    + `&client_id=${clientId}`
    + `&scope=${encodedScopes}`
    + `&redirect_uri=${encodedRedirectUri}`
    + `&response_type=code`
    + `&prompt=consent`;
}

/**
 * @name getUserAuthStatus
 * @description Checks if the current user has valid OAuth tokens stored.
 * Called by the frontend to determine UI state.
 */
resolver.define('getUserAuthStatus', async (req) => {
  console.log("[getUserAuthStatus] Checking auth status...");
  const { accountId } = req.context;
  if (!accountId) {
    console.warn("[getUserAuthStatus] No accountId found in context.");
    return { authenticated: false, error: 'User context not found' };
  }

  const tokenStorageKey = `oauth_token:${accountId}`;
  console.log(`[getUserAuthStatus] Checking storage for key: ${tokenStorageKey}`);
  try {
    const tokenData = await storage.get(tokenStorageKey);

    if (!tokenData || !tokenData.accessToken || !tokenData.expiresAt) {
      console.log("[getUserAuthStatus] No valid token data found in storage.");
      return { authenticated: false };
    }

    // Check for expiration (with a 60-second buffer)
    const now = Date.now();
    const bufferSeconds = 60 * 1000;
    if (tokenData.expiresAt < (now + bufferSeconds)) {
      console.log("[getUserAuthStatus] Token is expired or nearing expiration. Attempting refresh...");
      if (!tokenData.refreshToken) {
        console.warn("[getUserAuthStatus] Token expired, but no refresh token available.");
        await storage.delete(tokenStorageKey); // Clean up expired token without refresh
        return { authenticated: false, error: 'Session expired' };
      }
      
      try {
        const refreshedToken = await refreshOAuthToken(accountId, tokenData.refreshToken);
        console.log("[getUserAuthStatus] ✅ Token refreshed successfully.");
        // Return status based on the *newly* refreshed token
        return {
          authenticated: true,
          expiresAt: refreshedToken.expiresAt, // Use the new expiry
          timestamp: refreshedToken.timestamp || refreshedToken.lastRefreshed || Date.now() // Use new timestamp if available, else now
        };
      } catch (refreshError) {
        console.error(`[getUserAuthStatus] ❌ Token refresh failed: ${refreshError.message}`);
        // If refresh fails (e.g., invalid grant), delete the invalid token and return unauthenticated
        await storage.delete(tokenStorageKey); 
        return { authenticated: false, error: 'Session expired, refresh failed' };
      }
    } else {
      console.log("[getUserAuthStatus] ✅ Valid token found.");
      // Return details from the existing valid token
      return {
        authenticated: true,
        expiresAt: tokenData.expiresAt,
        timestamp: tokenData.timestamp // Use the original timestamp from storage
      };
    }

  } catch (error) {
    console.error(`[getUserAuthStatus] ❌ Error reading from storage: ${error.message}`);
    return { authenticated: false, error: 'Storage access error' };
  }
});

// 🔄 Get a valid access token for API calls
resolver.define('getAccessToken', async ({ context }) => {
  const accountId = context?.user?.accountId;
  
  if (!accountId) {
    throw new Error('No user context available');
  }
  
  const tokenResult = await getValidAccessToken(accountId);
  
  if (!tokenResult.valid) {
    throw new Error(tokenResult.error || 'Failed to get a valid access token');
  }
  
  return { accessToken: tokenResult.accessToken };
});

/**
 * Check if a user has authenticated and has valid tokens
 */
async function checkUserAuthentication(accountId) {
  console.log(`[checkUserAuthentication] Checking for accountId: ${accountId}`);
  if (!accountId) {
    console.log("[checkUserAuthentication] No accountId provided.");
    return { authenticated: false, error: 'No account ID provided' };
  }

  const tokenStorageKey = `oauth_token:${accountId}`;
  console.log(`[checkUserAuthentication] Attempting to get token from storage key: ${tokenStorageKey}`);
  let tokenData;
  try {
    tokenData = await storage.get(tokenStorageKey);
    console.log(`[checkUserAuthentication] Raw data retrieved from storage for key ${tokenStorageKey}:`, JSON.stringify(tokenData, null, 2));
  } catch (error) {
    console.error(`[checkUserAuthentication] ❌ Error during storage.get for key ${tokenStorageKey}:`, error);
    return { authenticated: false, error: `Failed to read storage: ${error.message}` };
  }
    
  if (!tokenData || !tokenData.accessToken) {
    console.log(`[checkUserAuthentication] No valid tokenData or accessToken found.`);
    return { authenticated: false, error: 'No tokens found' };
  }
  
  console.log(`[checkUserAuthentication] Token data found. Checking expiration...`);
  // Check if token is expired (with 5 minute buffer)
  const now = Date.now();
  const expiresAt = tokenData.expiresAt;
  const isExpired = expiresAt && expiresAt < (now + 5 * 60 * 1000);
  console.log(`[checkUserAuthentication] Now=${now}, ExpiresAt=${expiresAt}, IsExpired=${isExpired}`);
  
  if (isExpired) {
      console.log(`[checkUserAuthentication] Token is expired.`);
      if (!tokenData.refreshToken) {
        console.log(`[checkUserAuthentication] No refresh token available.`);
        return { authenticated: false, error: 'Token expired and no refresh token available' };
      } else {
        // Note: This function only checks, it doesn't refresh. Refresh happens in getValidAccessToken
        console.log(`[checkUserAuthentication] Refresh token IS available (but not refreshing here).`);
        // We still consider them 'authenticated' in the sense that they *could* refresh
        // Or perhaps return false here? Depends on desired UX. Let's return true for now, 
        // assuming getValidAccessToken will handle refresh when needed.
      }
  }
    
  console.log(`[checkUserAuthentication] Returning authenticated: true`);
  return { 
    authenticated: true,
    expiresAt: tokenData.expiresAt,
    isExpired // Let the frontend know if it's expired, even if refresh is possible
  };
}

/**
 * Get a valid access token, refreshing if necessary
 */
async function getValidAccessToken(accountId) {
  if (!accountId) {
    return { valid: false, error: 'No account ID provided' };
  }

  try {
    const tokenData = await storage.get(`oauth_token:${accountId}`);
    
    if (!tokenData || !tokenData.accessToken) {
      return { valid: false, error: 'No tokens found' };
    }
    
    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    const isExpired = tokenData.expiresAt && tokenData.expiresAt < (now + 5 * 60 * 1000);
    
    // If not expired, return the existing token
    if (!isExpired) {
      return { 
        valid: true, 
        accessToken: tokenData.accessToken,
        expiresAt: tokenData.expiresAt
      };
    }
    
    // If expired but we have refresh token, try to refresh
    if (tokenData.refreshToken) {
      try {
        const refreshedData = await refreshOAuthToken(accountId, tokenData.refreshToken);
        
        return { 
          valid: true, 
          accessToken: refreshedData.accessToken,
          expiresAt: refreshedData.expiresAt,
          refreshed: true
        };
      } catch (refreshError) {
        console.error('❌ Error refreshing token:', refreshError);
        return { valid: false, error: 'Failed to refresh token' };
      }
    }
    
    return { valid: false, error: 'Token expired and no refresh token available' };
  } catch (error) {
    console.error('❌ Error getting access token:', error);
    return { valid: false, error: error.message };
  }
}

function generateRandomSecret(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// 🧹 Cleanup old state parameters 
// Called automatically when generating new login URLs
async function cleanupOldStates(accountId) {
  if (!accountId) return;
  
  try {
    // Look for existing state for this user and clean it up
    const oldState = await storage.get(`oauth_state:${accountId}`);
    
    if (oldState) {
      // If state is older than 15 minutes, clean it up
      const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000; 
      
      if (oldState.createdAt < fifteenMinutesAgo) {
        await storage.delete(`oauth_state:${accountId}`);
        console.log(`🧹 Cleaned up expired state for user: ${accountId}`);
      }
    }
  } catch (error) {
    console.error('❌ Error cleaning up old states:', error);
  }
}

// --- Helper: Generate Secure Random String ---
/**
 * Generates a cryptographically secure random string.
 * @param {number} length - The desired length of the string.
 * @returns {string} A random URL-safe base64 string.
 */
function generateSecureRandomString(length = 32) {
  return crypto.randomBytes(Math.ceil(length * 3 / 4))
    .toString('base64')
    .slice(0, length)
    .replace(/\+/g, '0')
    .replace(/\//g, '_');
}

// --- Resolver Definition: Get Admin Page Context ---
/**
 * Fetches all necessary data for the Admin/Global page UI.
 * Includes Admin status, OAuth status, Zapier secret, and webhook URLs.
 */
resolver.define('getAdminPageContext', async ({ context }) => {
  const functionName = 'getAdminPageContext';
  console.log(`[${functionName}] Fetching admin page context...`);
  const accountId = context?.accountId;

  if (!accountId) {
    console.error(`[${functionName}] No accountId found in context.`);
    return {
        isAdmin: false, // Assume not admin if no context
        authStatus: { authenticated: false, error: 'User context not found' },
        zapierSecret: null,
        webhookUrls: null,
        error: 'User context not found'
    };
  }

  console.log(`[${functionName}] User accountId: ${accountId}`);

  try {
    // --- Check Admin Permissions --- 
    let isAdmin = false;
    try {
        console.log(`[${functionName}] Checking ADMINISTER permission...`);
        const res = await asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
        const data = await res.json();
        isAdmin = data?.permissions?.ADMINISTER?.havePermission || false;
        console.log(`[${functionName}] User isAdmin: ${isAdmin}`);
    } catch (permError) {
         console.error(`[${functionName}] Failed to check admin permissions:`, permError);
         // Decide how to handle - fail, or assume not admin? Assume not admin.
    }
    // --- End Check Admin Permissions ---

    // 1. Get OAuth Status
    const authStatus = await getUserAuthStatus(context); // Use the internal helper
    console.log(`[${functionName}] Auth Status:`, authStatus);

    // 2. Get Zapier Secret (Value) - Only fetch if admin for efficiency?
    // Let's fetch regardless for now, UI can decide to show/hide
    let zapierSecret = null;
    const secretKey = 'zapierSharedSecret';
    try {
      zapierSecret = await storage.getSecret(secretKey);
      console.log(`[${functionName}] Zapier secret ${zapierSecret ? 'retrieved' : 'not set'}.`);
    } catch (e) {
      console.error(`[${functionName}] Error retrieving secret from storage key '${secretKey}':`, e);
      zapierSecret = '{Error retrieving secret}';
    }

    // 3. Get Webhook URLs
    let webhookUrls = { create: null, update: null, delete: null };
    try {
        webhookUrls.create = await webTrigger.getUrl('worklog-create-trigger');
        webhookUrls.update = await webTrigger.getUrl('worklog-update-trigger');
        webhookUrls.delete = await webTrigger.getUrl('worklog-delete-trigger');
        console.log(`[${functionName}] Webhook URLs retrieved:`, webhookUrls);
    } catch (urlError) {
        console.error(`[${functionName}] Failed to retrieve one or more webhook URLs:`, urlError);
    }

    return {
      isAdmin, // Return admin status
      authStatus,
      zapierSecret,
      webhookUrls,
      error: null
    };

  } catch (error) {
      console.error(`[${functionName}] Unexpected error fetching admin context:`, error);
      return {
          isAdmin: false, // Assume not admin on error
          authStatus: { authenticated: false, error: 'Error fetching context' },
          zapierSecret: null,
          webhookUrls: null,
          error: `Failed to fetch admin context: ${error.message}`
      };
  }
});


// --- Resolver Definition: Regenerate Zapier Secret ---
/**
 * Generates a new Zapier shared secret, saves it using storage.setSecret,
 * and returns the new secret.
 */
resolver.define('regenerateZapierSecret', async () => {
  const functionName = 'regenerateZapierSecret';
  console.log(`[${functionName}] Attempting to regenerate secret...`);
  try {
    const newSecret = generateSecureRandomString(32);
    const storageKey = 'zapierSharedSecret';
    await storage.setSecret(storageKey, newSecret);
    console.log(`[${functionName}] Successfully stored new secret.`);
    return { newSecret: newSecret };
  } catch (error) {
      console.error(`[${functionName}] Failed to set new secret:`, error);
      throw new Error(`Failed to regenerate secret: ${error.message}`);
  }
});


// --- Helper: Get User Auth Status (Internal, called by getAdminPageContext) ---
/**
 * Checks if the current user has valid OAuth tokens stored.
 * Attempts to refresh the token if it's expired or nearing expiry.
 * @param {Object} req - The request object containing context.accountId.
 * @returns {Promise<Object>} - Object with authenticated status, expiry, timestamp, error.
 */
async function getUserAuthStatus(reqContext) {
  const functionName = 'getUserAuthStatus';
  console.log(`[${functionName}] Checking auth status...`);
  const { accountId } = reqContext;
  if (!accountId) {
    console.warn(`[${functionName}] No accountId found in context.`);
    return { authenticated: false, error: 'User context not found' };
  }

  const tokenStorageKey = `oauth_token:${accountId}`;
  console.log(`[${functionName}] Checking storage for key: ${tokenStorageKey}`);
  try {
    const tokenData = await storage.get(tokenStorageKey);

    if (!tokenData || !tokenData.accessToken || !tokenData.expiresAt) {
      console.log(`[${functionName}] No valid token data found in storage.`);
      return { authenticated: false };
    }

    const now = Date.now();
    const bufferSeconds = 60 * 1000;
    if (tokenData.expiresAt < (now + bufferSeconds)) {
      console.log(`[${functionName}] Token is expired or nearing expiration.`);
      if (!tokenData.refreshToken) {
        console.warn(`[${functionName}] Token expired, but no refresh token available.`);
        await storage.delete(tokenStorageKey);
        return { authenticated: false, error: 'Session expired' };
      }

      console.log(`[${functionName}] Attempting token refresh...`);
      try {
        await refreshOAuthToken(accountId, tokenData.refreshToken);
        console.log(`[${functionName}] Token refreshed successfully via imported function.`);
        const refreshedTokenData = await storage.get(tokenStorageKey);
        return {
          authenticated: true,
          expiresAt: refreshedTokenData?.expiresAt,
          timestamp: refreshedTokenData?.timestamp
        };
      } catch (refreshError) {
        console.error(`[${functionName}] Token refresh failed: ${refreshError.message}`);
        if (refreshError.requiresReAuthentication || refreshError.message.includes("re-authenticate")) {
             await storage.delete(tokenStorageKey);
             return { authenticated: false, error: 'Session expired, re-authentication required' };
        } else {
             return { authenticated: false, error: 'Session expired, refresh failed' };
        }
      }
    } else {
      console.log(`[${functionName}] Valid token found.`);
      return {
        authenticated: true,
        expiresAt: tokenData.expiresAt,
        timestamp: tokenData.timestamp
      };
    }
  } catch (error) {
    console.error(`[${functionName}] Error accessing storage: ${error.message}`);
    return { authenticated: false, error: 'Storage access error' };
  }
}

// === EXPORT THE RESOLVER DEFINITIONS ===
export const handler = resolver.getDefinitions();
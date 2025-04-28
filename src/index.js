import Resolver from '@forge/resolver';
import { storage, webTrigger, asUser, route } from '@forge/api';
import { refreshOAuthToken } from './oauth';
import { generateStateParameter } from './state';

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
  try {
    console.log('🔍 Generating OAuth URL, context:', JSON.stringify({ 
      hasContext: !!context, 
      hasUser: !!context?.user,
      accountId: context?.user?.accountId || 'none'
    }));
    
    const CLIENT_ID = process.env.CLIENT_ID;
    
    if (!CLIENT_ID) {
      console.error('❌ Missing OAuth configuration: CLIENT_ID');
      throw new Error('OAuth Client ID configuration is missing');
    }
    
    // Get the URL for the dedicated OAuth callback webtrigger
    let redirectUri;
    try {
      redirectUri = await webTrigger.getUrl('oauth-callback-trigger');
      console.log(`✅ Successfully obtained OAuth redirect URI: ${redirectUri}`);
    } catch (urlError) {
      console.error(`❌ Failed to get webtrigger URL for 'oauth-callback-trigger': ${urlError.message}`, urlError);
      throw new Error('Failed to generate redirect URL. Ensure manifest is correct and deployed.');
    }

    // Get the account ID if available
    const accountId = context?.user?.accountId;
    
    // Generate a unique state parameter for security
    const state = generateStateParameter();
    
    // Create the redirect URI with standard OAuth parameters
    const authUrl = constructOAuthUrl(CLIENT_ID, redirectUri, state);
    
    // Only try to store state if we have an account ID
    if (accountId) {
      try {
        // Store the state parameter for this user
        await storage.set(`oauth_state:${accountId}`, {
          state,
          createdAt: Date.now()
        });
        console.log(`✅ Stored OAuth state for user: ${accountId}`);
      } catch (storageError) {
        // Just log the error but don't fail the overall request
        console.error(`⚠️ Failed to store OAuth state: ${storageError.message}`);
      }
    } else {
      console.log(`ℹ️ No user context available, proceeding without state storage`);
    }
    
    console.log(`🔗 Constructed final OAuth URL: ${authUrl}`);
    return authUrl;
  } catch (error) {
    console.error(`❌ Error generating OAuth URL: ${error.message}`, error);
    // Provide a more specific error message if possible
    const finalMessage = error.message.includes('Failed to generate redirect URL') 
      ? error.message 
      : `Failed to generate authorization URL: ${error.message}`;
    throw new Error(finalMessage);
  }
});

/**
 * Construct the OAuth URL with all required parameters
 */
function constructOAuthUrl(clientId, redirectUri, state) {
  // Use proper URL encoding for all parameters
  const encodedRedirectUri = encodeURIComponent(redirectUri);
  const scopes = 'read:me read:account read:jira-user write:jira-work offline_access';
  const encodedScopes = encodeURIComponent(scopes);
  const encodedState = encodeURIComponent(state);
  
  return `https://auth.atlassian.com/authorize`
    + `?audience=api.atlassian.com`
    + `&client_id=${clientId}`
    + `&scope=${encodedScopes}`
    + `&redirect_uri=${encodedRedirectUri}`
    + `&state=${encodedState}`
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

export const handler = resolver.getDefinitions();

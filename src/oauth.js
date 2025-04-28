import { storage, webTrigger } from "@forge/api";

// Helper function to create the error response HTML
function createErrorHtml(message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Error</title>
      <script>
        if (window.opener && typeof window.opener.postMessage === 'function') {
          console.log('[Popup Script] Sending postMessage: oauth_failure');
          window.opener.postMessage('oauth_failure', '*');
        } else {
           console.warn('[Popup Script] window.opener or window.opener.postMessage not available.');
        }
        console.log('[Popup Script] Attempting window.close() after error');
        window.close();
      </script>
    </head>
    <body>
      <div style="text-align: center; padding-top: 50px; font-family: sans-serif;">
        <h2>❌ Authentication Error</h2>
        <p>${message}</p>
        <p>This window should close automatically. If not, please close it manually.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Handler specifically for the OAuth Callback
 */
export async function oauthCallbackHandler(req) {
  console.log('[oauthCallbackHandler] Started (Diagnostic Mode).');
  let accountId = ''; // Initialize accountId for use in catch blocks
  try {
    // Log the raw request object for debugging
    console.log("OAuth Raw request object received:", JSON.stringify(req, null, 2));
    
    // Construct a URL object from the request query parameters
    const queryParams = req?.queryParameters || {};
    let urlObj;
    const baseUrl = 'https://forge-placeholder.net'; // Base is needed for URL constructor
    try {
      const searchParams = new URLSearchParams();
      for (const key in queryParams) {
        if (queryParams[key] && queryParams[key].length > 0) {
          searchParams.append(key, queryParams[key][0]);
        }
      }
      // Construct a string URL including the query params
      const urlString = `${baseUrl}?${searchParams.toString()}`;
      urlObj = new URL(urlString);
      console.log(`Constructed URL for OAuth processing: ${urlObj.href}`);
    } catch (err) {
      console.error(`❌ Failed to construct URL object from query params`, err);
      return createErrorResponse(`Invalid request data format`, 400);
    }

    // Now proceed with the original OAuth callback logic, using the constructed urlObj
    
    // Step 1: Extract parameters (now from urlObj)
    console.log("Step 1: Extracting parameters...");
    const code = urlObj.searchParams.get("code");
    const error = urlObj.searchParams.get("error");
    const errorDescription = urlObj.searchParams.get("error_description");
    const state = urlObj.searchParams.get("state");
    console.log(`Params extracted: code exists=${!!code}, state=${state}, error=${error || 'none'}`);

    // Step 2: Handle direct OAuth error responses
    console.log("Step 2: Checking for direct OAuth errors...");
    if (error) {
      console.error(`❌ OAuth Error (from auth server): ${error} - ${errorDescription}`);
      return createErrorResponse(`Authentication error: ${error}. ${errorDescription || ''}`, 400);
    }
    console.log("No direct OAuth errors found.");

    // Step 3: Check required parameters
    console.log("Step 3: Validating required parameters (code, state)...");
    if (!code) {
      console.error("❌ Missing 'code' parameter");
      return createErrorResponse("Missing authorization code parameter", 400);
    }
    if (!state || !state.startsWith('secure-')) {
      console.error(`❌ Invalid state parameter format: ${state}`);
      return createErrorResponse("Invalid security parameter", 400);
    }
    console.log("Required parameters are present and valid format.");

    // Step 4: Get OAuth credentials
    console.log("Step 4: Retrieving OAuth credentials from environment...");
    const CLIENT_ID = process.env.CLIENT_ID;
    const CLIENT_SECRET = process.env.CLIENT_SECRET;
    // Get the Redirect URI dynamically for this trigger
    let REDIRECT_URI;
    try {
        REDIRECT_URI = await webTrigger.getUrl('oauth-callback-trigger');
    } catch (urlError) {
        console.error(`❌ Failed to get self webtrigger URL: ${urlError.message}`);
        return createErrorResponse("Server configuration error (cannot get redirect URI)", 500);
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error("❌ Missing required OAuth credentials in environment variables (ID or Secret)");
      return createErrorResponse("Server configuration error", 500);
    }
    console.log("OAuth credentials and Redirect URI retrieved.");

    // Step 5: Exchange code for token
    console.log("Step 5: Exchanging authorization code for access token...");
    let tokenData;
    let cloudId;
    try {
      const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: REDIRECT_URI // Use the dynamically obtained URI
        })
      });
      console.log(`Token exchange response status: ${tokenResponse.status}`);

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error(`❌ Token exchange failed: ${tokenResponse.status} - ${errorText}`);
        return createErrorResponse("Failed to get access token. Please try again.", tokenResponse.status >= 500 ? 502 : 500);
      }

      tokenData = await tokenResponse.json();
      console.log(`Token exchange successful. Received access token: ${!!tokenData.access_token}, refresh token: ${!!tokenData.refresh_token}`);

      if (!tokenData.access_token) {
        console.error("❌ Token exchange response missing access_token:", JSON.stringify(tokenData));
        return createErrorResponse("Invalid token response from authorization server", 500);
      }

      // Step 5.5: Get Accessible Resources (including cloudId)
      console.log("Step 5.5: Fetching accessible resources (cloudId)...");
      try {
          const resourcesResponse = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
              method: 'GET',
              headers: {
                  Authorization: `Bearer ${tokenData.access_token}`,
                  Accept: 'application/json',
              },
          });
          console.log(`Accessible resources response status: ${resourcesResponse.status}`);

          if (!resourcesResponse.ok) {
              const errorText = await resourcesResponse.text();
              console.error(`❌ Accessible resources request failed: ${resourcesResponse.status} - ${errorText}`);
              // Proceed without cloudId for now, but log the error. Crucial APIs might fail later.
              // Depending on requirements, you might want to return an error here.
              // return createErrorResponse("Failed to get site information needed for API calls", resourcesResponse.status >= 500 ? 502 : 500);
          } else {
              const resources = await resourcesResponse.json();
              // Assuming the user has access to at least one Jira site
              // Find the first Jira site resource. Adjust if multiple site handling is needed.
              const jiraResource = resources.find(resource => resource.url && resource.url.includes('.atlassian.net') && resource.scopes.some(s => s.startsWith('read:jira') || s.startsWith('write:jira'))); // Basic check for a Jira site URL

              if (jiraResource && jiraResource.id) {
                  cloudId = jiraResource.id;
                  console.log(`✅ Found cloudId: ${cloudId}`);
              } else {
                  console.warn("⚠️ Could not find a suitable Jira cloudId in accessible resources.", JSON.stringify(resources));
                  // Proceed without cloudId, but critical functions will fail.
                  // Consider returning an error or guiding the user if cloudId is absolutely required.
              }
          }
      } catch (resourceError) {
        console.error(`❌ Network or unexpected error fetching accessible resources: ${resourceError.message}`, resourceError);
        // Proceed without cloudId
      }
    } catch (tokenError) {
      console.error(`❌ Network or unexpected error during token exchange: ${tokenError.message}`, tokenError);
      return createErrorResponse("Error contacting authorization server", 500);
    }

    // Step 6: Get user info
    console.log("Step 6: Fetching user info using access token...");
    let userInfo;
    try {
      const userInfoRes = await fetch("https://api.atlassian.com/me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      console.log(`User info response status: ${userInfoRes.status}`);

      if (!userInfoRes.ok) {
        const errorText = await userInfoRes.text();
        console.error(`❌ User info request failed: ${userInfoRes.status} - ${errorText}`);
        return createErrorResponse("Failed to get user information", userInfoRes.status >= 500 ? 502 : 500);
      }

      userInfo = await userInfoRes.json();
      console.log(`User info received: account_id=${userInfo.account_id}`);
    } catch (userInfoError) {
      console.error(`❌ Network or unexpected error fetching user info: ${userInfoError.message}`, userInfoError);
      return createErrorResponse("Error fetching user information", 500);
    }

    // Step 7: Validate account ID
    console.log("Step 7: Validating account ID from user info...");
    accountId = userInfo.account_id;
    if (!accountId || typeof accountId !== 'string') {
      console.error("❌ Invalid account ID in user info:", userInfo);
      return createErrorResponse("Invalid user account information", 400);
    }
    console.log(`Account ID validated: ${accountId}`);

    // Step 8: Validate state parameter (optional but recommended)
    console.log("Step 8: Validating state parameter...");
    try {
      const storedStateData = await storage.get(`oauth_state:${accountId}`);
      if (storedStateData && storedStateData.state) {
        if (storedStateData.state !== state) {
          console.warn(`⚠️ State mismatch for user ${accountId}: expected ${storedStateData.state}, got ${state}. Continuing, but this is a potential security risk.`);
        } else {
          console.log(`✅ State validation successful for user: ${accountId}`);
        }
        // Attempt to clean up the state data regardless
        try {
          await storage.delete(`oauth_state:${accountId}`);
          console.log(`State data deleted for user: ${accountId}`);
        } catch (deleteError) {
          console.warn(`⚠️ Failed to delete state data for user ${accountId}: ${deleteError.message}`);
        }
      } else {
        console.log(`ℹ️ No stored state found for user: ${accountId}. Cannot perform full state validation.`);
      }
    } catch (stateError) {
      console.warn(`⚠️ Error checking/deleting state: ${stateError.message}. Continuing flow.`);
    }

    // Step 9: Store tokens
    console.log("[oauthCallbackHandler] Step 9: Storing tokens...");
    const tokenStorageKey = `oauth_token:${accountId}`;
    const tokenPayload = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      scopes: tokenData.scope ? tokenData.scope.split(' ') : [],
      cloudId: cloudId,
      userInfo: {
        accountId: userInfo.account_id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture
      },
      timestamp: Date.now()
    };
    
    console.log(`[oauthCallbackHandler] Attempting storage.set for key ${tokenStorageKey} with payload containing cloudId: ${!!cloudId}`);
    try {
      await storage.set(tokenStorageKey, tokenPayload);
      console.log(`[oauthCallbackHandler] ✅ Successfully stored tokens.`);
    } catch (storageError) {
      console.error(`[oauthCallbackHandler] ❌ storage.set FAILED: ${storageError.message}`, storageError);
      const errorHtml = createErrorHtml("Failed to save authorization data internally.");
      return new Response(errorHtml, { status: 500, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
    }

    // Step 10: Success - Return simple plain text (DIAGNOSTIC)
    console.log("[oauthCallbackHandler] Step 10: Success. Returning PLAIN TEXT response (Diagnostic)...");
    const successText = `Authentication successful! Account ${accountId} is connected. You can now close this window manually.`;
    console.log("[oauthCallbackHandler] Finished Successfully (Diagnostic Mode).");
    return new Response(successText, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store'
        }
      });

  } catch (err) {
    // Ensure accountId is captured if available before the error occurred
    // This is a best-effort for logging context
    const capturedAccountId = accountId || 'unknown'; 
    console.error(`[oauthCallbackHandler] ❌ UNEXPECTED ERROR (Account: ${capturedAccountId}): ${err.message}`, err.stack);
    const errorHtml = createErrorHtml(`An unexpected error occurred during authentication: ${err.message}`);
    // Return error page HTML to browser
    console.log("[oauthCallbackHandler] Finished with Unexpected Error.");
    return new Response(errorHtml, { status: 500, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
  }
}

/**
 * Helper function to refresh an OAuth token
 * Can be called from other parts of your app when tokens expire
 */
export async function refreshOAuthToken(accountId, refreshToken) {
  if (!accountId || !refreshToken) {
    throw new Error("Missing required parameters for token refresh");
  }

  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing OAuth client credentials");
  }

  const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Token refresh failed: ${tokenResponse.status} - ${errorText}`);
  }

  const tokenData = await tokenResponse.json();
  
  if (!tokenData.access_token) {
    throw new Error("Invalid token refresh response");
  }

  // Update the stored token
  const storedToken = await storage.get(`oauth_token:${accountId}`);
  if (!storedToken) {
    throw new Error("No existing token found to update");
  }

  const updatedToken = {
    ...storedToken,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || storedToken.refreshToken,
    expiresAt: Date.now() + (tokenData.expires_in * 1000),
    lastRefreshed: Date.now()
  };

  await storage.set(`oauth_token:${accountId}`, updatedToken);
  return updatedToken;
}

/**
 * Create a standardized error response
 */
function createErrorResponse(message, status = 400) {
  return new Response(`
    <html>
    <head>
      <title>Authentication Error</title>
      <script>
        // Auto-close after 10 seconds
        setTimeout(function() {
          window.close();
        }, 10000);
      </script>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', sans-serif;
          text-align: center;
          padding: 40px 20px;
          color: #172B4D;
          background-color: #F4F5F7;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          min-height: 70vh;
        }
        .card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 8px rgba(9, 30, 66, 0.15);
          padding: 32px;
          max-width: 480px;
          width: 100%;
        }
        .error-icon {
          font-size: 48px;
          margin-bottom: 16px;
          color: #BF2600;
        }
        .message {
          font-size: 20px;
          font-weight: 500;
          margin: 16px 0;
          color: #BF2600;
        }
        .detail {
          font-size: 14px;
          color: #6B778C;
          margin-bottom: 24px;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="error-icon">❌</div>
        <div class="message">Authentication Error</div>
        <div class="detail">${message}</div>
        <div class="detail">This window will close automatically in 10 seconds...</div>
      </div>
    </body>
    </html>
  `, {
    status,
    headers: { 
      "Content-Type": "text/html",
      "Cache-Control": "no-store"
    }
  });
} 
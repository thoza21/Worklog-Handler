import { storage, webTrigger } from "@forge/api";

function createPopupHtml(success, message) {
  const icon = success ? "✅" : "❌";
  const heading = success ? "Authentication Successful" : "Authentication Failed";
  const targetOriginScript = `
    const targetOrigin = document.referrer ? new URL(document.referrer).origin : '*';
    if (window.opener && typeof window.opener.postMessage === 'function') {
      window.opener.postMessage({
        type: '${success ? 'oauth_success' : 'oauth_failure'}',
        message: ${JSON.stringify(message)}
      }, targetOrigin);
    }
    setTimeout(() => window.close(), 3000);
  `;
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${heading}</title>
        <script>${targetOriginScript}</script>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', sans-serif; text-align: center; padding: 40px 20px; color: #172B4D; background-color: #F4F5F7; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 70vh; }
          .card { background: white; border-radius: 8px; box-shadow: 0 4px 8px rgba(9, 30, 66, 0.15); padding: 32px; max-width: 480px; width: 100%; }
          .icon { font-size: 48px; margin-bottom: 16px; color: ${success ? '#00875A' : '#BF2600'}; }
          .message { font-size: 20px; font-weight: 500; margin: 16px 0; color: ${success ? '#00875A' : '#BF2600'}; }
          .detail { font-size: 14px; color: #6B778C; margin-bottom: 24px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">${icon}</div>
          <div class="message">${heading}</div>
          <div class="detail">${message}</div>
          <div class="detail">This window will close automatically in 3 seconds...</div>
        </div>
      </body>
    </html>
  `;
}

function createErrorResponse(message) {
  return new Response(createPopupHtml(false, message), {
    status: 200, // Always 200 OK
    headers: { "Content-Type": "text/html", "Cache-Control": "no-store" }
  });
}

export async function oauthCallbackHandler(req) {
  console.log('[oauthCallbackHandler] Started.');
  let accountId = '';

  try {
    console.log("OAuth Raw request object received:", JSON.stringify(req, null, 2));
    
    const queryParams = req?.queryParameters || {};
    let urlObj;
    try {
      const searchParams = new URLSearchParams();
      for (const key in queryParams) {
        if (queryParams[key]?.length > 0) {
          searchParams.append(key, queryParams[key][0]);
        }
      }
      urlObj = new URL(`https://forge-placeholder.net?${searchParams.toString()}`);
    } catch (err) {
      console.error("Failed to construct URL:", err);
      return createErrorResponse("Invalid request data format");
    }

    const code = urlObj.searchParams.get("code");
    const error = urlObj.searchParams.get("error");
    const errorDescription = urlObj.searchParams.get("error_description");
    const state = urlObj.searchParams.get("state");

    if (error) {
      console.error(`OAuth Error: ${error} - ${errorDescription}`);
      return createErrorResponse(`Authentication error: ${error}`);
    }
    if (!code || !state || !state.startsWith('secure-')) {
      console.error("Missing code or invalid state.");
      return createErrorResponse("Missing authorization code or invalid state.");
    }

    const CLIENT_ID = process.env.CLIENT_ID;
    const CLIENT_SECRET = process.env.CLIENT_SECRET;
    let REDIRECT_URI;
    try {
      REDIRECT_URI = await webTrigger.getUrl('oauth-callback-trigger');
    } catch (urlError) {
      console.error("Failed to get webtrigger URL:", urlError);
      return createErrorResponse("Server configuration error (missing Redirect URI).");
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error("Missing CLIENT_ID or CLIENT_SECRET.");
      return createErrorResponse("Server configuration error (missing client credentials).");
    }

    let tokenData;
    try {
      const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: REDIRECT_URI,
          audience: "api.atlassian.com"
        })
      });

      if (!tokenResponse.ok) {
        console.error("Token exchange failed:", tokenResponse.status);
        return createErrorResponse("Failed to get access token.");
      }

      tokenData = await tokenResponse.json();
    } catch (tokenErr) {
      console.error("Error during token exchange:", tokenErr);
      return createErrorResponse("Error exchanging token.");
    }

    if (!tokenData?.access_token) {
      console.error("Missing access token in token response.");
      return createErrorResponse("Invalid access token response.");
    }

    let userInfo;
    try {
      const userInfoRes = await fetch("https://api.atlassian.com/me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });

      if (!userInfoRes.ok) {
        console.error("User info fetch failed:", userInfoRes.status);
        return createErrorResponse("Failed to fetch user information.");
      }

      userInfo = await userInfoRes.json();
    } catch (userInfoErr) {
      console.error("Error fetching user info:", userInfoErr);
      return createErrorResponse("Error retrieving user profile.");
    }

    accountId = userInfo?.account_id;
    if (!accountId) {
      console.error("Account ID missing in user info.");
      return createErrorResponse("Invalid user account.");
    }

    // --- Fetch Accessible Resources to get cloudId ---
    let cloudId = null;
    try {
      console.log("Fetching accessible resources...");
      const resourcesRes = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Accept': 'application/json' }
      });

      if (!resourcesRes.ok) {
        console.error("Accessible resources fetch failed:", resourcesRes.status);
        // Don't block auth, but log the error. Worklog handler will fail later if cloudId is needed.
      } else {
          const resources = await resourcesRes.json();
          if (resources && resources.length > 0) {
            // Assuming the first resource is the desired Jira site
            cloudId = resources[0].id; 
            console.log(`Found cloudId: ${cloudId}`);
          } else {
            console.warn("Accessible resources list is empty. Unable to determine cloudId.");
          }
      }
    } catch (resourcesErr) {
      console.error("Error fetching accessible resources:", resourcesErr);
      // Continue without cloudId, log the error
    }
    // --- End Fetch Accessible Resources ---

    const tokenStorageKey = `oauth_token:${accountId}`;
    const tokenPayload = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      scopes: tokenData.scope?.split(' ') || [],
      timestamp: Date.now(),
      cloudId: cloudId,
      accountId: accountId
    };

    try {
      await storage.set(tokenStorageKey, tokenPayload);
      console.log(`Token stored successfully for accountId: ${accountId}`);
    } catch (storageErr) {
      console.error("Error storing tokens:", storageErr);
      return createErrorResponse("Failed to save authorization data.");
    }

    console.log("OAuth completed successfully.");
    return new Response(createPopupHtml(true, "Authentication successful!"), {
      status: 200,
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" }
    });

  } catch (err) {
    console.error(`Unexpected error: ${err.message}`, err);
    return createErrorResponse("Unexpected server error.");
  }
}

export async function refreshOAuthToken(accountId, refreshToken) {
  if (!accountId || !refreshToken) {
    throw new Error("Missing required parameters.");
  }

  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing client credentials.");
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
    throw new Error(`Token refresh failed: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  if (!tokenData?.access_token) {
    throw new Error("Invalid token refresh response.");
  }

  const storedToken = await storage.get(`oauth_token:${accountId}`);
  if (!storedToken) {
    throw new Error("No token to refresh.");
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

import { storage, fetch } from '@forge/api';

// --- Token Refresh Logic ---
/**
 * Refreshes the OAuth access token using the refresh token.
 * Stores the new tokens (including rotated refresh token) in storage.
 * @param {string} userId - The Atlassian Account ID.
 * @param {string} refreshToken - The current refresh token.
 * @returns {Promise<string>} - The new access token.
 * @throws {Error} - If refresh fails, including specific error for re-authentication.
 */
export async function refreshAccessToken(userId, refreshToken) {
    console.log(`Attempting to refresh token for user ${userId}`);
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.error("CLIENT_ID or CLIENT_SECRET environment variables not set.");
        throw new Error("OAuth client configuration missing.");
    }
    if (!refreshToken) {
        console.error(`No refresh token found for user ${userId} during refresh attempt.`);
        throw new Error("Refresh token is missing, user needs to re-authenticate.");
    }

    const url = 'https://auth.atlassian.com/oauth/token';
    const body = {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Token refresh failed with status ${response.status}: ${errorBody}`);
            // Check for invalid_grant specifically
            if (response.status === 403 || response.status === 400 ) {
                 try {
                    const parsedError = JSON.parse(errorBody);
                    if (parsedError.error === 'invalid_grant') {
                         console.error(`Refresh token for user ${userId} is invalid or expired. Re-authentication required.`);
                         const refreshError = new Error("Refresh token invalid. Please re-authenticate the app.");
                         refreshError.requiresReAuthentication = true; // Add flag
                         throw refreshError;
                    }
                 } catch(e) {
                    // If it was our specific error, re-throw it
                    if (e.requiresReAuthentication) throw e;
                    // Otherwise, fall through to generic error
                 }
            }
            throw new Error(`Token refresh failed with status: ${response.status}`);
        }

        const tokenData = await response.json();
        const newAccessToken = tokenData.access_token;
        const newRefreshToken = tokenData.refresh_token; // Atlassian rotates refresh tokens

        if (!newAccessToken) {
             console.error("Token refresh response did not contain an access_token.");
             throw new Error("Failed to obtain new access token after refresh.");
        }

        console.log(`Successfully refreshed token for user ${userId}`);

        // --- Store Refreshed Tokens --- 
        const storageKey = `oauth_token:${userId}`;
        const existingUserData = await storage.get(storageKey) || {}; 
        const updatedUserData = {
            ...existingUserData, 
            accessToken: newAccessToken,
            // IMPORTANT: Store the new refresh token if one was provided
            ...(newRefreshToken && { refreshToken: newRefreshToken }),
            expiresAt: Date.now() + (tokenData.expires_in * 1000), 
            timestamp: Date.now() 
        };

        await storage.set(storageKey, updatedUserData);
        console.log(`Stored refreshed tokens for user ${userId} under key ${storageKey}`);

        return newAccessToken;

    } catch (error) {
        console.error('Error during token refresh:', error);
        // Propagate specific re-auth error, otherwise throw generic
        if (error.requiresReAuthentication) {
            throw error;
        }
        throw new Error('Failed to refresh access token.');
    }
}


// --- Jira API Call Logic ---
/**
 * Calls the Jira Cloud REST API (v3) worklog endpoint.
 * Handles POST, PUT, DELETE methods.
 * @param {string} method - HTTP method ('POST', 'PUT', 'DELETE').
 * @param {string} cloudId - The Jira site cloud ID.
 * @param {string} accessToken - The valid OAuth access token.
 * @param {string} issueKey - The Jira issue key (e.g., 'PROJ-123').
 * @param {Object} worklogData - Payload for POST/PUT (started, timeSpentSeconds). Ignored for DELETE.
 * @param {string|null} worklogId - The ID of the worklog for PUT/DELETE operations.
 * @returns {Promise<{status: number, response: Response}>} - The status code and raw fetch Response object.
 * @throws {Error} - If required parameters are missing for the operation.
 */
export async function callJiraApi(method, cloudId, accessToken, issueKey, worklogData, worklogId = null) {
    let url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/worklog`;
    
    // Validate and append worklogId for PUT/DELETE
    if (method === 'PUT' || method === 'DELETE') {
        if (!worklogId) {
            throw new Error(`Worklog ID is required for ${method} operation on issue ${issueKey}.`);
        }
        url += `/${worklogId}`;
    }

    console.log(`Calling Jira API: ${method} ${url}`);

    let requestBody = null;
    if (method === 'POST' || method === 'PUT') {
        // Validate required fields for POST/PUT body
        if (!worklogData || worklogData.timeSpentSeconds === undefined || !worklogData.started) {
             throw new Error(`Missing required fields (started, timeSpentSeconds) in worklog data for ${method} on issue ${issueKey}.`);
        }
        requestBody = JSON.stringify({
            started: worklogData.started,
            timeSpentSeconds: worklogData.timeSpentSeconds,
            // Example for adding comment later (requires ADF format):
            // ...(worklogData.comment && { comment: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: worklogData.comment }] }] } })
        });
    }
    
    const requestOptions = {
        method: method,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            ...(requestBody && { 'Content-Type': 'application/json' })
        },
        ...(requestBody && { body: requestBody })
    };

    try {
        const response = await fetch(url, requestOptions); 
        // Return the status and the raw Response object for the wrapper to handle
        return { status: response.status, response };
    } catch (error) {
        console.error('Error calling Jira API:', error);
        throw new Error('Network or unexpected error occurred while calling Jira API.');
    }
}


// --- Common API Call Wrapper with Retry ---
/**
 * Retrieves user auth data and calls the Jira API, handling token refresh and retry.
 * @param {string} accountId - The Atlassian Account ID of the user.
 * @param {string} apiMethod - 'POST', 'PUT', or 'DELETE'.
 * @param {string} issueKey - The Jira issue key.
 * @param {Object} payloadForApi - The data for the API call body (for POST/PUT).
 * @param {string|null} targetWorklogId - The worklog ID (for PUT/DELETE).
 * @returns {Promise<{status: number, response: Response}>} - The final API result after potential retry.
 * @throws {Error} - If auth data is missing, refresh fails irrecoverably, or API call fails irrecoverably.
 */
export async function callJiraApiWithRetry(accountId, apiMethod, issueKey, payloadForApi, targetWorklogId = null) {
    const storageKey = `oauth_token:${accountId}`;
    console.log(`Retrieving OAuth data for API call using key: ${storageKey}`);
    let userData;
    try {
        userData = await storage.get(storageKey);
        // Explicitly check for all required fields from storage
        if (!userData || !userData.accessToken || !userData.refreshToken || !userData.cloudId) {
            const missingFields = [
                !userData && 'userData object',
                userData && !userData.accessToken && 'accessToken',
                userData && !userData.refreshToken && 'refreshToken',
                userData && !userData.cloudId && 'cloudId'
            ].filter(Boolean).join(', ');
            console.error(`OAuth data incomplete or not found for user ${accountId}. Missing: ${missingFields}.`);
            throw new Error(`Authentication data incomplete for user ${accountId}. Missing: ${missingFields}. Please re-authenticate.`);
        }
        console.log(`Successfully retrieved user data for ${accountId}. cloudId: ${userData.cloudId}`);
    } catch (error) {
        // Catch errors from storage.get or the validation check
        console.error(`Failed to retrieve or validate storage for user ${accountId}:`, error);
        // Prefix the error message to make it clear it originated here
        throw new Error(`Could not retrieve user authentication data: ${error.message}`);
    }

    let currentAccessToken = userData.accessToken;
    let apiResult;

    try {
        // Initial API Call attempt
        console.log(`Attempting initial API call: ${apiMethod} for issue ${issueKey} (worklogId: ${targetWorklogId || 'N/A'})`);
        apiResult = await callJiraApi(apiMethod, userData.cloudId, currentAccessToken, issueKey, payloadForApi, targetWorklogId);

        // Handle Token Expiry (401 Unauthorized or 403 Forbidden)
        if (apiResult.status === 401 || apiResult.status === 403) {
            console.warn(`Received ${apiResult.status} on initial call for user ${accountId}. Attempting token refresh.`);
            try {
                currentAccessToken = await refreshAccessToken(accountId, userData.refreshToken);
                
                // --- Retry API Call with new token --- 
                console.log(`Retrying API call (${apiMethod}) for issue ${issueKey} with refreshed token.`);
                apiResult = await callJiraApi(apiMethod, userData.cloudId, currentAccessToken, issueKey, payloadForApi, targetWorklogId);
                console.log(`Retry API call completed with status: ${apiResult.status}`);

            } catch (refreshError) {
                console.error(`Failed to refresh token or retry API call for user ${accountId}:`, refreshError);
                // Re-throw the error from refreshAccessToken - it might require re-authentication
                throw refreshError; 
            }
        }
        // Return the final result (either from initial call or successful retry)
        return apiResult;

    } catch (error) {
        // Catch errors from callJiraApi or refreshAccessToken
         console.error(`Error during Jira API call/retry process for user ${accountId}:`, error);
         // Check if the error requires re-authentication explicitly
         if (error.requiresReAuthentication || (error.message && error.message.includes("re-authenticate"))) {
            // Throw a specific error upwards
            throw new Error(`Authentication failed for user ${accountId}. Please re-authenticate the app.`);
         }
         // Throw other errors (e.g., network, missing params from callJiraApi)
         throw new Error(`Failed to execute Jira API request: ${error.message}`);
    }
} 
import Resolver from '@forge/resolver';
import { storage, fetch } from '@forge/api';

// Helper function to refresh the access token
async function refreshAccessToken(userId, refreshToken) {
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
            // Specific handling for invalid_grant might indicate expired refresh token
            if (response.status === 403 || response.status === 400 ) { // 403 invalid_grant, 400 sometimes used too
                 try {
                    const parsedError = JSON.parse(errorBody);
                    if (parsedError.error === 'invalid_grant') {
                         console.error(`Refresh token for user ${userId} is invalid or expired. Re-authentication required.`);
                         throw new Error("Refresh token invalid. Please re-authenticate the app.");
                    }
                 } catch(e) {
                    // Ignore JSON parse error, throw generic error
                 }
            }
            throw new Error(`Token refresh failed with status: ${response.status}`);
        }

        const tokenData = await response.json();
        const newAccessToken = tokenData.access_token;
        const newRefreshToken = tokenData.refresh_token; // Rotating tokens mean we get a new one

        if (!newAccessToken) {
             console.error("Token refresh response did not contain an access_token.");
             throw new Error("Failed to obtain new access token after refresh.");
        }

        console.log(`Successfully refreshed token for user ${userId}`);

        // --- Use the correct storage key --- 
        const storageKey = `oauth_token:${userId}`;

        // Get existing stored data to update tokens
        // Ensure we preserve other stored data like userInfo, cloudId, etc.
        const existingUserData = await storage.get(storageKey) || {}; 
        const updatedUserData = {
            ...existingUserData, // Preserve existing data
            accessToken: newAccessToken,
            // IMPORTANT: Store the new refresh token if received
            ...(newRefreshToken && { refreshToken: newRefreshToken }),
            expiresAt: Date.now() + (tokenData.expires_in * 1000), // Update expiry
            timestamp: Date.now() // Update timestamp of refresh
        };

        await storage.set(storageKey, updatedUserData);
        console.log(`Stored new tokens for user ${userId} under key ${storageKey}`);

        return newAccessToken; // Return the new access token for immediate use

    } catch (error) {
        console.error('Error during token refresh:', error);
        // Re-throw specific errors or a generic one
        if (error.message.includes("Refresh token invalid")) {
            throw error;
        }
        throw new Error('Failed to refresh access token.');
    }
}

// Helper function to call the Jira API using the 3LO token
// Modified to accept method and optional worklogId
async function callJiraApi(method, cloudId, accessToken, issueKey, worklogData, worklogId = null) {
    let url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/worklog`;
    if ((method === 'PUT' || method === 'DELETE') && worklogId) { // Also add worklogId for DELETE
        url += `/${worklogId}`;
    }
    
    console.log(`Calling Jira API: ${method} ${url}`);

    // Construct body only if needed (POST/PUT)
    let requestBody = null;
    if (method === 'POST' || method === 'PUT') {
        requestBody = JSON.stringify({
            started: worklogData.started,
            timeSpentSeconds: worklogData.timeSpentSeconds,
            // comment: worklogData.comment // Add later if needed
        });
    }
    
    const requestOptions = {
        method: method, 
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
            // Only add Content-Type if we have a body
            ...(requestBody && { 'Content-Type': 'application/json' })
        },
        ...(requestBody && { body: requestBody })
    };

    try {
        // Use fetch with constructed options
        const response = await fetch(url, requestOptions); 

        // Return status for retry logic and the response itself
        return { status: response.status, response };

    } catch (error) {
        console.error('Error calling Jira API:', error);
        throw new Error('Network or unexpected error occurred while calling Jira API.');
    }
}

// Define the main function that handles the request
// Renamed to handleWorklogAction
const handleWorklogAction = async (req) => {
    console.log('Raw webtrigger request received:', JSON.stringify(req, null, 2));
    
    // Attempt to parse the JSON payload from the request body
    let payload;
    try {
        // Webtrigger body is often a string, needs parsing
        if (typeof req.body === 'string') {
             payload = JSON.parse(req.body);
        } else {
            payload = req.body; // Assume already parsed if not a string
        }
        console.log('Parsed worklog create request payload:', JSON.stringify(payload));
    } catch (e) {
        console.error("Failed to parse request body as JSON:", e);
        console.error("Raw request body:", req.body);
        // Return a 400 Bad Request response
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid JSON payload in request body.' })
        };
    }

    // Now extract data from the parsed payload object
    const { event, userId, issueKey, started, timeSpentSeconds, worklogId } = payload || {}; // Extract event and worklogId
    const accountId = userId; // Use userId from payload as accountId

    // --- Validate common fields --- 
    if (!event || !accountId || !issueKey || !started || timeSpentSeconds === undefined) {
        console.error('Invalid payload content - missing common fields:', payload);
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Missing required fields in payload (event, userId, issueKey, started, timeSpentSeconds).' })
        };
    }

    // --- Retrieve User OAuth Data (Common step) ---
    const storageKey = `oauth_token:${accountId}`;
    console.log(`Retrieving OAuth data using key: ${storageKey}`);
    let userData;
    try {
        userData = await storage.get(storageKey);
        console.log(`Retrieved userData for ${accountId} from storage:`, JSON.stringify(userData, null, 2));
        // Check for essential fields including cloudId
        if (!userData || !userData.accessToken || !userData.refreshToken || !userData.cloudId) {
             console.error(`OAuth data incomplete or not found for user ${accountId} using key ${storageKey}. Required fields: accessToken, refreshToken, cloudId.`);
            // Instruct user to re-authenticate
            throw new Error(`Authentication data not found or incomplete for user ${accountId}. Please ensure the user has connected their Jira account via the app.`);
        }
        console.log(`Successfully retrieved user data for ${accountId}. cloudId found: ${!!userData.cloudId}`);
    } catch (error) {
        console.error(`Failed to retrieve storage for user ${accountId} using key ${storageKey}:`, error);
        // Return a 500 Internal Server Error response for storage issues
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: `Could not retrieve user authentication data: ${error.message}` })
        };
    }

    let currentAccessToken = userData.accessToken;
    const worklogPayloadForApi = { started, timeSpentSeconds }; // Data for API call
    let apiMethod;
    let apiTargetWorklogId = null; // Only used for PUT
    let successMessageAction = "processed"; // Default message

    // --- Determine Action based on event --- 
    if (event === 'hours:created') {
        console.log(`Action: Create worklog for issue ${issueKey}`);
        apiMethod = 'POST';
        successMessageAction = "created";
    } else if (event === 'hours:updated') {
        console.log(`Action: Update worklog ${worklogId} for issue ${issueKey}`);
        if (!worklogId) {
            console.error('Invalid payload for update - missing worklogId:', payload);
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Missing required field worklogId for event hours:updated.' })
            };
        }
        apiMethod = 'PUT';
        apiTargetWorklogId = worklogId;
        successMessageAction = "updated";
    } else if (event === 'hours:deleted') { // Add delete case
        console.log(`Action: Delete worklog ${worklogId} for issue ${issueKey}`);
        if (!worklogId) { // Need worklogId for delete
            console.error('Invalid payload for delete - missing worklogId:', payload);
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Missing required field worklogId for event hours:deleted.' })
            };
        }
        // For DELETE, we don't need started or timeSpentSeconds from payload
        apiMethod = 'DELETE'; 
        apiTargetWorklogId = worklogId;
        successMessageAction = "deleted";
    } else {
        console.error(`Unsupported event type: ${event}`);
        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: `Unsupported event type: ${event}. Expected hours:created, hours:updated, or hours:deleted.` })
        };
    }

    // --- Attempt API Call (Common logic, adapted parameters) ---
    // For DELETE, worklogPayloadForApi is not strictly needed by callJiraApi, pass empty object
    const payloadForCall = (apiMethod === 'DELETE') ? {} : worklogPayloadForApi; 
    console.log(`Attempting to ${successMessageAction} worklog ${apiTargetWorklogId || ''} for issue ${issueKey} as user ${accountId} using cloudId ${userData.cloudId}`);
    let apiResult = await callJiraApi(apiMethod, userData.cloudId, currentAccessToken, issueKey, payloadForCall, apiTargetWorklogId);

    // --- Handle Token Expiry (Refresh if necessary - Common logic) ---
    if (apiResult.status === 401 || apiResult.status === 403) {
        console.warn(`Received ${apiResult.status} for user ${accountId}. Attempting token refresh.`);
        try {
            currentAccessToken = await refreshAccessToken(accountId, userData.refreshToken);
            // --- Retry API Call with new token --- 
            console.log(`Retrying API call (${apiMethod}) for issue ${issueKey} with refreshed token.`);
            apiResult = await callJiraApi(apiMethod, userData.cloudId, currentAccessToken, issueKey, payloadForCall, apiTargetWorklogId);

        } catch (refreshError) {
            console.error(`Failed to refresh token or retry API call for user ${accountId}:`, refreshError);
            // Send specific error back if it's about re-authentication
             if (refreshError.message.includes("re-authenticate") || refreshError.message.includes("Refresh token invalid")) {
                 throw refreshError;
             }
            // Return a 500 or specific error indicating auth failure
             return {
                 statusCode: 500, // Or maybe 401/403 depending on refreshError type
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ error: `Failed to process worklog for user ${accountId} after authentication issue: ${refreshError.message}` })
             };
        }
    }

    // --- 5. Process Final API Response ---
    if (apiMethod === 'DELETE' && apiResult.status === 204) {
        console.log(`Successfully deleted worklog ${apiTargetWorklogId} for issue ${issueKey}.`);
        return {
            statusCode: 200, // Return 200 OK to client
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                success: true, 
                action: successMessageAction, 
                worklogId: apiTargetWorklogId 
            })
        };
    }

    if (!apiResult.response.ok) {
        const errorBody = await apiResult.response.text();
        console.error(`Jira API call failed with status ${apiResult.status} for issue ${issueKey}: ${errorBody}`);
        // Try to parse Jira's error messages
        let errorMessage = `Jira API error (Status: ${apiResult.status}).`;
        try {
            const jiraError = JSON.parse(errorBody);
            if (jiraError.errorMessages && jiraError.errorMessages.length > 0) {
                errorMessage = `Jira Error: ${jiraError.errorMessages.join(', ')}`;
            } else if (jiraError.errors) {
                 // Handle field-specific errors if needed
                 errorMessage = `Jira Error: ${JSON.stringify(jiraError.errors)}`;
            }
        } catch(e) { /* Ignore parse error, use generic message */ }
        // Return a specific error status code from Jira if possible, or 502 Bad Gateway
        return {
            statusCode: apiResult.status || 502, // Use Jira's status or 502
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: errorMessage })
        };
    }

    const responseData = await apiResult.response.json();
    console.log(`Successfully ${successMessageAction} worklog for issue ${issueKey}. Worklog ID: ${responseData.id}`);

    // Return success response object with correct headers format
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            success: true, 
            action: successMessageAction, 
            worklogId: responseData.id 
        })
    };
};

// Export the main handler function
export const handler = handleWorklogAction; 
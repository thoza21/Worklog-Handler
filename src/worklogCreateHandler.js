import { validateZapierSecret } from './secureUtils';
import { callJiraApiWithRetry } from './jiraApiHelper';
import { logAction } from './actionLogger';

/**
 * Parses the request body, ensuring it's valid JSON.
 */
function parseRequestBody(req) {
    console.log('Attempting to parse request body for Create...');
    if (!req.body) {
        throw new Error('Request body is missing.');
    }
    try {
        let payload;
        if (typeof req.body === 'string') {
            payload = JSON.parse(req.body);
        } else {
            payload = req.body; // Assume already object
        }
        console.log('Parsed payload:', payload);
        if (Object.keys(payload).length === 0) {
             throw new Error('Request body is empty or not valid JSON.');
        }
        return payload;
    } catch (e) {
        console.error("Failed to parse request body as JSON:", e);
        console.error("Raw request body snippet:", String(req.body).substring(0, 200));
        throw new Error('Invalid JSON payload in request body.');
    }
}

/**
 * Handles the incoming webhook request to CREATE a Jira worklog.
 */
export const handler = async (req) => {
    const handlerName = 'WorklogCreateHandler';
    console.log(`[${handlerName}] Invoked.`);
    // Log headers for debugging secret issues (consider removing in production)
    // console.log(`[${handlerName}] Raw headers:`, JSON.stringify(req.headers || {}, null, 2));

    let outputKey = 'error-internal'; // Default to internal error
    let logDetails = {}; // <-- Initialize log details

    try {
        // 1. Validate Secret (using secureUtils)
        await validateZapierSecret(req.headers); // Now async

        // 2. Parse Body
        const payload = parseRequestBody(req);

        // 3. Extract and Validate Payload Data for CREATE
        // Note: `event` field is not strictly needed by this handler but might be useful for logging
        const { userId, issueKey, started, timeSpentSeconds } = payload;
        const accountId = userId;

        // <-- Store details for logging
        logDetails = { actionType: 'create', success: false, issueKey, accountId }; 

        if (!accountId || !issueKey || !started || timeSpentSeconds === undefined) {
            const missing = [
                !accountId && 'userId',
                !issueKey && 'issueKey',
                !started && 'started',
                timeSpentSeconds === undefined && 'timeSpentSeconds'
            ].filter(Boolean).join(', ');
            console.error(`[${handlerName}] Invalid payload - missing required fields: ${missing}. Payload:`, payload);
            outputKey = 'error-bad-request';
            logDetails.message = `Missing required fields: ${missing}.`; // <-- Log error detail
            throw new Error(`Missing required fields in payload for create: ${missing}.`);
        }
        console.log(`[${handlerName}] Processing CREATE request for user: ${accountId}, issue: ${issueKey}`);

        // Prepare payload for the API call
        const payloadForApi = { started, timeSpentSeconds };

        // 4. Call Jira API (POST) via wrapper
        const apiResult = await callJiraApiWithRetry(accountId, 'POST', issueKey, payloadForApi, null);

        // 5. Process Final API Response
        if (!apiResult.response.ok) {
            const errorBody = await apiResult.response.text();
            console.error(`[${handlerName}] Jira API call failed. Status: ${apiResult.status}, Issue: ${issueKey}, Body: ${errorBody}`);
            // Map Jira status codes to output keys
            if (apiResult.status === 400) outputKey = 'error-bad-request';
            else if (apiResult.status === 401) outputKey = 'error-unauthorized';
            else if (apiResult.status === 403) outputKey = 'error-forbidden';
            else outputKey = 'error-jira-api'; // Generic Jira error for others (404, 5xx etc.)
            
            let errorMessage = `Jira API error (Status: ${apiResult.status}).`;
            try {
                const jiraError = JSON.parse(errorBody);
                errorMessage = jiraError.errorMessages?.join(', ') || JSON.stringify(jiraError.errors) || errorMessage;
            } catch (e) { /* Ignore parse error */ }
            logDetails.message = `Jira API Error: ${apiResult.status} - ${errorMessage}`; // <-- Log error detail
            throw new Error(errorMessage); // Throw to be caught below
        }

        const responseData = await apiResult.response.json();
        // --- Log the successful Worklog ID --- 
        console.log(`[${handlerName}] <<< Worklog CREATED Successfully >>> Issue: ${issueKey}, Worklog ID: ${responseData.id}, User: ${accountId}`);
        // --- End Log ---

        outputKey = 'success-created';
        logDetails.success = true; // <-- Mark success
        logDetails.worklogId = responseData.id; // <-- Add worklog ID
        logDetails.message = `Worklog ${responseData.id} created successfully.`; // <-- Success message
        await logAction(logDetails); // <-- Log success action
        return { outputKey }; // Return static success key

    } catch (error) {
        console.error(`[${handlerName}] Error:`, error);
        // Map specific thrown errors to output keys
        if (error.message.includes("secret")) outputKey = 'error-unauthorized'; // Treat secret errors as Unauthorized
        else if (error.message.includes("payload") || error.message.includes("Missing required fields")) outputKey = 'error-bad-request';
        else if (error.message.includes("re-authenticate")) outputKey = 'error-unauthorized';
        // Use the outputKey set during API failure if available, otherwise default internal error
        outputKey = outputKey || 'error-internal'; 

        // Ensure log details has basic info even if error happened early
        logDetails.actionType = logDetails.actionType || 'create';
        logDetails.success = false;
        logDetails.issueKey = logDetails.issueKey || payload?.issueKey || 'Unknown';
        logDetails.accountId = logDetails.accountId || payload?.userId || 'Unknown';
        // Use specific error message if available, otherwise the caught error
        logDetails.message = logDetails.message || error.message;

        await logAction(logDetails); // <-- Log failure action
        return { outputKey };
    }
}; 
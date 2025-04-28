import { validateZapierSecret } from './secureUtils';
import { callJiraApiWithRetry } from './jiraApiHelper';
import { logAction } from './actionLogger';

/**
 * Parses the request body, ensuring it's valid JSON.
 */
function parseRequestBody(req) {
    console.log('Attempting to parse request body for Update...');
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
 * Handles the incoming webhook request to UPDATE a Jira worklog.
 */
export const handler = async (req) => {
    const handlerName = 'WorklogUpdateHandler';
    console.log(`[${handlerName}] Invoked.`);
    
    let outputKey = 'error-internal';
    let logDetails = {};
    let payload = null;

    try {
        await validateZapierSecret(req.headers);
        payload = parseRequestBody(req);
        const { userId, issueKey, started, timeSpentSeconds, worklogId } = payload;
        const accountId = userId;

        // Store details for logging
        logDetails = { actionType: 'update', success: false, issueKey, worklogId, accountId };

        if (!accountId || !issueKey || !started || timeSpentSeconds === undefined || !worklogId) {
            const missing = [
                !accountId && 'userId',
                !issueKey && 'issueKey',
                !started && 'started',
                timeSpentSeconds === undefined && 'timeSpentSeconds',
                !worklogId && 'worklogId'
            ].filter(Boolean).join(', ');
            console.error(`[${handlerName}] Invalid payload - missing required fields: ${missing}. Payload:`, payload);
            outputKey = 'error-bad-request';
            logDetails.message = `Missing required fields: ${missing}.`; // Log error detail
            throw new Error(`Missing required fields in payload for update: ${missing}.`);
        }
        console.log(`[${handlerName}] Processing UPDATE request for user: ${accountId}, issue: ${issueKey}, worklog: ${worklogId}`);

        const payloadForApi = { started, timeSpentSeconds };
        const apiResult = await callJiraApiWithRetry(accountId, 'PUT', issueKey, payloadForApi, worklogId);

        if (!apiResult.response.ok) {
            const errorBody = await apiResult.response.text();
            console.error(`[${handlerName}] Jira API call failed. Status: ${apiResult.status}, Issue: ${issueKey}, Worklog: ${worklogId}, Body: ${errorBody}`);
            // Map status codes
            if (apiResult.status === 400) outputKey = 'error-bad-request';
            else if (apiResult.status === 401) outputKey = 'error-unauthorized';
            else if (apiResult.status === 403) outputKey = 'error-forbidden';
            else if (apiResult.status === 404) outputKey = 'error-not-found';
            else outputKey = 'error-jira-api';
            
            let errorMessage = `Jira API error (Status: ${apiResult.status}).`;
            try {
                const jiraError = JSON.parse(errorBody);
                errorMessage = jiraError.errorMessages?.join(', ') || JSON.stringify(jiraError.errors) || errorMessage;
            } catch (e) { /* Ignore parse error */ }
            logDetails.message = `Jira API Error: ${apiResult.status} - ${errorMessage}`; // Log error detail
            throw new Error(errorMessage);
        }

        const responseData = await apiResult.response.json();
        // --- Log the successful Worklog ID --- 
        console.log(`[${handlerName}] <<< Worklog UPDATED Successfully >>> Issue: ${issueKey}, Worklog ID: ${responseData.id}, User: ${accountId}`);
        // --- End Log ---

        outputKey = 'success-updated';
        logDetails.success = true; // Mark success
        logDetails.message = `Worklog ${responseData.id} updated successfully.`; // Success message
        await logAction(logDetails); // Log success action
        return { outputKey }; // Return static success key

    } catch (error) {
        console.error(`[${handlerName}] Error:`, error);
        // Map errors to output keys
        if (error.message.includes("secret")) outputKey = 'error-unauthorized';
        else if (error.message.includes("payload") || error.message.includes("Missing required fields")) outputKey = 'error-bad-request';
        else if (error.message.includes("re-authenticate")) outputKey = 'error-unauthorized';
        else if (error.message.includes("Not Found")) outputKey = 'error-not-found'; // Catch 404 from API error message
        // Use API status mapping if available, otherwise default internal
        outputKey = outputKey || 'error-internal';

        // Now this is safe because payload is declared in the outer scope
        logDetails.actionType = logDetails.actionType || 'update';
        logDetails.success = false;
        logDetails.issueKey = logDetails.issueKey || payload?.issueKey || 'Unknown';
        logDetails.worklogId = logDetails.worklogId || payload?.worklogId || 'Unknown';
        logDetails.accountId = logDetails.accountId || payload?.userId || 'Unknown';
        logDetails.message = logDetails.message || error.message;

        await logAction(logDetails); // Log failure action
        return { outputKey };
    }
}; 
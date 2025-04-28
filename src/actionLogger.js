import { storage } from '@forge/api';

const LOG_STORAGE_KEY = 'actionLog';
const MAX_LOG_ENTRIES = 50; // Keep the last 50 log entries

/**
 * Logs an action result to Forge Storage.
 * @param {object} details - Details about the action.
 * @param {string} details.actionType - e.g., 'create', 'update', 'delete'.
 * @param {boolean} details.success - Whether the action was successful.
 * @param {string} details.issueKey - The Jira issue key.
 * @param {string} [details.worklogId] - The Jira worklog ID (if applicable).
 * @param {string} [details.message] - Optional additional details or error message.
 * @param {string} [details.accountId] - The Atlassian account ID involved.
 */
export async function logAction(details) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        actionType: details.actionType,
        success: details.success,
        issueKey: details.issueKey,
        worklogId: details.worklogId || 'N/A',
        accountId: details.accountId || 'Unknown',
        message: details.message || (details.success ? 'Success' : 'Failure')
    };

    try {
        console.log(`[ActionLogger] Logging action: ${logEntry.actionType} for ${logEntry.issueKey}, Success: ${logEntry.success}`);
        let currentLogs = await storage.get(LOG_STORAGE_KEY);
        if (!Array.isArray(currentLogs)) {
            console.warn('[ActionLogger] Initializing action log in storage.');
            currentLogs = [];
        }

        // Add new entry to the beginning
        currentLogs.unshift(logEntry);

        // Trim the log to MAX_LOG_ENTRIES
        if (currentLogs.length > MAX_LOG_ENTRIES) {
            currentLogs = currentLogs.slice(0, MAX_LOG_ENTRIES);
        }

        await storage.set(LOG_STORAGE_KEY, currentLogs);
        console.log(`[ActionLogger] Log stored successfully. Total entries: ${currentLogs.length}`);

    } catch (error) {
        // Log the error but don't let logging failure break the main handler flow
        console.error('[ActionLogger] Failed to write action log to storage:', error);
    }
} 
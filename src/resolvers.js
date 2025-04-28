import api, { storage } from '@forge/api';

const LOG_STORAGE_KEY = 'actionLog';

/**
 * Resolver function to fetch the stored action logs.
 */
export async function getActionLogResolver() {
    console.log(`[Resolver:getActionLogResolver] Fetching logs from storage key: ${LOG_STORAGE_KEY}`);
    try {
        const logs = await storage.get(LOG_STORAGE_KEY);
        // Return the logs, or an empty array if nothing is stored yet
        return Array.isArray(logs) ? logs : []; 
    } catch (error) {
        console.error(`[Resolver:getActionLogResolver] Error fetching logs:`, error);
        // Return empty array or throw error depending on desired frontend handling
        return []; 
    }
}

/**
 * Resolver function to check if credentials are set.
 * (Included based on manifest reference)
 */
export async function credentialCheckResolver() {
    console.log('[Resolver:credentialCheckResolver] Checking credentials...');
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const isConfigured = !!(clientId && clientSecret);
    console.log(`[Resolver:credentialCheckResolver] Configured status: ${isConfigured}`);
    return { isConfigured };
} 
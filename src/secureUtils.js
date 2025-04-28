import { storage } from '@forge/api';

/**
 * Validates the incoming Zapier secret header against the secret stored in Forge storage.
 * Throws an error if validation fails or if the secret is not configured.
 * @param {Object} headers - The request headers object.
 * @throws {Error} - If validation fails or secret is missing/not configured.
 */
export async function validateZapierSecret(headers) {
    // Extract header, checking both cases
    const headerValue = headers && (headers['x-zapier-secret'] || headers['X-Zapier-Secret']);
    // Handle header value potentially being an array
    const receivedSecretRaw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    
    const storageKey = 'zapierSharedSecret';

    console.log(`Validating Zapier secret using storage key: ${storageKey}...`);

    let expectedSecretRaw;
    try {
        expectedSecretRaw = await storage.getSecret(storageKey);
    } catch (e) {
        console.error(`Error retrieving secret from storage key '${storageKey}':`, e);
        throw new Error("Server configuration error: Could not retrieve shared secret.");
    }

    if (expectedSecretRaw === null || expectedSecretRaw === undefined) { // Check specifically for null/undefined from storage
        console.error(`Request validation failed: Shared secret is not configured in Forge storage (key: '${storageKey}').`);
        throw new Error("Secret validation failed: Shared secret not configured.");
    }

    if (receivedSecretRaw === null || receivedSecretRaw === undefined || receivedSecretRaw === '') { // Check for missing or empty header
        console.error("Request validation failed: Missing or empty x-zapier-secret header.");
        throw new Error("Missing required secret header.");
    }

    // Ensure both are strings before trimming (getSecret should return string or null)
    const receivedSecret = String(receivedSecretRaw).trim();
    const expectedSecret = String(expectedSecretRaw).trim();

    // Compare trimmed secrets
    if (receivedSecret !== expectedSecret) {
        console.error("Request validation failed: Invalid x-zapier-secret provided (Mismatch after trimming).");
        throw new Error("Invalid secret.");
    }

    console.log("Zapier secret validation successful.");
} 
import { router } from '@forge/bridge'; // Import router

/**
 * Manages the OAuth 2.0 popup flow using postMessage communication.
 */
export async function startOAuthFlow(oauthUrl) {
  console.log('[OAuth Manager] Starting OAuth flow with URL:', oauthUrl);

  let handleOAuthMessage; // Declare here to allow access in error handling
  
  // 1. Setup a promise to await the outcome from the popup
  const authPromise = new Promise((resolve, reject) => {
    
    // Define the handler inside the promise scope
    handleOAuthMessage = (event) => {
      console.log('[OAuth Manager] Received postMessage:', event.data);

      if (event.data === 'oauth_success') {
        console.log('[OAuth Manager] Success message received.');
        cleanup();
        resolve('success');
      } else if (event.data === 'oauth_failure') { 
        console.error('[OAuth Manager] Failure message received.');
        cleanup();
        reject(new Error('OAuth flow failed in popup.'));
      }
    };

    // Function to remove listener
    const cleanup = () => {
      console.log('[OAuth Manager] Cleaning up listener.');
      window.removeEventListener('message', handleOAuthMessage);
    };

    console.log('[OAuth Manager] Adding message event listener.');
    window.addEventListener('message', handleOAuthMessage);

    // Optional: Timeout for the entire flow
    const timeoutId = setTimeout(() => { 
       console.warn('[OAuth Manager] Flow timed out.');
       cleanup(); 
       reject(new Error('OAuth flow timed out.')); 
    }, 60000); // 60 seconds timeout 

    // Store cleanup function reference to clear timeout later
    authPromise.cleanup = () => {
        clearTimeout(timeoutId);
        cleanup();
    };

  });

  // 2. Open OAuth using Forge Router
  try {
      console.log('[OAuth Manager] Opening popup window via router.open()...');
      await router.open(oauthUrl);
      console.log('[OAuth Manager] router.open() called.');
      // Note: router.open doesn't return a window handle or throw easily catchable errors 
      // if popups are blocked at a higher level, rely on timeout/postMessage.
  } catch (routerError) {
      // This catch block might not be very effective for router.open errors
      console.error('[OAuth Manager] Error calling router.open():', routerError);
      if (authPromise.cleanup) authPromise.cleanup(); // Ensure listener is cleaned up
      throw new Error('Failed to initiate OAuth popup via Forge router.');
  }
  

  // 3. Wait for OAuth result from the postMessage listener
  try {
    const result = await authPromise;
    console.log('[OAuth Manager] OAuth completed successfully:', result);
    if (authPromise.cleanup) authPromise.cleanup(); // Clear timeout on success
    return result;
  } catch (error) { // Catches rejection from the promise (timeout or oauth_failure)
    console.error('[OAuth Manager] OAuth flow failed:', error);
    if (authPromise.cleanup) authPromise.cleanup(); // Clear timeout on failure
    throw error; // Re-throw the error to be caught by the caller
  }
} 
import React, { useEffect, useState, useCallback } from 'react';
import { invoke, router } from '@forge/bridge';

// --- Helper Function for Time --- //
function formatTimeLeft(ms) {
  if (ms <= 0) return 'Expired';

  let seconds = Math.floor(ms / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);
  let days = Math.floor(hours / 24);

  seconds %= 60;
  minutes %= 60;
  hours %= 24;

  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`); // Show seconds if no larger units or if < 1 min

  return parts.join(' ');
}

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  try {
    const date = new Date(ts);
    return date.toLocaleString(); // Use locale-specific format
  } catch (e) {
    console.error("Error formatting timestamp:", e);
    return 'Invalid Date';
  }
}

// --- TokenInfo Component --- //
function TokenInfo({ expiresAt, timestamp }) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!expiresAt) {
      setTimeLeft('N/A');
      return;
    }

    const calculateTimeLeft = () => {
      const now = Date.now();
      const diff = expiresAt - now;
      setTimeLeft(formatTimeLeft(diff));
    };

    calculateTimeLeft(); // Initial calculation
    const intervalId = setInterval(calculateTimeLeft, 1000); // Update every second

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, [expiresAt]);

  return (
    <div style={styles.tokenInfoContainer}>
      <h4 style={styles.tokenInfoHeader}>Token Details</h4>
      <p style={styles.tokenInfoText}><strong>Token Present:</strong> Yes</p>
      <p style={styles.tokenInfoText}><strong>Expires In:</strong> {timeLeft}</p>
      <p style={styles.tokenInfoText}><strong>Stored At:</strong> {formatTimestamp(timestamp)}</p>
    </div>
  );
}

// --- Copyable Input Component --- //
function CopyableInput({ label, value, id }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
      .then(() => console.log(`${label} copied!`))
      .catch(err => console.error(`Failed to copy ${label}:`, err));
  };

  return (
    <div>
      <label htmlFor={id} style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>{label}:</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          id={id}
          type="text"
          readOnly
          value={value || '-'}
          style={styles.copyableInput}
        />
        <button onClick={handleCopy} style={styles.copyButton} title={`Copy ${label}`}>📄</button>
      </div>
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accountId, setAccountId] = useState(null);
  const [zapierSecret, setZapierSecret] = useState(null);
  const [webhookUrls, setWebhookUrls] = useState({ create: null, update: null, delete: null });
  const [generatingSecret, setGeneratingSecret] = useState(false);
  const [authStatus, setAuthStatus] = useState({ checking: true, authenticated: false, expiresAt: null, timestamp: null, error: null });
  const [generalError, setGeneralError] = useState(null);

  const fetchAdminContext = useCallback(async () => {
    setLoading(true);
    setGeneralError(null);
    try {
      console.log('[fetchAdminContext] Fetching context...');
      const contextData = await invoke('getAdminPageContext');
      console.log('[fetchAdminContext] Context received:', contextData);

      if (contextData.error) {
        throw new Error(contextData.error);
      }
      
      setIsAdmin(contextData.isAdmin || false);
      setAuthStatus(contextData.authStatus || { checking: false, authenticated: false, error: 'Auth status missing' });
      setZapierSecret(contextData.zapierSecret);
      setWebhookUrls(contextData.webhookUrls || { create: null, update: null, delete: null });

    } catch (err) {
      console.error('[fetchAdminContext] Failed to load context:', err);
      setGeneralError(err.message || 'Failed to load application context.');
      setIsAdmin(false);
      setAuthStatus({ checking: false, authenticated: false, error: 'Context load failed' });
      setZapierSecret(null);
      setWebhookUrls({ create: null, update: null, delete: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdminContext();
  }, [fetchAdminContext]);

  const handleRegenerateSecret = useCallback(async () => {
    setGeneratingSecret(true);
    try {
      const result = await invoke('regenerateZapierSecret');
      if (result && result.newSecret) {
        setZapierSecret(result.newSecret);
      } else {
        console.error('Regenerate secret did not return a new secret.');
      }
    } catch (err) {
      console.error('Failed to generate secret:', err);
    } finally {
      setGeneratingSecret(false);
    }
  }, []);

  useEffect(() => {
    const checkAuthOnFocus = async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        console.log('Window focused, re-checking auth...');
        fetchAdminContext(); 
    };
    window.addEventListener('focus', checkAuthOnFocus);
    return () => window.removeEventListener('focus', checkAuthOnFocus);
  }, [fetchAdminContext]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>Loading Worklog Handler</div>
          <div style={{ color: '#6B778C', fontSize: '14px' }}>Please wait...</div>
        </div>
      </div>
    );
  }

  if (generalError) {
      return <div style={{ padding: '2rem', color: 'red' }}>Error loading application: {generalError}</div>;
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>🛠️ Worklog Manager</h1>
      {accountId ? <p>You are logged in as: <code>{accountId}</code></p> : null}

      {isAdmin ? (
        <AdminView
          zapierSecret={zapierSecret}
          webhookUrls={webhookUrls}
          onGenerateSecret={handleRegenerateSecret}
          generating={generatingSecret}
          authStatus={authStatus}
        />
      ) : (
        <UserView
          authStatus={authStatus}
        />
      )}
    </div>
  );
}

function AdminView({ zapierSecret, webhookUrls, onGenerateSecret, generating, authStatus }) {
  const secretDisplayValue = typeof zapierSecret === 'string' && zapierSecret.startsWith('{Error') 
    ? 'Error retrieving secret' 
    : zapierSecret;

  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>🔐 Admin Panel</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={styles.sectionContainer}>
          <h3 style={styles.sectionHeader}>Zapier Integration</h3>
          <button
            onClick={onGenerateSecret}
            disabled={generating}
            style={styles.actionButton}
          >
            {generating ? 'Generating...' : (zapierSecret && !zapierSecret.startsWith('{Error')) ? 'Regenerate Secret' : 'Generate Secret'}
          </button>

          {zapierSecret && !zapierSecret.startsWith('{Error') && (
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <CopyableInput
                    id="zapier-secret"
                    label="Header (x-zapier-secret)"
                    value={secretDisplayValue || 'Secret not set or error.'} 
                />
                <CopyableInput 
                    id="webhook-create"
                    label="Create Worklog URL"
                    value={webhookUrls?.create || 'Not available'} 
                />
                 <CopyableInput 
                    id="webhook-update"
                    label="Update Worklog URL"
                    value={webhookUrls?.update || 'Not available'} 
                />
                 <CopyableInput 
                    id="webhook-delete"
                    label="Delete Worklog URL"
                    value={webhookUrls?.delete || 'Not available'} 
                />
            </div>
          )}
           {zapierSecret && zapierSecret.startsWith('{Error') && (
                <p style={{color: 'red', marginTop: '10px'}}>{secretDisplayValue}</p>
           )}
           {!zapierSecret && !generating && (
               <p style={{color: 'orange', marginTop: '10px'}}>No Zapier secret is currently configured. Click 'Generate Secret'.</p>
           )}
        </div>

        <div style={styles.sectionContainer}>
          <h3 style={styles.sectionHeader}>OAuth Status</h3>
          {authStatus.checking ? (
            <p>Checking authentication status...</p>
          ) : authStatus.authenticated ? (
            <div>
              <p style={styles.successMessage}>✅ Your account is connected</p>
              <TokenInfo expiresAt={authStatus.expiresAt} timestamp={authStatus.timestamp} />
            </div>
          ) : (
            <div>
              <p style={styles.errorMessage}>⚠️ Your account is not connected {authStatus.error ? `(${authStatus.error})` : ''}</p>
              <OAuthButton />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserView({ authStatus }) {
  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>📅 Your Worklogs</h2>
      
      {authStatus.checking ? (
        <p>Checking authentication status...</p>
      ) : authStatus.authenticated ? (
        <div style={{ marginTop: '1rem' }}>
          <div style={styles.successMessage}>
            ✅ Your Jira account is connected
          </div>
          <TokenInfo expiresAt={authStatus.expiresAt} timestamp={authStatus.timestamp} />
        </div>
      ) : (
        <div style={{ marginTop: '1rem' }}>
          <div style={styles.errorMessage}>
            ⚠️ You need to connect your Jira account {authStatus.error ? `(${authStatus.error})` : ''}
          </div>
          
          <div style={{ marginTop: '1rem' }}>
            <h3>Connect to Jira</h3>
            <p>Connect your Jira account to allow Worklog Handler to manage time entries on your behalf.</p>
            <OAuthButton />
          </div>
        </div>
      )}
    </div>
  );
}

// --- OAuth Button Component --- //
function OAuthButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleOAuthClick = async () => {
    setLoading(true);
    setError(null);
    console.log('[OAuthButton] Starting OAuth flow...');
    try {
      // Call the correct resolver function to get the OAuth URL
      const oauthUrl = await invoke('getOAuthLoginUrl'); 
      console.log('[OAuthButton] OAuth URL fetched successfully:', oauthUrl);

      // Check if we actually got a URL string back
      if (typeof oauthUrl === 'string' && oauthUrl.startsWith('https://')) {
        // Use the fetched URL to navigate the user
        await router.open(oauthUrl);
      } else {
        // Handle cases where the resolver didn't return a valid URL
        console.error('[OAuthButton] Invalid OAuth URL received:', oauthUrl);
        setError('Could not retrieve the authorization URL. Please check app configuration.');
      }
    } catch (err) {
      console.error('[OAuthButton] OAuth process error:', err);
      setError(err.message || 'An unexpected error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleOAuthClick}
        disabled={loading}
        style={styles.actionButton}
      >
        {loading ? 'Processing...' : '🔗 Connect / Reconnect Jira Account'}
      </button>
      {error && <p style={{ color: 'red', marginTop: '10px' }}>Error: {error}</p>}
    </div>
  );
}

const styles = {
  sectionContainer: {
    padding: '16px', 
    backgroundColor: '#F4F5F7', 
    borderRadius: '8px',
    border: '1px solid #DFE1E6'
  },
  sectionHeader: {
    margin: '0 0 12px 0'
  },
  actionButton: {
    padding: '8px 16px',
    backgroundColor: '#0052CC',
    color: '#fff',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    '&:disabled': {
      cursor: 'default',
      opacity: 0.7
    }
  },
  copyableInput: {
    flexGrow: 1,
    padding: '8px',
    backgroundColor: '#FAFBFC',
    border: '1px solid #DFE1E6',
    borderRadius: '3px',
    fontFamily: 'monospace',
    fontSize: '13px'
  },
  copyButton: {
    padding: '6px 8px',
    backgroundColor: '#DEEBFF',
    color: '#0052CC',
    border: '1px solid #B3D4FF',
    borderRadius: '3px',
    cursor: 'pointer'
  },
  successMessage: {
    backgroundColor: '#E3FCEF', 
    color: '#006644',
    padding: '12px', 
    borderRadius: '3px',
    marginBottom: '16px'
  },
  errorMessage: {
    backgroundColor: '#FFEBE6', 
    color: '#BF2600',
    padding: '12px', 
    borderRadius: '3px',
    marginBottom: '16px'
  },
  inlineError: {
    color: '#BF2600',
    marginTop: '8px',
    fontSize: '14px',
    padding: '8px',
    backgroundColor: '#FFEBE6',
    borderRadius: '3px',
  },
  tokenInfoContainer: {
    marginTop: '12px',
    padding: '12px',
    backgroundColor: '#fff',
    border: '1px solid #DFE1E6',
    borderRadius: '3px',
    fontSize: '13px',
    color: '#42526E'
  },
  tokenInfoHeader: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: '#172B4D'
  },
  tokenInfoText: {
    margin: '4px 0'
  }
};

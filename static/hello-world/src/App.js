import React, { useEffect, useState } from 'react';
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

export default function App() {
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState(null);
  const [secret, setSecret] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [authStatus, setAuthStatus] = useState({ 
    checking: true, 
    authenticated: false, 
    expiresAt: null, 
    timestamp: null, 
    error: null 
  });

  useEffect(() => {
    const loadContext = async () => {
      try {
        console.log('Loading page context...');
        const ctx = await invoke('getPageContext');
        console.log('[Initial Load] Context received:', ctx);
        setContext(ctx);
        setSecret(ctx.secret || null);
        setAuthStatus({
          checking: false,
          authenticated: ctx.authenticated || false,
          expiresAt: ctx.expiresAt || null,
          timestamp: ctx.timestamp || null,
          error: ctx.error || null
        });
        console.log('[Initial Load] Initial authStatus set to:', { 
          checking: false, 
          authenticated: ctx.authenticated || false,
          expiresAt: ctx.expiresAt || null,
          timestamp: ctx.timestamp || null,
          error: ctx.error || null
        });
        setLoading(false);
        console.log('Context loaded successfully');
      } catch (err) {
        console.error('Failed to load context:', err);
        setLoading(false);
        setContext({ error: err.message });
        setAuthStatus({ checking: false, authenticated: false, expiresAt: null, timestamp: null, error: 'Context load failed' });
      }
    };
    
    loadContext();
  }, []);

  useEffect(() => {
    const checkAuthOnFocus = async () => {
      // Add a small delay to allow storage writes to potentially complete
      // This is a heuristic, not guaranteed, but might help in edge cases
      await new Promise(resolve => setTimeout(resolve, 250)); 
      
      console.log('>>> Window focused event triggered <<< (Diagnostic Mode)'); 
      if (context?.accountId) {
        console.log('[Focus Check] Account ID found, proceeding to check auth status...');
        try {
          setAuthStatus(prev => ({ ...prev, checking: true })); 
          const status = await invoke('getUserAuthStatus');
          console.log('[Focus Check] Auth status received from invoke:', status); 
          setAuthStatus({
            checking: false,
            authenticated: status.authenticated,
            expiresAt: status.expiresAt || null,
            timestamp: status.timestamp || null,
            error: status.error || null
          });
          console.log('[Focus Check] Auth status updated to:', {
            checking: false,
            authenticated: status.authenticated,
            expiresAt: status.expiresAt || null,
            timestamp: status.timestamp || null,
            error: status.error || null
          });
        } catch (err) {
          console.error('[Focus Check] Failed to check auth status on focus:', err);
          setAuthStatus({
            checking: false,
            authenticated: false,
            expiresAt: null,
            timestamp: null,
            error: err.message
          });
        }
      } else {
        console.log('[Focus Check] Skipping auth check on focus: no accountId in context');
      }
    };

    window.addEventListener('focus', checkAuthOnFocus);
    console.log('[Focus Check] Added focus event listener. (Diagnostic Mode)');

    return () => {
      console.log('[Focus Check] Removing focus event listener. (Diagnostic Mode)');
      window.removeEventListener('focus', checkAuthOnFocus);
    };
  }, [context?.accountId]); 

  const generateNewSecret = async () => {
    setGenerating(true);
    try {
      const newSecret = await invoke('setNewSecret');
      setSecret(newSecret);
    } catch (err) {
      console.error('Failed to generate secret:', err);
    } finally {
      setGenerating(false);
    }
  };

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
  
  if (!context) return <div>Error loading context.</div>;
  if (context?.error && !context.accountId) return <div>Error: {context.error}</div>;

  // Add console log here to see the final authStatus used for rendering
  console.log('[Render] Final authStatus being used:', authStatus);

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>🛠️ Worklog Manager</h1>
      {/* Conditionally render account ID only if context and accountId exist */}
      {context?.accountId ? 
        <p>You are logged in as: <code>{context.accountId}</code></p> 
        : <p>Loading user info...</p>}

      {context?.isAdmin ? (
        <AdminView
          secret={secret}
          onGenerateSecret={generateNewSecret}
          generating={generating}
          authStatus={authStatus}
          zapierWebhookUrl={context.zapierWebhookUrl}
        />
      ) : (
        <UserView 
          authStatus={authStatus}
          accountId={context?.accountId}
        />
      )}
    </div>
  );
}

function AdminView({ secret, onGenerateSecret, generating, authStatus, zapierWebhookUrl }) {
  return (
    <div style={{ marginTop: '2rem' }}>
      <h2>🔐 Admin Panel</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ 
          padding: '16px', 
          backgroundColor: '#F4F5F7', 
          borderRadius: '8px',
          border: '1px solid #DFE1E6'
        }}>
          <h3 style={{ margin: '0 0 12px 0' }}>Zapier Integration</h3>
          <button 
            onClick={onGenerateSecret} 
            disabled={generating}
            style={{
              padding: '8px 16px',
              backgroundColor: '#0052CC',
              color: '#fff',
              border: 'none',
              borderRadius: '3px',
              cursor: generating ? 'default' : 'pointer',
              opacity: generating ? 0.7 : 1
            }}
          >
            {generating ? 'Generating...' : secret ? 'Regenerate Secret' : 'Generate Secret'}
          </button>

          {secret && (
            <div style={{ marginTop: '16px' }}>
              <p><strong>Zapier Webhook:</strong></p>
              <code style={{ 
                display: 'block', 
                padding: '8px', 
                backgroundColor: '#F8F9FA', 
                border: '1px solid #DFE1E6',
                borderRadius: '3px'
              }}>
                {zapierWebhookUrl ? zapierWebhookUrl : 'Webhook URL not available'}
              </code>
              <p><strong>Header:</strong></p>
              <code style={{ 
                display: 'block', 
                padding: '8px', 
                backgroundColor: '#F8F9FA', 
                border: '1px solid #DFE1E6',
                borderRadius: '3px'
              }}>x-zapier-secret: {secret}</code>
            </div>
          )}
        </div>

        <div style={{ 
          padding: '16px', 
          backgroundColor: '#F4F5F7', 
          borderRadius: '8px',
          border: '1px solid #DFE1E6'
        }}>
          <h3 style={{ margin: '0 0 12px 0' }}>OAuth Status</h3>
          
          {authStatus.checking ? (
            <p>Checking authentication status...</p>
          ) : authStatus.authenticated ? (
            <div>
              <p style={styles.successMessage}>
                ✅ Your account is connected
              </p>
              <TokenInfo expiresAt={authStatus.expiresAt} timestamp={authStatus.timestamp} />
            </div>
          ) : (
            <div>
              <p style={styles.errorMessage}>
                ⚠️ Your account is not connected {authStatus.error ? `(${authStatus.error})` : ''}
              </p>
              <OAuthButton />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserView({ authStatus, accountId }) {
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
          <p>Your worklogs will appear here soon.</p>
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

function OAuthButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleOAuthClick = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('[OAuthButton] Starting OAuth flow...');
      
      let authUrl;
      try {
        authUrl = await invoke('getOAuthLoginUrl');
        console.log('[OAuthButton] OAuth URL fetched successfully:', authUrl);
        if (!authUrl) {
          throw new Error('No authorization URL returned from backend');
        }
      } catch (urlError) {
        console.error('[OAuthButton] Failed to fetch OAuth URL:', urlError);
        throw new Error('Could not generate login URL. Please try again.');
      }
      
      await router.open(authUrl); 
      console.log('[OAuthButton] Opened OAuth URL via router.open');

    } catch (err) {
      console.error('[OAuthButton] OAuth process error:', err);
      setError(err.message || 'Failed to start authorization process.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleOAuthClick}
        disabled={isLoading}
        style={{
          padding: '0.75rem 1.25rem',
          backgroundColor: '#0052CC',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 'bold',
          fontSize: '14px',
          cursor: isLoading ? 'default' : 'pointer',
          opacity: isLoading ? 0.7 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <span>{isLoading ? '⏳' : '🔐'}</span>
        <span>{isLoading ? 'Connecting...' : 'Connect to Jira'}</span>
      </button>
      
      {error && (
        <div style={{ 
          color: '#BF2600', 
          marginTop: '8px',
          fontSize: '14px',
          padding: '8px',
          backgroundColor: '#FFEBE6',
          borderRadius: '3px',
        }}>
          Error: {error}
        </div>
      )}
    </div>
  );
}

// --- Styles Object (Optional but good practice) --- //
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

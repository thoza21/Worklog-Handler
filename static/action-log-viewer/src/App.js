import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';

function App() {
    const [logs, setLogs] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        setIsLoading(true);
        invoke('getActionLog') // Call the resolver function key from manifest.yml
            .then(fetchedLogs => {
                console.log("Fetched logs:", fetchedLogs);
                setLogs(fetchedLogs); 
                setIsLoading(false);
            })
            .catch(err => {
                console.error("Error fetching logs:", err);
                setError("Failed to load action logs.");
                setIsLoading(false);
            });
    }, []); // Empty dependency array means this runs once on mount

    return (
        <div>
            <h1>Webhook Action Log</h1>
            {isLoading && <p>Loading logs...</p>}
            {error && <p style={{ color: 'red' }}>Error: {error}</p>}
            {logs && logs.length === 0 && !isLoading && (
                <p>No log entries found.</p>
            )}
            {logs && logs.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
                            <th>Timestamp</th>
                            <th>Action</th>
                            <th>Status</th>
                            <th>Issue</th>
                            <th>Worklog ID</th>
                            <th>Account ID</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.map((log, index) => (
                            <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                                <td style={{ padding: '4px 0' }}>{new Date(log.timestamp).toLocaleString()}</td>
                                <td style={{ padding: '4px 0' }}>{log.actionType}</td>
                                <td style={{ padding: '4px 0', color: log.success ? 'green' : 'red' }}>
                                    {log.success ? 'Success' : 'Failed'}
                                </td>
                                <td style={{ padding: '4px 0' }}>{log.issueKey}</td>
                                <td style={{ padding: '4px 0' }}>{log.worklogId}</td>
                                <td style={{ padding: '4px 0' }}>{log.accountId}</td>
                                <td style={{ padding: '4px 0' }}>{log.message}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

export default App; 
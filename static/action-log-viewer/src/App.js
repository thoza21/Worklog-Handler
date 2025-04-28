import React, { useEffect, useState, useMemo } from 'react';
import { invoke } from '@forge/bridge';

function App() {
    const [logs, setLogs] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // --- Filter State --- 
    const [filterActionType, setFilterActionType] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterIssueKey, setFilterIssueKey] = useState('');
    const [filterAccountId, setFilterAccountId] = useState('');
    // --- End Filter State ---

    useEffect(() => {
        setIsLoading(true);
        invoke('getActionLogFn') // Ensure this matches the corrected function key
            .then(fetchedLogs => {
                console.log("Fetched logs:", fetchedLogs);
                // Ensure logs is always an array
                setLogs(Array.isArray(fetchedLogs) ? fetchedLogs : []); 
                setIsLoading(false);
            })
            .catch(err => {
                console.error("Error fetching logs:", err);
                setError("Failed to load action logs.");
                setLogs([]); // Set empty array on error
                setIsLoading(false);
            });
    }, []);

    // --- Apply Filters --- 
    const filteredLogs = useMemo(() => {
        if (!logs) return [];
        return logs.filter(log => {
            const actionTypeMatch = filterActionType === 'all' || log.actionType === filterActionType;
            const statusMatch = filterStatus === 'all' || String(log.success) === filterStatus;
            const issueKeyMatch = !filterIssueKey || log.issueKey?.toUpperCase().includes(filterIssueKey.toUpperCase());
            const accountIdMatch = !filterAccountId || log.accountId?.toUpperCase().includes(filterAccountId.toUpperCase());
            return actionTypeMatch && statusMatch && issueKeyMatch && accountIdMatch;
        });
    }, [logs, filterActionType, filterStatus, filterIssueKey, filterAccountId]);
    // --- End Apply Filters ---

    const handleClearFilters = () => {
        setFilterActionType('all');
        setFilterStatus('all');
        setFilterIssueKey('');
        setFilterAccountId('');
    };

    return (
        <div>
            {/* --- Filter Controls --- */} 
            <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ccc', borderRadius: '5px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>Filters:</strong>
                <select value={filterActionType} onChange={e => setFilterActionType(e.target.value)}>
                    <option value="all">All Actions</option>
                    <option value="create">Create</option>
                    <option value="update">Update</option>
                    <option value="delete">Delete</option>
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="all">All Statuses</option>
                    <option value="true">Success</option>
                    <option value="false">Failed</option>
                </select>
                <input 
                    type="text" 
                    placeholder="Filter by Issue Key..." 
                    value={filterIssueKey}
                    onChange={e => setFilterIssueKey(e.target.value)}
                    style={{ padding: '5px' }}
                />
                <input 
                    type="text" 
                    placeholder="Filter by Account ID..." 
                    value={filterAccountId}
                    onChange={e => setFilterAccountId(e.target.value)}
                    style={{ padding: '5px' }}
                />
                <button onClick={handleClearFilters}>Clear Filters</button>
            </div>
            {/* --- End Filter Controls --- */} 

            {isLoading && <p>Loading logs...</p>}
            {error && <p style={{ color: 'red' }}>Error: {error}</p>}
            {!isLoading && logs && filteredLogs.length === 0 && (
                <p>No log entries found{logs.length > 0 ? ' matching your filters' : ''}.</p>
            )}
            {!isLoading && filteredLogs.length > 0 && (
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
                        {filteredLogs.map((log, index) => (
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AuditEntry } from '../types';

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [serverFilter, setServerFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'ok' | 'fail'>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<AuditEntry[]>('/api/audit');
      setEntries(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const users = useMemo(
    () => [...new Set(entries.map((e) => e.userEmail).filter(Boolean))].sort(),
    [entries],
  );
  const servers = useMemo(
    () => [...new Set(entries.map((e) => e.serverName).filter(Boolean))].sort(),
    [entries],
  );

  const filtered = entries.filter((row) => {
    if (userFilter && row.userEmail !== userFilter) return false;
    if (serverFilter && row.serverName !== serverFilter) return false;
    if (outcomeFilter === 'ok' && !row.success) return false;
    if (outcomeFilter === 'fail' && row.success) return false;
    return true;
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Audit log</h1>
          <p className="muted">
            Every tool call: who, server, tool, when, duration, outcome. Filter Ava vs Ben for the
            demo.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {error && <p className="alert alert--error">{error}</p>}

      <div className="filter-bar">
        <label className="field">
          <span>User</span>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
            <option value="">All</option>
            {users.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Server</span>
          <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
            <option value="">All</option>
            {servers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Outcome</span>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as 'all' | 'ok' | 'fail')}
          >
            <option value="all">All</option>
            <option value="ok">Success</option>
            <option value="fail">Failed / denied</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No audit entries match.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table data-table--compact">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Server</th>
                <th>Tool</th>
                <th>Result</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.userEmail}</td>
                  <td>{row.serverName}</td>
                  <td className="mono">{row.toolName}</td>
                  <td>
                    {row.success ? (
                      <span className="badge badge--ok">OK</span>
                    ) : (
                      <span className="badge badge--warn" title={row.errorMessage ?? undefined}>
                        Failed
                      </span>
                    )}
                    {!row.success && row.errorMessage && (
                      <p className="small error-text">{row.errorMessage}</p>
                    )}
                  </td>
                  <td>{row.durationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { getServerDisplayStatus, StatusBadge } from '../components/StatusBadge';
import type { McpServer, MetricsSummary, PermissionResponse } from '../types';

interface ServerFormState {
  name: string;
  url: string;
  credentialType: string;
  credentialHeader: string;
  credentialValue: string;
}

const emptyForm = (): ServerFormState => ({
  name: '',
  url: '',
  credentialType: 'none',
  credentialHeader: '',
  credentialValue: '',
});

const MUTATING_PREFIXES = ['create_', 'update_', 'delete_'];

function isMutatingTool(name: string): boolean {
  return MUTATING_PREFIXES.some((p) => name.startsWith(p));
}

export function ServersPage() {
  const { isAdmin, user } = useAuth();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [policies, setPolicies] = useState<PermissionResponse | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ServerFormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<McpServer[]>('/api/servers');
      setServers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load servers');
      setLoading(false);
      return;
    }

    // Soft-fail extras so status still shows on older builds
    try {
      setPolicies(await api.get<PermissionResponse>('/api/permissions'));
    } catch {
      setPolicies(null);
    }
    try {
      setMetrics(await api.get<MetricsSummary>('/api/servers/metrics-summary'));
    } catch {
      setMetrics(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const data = await api.post<McpServer[]>('/api/servers/refresh');
      setServers(data);
      try {
        setMetrics(await api.get<MetricsSummary>('/api/servers/metrics-summary'));
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(server: McpServer) {
    setEditingId(server.id);
    setForm({
      name: server.name,
      url: server.url,
      credentialType: server.credentialType,
      credentialHeader: '',
      credentialValue: '',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, string> = {
      name: form.name.trim(),
      url: form.url.trim(),
      credentialType: form.credentialType.trim(),
    };
    if (form.credentialHeader.trim()) {
      payload.credentialHeader = form.credentialHeader.trim();
    }
    if (form.credentialValue.trim()) {
      payload.credentialValue = form.credentialValue.trim();
    }
    try {
      if (editingId) {
        await api.patch(`/api/servers/${editingId}`, payload);
      } else {
        await api.post('/api/servers', payload);
      }
      closeForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(server: McpServer) {
    if (!isAdmin) return;
    setError(null);
    try {
      await api.patch(`/api/servers/${server.id}`, { enabled: !server.enabled });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function removeServer(id: string) {
    if (!isAdmin) return;
    if (!window.confirm('Delete this MCP server?')) return;
    setError(null);
    try {
      await api.delete(`/api/servers/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  const connected = servers.filter((s) => getServerDisplayStatus(s) === 'Connected').length;
  const unreachable = servers.filter((s) => getServerDisplayStatus(s) === 'Unreachable').length;
  const disabled = servers.filter((s) => getServerDisplayStatus(s) === 'Disabled').length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>MCP servers</h1>
          <p className="muted">
            Upstream MCP endpoints aggregated by the gateway. Signed in as{' '}
            <strong>{user?.role}</strong> — tool lists in chat/MCP are filtered by role.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh status'}
          </button>
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              Add server
            </button>
          )}
        </div>
      </header>

      {error && <p className="alert alert--error">{error}</p>}

      {/* Always visible — this is the status / observability strip */}
      <section className="panel status-panel" id="server-status">
        <h2>Server status &amp; observability</h2>
        <p className="muted small">
          Live upstream health (Connected / Unreachable / Disabled). Use{' '}
          <strong>Refresh status</strong> after pod-kill or disable. Call metrics appear below after
          tool use.
        </p>
        {!loading && servers.length > 0 && (
          <p className="status-summary">
            <span className="badge badge--ok">{connected} connected</span>
            <span className="badge badge--warn">{unreachable} unreachable</span>
            <span className="badge badge--muted">{disabled} disabled</span>
          </p>
        )}
        {loading ? (
          <p className="muted">Loading status…</p>
        ) : servers.length === 0 ? (
          <p className="muted">No servers registered yet.</p>
        ) : (
          <div className="status-grid">
            {servers.map((server) => {
              const label = getServerDisplayStatus(server);
              return (
                <article key={server.id} className={`status-tile status-tile--${label.toLowerCase()}`}>
                  <div className="status-tile-head">
                    <strong>{server.name}</strong>
                    <StatusBadge server={server} />
                  </div>
                  <p className="mono small muted">{server.slug}</p>
                  {server.lastError ? (
                    <p className="error-text small">
                      <strong>Reason:</strong> {server.lastError}
                    </p>
                  ) : (
                    <p className="muted small">
                      {label === 'Connected'
                        ? 'Probe OK'
                        : label === 'Disabled'
                          ? 'Disabled by admin — tools hidden'
                          : 'No error detail yet — click Refresh status'}
                    </p>
                  )}
                  {server.lastCheckedAt && (
                    <p className="muted small">
                      Checked {new Date(server.lastCheckedAt).toLocaleString()}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <div className="metrics-block">
          <h3>Tool-call metrics (last {metrics?.windowMinutes ?? 15}m)</h3>
          {metrics ? (
            <>
              <p className="muted small">
                {metrics.totalCalls} calls · {metrics.totalErrors} errors · scrape{' '}
                <span className="mono">http://gateway.local/metrics</span>
              </p>
              {metrics.servers.length === 0 ? (
                <p className="muted small">
                  No tool calls in this window yet. Run a chat or MCP tool call, then refresh.
                </p>
              ) : (
                <div className="metrics-grid">
                  {metrics.servers.map((s) => (
                    <div key={s.serverSlug} className="metric-tile">
                      <p className="mono">{s.serverSlug}</p>
                      <p>
                        {s.calls} calls · {(s.errorRate * 100).toFixed(0)}% err · p95 {s.p95Ms}ms
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="muted small">
              Metrics API unavailable — rebuild/redeploy gateway images, or curl{' '}
              <span className="mono">http://gateway.local/metrics</span>
            </p>
          )}
        </div>
      </section>

      {policies && (
        <section className="panel policy-panel">
          <h2>Tool permissions</h2>
          <p className="muted small">{policies.enforcement}</p>
          <div className="policy-grid">
            {policies.policies.map((p) => (
              <article key={p.role} className="policy-card">
                <h3>
                  <span className="role-tag">{p.role}</span>
                </h3>
                <p>{p.description}</p>
                <p className="small muted">{p.note}</p>
                {p.role === 'member' && (
                  <ul className="policy-tools mono small">
                    {p.allowExact.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                    {p.allowPrefixes.map((t) => (
                      <li key={t}>{t}*</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {showForm && isAdmin && (
        <section className="panel">
          <h2>{editingId ? 'Edit server' : 'New server'}</h2>
          <p className="muted small">
            URLs are SSRF-checked: loopback, link-local/metadata, and raw private IPs are rejected.
            Prefer in-cluster DNS (e.g. <span className="mono">http://notes-mcp:3103/mcp</span>).
          </p>
          <form onSubmit={handleSubmit} className="form-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>URL</span>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Credential type</span>
              <select
                value={form.credentialType}
                onChange={(e) => setForm({ ...form, credentialType: e.target.value })}
                required
              >
                <option value="none">none</option>
                <option value="bearer">bearer</option>
                <option value="header">header</option>
              </select>
            </label>
            <label className="field">
              <span>Credential header (optional)</span>
              <input
                value={form.credentialHeader}
                onChange={(e) => setForm({ ...form, credentialHeader: e.target.value })}
                placeholder="Authorization"
              />
            </label>
            <label className="field field--full">
              <span>Credential value (optional, never shown after save)</span>
              <input
                type="password"
                autoComplete="new-password"
                value={form.credentialValue}
                onChange={(e) => setForm({ ...form, credentialValue: e.target.value })}
                placeholder={editingId ? 'Leave blank to keep existing' : ''}
              />
            </label>
            <div className="form-actions field--full">
              <button type="button" className="btn btn-ghost" onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </section>
      )}

      {loading ? (
        <p className="muted">Loading server details…</p>
      ) : servers.length === 0 ? (
        <p className="muted">No servers configured yet.</p>
      ) : (
        <div className="card-list">
          {servers.map((server) => (
            <article key={server.id} className="card">
              <div className="card-head">
                <div>
                  <h2>{server.name}</h2>
                  <p className="mono muted small">{server.slug}</p>
                </div>
                <StatusBadge server={server} />
              </div>
              <dl className="meta-grid">
                <div>
                  <dt>URL</dt>
                  <dd className="mono">{server.url}</dd>
                </div>
                <div>
                  <dt>Credential</dt>
                  <dd>
                    {server.credentialType}
                    {server.hasCredential ? ' (stored server-side)' : ''}
                  </dd>
                </div>
                <div>
                  <dt>Last checked</dt>
                  <dd>
                    {server.lastCheckedAt
                      ? new Date(server.lastCheckedAt).toLocaleString()
                      : '—'}
                  </dd>
                </div>
                {server.lastError && (
                  <div className="meta-full">
                    <dt>Last error reason</dt>
                    <dd className="error-text">{server.lastError}</dd>
                  </div>
                )}
              </dl>
              {server.tools.length > 0 && (
                <div className="tools-block">
                  <h3>Tools ({server.tools.length})</h3>
                  <ul className="tools-list">
                    {server.tools.map((tool) => (
                      <li key={tool.name}>
                        <span className="mono">
                          {server.slug}__{tool.name}
                        </span>
                        {isMutatingTool(tool.name) && (
                          <span className="badge badge--admin">admin only</span>
                        )}
                        {tool.description && (
                          <span className="muted"> — {tool.description}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {isAdmin && (
                <div className="card-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => openEdit(server)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void toggleEnabled(server)}
                  >
                    {server.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-ghost"
                    onClick={() => void removeServer(server.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

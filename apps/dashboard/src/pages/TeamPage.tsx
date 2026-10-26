import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { ApiKey, ApiKeyCreated, GatewayInfo, TeamMember, UserRole } from '../types';

export function TeamPage() {
  const { isAdmin } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [teamKeys, setTeamKeys] = useState<ApiKey[]>([]);
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [inviting, setInviting] = useState(false);

  const [keyName, setKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [keysRes, gatewayRes] = await Promise.all([
        api.get<ApiKey[]>('/api/keys'),
        api.get<GatewayInfo>('/api/me/gateway-info'),
      ]);
      setKeys(keysRes);
      setGateway(gatewayRes);
      if (isAdmin) {
        const [membersRes, teamKeysRes] = await Promise.all([
          api.get<TeamMember[]>('/api/team/members'),
          api.get<ApiKey[]>('/api/team/keys'),
        ]);
        setMembers(membersRes);
        setTeamKeys(teamKeysRes);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setInviting(true);
    setError(null);
    try {
      await api.post('/api/team/invite', {
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        password: invitePassword,
        role: inviteRole,
      });
      setInviteEmail('');
      setInviteName('');
      setInvitePassword('');
      setInviteRole('member');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invite failed');
    } finally {
      setInviting(false);
    }
  }

  async function handleCreateKey(e: FormEvent) {
    e.preventDefault();
    setCreatingKey(true);
    setError(null);
    setRevealedKey(null);
    try {
      const created = await api.post<ApiKeyCreated>('/api/keys', {
        name: keyName.trim(),
      });
      setRevealedKey(created);
      setKeyName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create key');
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(id: string, asAdmin = false) {
    if (!window.confirm('Revoke this API key?')) return;
    setError(null);
    try {
      if (asAdmin) {
        await api.post(`/api/team/keys/${id}/revoke`, {});
      } else {
        await api.delete(`/api/keys/${id}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revoke failed');
    }
  }

  function copyText(text: string) {
    void navigator.clipboard.writeText(text);
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Team &amp; API keys</h1>
          <p className="muted">Connect clients to the shared gateway MCP endpoint.</p>
        </div>
      </header>

      {error && <p className="alert alert--error">{error}</p>}

      {gateway && (
        <section className="panel">
          <h2>Gateway MCP URL</h2>
          <div className="copy-row">
            <code className="copy-value">{gateway.mcpUrl}</code>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => copyText(gateway.mcpUrl)}
            >
              Copy
            </button>
          </div>
          <p className="muted pre-wrap">{gateway.instructions}</p>

          <h3 className="snippet-title">Cursor / Claude Code config</h3>
          <p className="muted small">
            Paste into MCP settings. Replace the bearer value with your API key (shown once when
            created below).
          </p>
          <div className="copy-row">
            <pre className="copy-value mcp-snippet">
              {JSON.stringify(
                {
                  mcpServers: {
                    'team-gateway': {
                      url: gateway.mcpUrl,
                      headers: {
                        Authorization: `Bearer ${revealedKey?.key ?? 'mcp_YOUR_KEY_HERE'}`,
                      },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                copyText(
                  JSON.stringify(
                    {
                      mcpServers: {
                        'team-gateway': {
                          url: gateway.mcpUrl,
                          headers: {
                            Authorization: `Bearer ${revealedKey?.key ?? 'mcp_YOUR_KEY_HERE'}`,
                          },
                        },
                      },
                    },
                    null,
                    2,
                  ),
                )
              }
            >
              Copy JSON
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>API keys</h2>
        <form onSubmit={handleCreateKey} className="inline-form">
          <label className="field field--grow">
            <span className="sr-only">Key name</span>
            <input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="Key name (e.g. Cursor laptop)"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creatingKey}>
            {creatingKey ? 'Creating…' : 'Create key'}
          </button>
        </form>

        {revealedKey && (
          <div className="alert alert--success key-reveal">
            <p>
              <strong>{revealedKey.name}</strong> — copy this key now; it will not be shown again.
            </p>
            <div className="copy-row">
              <code className="copy-value">{revealedKey.key}</code>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => copyText(revealedKey.key)}
              >
                Copy
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost small-btn"
              onClick={() => setRevealedKey(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {keys.length === 0 ? (
          <p className="muted">No API keys yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const revoked = Boolean(k.revokedAt);
                return (
                  <tr key={k.id} className={revoked ? 'row-muted' : undefined}>
                    <td>{k.name}</td>
                    <td className="mono">{k.prefix}…</td>
                    <td>
                      {revoked ? (
                        <span className="badge badge--muted">Revoked</span>
                      ) : (
                        <span className="badge badge--ok">Active</span>
                      )}
                    </td>
                    <td>{new Date(k.createdAt).toLocaleString()}</td>
                    <td className="cell-actions">
                      {!revoked && (
                        <button
                          type="button"
                          className="btn btn-danger-ghost"
                          onClick={() => void revokeKey(k.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Revoking a key rejects the next MCP call with that bearer token. If Cursor still works,
          check <span className="mono">mcp.json</span> — it may still use a different active key.
        </p>
      </section>

      {isAdmin && (
        <section className="panel">
          <h2>Team members</h2>
          <form onSubmit={handleInvite} className="form-grid invite-grid">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Name</span>
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Role</span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <div className="form-actions field--full">
              <button type="submit" className="btn btn-primary" disabled={inviting}>
                {inviting ? 'Inviting…' : 'Invite member'}
              </button>
            </div>
          </form>

          {members.length === 0 ? (
            <p className="muted">No members loaded.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id ?? m.email}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>
                      <span className="role-tag">{m.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 style={{ marginTop: '1.5rem' }}>All active API keys</h2>
          <p className="muted">Revoke a member key to cut off their external MCP access.</p>
          {teamKeys.length === 0 ? (
            <p className="muted">No active team keys.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {teamKeys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.userEmail ?? '—'}</td>
                    <td>{k.name}</td>
                    <td className="mono">{k.prefix}…</td>
                    <td>{new Date(k.createdAt).toLocaleString()}</td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-danger-ghost"
                        onClick={() => void revokeKey(k.id, true)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

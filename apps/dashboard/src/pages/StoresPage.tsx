import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Store, StoreAccess, StoresResponse } from '../types';

function statusClass(status: string): string {
  if (status === 'ready') return 'badge badge--ok';
  if (status === 'failed') return 'badge badge--warn';
  if (status === 'deleting') return 'badge badge--muted';
  return 'badge';
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

export function StoresPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<StoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [accessById, setAccessById] = useState<Record<string, StoreAccess>>({});
  const [accessLoading, setAccessLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<StoresResponse>('/api/stores');
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load stores');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    setCreating(true);
    setError(null);
    try {
      await api.post<Store>('/api/stores', { name: name.trim() });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleRetry(id: string) {
    setError(null);
    try {
      await api.post(`/api/stores/${id}/retry`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Retry failed');
    }
  }

  async function handleDelete(store: Store) {
    if (
      !window.confirm(
        `Delete store "${store.name}"? This removes its namespace, volumes, and MCP registration.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.delete(`/api/stores/${store.id}`);
      setAccessById((prev) => {
        const next = { ...prev };
        delete next[store.id];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function revealAccess(storeId: string) {
    setAccessLoading(storeId);
    setError(null);
    try {
      const access = await api.get<StoreAccess>(`/api/stores/${storeId}/access`);
      setAccessById((prev) => ({ ...prev, [storeId]: access }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load WP admin credentials');
    } finally {
      setAccessLoading(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Stores</h1>
          <p className="muted">
            Provision isolated WooCommerce stores (own namespace, DB, MCP). Tools appear as{' '}
            <span className="mono">woo-&#123;slug&#125;__*</span> on the gateway.
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {error && <p className="alert alert--error">{error}</p>}

      {data && !data.enabled && (
        <p className="alert">Multi-store provisioning is disabled in this deployment.</p>
      )}

      {isAdmin && data?.enabled && (
        <section className="panel">
          <h2>Create store</h2>
          <p className="muted small">
            Max {data.maxStoresPerUser} per user. After Ready, add the hosts line shown on the card to{' '}
            <span className="mono">/etc/hosts</span> or the storefront URL will time out on DNS.
          </p>
          <form onSubmit={handleCreate} className="inline-form">
            <label className="field field--grow">
              <span className="sr-only">Store name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Harbor East"
                required
                minLength={2}
                maxLength={64}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Provision store'}
            </button>
          </form>
        </section>
      )}

      {loading ? (
        <p className="muted">Loading stores…</p>
      ) : !data?.stores.length ? (
        <p className="muted">
          No provisioned stores yet. The default platform store remains at store.local.
        </p>
      ) : (
        <div className="card-list">
          {data.stores.map((store) => {
            const access = accessById[store.id];
            return (
              <article key={store.id} className="card">
                <div className="card-head">
                  <div>
                    <h2>{store.name}</h2>
                    <p className="mono muted small">{store.slug}</p>
                  </div>
                  <span className={statusClass(store.status)}>{store.status}</span>
                </div>
                <dl className="meta-grid">
                  <div>
                    <dt>Storefront</dt>
                    <dd>
                      <a href={store.url} target="_blank" rel="noreferrer">
                        {store.url}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>WP Admin</dt>
                    <dd>
                      <a href={store.wpAdminUrl} target="_blank" rel="noreferrer">
                        {store.wpAdminUrl}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>Namespace</dt>
                    <dd className="mono">{store.namespace}</dd>
                  </div>
                  <div>
                    <dt>MCP tools</dt>
                    <dd className="mono">{store.mcpSlug}__*</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{new Date(store.createdAt).toLocaleString()}</dd>
                  </div>
                  {store.status === 'ready' && (
                    <div className="meta-full">
                      <dt>/etc/hosts</dt>
                      <dd>
                        <div className="copy-row">
                          <code className="copy-value">{store.hostsLine}</code>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void copyText(store.hostsLine)}
                          >
                            Copy
                          </button>
                        </div>
                        <p className="muted small" style={{ marginTop: '0.5rem' }}>
                          Run:{' '}
                          <span className="mono">
                            echo &apos;{store.hostsLine}&apos; | sudo tee -a /etc/hosts
                          </span>
                        </p>
                      </dd>
                    </div>
                  )}
                  {store.statusReason && (
                    <div className="meta-full">
                      <dt>Status detail</dt>
                      <dd className={store.status === 'failed' ? 'error-text' : undefined}>
                        {store.statusReason}
                      </dd>
                    </div>
                  )}
                  {access && (
                    <div className="meta-full">
                      <dt>WP login</dt>
                      <dd>
                        <p>
                          User: <span className="mono">{access.adminUser}</span>
                        </p>
                        <div className="copy-row">
                          <code className="copy-value">{access.adminPassword}</code>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void copyText(access.adminPassword)}
                          >
                            Copy password
                          </button>
                        </div>
                      </dd>
                    </div>
                  )}
                </dl>
                {isAdmin && (
                  <div className="card-actions">
                    {store.status === 'ready' && !access && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={accessLoading === store.id}
                        onClick={() => void revealAccess(store.id)}
                      >
                        {accessLoading === store.id ? 'Loading…' : 'Show WP admin login'}
                      </button>
                    )}
                    {(store.status === 'failed' || store.status === 'provisioning') && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => void handleRetry(store.id)}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger-ghost"
                      onClick={() => void handleDelete(store)}
                      disabled={store.status === 'deleting'}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

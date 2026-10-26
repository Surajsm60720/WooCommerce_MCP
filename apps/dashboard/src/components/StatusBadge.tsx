import type { McpServer } from '../types';

export type ServerDisplayStatus = 'Connected' | 'Unreachable' | 'Disabled';

export function getServerDisplayStatus(server: McpServer): ServerDisplayStatus {
  if (!server.enabled) return 'Disabled';
  const normalized = server.status.toLowerCase();
  if (normalized === 'connected' || normalized === 'ok' || normalized === 'healthy') {
    return 'Connected';
  }
  return 'Unreachable';
}

export function StatusBadge({ server }: { server: McpServer }) {
  const label = getServerDisplayStatus(server);
  const className =
    label === 'Connected'
      ? 'badge badge--ok'
      : label === 'Disabled'
        ? 'badge badge--muted'
        : 'badge badge--warn';

  return <span className={className}>{label}</span>;
}

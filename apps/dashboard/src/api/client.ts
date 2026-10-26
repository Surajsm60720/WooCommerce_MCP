const TOKEN_KEY = 'mcp_gateway_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  auth = true,
): Promise<T> {
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  if (auth) {
    const token = getStoredToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(path, { ...options, headers });
  const body = await parseJsonSafe(res);

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (typeof body === 'object' && body !== null) {
      const obj = body as { message?: unknown; error?: unknown };
      if (typeof obj.error === 'string') message = obj.error;
      else if (typeof obj.message === 'string') message = obj.message;
    }
    throw new ApiError(message, res.status, body);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, data?: unknown, auth = true) =>
    apiRequest<T>(
      path,
      {
        method: 'POST',
        body: data !== undefined ? JSON.stringify(data) : undefined,
      },
      auth,
    ),
  patch: <T>(path: string, data?: unknown) =>
    apiRequest<T>(path, {
      method: 'PATCH',
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

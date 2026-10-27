// Thin fetch wrapper. The session lives in an httpOnly cookie, so no token is
// ever handled in JavaScript.
export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  code?: string;
  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'rms', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Could not reach the server. Check your internet connection and try again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login') && onUnauthorized) onUnauthorized();
    const message =
      data.error ||
      (res.status === 429 ? 'Too many requests. Please wait a moment and try again.' : 'Something went wrong. Please try again.');
    throw new ApiError(res.status, message, data.fields, data.code);
  }
  return data as T;
}

/**
 * Sends a file as the raw request body (image upload). Same session cookie
 * and CSRF header as every other admin request; the server decides the type
 * from the file's bytes.
 */
export async function uploadFile<T>(path: string, file: Blob, fileName = ''): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'rms',
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(fileName.slice(0, 200)),
      },
      credentials: 'same-origin',
      body: file,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const message = data.error || (res.status === 413 ? 'The image is larger than 5 MB.' : 'The upload failed. Please try again.');
    throw new ApiError(res.status, message, data.fields, data.code);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

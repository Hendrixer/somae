export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

export function apiClient(origin: string, token: string) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Somae needs HTTPS or a local development service.');
  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(new URL(path, base), { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
      throw new ApiError(body.error ?? 'service_unavailable', body.message ?? `Somae returned ${response.status}.`, response.status);
    }
    return response;
  };
  return {
    request,
    async json(path: string) { return (await request(path)).json(); },
    async operation(operation: Record<string, unknown>) {
      return (await request('/v1/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(operation) })).json();
    },
  };
}

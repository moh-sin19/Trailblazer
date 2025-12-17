const DEFAULT_API_ORIGIN = 'http://localhost:8000';

const inferOrigin = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_API_ORIGIN;
  }

  const { protocol, hostname } = window.location;
  const devHosts = new Set(['localhost', '127.0.0.1']);
  if (devHosts.has(hostname)) {
    return `${protocol}//${hostname}:8000`;
  }

  const port = window.location.port ? `:${window.location.port}` : '';
  return `${protocol}//${hostname}${port}`;
};

export const API_ORIGIN = inferOrigin();
export const API_BASE_URL = `${API_ORIGIN}/api`;

export const KNOWN_API_ORIGINS = Array.from(
  new Set([API_ORIGIN, DEFAULT_API_ORIGIN, 'http://127.0.0.1:8000'])
);

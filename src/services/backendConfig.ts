const STORAGE_KEY = 'bolkhata_backend_url';

const DEFAULT_NETLIFY_BACKEND_URL = 'https://bolkhata-live.onrender.com';

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isNetlifyHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'netlify.app' || host.endsWith('.netlify.app');
}

export function getConfiguredBackendUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim()) {
      return normalizeBaseUrl(stored);
    }
  } catch {
    // ignore storage access errors
  }
  const envUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envUrl && envUrl.trim()) {
    return normalizeBaseUrl(envUrl);
  }
  if (isNetlifyHost()) {
    return DEFAULT_NETLIFY_BACKEND_URL;
  }
  return '';
}

export function setConfiguredBackendUrl(url: string): string {
  const normalized = normalizeBaseUrl(url);
  try {
    if (normalized) {
      localStorage.setItem(STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  return normalized;
}

export function isStaticHostingWithoutBackend(): boolean {
  if (typeof window === 'undefined') return false;
  if (getConfiguredBackendUrl()) return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host === 'netlify.app' ||
    host.endsWith('.netlify.app') ||
    host.endsWith('.vercel.app') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.github.io')
  );
}

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getConfiguredBackendUrl();
  if (base) {
    return `${base}${cleanPath}`;
  }
  return cleanPath;
}

export function getWebSocketUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getConfiguredBackendUrl();
  if (base) {
    const parsed = new URL(base);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${parsed.host}${cleanPath}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${cleanPath}`;
}

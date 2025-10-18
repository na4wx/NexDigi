/**
 * api.js
 * 
 * Authenticated API wrapper for fetch requests
 */

import { serverManager } from './serverManager';

/**
 * Authenticated fetch wrapper that automatically includes the UI password header
 */
export async function apiFetch(url, options = {}) {
  const active = serverManager.getActiveServer();
  
  // Add authentication header
  const headers = {
    ...options.headers,
  };
  
  if (active && active.password) {
    headers['X-UI-Password'] = active.password;
  }
  
  // If URL starts with /api and we have an active server, prepend the full backend URL
  let fullUrl = url;
  if (active && url.startsWith('/api')) {
    const protocol = active.protocol || 'http';
    const host = active.host.replace(/^https?:\/\//, '');
    fullUrl = `${protocol}://${host}${url}`;
  } else if (url.startsWith('/api')) {
    // No active server, use default localhost
    fullUrl = `http://${location.hostname}:3000${url}`;
  }
  
  return fetch(fullUrl, {
    ...options,
    headers
  });
}

/**
 * Get the backend base URL
 */
export function getBackendUrl() {
  const active = serverManager.getActiveServer();
  if (active && active.host) {
    const protocol = active.protocol || 'http';
    const host = active.host.replace(/^https?:\/\//, '');
    return `${protocol}://${host}`;
  }
  return `http://${location.hostname}:3000`;
}

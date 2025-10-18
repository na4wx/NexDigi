/**
 * axiosConfig.js
 * 
 * Global axios configuration with authentication interceptor
 * Also patches global fetch to include authentication headers
 */

import axios from 'axios';
import { serverManager } from './serverManager';

// Patch global fetch to automatically include authentication header
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const active = serverManager.getActiveServer();
  
  // Only add header if this is an API request
  if (active && active.password && typeof url === 'string' && url.includes('/api/')) {
    options.headers = options.headers || {};
    
    // Handle different header types (Headers object, plain object, array)
    if (options.headers instanceof Headers) {
      options.headers.set('X-UI-Password', active.password);
    } else if (Array.isArray(options.headers)) {
      options.headers.push(['X-UI-Password', active.password]);
    } else {
      options.headers['X-UI-Password'] = active.password;
    }
  }
  
  return originalFetch.call(this, url, options);
};

// Add request interceptor to include authentication header
axios.interceptors.request.use(
  (config) => {
    const active = serverManager.getActiveServer();
    
    if (active && active.password) {
      config.headers = config.headers || {};
      config.headers['X-UI-Password'] = active.password;
    }
    
    // If using relative /api paths and we have an active server, set the base URL
    if (active && config.url && config.url.startsWith('/api')) {
      const protocol = active.protocol || 'http';
      const host = active.host.replace(/^https?:\/\//, '');
      config.baseURL = `${protocol}://${host}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle 401 errors
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      console.warn('Authentication failed - password may be incorrect or missing');
      // Could dispatch an event here to show a UI notification
    }
    return Promise.reject(error);
  }
);

export default axios;

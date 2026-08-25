/**
 * serverManager.js
 * 
 * Manages server connections, authentication, and localStorage persistence
 */

const STORAGE_KEY = 'nexdigi_servers';

/**
 * Server connection structure:
 * {
 *   id: string (uuid),
 *   name: string,
 *   host: string (without protocol, e.g., "localhost:3000"),
 *   password: string,
 *   callsign: string,
 *   protocol: 'http' | 'https' (optional, defaults to 'http')
 * }
 */

export class ServerManager {
  constructor() {
    this.servers = [];
    this.activeServerId = null;
    this.load();
  }

  /**
   * Load servers from localStorage
   */
  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        this.servers = data.servers || [];
        this.activeServerId = data.activeServerId || null;
        
        // Migrate old callsign if it exists
        const oldCallsign = localStorage.getItem('chatCallsign');
        if (oldCallsign && this.servers.length > 0 && !this.servers[0].callsign) {
          this.servers[0].callsign = oldCallsign;
          this.save();
        }
      }
    } catch (err) {
      console.error('Failed to load servers from localStorage:', err);
      this.servers = [];
      this.activeServerId = null;
    }
  }

  /**
   * Save servers to localStorage
   */
  save() {
    try {
      const data = {
        servers: this.servers,
        activeServerId: this.activeServerId
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Failed to save servers to localStorage:', err);
    }
  }

  /**
   * Generate a unique ID
   */
  generateId() {
    return `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add a new server
   */
  addServer(server) {
    const newServer = {
      id: this.generateId(),
      name: server.name || server.host,
      host: server.host.replace(/^https?:\/\//, ''), // Strip protocol if present
      password: server.password,
      callsign: server.callsign,
      protocol: server.protocol || 'http' // Default to http
    };
    
    this.servers.push(newServer);
    
    // Set as active if it's the first server
    if (this.servers.length === 1) {
      this.activeServerId = newServer.id;
    }
    
    this.save();
    return newServer;
  }

  /**
   * Update an existing server
   */
  updateServer(id, updates) {
    const index = this.servers.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error('Server not found');
    }
    
    this.servers[index] = {
      ...this.servers[index],
      ...updates,
      id // Ensure ID doesn't change
    };
    
    this.save();
    return this.servers[index];
  }

  /**
   * Delete a server
   */
  deleteServer(id) {
    const index = this.servers.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error('Server not found');
    }
    
    this.servers.splice(index, 1);
    
    // If we deleted the active server, switch to another
    if (this.activeServerId === id) {
      this.activeServerId = this.servers.length > 0 ? this.servers[0].id : null;
    }
    
    this.save();
  }

  /**
   * Get a server by ID
   */
  getServer(id) {
    return this.servers.find(s => s.id === id);
  }

  /**
   * Get all servers
   */
  getAllServers() {
    return [...this.servers];
  }

  /**
   * Get the active server
   */
  getActiveServer() {
    if (!this.activeServerId) {
      return null;
    }
    return this.getServer(this.activeServerId);
  }

  /**
   * Get the base URL (protocol://host) for the active server, e.g.
   * "http://192.168.1.50:3000". Falls back to this page's own hostname on
   * the server's default port when no server is configured yet, so early
   * callers (before setup completes) still hit something reasonable.
   */
  getBackendUrl() {
    const active = this.getActiveServer();
    if (active && active.host) {
      const protocol = active.protocol || 'http';
      const host = active.host.replace(/^https?:\/\//, '');
      return `${protocol}://${host}`;
    }
    return `${location.protocol}//${location.hostname}:3000`;
  }

  /**
   * Set the active server
   */
  setActiveServer(id) {
    const server = this.getServer(id);
    if (!server) {
      throw new Error('Server not found');
    }
    
    this.activeServerId = id;
    this.save();
    return server;
  }

  /**
   * Check if any servers are configured
   */
  hasServers() {
    return this.servers.length > 0;
  }

  /**
   * Verify server password.
   * Returns a reason so callers can tell "server unreachable" apart from
   * "server reached, password rejected" instead of collapsing both to a
   * single boolean (which used to surface as a misleading "Invalid
   * password" even when the host/port was simply wrong).
   * @returns {Promise<{ok: boolean, reason: 'valid'|'invalid'|'unreachable', message: string}>}
   */
  async verifyPassword(host, password, protocol = 'http') {
    const cleanHost = host.replace(/^https?:\/\//, '');
    let response;
    try {
      response = await fetch(`${protocol}://${cleanHost}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
    } catch (err) {
      // fetch() only throws for network-level failures (DNS, connection
      // refused, CORS, timeout) - never for a reachable server returning
      // an error status. So this is always "couldn't reach the server".
      console.error('Could not reach server for password verification:', err);
      return { ok: false, reason: 'unreachable', message: `Could not reach server at ${cleanHost}. Check the address and that the server is running.` };
    }

    // A 404/500/etc here means *something* answered but it isn't NexDigi's
    // auth endpoint (wrong port pointing at an unrelated service, wrong
    // path, proxy misconfiguration, ...) - that's a different problem than
    // "reached NexDigi, password rejected" (which replies 401 with JSON).
    if (response.status === 404) {
      return { ok: false, reason: 'unreachable', message: `No NexDigi server found at ${cleanHost} (got 404). Check the address and port.` };
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      return { ok: false, reason: 'unreachable', message: `Server at ${cleanHost} did not return a valid response (is this a NexDigi server?).` };
    }

    if (data && data.success === true) {
      return { ok: true, reason: 'valid', message: 'OK' };
    }

    // Defensively coerce whatever the server sent into a renderable string -
    // an API error field is not guaranteed to be a string (some servers/
    // proxies send {code, message} or similar objects), and passing a raw
    // object into React as children crashes the whole tree.
    const rawMessage = (data && (data.message || data.error)) || 'Invalid password';
    const safeMessage = typeof rawMessage === 'string' ? rawMessage : (rawMessage && rawMessage.message) || 'Invalid password';
    return { ok: false, reason: 'invalid', message: safeMessage };
  }

  /**
   * Test server connection
   */
  async testConnection(host, password, protocol = 'http') {
    const cleanHost = host.replace(/^https?:\/\//, '');

    // Try to verify password - distinguishes unreachable server from wrong password
    const verification = await this.verifyPassword(cleanHost, password, protocol);
    if (!verification.ok) {
      return { success: false, error: verification.message, reason: verification.reason };
    }

    // Try to fetch channels (read-only, should work if server is up)
    try {
      const response = await fetch(`${protocol}://${cleanHost}/api/channels`, {
        headers: {
          'X-UI-Password': password
        }
      });

      if (!response.ok) {
        return { success: false, error: `Server returned ${response.status}`, reason: 'error' };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: `Could not reach server at ${cleanHost}. Check the address and that the server is running.`, reason: 'unreachable' };
    }
  }
}

// Export singleton instance
export const serverManager = new ServerManager();

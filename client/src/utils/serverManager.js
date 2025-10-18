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
   * Verify server password
   */
  async verifyPassword(host, password, protocol = 'http') {
    try {
      const cleanHost = host.replace(/^https?:\/\//, '');
      const response = await fetch(`${protocol}://${cleanHost}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });
      
      const data = await response.json();
      return data.success === true;
    } catch (err) {
      console.error('Password verification failed:', err);
      return false;
    }
  }

  /**
   * Test server connection
   */
  async testConnection(host, password, protocol = 'http') {
    try {
      const cleanHost = host.replace(/^https?:\/\//, '');
      
      // Try to verify password
      const isValid = await this.verifyPassword(cleanHost, password, protocol);
      if (!isValid) {
        return { success: false, error: 'Invalid password' };
      }
      
      // Try to fetch channels (read-only, should work if server is up)
      const response = await fetch(`${protocol}://${cleanHost}/api/channels`, {
        headers: {
          'X-UI-Password': password
        }
      });
      
      if (!response.ok) {
        return { success: false, error: `Server returned ${response.status}` };
      }
      
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// Export singleton instance
export const serverManager = new ServerManager();

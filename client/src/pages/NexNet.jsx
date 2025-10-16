import { useState, useEffect } from 'react';

export default function NexNet({ setPage }) {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    const interval = setInterval(fetchStatus, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/backbone/status');
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError('Failed to fetch backbone status');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/backbone/config');
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  };

  const handleEnableToggle = async () => {
    if (!config) return;
    
    setSaving(true);
    try {
      const newConfig = { ...config, enabled: !config.enabled };
      const res = await fetch('/api/backbone/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const data = await res.json();
      if (data.success) {
        setConfig(newConfig);
        alert('Configuration updated. Please restart the server to apply changes.');
      }
    } catch (err) {
      alert('Failed to update configuration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatLastSeen = (lastSeenAgo) => {
    const seconds = Math.floor(lastSeenAgo / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">NexNet</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">NexNet</h1>
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">NexNet</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setPage && setPage('nexnet-settings')}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded"
          >
            ⚙️ Settings
          </button>
          {config && (
            <button
              onClick={handleEnableToggle}
              disabled={saving}
              className={`px-4 py-2 rounded ${
                config.enabled
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-green-500 hover:bg-green-600 text-white'
              } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {saving ? 'Saving...' : config.enabled ? 'Disable' : 'Enable'}
            </button>
          )}
        </div>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Status</h3>
          <p className={`text-2xl font-bold ${status?.enabled ? 'text-green-600' : 'text-gray-400'}`}>
            {status?.enabled ? 'Enabled' : 'Disabled'}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Mode</h3>
          <p className="text-2xl font-bold text-purple-600">
            {status?.transports?.internet?.mode ? 
              <span className={`px-3 py-1 text-lg rounded ${
                status.transports.internet.mode === 'server' ? 'bg-green-100 text-green-800' :
                status.transports.internet.mode === 'client' ? 'bg-blue-100 text-blue-800' :
                'bg-purple-100 text-purple-800'
              }`}>
                {status.transports.internet.mode === 'server' ? '🌐 Hub' :
                 status.transports.internet.mode === 'client' ? '📡 Client' :
                 '🔗 Mesh'}
              </span>
            : 'N/A'}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Neighbors</h3>
          <p className="text-2xl font-bold text-blue-600">
            {status?.neighbors?.length || 0}
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">Callsign</h3>
          <p className="text-2xl font-bold text-gray-800">
            {status?.localCallsign || 'N/A'}
          </p>
        </div>
      </div>

      {/* Hub Connection Status (Client Mode) */}
      {status?.enabled && status?.transports?.internet?.mode === 'client' && (
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-3">Hub Connection</h2>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Hub Callsign</h3>
                <p className="text-lg font-medium text-gray-900">
                  {status.transports.internet.hubCallsign || 'Not connected'}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Connection Status</h3>
                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  status.transports.internet.connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {status.transports.internet.connected ? '✓ Connected' : '✗ Disconnected'}
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Hub Address</h3>
                <p className="text-sm text-gray-700 font-mono">
                  {config?.transports?.internet?.hubServer?.host || 'N/A'}:
                  {config?.transports?.internet?.hubServer?.port || 'N/A'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hub Statistics (Server Mode) */}
      {status?.enabled && status?.transports?.internet?.mode === 'server' && (
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-3">Hub Statistics</h2>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Connected Clients</h3>
                <p className="text-3xl font-bold text-blue-600">
                  {status.transports.internet.connectedClients || 0}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Packets Relayed</h3>
                <p className="text-3xl font-bold text-green-600">
                  {status.transports.internet.packetsRelayed || 0}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Total Bandwidth</h3>
                <p className="text-lg font-medium text-gray-700">
                  ↑ {formatBytes(status.transports.internet.bytesSent || 0)}<br/>
                  ↓ {formatBytes(status.transports.internet.bytesReceived || 0)}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-1">Uptime</h3>
                <p className="text-lg font-medium text-gray-700">
                  {formatUptime(status.transports.internet.uptime || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transports */}
      {status?.enabled && (
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-3">Transports</h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cost</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">MTU</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TX/RX</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.entries(status?.transports || {}).map(([id, transport]) => (
                  <tr key={id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-gray-900 uppercase">{id}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transport.connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {transport.connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{transport.metrics?.cost || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{transport.metrics?.mtu || 'N/A'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transport.metrics?.packetsSent || 0} / {transport.metrics?.packetsReceived || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Neighbors */}
      {status?.enabled && status?.neighbors && status.neighbors.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-3">Neighbors</h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Callsign</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transports</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Services</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {status.neighbors.map((neighbor) => (
                  <tr key={neighbor.callsign}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{neighbor.callsign}</span>
                        {neighbor.viaHub && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded" title="Learned via hub">
                            via hub
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-1">
                        {neighbor.transports.map(t => (
                          <span key={t} className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded uppercase">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {neighbor.services.map(s => (
                          <span key={s} className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatLastSeen(neighbor.lastSeenAgo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Services */}
      {status?.enabled && status?.services && Object.keys(status.services).length > 0 && (
        <div className="mb-6">
          <h2 className="text-xl font-bold mb-3">Available Services</h2>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(status.services).map(([service, providers]) => (
                <div key={service} className="border rounded p-3">
                  <h3 className="font-semibold text-gray-700 mb-2">{service}</h3>
                  <div className="text-sm text-gray-600">
                    {providers.length} provider{providers.length !== 1 ? 's' : ''}:
                    <ul className="mt-1 ml-4 list-disc">
                      {providers.map(p => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Configuration Info */}
      {!status?.enabled && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">Getting Started</h3>
          <p className="text-sm text-blue-800 mb-2">
            NexNet allows multiple NexDigi nodes to connect and share data via RF and/or Internet using advanced mesh networking with QoS, load balancing, and self-healing capabilities.
          </p>
          <p className="text-sm text-blue-800">
            To enable NexNet, configure your settings and click the Enable button above. You'll need to restart the server for changes to take effect.
          </p>
        </div>
      )}
    </div>
  );
}

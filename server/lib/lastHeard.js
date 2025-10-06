const fs = require('fs');
const path = require('path');
const { writeJsonAtomicSync } = require('./fileHelpers');

class LastHeard {
  constructor(opts) {
    opts = opts || {};
    this.filePath = opts.filePath || path.join(__dirname, '..', 'data', 'lastHeard.json');
    this.maxAgeMs = typeof opts.maxAgeMs === 'number' ? opts.maxAgeMs : (48 * 60 * 60 * 1000); // 48 hours
    this.entries = [];
    this._dirty = false;
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.entries = [];
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const j = JSON.parse(raw || '[]');
      if (Array.isArray(j)) this.entries = j; else this.entries = [];
      this._prune();
    } catch (e) {
      console.error('[LastHeard] load error:', e && e.message);
      this.entries = [];
    }
  }

  _persistSoon() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      try {
        writeJsonAtomicSync(this.filePath, this.entries);
      } catch (e) { console.error('[LastHeard] save error:', e && e.message); }
      this._saveTimer = null;
      this._dirty = false;
    }, 1000);
  }

  _prune() {
    const cutoff = Date.now() - this.maxAgeMs;
    // keep entries newer than cutoff
    this.entries = this.entries.filter(e => (e.ts || 0) >= cutoff);
  }

  add(entry) {
    try {
      // Normalize minimal entry structure
      const e = {
        callsign: entry.callsign || null,
        ssid: (typeof entry.ssid === 'number') ? entry.ssid : (entry.callsign && entry.callsign.split('-')[1] ? Number(entry.callsign.split('-')[1]) : null),
        mode: entry.mode || 'APRS',
        channel: entry.channel || null,
        raw: entry.raw || null,
        info: entry.info || null,
        ts: entry.ts || Date.now()
      };
      // dedupe by callsign + mode; update existing if newer
      if (e.callsign) {
        const key = `${String(e.callsign).toUpperCase()}|${e.mode}`;
        const idx = this.entries.findIndex(x => `${String(x.callsign).toUpperCase()}|${x.mode}` === key);
        if (idx !== -1) {
          if ((this.entries[idx].ts || 0) < e.ts) this.entries[idx] = Object.assign({}, this.entries[idx], e);
        } else {
          this.entries.unshift(e);
        }
      } else {
        // no callsign - push as anonymous raw entry
        this.entries.unshift(e);
      }
      // prune to max age
      this._prune();
      this._dirty = true;
      this._persistSoon();
    } catch (err) {
      console.error('[LastHeard] add error:', err && err.message);
    }
  }

  // simple query: filter by callsign substring, mode, since timestamp, limit
  query(opts) {
    opts = opts || {};
    const q = (opts.q && String(opts.q).trim()) ? String(opts.q).toUpperCase() : null;
    const mode = opts.mode ? String(opts.mode).toUpperCase() : null;
    const since = opts.since ? Number(opts.since) : null;
    const limit = Math.min(typeof opts.limit === 'number' ? opts.limit : 200, 2000);
    let res = this.entries.slice();
    if (q) res = res.filter(e => (e.callsign && String(e.callsign).toUpperCase().includes(q)) || (e.info && String(e.info).toUpperCase().includes(q)) );
    if (mode) res = res.filter(e => String(e.mode || '').toUpperCase() === mode);
    if (since) res = res.filter(e => (e.ts || 0) >= since);
    return res.slice(0, limit);
  }
}

module.exports = LastHeard;

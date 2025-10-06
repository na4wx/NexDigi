const fs = require('fs');
const path = require('path');

// Atomically write JSON to disk by writing to a temp file then renaming.
// Synchronous to keep callers simple and deterministic during shutdown.
function writeJsonAtomicSync(filePath, obj, options = {}) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}`);
  const json = JSON.stringify(obj, null, options.spaces || 2);
  // write then fsync where available
  try {
    fs.writeFileSync(tmp, json, 'utf8');
    try {
      const fd = fs.openSync(tmp, 'r');
      try { fs.fsyncSync(fd); } catch (e) { /* ignore fsync errors on some platforms */ }
      fs.closeSync(fd);
    } catch (e) { /* ignore fstat/fsync issues */ }
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // best-effort cleanup of tmp file
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
    throw err;
  }
}

module.exports = { writeJsonAtomicSync };

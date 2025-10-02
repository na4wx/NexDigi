const DEFAULT_MAX = 67;

const SAME_TO_BLN = [
  { codes: ['TOR'], bln: { n: 2, label: 'TOR' }, kw: ['tornado'] },
  { codes: ['SVR'], bln: { n: 3, label: 'SVR' }, kw: ['severe thunderstorm'] },
  { codes: ['FFW','FLW','CFW'], bln: { n: 4, label: 'FLD' }, kw: ['flood','flash flood','coastal flood'] },
  { codes: ['WIN'], bln: { n: 5, label: 'WIN' }, kw: ['blizzard','winter','lake effect'] },
  { codes: ['HEA'], bln: { n: 6, label: 'HEA' }, kw: ['heat','excessive heat'] },
  { codes: ['FIR'], bln: { n: 7, label: 'FIRE' }, kw: ['fire','red flag'] },
  { codes: ['MAR'], bln: { n: 8, label: 'MAR' }, kw: ['marine','special marine'] },
  { codes: ['WX'],  bln: { n: 1, label: 'WX' },  kw: [] }
];

function chooseBlnHeader({ sameCode, event }) {
  const ev = (event || '').trim().toLowerCase();
  const code = (sameCode || '').trim().toUpperCase();
  if (code) {
    const hit = SAME_TO_BLN.find(m => (m.codes || []).includes(code));
    if (hit) return `BLN${hit.bln.n}${hit.bln.label}`;
  }
  if (ev) {
    const hit = SAME_TO_BLN.find(m => (m.kw || []).some(k => ev.includes(k)));
    if (hit) return `BLN${hit.bln.n}${hit.bln.label}`;
  }
  return 'BLN1WX';
}

function normalizeText(s, uppercase = true) {
  if (!s) return '';
  let t = s
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(\w)([.,;:!?])/g, '$1$2')
    .replace(/([.,;:!?])(\w)/g, '$1 $2');
  t = t.trim();
  return uppercase ? t.toUpperCase() : t;
}

function hardSplit(str, max) {
  const chunks = [];
  for (let i = 0; i < str.length; i += max) chunks.push(str.slice(i, i + max));
  return chunks;
}

function chunkText(text, max = DEFAULT_MAX) {
  const out = [];
  let line = '';
  const pushLine = () => { if (line.length) { out.push(line); line = ''; } };
  for (const raw of text.split(' ')) {
    const word = raw.trim(); if (!word) continue;
    if (line.length === 0) {
      if (word.length <= max) line = word;
      else {
        const parts = hardSplit(word, max);
        out.push(...parts.slice(0, -1));
        line = parts[parts.length - 1] || '';
      }
      continue;
    }
    if (line.length + 1 + word.length <= max) line += ' ' + word;
    else { pushLine(); if (word.length <= max) line = word; else { const parts = hardSplit(word, max); out.push(...parts.slice(0, -1)); line = parts[parts.length - 1] || ''; } }
  }
  pushLine();
  return out;
}

function buildHeadline({ event, area, until }, max, uppercase) {
  const parts = [];
  if (event) parts.push(event);
  if (area) parts.push(area);
  if (until) parts.push(`TIL ${until}`);
  const headline = normalizeText(parts.join(' '), uppercase);
  return headline.length ? headline : '';
}

function formatAprsBulletin({ sameCode, event, area, until, body, options = {} }) {
  const max = Math.max(10, options.maxChars ?? DEFAULT_MAX);
  const uppercase = options.uppercase !== false;
  const concise = !!options.concise;
  const toFull = chooseBlnHeader({ sameCode, event });
  const dest = String(toFull || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6) || 'BLN1WX';
  const headline = buildHeadline({ event, area, until }, max, uppercase);
  const includeSame = !!(options.includeSame);
  const sameCodes = Array.isArray(options.sameCodes) ? options.sameCodes.map(s => String(s).trim()).filter(Boolean) : [];
  if (concise) {
    // single short frame: EVENT AREA TIL TIME
    let text = normalizeText(headline, uppercase);
    if (includeSame && sameCodes.length) {
      const s = `SAME:${sameCodes.join(',')}`;
      // prepend SAME tag if it fits, otherwise append
      if ((s + ' ' + text).length <= max) text = `${s} ${text}`;
      else if ((text + ' ' + s).length <= max) text = `${text} ${s}`;
      else text = (s + ' ' + text).slice(0, max);
    }
    text = text.slice(0, max);
    return [{ to: toFull, dest, text }];
  }
  const cleanedBody = normalizeText(body || '', uppercase);
  const lines = [];
  if (headline) lines.push(headline);
  const sentences = cleanedBody.replace(/([.!?])\s+/g, '$1|').split('|').map(s => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const chunks = chunkText(s, max);
    lines.push(...chunks);
  }
  const frames = lines.map(text => ({ to: toFull, dest, text }));
  // If requested, prepend SAME codes to the first frame text (or create one if none)
  if (includeSame && sameCodes.length) {
    const s = `SAME:${sameCodes.join(',')}`;
    if (frames.length === 0) {
      frames.push({ to: toFull, dest, text: s.slice(0, max) });
    } else {
      const first = frames[0];
      if ((s + ' ' + first.text).length <= max) first.text = `${s} ${first.text}`;
      else if ((first.text + ' ' + s).length <= max) first.text = `${first.text} ${s}`;
      else first.text = (s + ' ' + first.text).slice(0, max);
    }
  }
  return frames;
}

function framesToTnc2(frames, { from, via = [] } = {}) {
  return frames.map(f => {
    const headerLeft = from ? `${from}>${f.to}` : f.to;
    const viaPart = via.length ? `,${via.join(',')}` : '';
    return `${headerLeft}${viaPart}:${f.text}`;
  });
}

module.exports = { formatAprsBulletin, framesToTnc2 };

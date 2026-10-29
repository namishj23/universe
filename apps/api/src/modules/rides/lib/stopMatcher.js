// Resolves free text a student typed ("andheri stn", "Ghatkoper") to the
// closest-matching stop. Case-insensitive; partial matches and small typos allowed.

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// 1 = exact, ~0.9 = one contains the other, lower = word overlap / near-spelling, 0 = unrelated.
function similarity(input, label) {
  if (!input || !label) return 0;
  if (input === label) return 1;
  if (label.includes(input) || input.includes(label)) {
    return (
      0.8 + 0.1 * (Math.min(input.length, label.length) / Math.max(input.length, label.length))
    );
  }
  const iw = input.split(' ');
  const lw = label.split(' ');
  const shared = iw.filter(
    (w) => w.length > 1 && lw.some((l) => l.startsWith(w) || w.startsWith(l)),
  ).length;
  const wordScore = shared ? 0.5 + 0.3 * (shared / Math.max(iw.length, lw.length)) : 0;
  const spell = 1 - editDistance(input, label) / Math.max(input.length, label.length);
  return Math.max(wordScore, spell >= 0.7 ? spell * 0.75 : 0);
}

const MIN_SIMILARITY = 0.45;

/**
 * @param {{ id, name, shortName?, aliases? }[]} nodes
 * @param {string} text
 * @returns the best-matching node, or null if nothing is close enough
 */
function matchStop(nodes, text) {
  const input = norm(text);
  let best = null;
  let bestScore = 0;
  for (const n of nodes) {
    const labels = [n.name, n.shortName, ...(n.aliases || [])].map(norm);
    const score = Math.max(...labels.map((l) => similarity(input, l)));
    if (score > bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return bestScore >= MIN_SIMILARITY ? best : null;
}

module.exports = { matchStop };

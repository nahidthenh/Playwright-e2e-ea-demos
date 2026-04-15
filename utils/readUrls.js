const fs = require('fs');
const path = require('path');

/**
 * Reads URLs from a plain-text file, one URL per line.
 * Skips blank lines and lines starting with '#' (comments).
 *
 * @param {string} filePath - Absolute or relative path to the URL file.
 * @returns {string[]} Array of trimmed, non-empty URL strings.
 */
function readUrls(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`URL file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf-8');

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

module.exports = { readUrls };

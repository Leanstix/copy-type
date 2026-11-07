'use strict';
const fs = require('node:fs');
const path = require('node:path');
function workspaceFile(root, name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 512 || /[\0\r\n]/.test(name)) throw Error('Enter a relative filename, such as src/example.js.');
  const parts = name.trim().split(/[\\/]/);
  if (/^[a-z]:/i.test(name) || parts.some(part => !part || part === '.' || part === '..')) throw Error('Choose a filename inside the selected workspace folder.');
  const base = fs.realpathSync(root), destination = path.join(base, ...parts);
  let parent = path.dirname(destination);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const relative = path.relative(base, fs.realpathSync(parent));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('This path leaves the workspace through a symbolic link.');
  return path.resolve(root, ...parts);
}
module.exports = {workspaceFile};

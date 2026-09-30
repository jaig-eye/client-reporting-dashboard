// Loaded with --require by `npm run test:unit` (see package.json).
//
// Lets node's built-in test runner load pure lib/ modules straight from TypeScript: sucrase
// transpiles on require (it is already installed as a dependency of Tailwind — no test framework
// added), and the '@/…' path alias is mapped to src/. Only modules with no server or network
// imports can be loaded this way, which is the point — these check the rules, not the plumbing.

const path = require('path')
const Module = require('module')

const root = path.resolve(__dirname, '..', '..')
process.env.WT = root

try {
  require(path.join(root, 'node_modules/sucrase/register/ts'))
} catch {
  console.error('sucrase is not installed (it normally arrives with tailwindcss). Run npm install.')
  process.exit(1)
}
const resolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith('@/')) req = path.join(root, 'src', req.slice(2))
  return resolve.call(this, req, ...rest)
}

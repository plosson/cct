/**
 * Build renderer bundle with esbuild
 * Bundles src/renderer/index.js → dist/renderer.bundle.js
 */

const esbuild = require('esbuild');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

esbuild.buildSync({
  entryPoints: [path.join(projectRoot, 'src/renderer/index.js')],
  bundle: true,
  outfile: path.join(projectRoot, 'dist/renderer.bundle.js'),
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info'
});

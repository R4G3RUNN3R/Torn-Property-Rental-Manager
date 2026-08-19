'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'R4G3RUNN3R-Property-Rental-Manager.user.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const sourceFiles = [
  'src/property-core.js',
  'src/market-core.js',
  'src/api-core.js',
  'src/draft-core.js',
  'src/form-core.js',
  'src/app.js',
  'src/bootstrap.js'
];

function metadata() {
  return `// ==UserScript==
// @name         R4G3RUNN3R Property Rental Manager
// @namespace    https://github.com/R4G3RUNN3R
// @version      ${packageJson.version}
// @description  Price owned Torn rentals from exact market matches and list them through an explicit two-click workflow.
// @author       R4G3RUNN3R
// @match        https://www.torn.com/properties.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==
`;
}

function buildText() {
  const modules = sourceFiles.map(file => {
    const source = fs.readFileSync(path.join(root, file), 'utf8').trimEnd();
    return `\n/* ===== ${file} ===== */\n${source}\n`;
  }).join('');

  return `${metadata()}${modules}\n/* ===== userscript start ===== */\nR4G3PropertyRentalBootstrap.start();\n`;
}

function main() {
  const expected = buildText();
  if (process.argv.includes('--check')) {
    const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (actual !== expected) {
      console.error('Userscript release is out of date. Run npm run build and commit the generated file.');
      process.exitCode = 1;
    }
    return;
  }

  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Built ${path.relative(root, outputPath)}`);
}

if (require.main === module) main();

module.exports = Object.freeze({ sourceFiles, buildText });

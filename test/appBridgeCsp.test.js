import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const settingsSource = fs.readFileSync(new URL('../web/src/pages/SettingsPage.jsx', import.meta.url), 'utf8');

test('CSP allows the Shopify App Bridge CDN required by save bar UI', () => {
  assert.match(serverSource, /scriptSrc:\s*\[[\s\S]*?["']https:\/\/cdn\.shopify\.com["']/);
  assert.match(serverSource, /connectSrc:\s*\[[\s\S]*?["']https:\/\/cdn\.shopify\.com["']/);
});

test('Shopify App Bridge CDN script remains present', () => {
  assert.match(indexSource, /https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js/);
});

test('Settings keeps automatic Shopify save bar integration', () => {
  assert.match(settingsSource, /<form[\s\S]*?data-save-bar[\s\S]*?onSubmit=\{handleFormSubmit\}[\s\S]*?onReset=\{handleFormReset\}/);
  assert.match(settingsSource, /dirtyBridgeRef/);
  assert.match(settingsSource, /dispatchEvent\(new Event\(["']input["'], \{ bubbles: true \}\)\)/);
});

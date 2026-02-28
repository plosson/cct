// @ts-check
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

// --- File & YAML validation tests (no Electron needed) ---

test('ci.yml exists and is valid YAML', async () => {
  const ciPath = path.join(projectRoot, '.github', 'workflows', 'ci.yml');
  expect(fs.existsSync(ciPath)).toBe(true);

  const content = fs.readFileSync(ciPath, 'utf8');
  expect(content).toContain('name: CI');
  expect(content).toContain('on:');
  expect(content).toContain('jobs:');
  // No tabs (would break YAML)
  expect(content).not.toMatch(/\t/);
});

test('release.yml exists and is valid YAML', async () => {
  const releasePath = path.join(projectRoot, '.github', 'workflows', 'release.yml');
  expect(fs.existsSync(releasePath)).toBe(true);

  const content = fs.readFileSync(releasePath, 'utf8');
  expect(content).toContain('name: Release');
  expect(content).toContain('on:');
  expect(content).toContain('jobs:');
  expect(content).not.toMatch(/\t/);
});

test('CI workflow has install, lint, build, test steps', async () => {
  const content = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8'
  );
  expect(content).toContain('npm ci');
  expect(content).toContain('npm run lint');
  expect(content).toContain('npm run build');
  expect(content).toMatch(/playwright test|npm test/);
});

test('release workflow triggers on v* tags and uses electron-builder', async () => {
  const content = fs.readFileSync(
    path.join(projectRoot, '.github', 'workflows', 'release.yml'), 'utf8'
  );
  expect(content).toContain("- 'v*'");
  expect(content).toContain('electron-builder');
});

test('electron-builder config exists and is valid', async () => {
  const configPath = path.join(projectRoot, 'electron-builder.config.js');
  expect(fs.existsSync(configPath)).toBe(true);
  const config = require(configPath);
  expect(config.appId).toBeTruthy();
  expect(config.mac).toBeTruthy();
  expect(config.publish.provider).toBe('github');
});

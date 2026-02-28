// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

function readWorkflow(name) {
  const filePath = path.join(projectRoot, '.github', 'workflows', name);
  expect(fs.existsSync(filePath)).toBe(true);
  return fs.readFileSync(filePath, 'utf8');
}

function expectValidYaml(content, workflowName) {
  expect(content).toContain(`name: ${workflowName}`);
  expect(content).toContain('on:');
  expect(content).toContain('jobs:');
  expect(content).not.toMatch(/\t/);
}

test('ci.yml exists and is valid YAML', async () => {
  const content = readWorkflow('ci.yml');
  expectValidYaml(content, 'CI');
});

test('release.yml exists and is valid YAML', async () => {
  const content = readWorkflow('release.yml');
  expectValidYaml(content, 'Release');
});

test('CI workflow has install, lint, build, test steps', async () => {
  const content = readWorkflow('ci.yml');
  expect(content).toContain('npm ci');
  expect(content).toContain('npm run lint');
  expect(content).toContain('npm run build');
  expect(content).toMatch(/playwright test|npm test/);
});

test('release workflow triggers on v* tags and uses electron-builder', async () => {
  const content = readWorkflow('release.yml');
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

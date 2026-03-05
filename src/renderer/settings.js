/**
 * Settings tab + Audio Trim UI
 * Extracted from renderer/index.js
 */

import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import {
  sessions,
  getSelectedProjectPath, getTerminalsContainer, getTabBarTabs,
  projects,
  activateTab, closeTab, renderSidebar,
  showPromptOverlay, loadSoundTheme, applyThemeSetting,
} from './index.js';

const api = window.electron_api;

// ── Settings tab (Cmd+,) ─────────────────────────────────────

/** Unique counter for settings pseudo-sessions (negative to avoid PTY id collisions) */
let settingsIdCounter = -1000;

/** All hook event names for the Sound & Hooks UI */
const ALL_HOOK_EVENTS = [
  'SessionStart', 'SessionEnd',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification',
  'SubagentStart', 'SubagentStop',
  'PreCompact', 'ConfigChange',
  'UserPromptSubmit', 'Stop',
  'TeammateIdle', 'TaskCompleted',
  'WorktreeCreate', 'WorktreeRemove',
];

/**
 * Find an existing settings tab for the current project (or global).
 * Returns the session id or null.
 */
function findSettingsTab() {
  for (const [id, s] of sessions.entries()) {
    if (s.type === 'settings') return id;
  }
  return null;
}

/** Open (or focus) the settings tab */
async function openSettings() {
  // If a settings tab already exists, just focus it
  const existing = findSettingsTab();
  if (existing !== null) {
    activateTab(existing);
    return;
  }

  const id = settingsIdCounter--;

  const panelEl = document.createElement('div');
  panelEl.className = 'terminal-panel settings-tab-panel';
  getTerminalsContainer().appendChild(panelEl);

  // Build settings icon for tab
  const settingsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></svg>`;
  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `<span class="tab-icon tab-icon-settings" style="background:var(--accent-bg);color:var(--accent)">${settingsSvg}</span><span class="tab-label" data-testid="tab-label">Settings</span><button class="tab-close" data-testid="tab-close">&times;</button>`;
  getTabBarTabs().appendChild(tabEl);

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) activateTab(id);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(id));

  const cleanup = () => {}; // no PTY to dispose

  sessions.set(id, {
    terminal: null, fitAddon: null, searchAddon: null,
    panelEl, tabEl, cleanup,
    projectPath: getSelectedProjectPath() || '__global__',
    sessionId: null, type: 'settings', createdAt: Date.now(),
  });

  // Render settings content into the panel
  await renderSettingsTab(panelEl);
  activateTab(id);
  renderSidebar();
}

/** Render the full settings tab UI into a panel element */
async function renderSettingsTab(panelEl) {
  const selectedProjectPath = getSelectedProjectPath();
  const [schema, globalConfig, projectConfig, themes, version] = await Promise.all([
    api.appConfig.getSchema(),
    api.appConfig.getGlobal(),
    selectedProjectPath ? api.appConfig.getProject(selectedProjectPath) : Promise.resolve(null),
    api.soundThemes ? api.soundThemes.list() : Promise.resolve([]),
    api.getVersion().catch(() => '?'),
  ]);

  let resolvedSoundMap = null;
  if (api.soundThemes) {
    resolvedSoundMap = await api.soundThemes.getSounds(selectedProjectPath) || {};
  }

  // State
  let activeSection = 'general';
  let settingsScope = 'global'; // 'global' or 'project'
  const editGlobal = { ...globalConfig };
  const editProject = projectConfig ? { ...projectConfig } : {};

  const container = document.createElement('div');
  container.className = 'settings-container';

  // ── Scope toggle bar ───────────────────────────────────────
  const scopeBar = document.createElement('div');
  scopeBar.className = 'settings-scope-bar';

  const scopeGlobalBtn = document.createElement('button');
  scopeGlobalBtn.className = 'settings-scope-btn active';
  scopeGlobalBtn.dataset.testid = 'settings-scope-global';
  scopeGlobalBtn.textContent = 'All Projects';

  const scopeProjectBtn = document.createElement('button');
  scopeProjectBtn.className = 'settings-scope-btn';
  scopeProjectBtn.dataset.testid = 'settings-scope-project';
  const currentProjectName = selectedProjectPath
    ? projects.find(p => p.path === selectedProjectPath)?.name || 'Project'
    : 'Project';
  scopeProjectBtn.textContent = currentProjectName;
  scopeProjectBtn.disabled = !selectedProjectPath;

  scopeBar.appendChild(scopeGlobalBtn);
  scopeBar.appendChild(scopeProjectBtn);
  container.appendChild(scopeBar);

  scopeGlobalBtn.addEventListener('click', () => {
    settingsScope = 'global';
    scopeGlobalBtn.classList.add('active');
    scopeProjectBtn.classList.remove('active');
    renderActiveSection();
  });
  scopeProjectBtn.addEventListener('click', () => {
    if (!selectedProjectPath) return;
    settingsScope = 'project';
    scopeProjectBtn.classList.add('active');
    scopeGlobalBtn.classList.remove('active');
    renderActiveSection();
  });

  // ── Two-column layout ──────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'settings-layout';

  // Left nav
  const nav = document.createElement('nav');
  nav.className = 'settings-nav';
  const sections = [
    { id: 'general', label: 'General', icon: '\u2699' },
    { id: 'sounds', label: 'Sound & Hooks', icon: '\uD83D\uDD0A' },
    { id: 'about', label: 'About', icon: '\u2139' },
  ];

  for (const sec of sections) {
    const btn = document.createElement('button');
    btn.className = 'settings-nav-item' + (sec.id === activeSection ? ' active' : '');
    btn.dataset.section = sec.id;
    btn.dataset.testid = `settings-nav-${sec.id}`;
    btn.textContent = sec.label;
    btn.addEventListener('click', () => {
      activeSection = sec.id;
      nav.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderActiveSection();
    });
    nav.appendChild(btn);
  }
  layout.appendChild(nav);

  // Right content
  const contentArea = document.createElement('div');
  contentArea.className = 'settings-content';
  layout.appendChild(contentArea);

  container.appendChild(layout);
  panelEl.appendChild(container);

  // ── Section renderers ──────────────────────────────────────

  function renderActiveSection() {
    contentArea.innerHTML = '';
    switch (activeSection) {
      case 'general': renderGeneralSection(); break;
      case 'sounds': renderSoundsSection(); break;
      case 'about': renderAboutSection(); break;
    }
  }

  function renderGeneralSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.className = 'settings-section-title';
    heading.textContent = 'General';
    wrapper.appendChild(heading);

    const isProject = settingsScope === 'project';
    const values = isProject ? editProject : editGlobal;

    for (const [key, schemaDef] of Object.entries(schema)) {
      // Skip soundTheme — that goes in the Sounds section
      if (key === 'soundTheme') continue;

      const row = document.createElement('div');
      row.className = 'settings-row';

      const label = document.createElement('label');
      label.className = 'settings-label';
      label.textContent = schemaDef.label;
      row.appendChild(label);

      const desc = document.createElement('div');
      desc.className = 'settings-description';
      desc.textContent = schemaDef.description;
      row.appendChild(desc);

      const inputRow = document.createElement('div');
      inputRow.className = 'settings-input-row';

      let inputEl;

      if (schemaDef.type === 'select') {
        const select = document.createElement('select');
        select.className = 'settings-select';
        select.dataset.testid = `settings-input-${key}`;

        for (const opt of schemaDef.options) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
          select.appendChild(option);
        }

        if (isProject) {
          const projectValue = values[key];
          const globalValue = editGlobal[key] ?? schemaDef.default;
          select.value = projectValue !== undefined ? projectValue : globalValue;

          if (projectValue !== undefined) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'settings-clear-btn';
            clearBtn.dataset.testid = `settings-clear-${key}`;
            clearBtn.textContent = '\u00d7';
            clearBtn.title = 'Use global default';
            clearBtn.addEventListener('click', () => {
              delete editProject[key];
              select.value = globalValue;
              clearBtn.remove();
            });
            inputRow.appendChild(clearBtn);
          }
        } else {
          select.value = values[key] !== undefined ? values[key] : schemaDef.default;
        }

        select.addEventListener('change', () => { values[key] = select.value; });
        inputEl = select;
      } else {
        const input = document.createElement('input');
        input.className = 'settings-input';
        input.dataset.testid = `settings-input-${key}`;
        input.type = 'text';

        if (isProject) {
          const projectValue = values[key];
          const globalValue = editGlobal[key] ?? schemaDef.default;
          input.value = projectValue !== undefined ? projectValue : '';
          input.placeholder = globalValue || schemaDef.default || '(default)';

          if (projectValue !== undefined) {
            const clearBtn = document.createElement('button');
            clearBtn.className = 'settings-clear-btn';
            clearBtn.dataset.testid = `settings-clear-${key}`;
            clearBtn.textContent = '\u00d7';
            clearBtn.title = 'Use global default';
            clearBtn.addEventListener('click', () => {
              delete editProject[key];
              input.value = '';
              clearBtn.remove();
            });
            inputRow.appendChild(clearBtn);
          }
        } else {
          input.value = values[key] !== undefined ? values[key] : '';
          input.placeholder = schemaDef.default || '(default)';
        }

        input.addEventListener('input', () => {
          const trimmed = input.value.trim();
          if (trimmed) values[key] = trimmed;
          else delete values[key];
        });

        inputEl = input;
      }

      inputRow.insertBefore(inputEl, inputRow.firstChild);
      row.appendChild(inputRow);
      wrapper.appendChild(row);
    }

    // Save button
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-save-btn';
    saveBtn.dataset.testid = 'settings-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      if (isProject && selectedProjectPath) {
        await api.appConfig.setProject(selectedProjectPath, editProject);
      } else {
        await api.appConfig.setGlobal(editGlobal);
      }
      const resolvedTheme = await api.appConfig.resolve('theme', selectedProjectPath);
      applyThemeSetting(resolvedTheme || 'system');
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    });

    actionsDiv.appendChild(saveBtn);
    wrapper.appendChild(actionsDiv);
    contentArea.appendChild(wrapper);
  }

  function renderSoundsSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.className = 'settings-section-title';
    heading.textContent = 'Sound & Hooks';
    wrapper.appendChild(heading);

    // Theme selector
    const themeRow = document.createElement('div');
    themeRow.className = 'settings-row';

    const themeLabel = document.createElement('label');
    themeLabel.className = 'settings-label';
    themeLabel.textContent = 'Sound theme';
    themeRow.appendChild(themeLabel);

    const themeDesc = document.createElement('div');
    themeDesc.className = 'settings-description';
    themeDesc.textContent = 'Select a sound theme or "none" to disable all sounds';
    themeRow.appendChild(themeDesc);

    const themeInputRow = document.createElement('div');
    themeInputRow.className = 'settings-input-row';

    const themeSelect = document.createElement('select');
    themeSelect.className = 'settings-select';
    themeSelect.dataset.testid = 'settings-sound-theme-select';

    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'None';
    themeSelect.appendChild(noneOpt);

    for (const t of themes) {
      const opt = document.createElement('option');
      opt.value = t.dirName;
      opt.textContent = t.builtIn ? `${t.name} (built-in)` : t.name;
      themeSelect.appendChild(opt);
    }

    const isProject = settingsScope === 'project';
    const values = isProject ? editProject : editGlobal;
    const currentTheme = values.soundTheme !== undefined ? values.soundTheme : (editGlobal.soundTheme || schema.soundTheme.default || 'none');
    const currentThemeMeta = themes.find(t => t.dirName === currentTheme);
    const isCurrentBuiltIn = currentThemeMeta ? currentThemeMeta.builtIn : false;
    themeSelect.value = currentTheme;

    themeSelect.addEventListener('change', async () => {
      values.soundTheme = themeSelect.value;
      resolvedSoundMap = await api.soundThemes.getSoundMap(themeSelect.value) || {};
      renderActiveSection();
    });

    themeInputRow.appendChild(themeSelect);
    themeRow.appendChild(themeInputRow);
    wrapper.appendChild(themeRow);

    // Theme management buttons (Duplicate / Rename / Delete)
    const themeManageRow = document.createElement('div');
    themeManageRow.className = 'settings-row settings-theme-install-row';

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'settings-btn-secondary';
    duplicateBtn.textContent = 'Duplicate';
    duplicateBtn.disabled = currentTheme === 'none';
    duplicateBtn.addEventListener('click', async () => {
      const srcDir = themeSelect.value;
      if (!srcDir || srcDir === 'none') return;
      const srcMeta = themes.find(t => t.dirName === srcDir);
      const baseName = srcMeta ? srcMeta.name.replace(/ \(built-in\)$/, '') : srcDir;
      const newName = await showPromptOverlay('Name for the duplicated theme:', baseName + ' Copy');
      if (!newName) return;
      const result = await api.soundThemes.duplicate(srcDir, newName);
      if (result.success) {
        values.soundTheme = result.dirName;
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        resolvedSoundMap = await api.soundThemes.getSoundMap(result.dirName) || {};
        renderActiveSection();
      } else {
        alert('Duplicate failed: ' + (result.error || 'Unknown error'));
      }
    });
    themeManageRow.appendChild(duplicateBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'settings-btn-secondary';
    renameBtn.textContent = 'Rename';
    renameBtn.disabled = isCurrentBuiltIn || currentTheme === 'none';
    renameBtn.addEventListener('click', async () => {
      const dirName = themeSelect.value;
      if (!dirName || dirName === 'none') return;
      const meta = themes.find(t => t.dirName === dirName);
      const newName = await showPromptOverlay('New name:', meta ? meta.name : dirName);
      if (!newName) return;
      const result = await api.soundThemes.rename(dirName, newName);
      if (result.success) {
        values.soundTheme = result.dirName;
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        resolvedSoundMap = await api.soundThemes.getSoundMap(result.dirName) || {};
        renderActiveSection();
      } else {
        alert('Rename failed: ' + (result.error || 'Unknown error'));
      }
    });
    themeManageRow.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'settings-btn-secondary settings-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.disabled = isCurrentBuiltIn || currentTheme === 'none';
    deleteBtn.addEventListener('click', async () => {
      const dirName = themeSelect.value;
      if (!dirName || dirName === 'none') return;
      const meta = themes.find(t => t.dirName === dirName);
      if (!confirm(`Delete theme "${meta ? meta.name : dirName}"? This cannot be undone.`)) return;
      const result = await api.soundThemes.remove(dirName);
      if (result.success) {
        values.soundTheme = 'default';
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        resolvedSoundMap = await api.soundThemes.getSounds(selectedProjectPath) || {};
        renderActiveSection();
      } else {
        alert('Delete failed: ' + (result.error || 'Unknown error'));
      }
    });
    themeManageRow.appendChild(deleteBtn);

    wrapper.appendChild(themeManageRow);

    // Theme install buttons
    const installRow = document.createElement('div');
    installRow.className = 'settings-row settings-theme-install-row';

    const installZipBtn = document.createElement('button');
    installZipBtn.className = 'settings-btn-secondary';
    installZipBtn.textContent = 'Install from ZIP';
    installZipBtn.addEventListener('click', async () => {
      const result = await api.soundThemes.installFromZip();
      if (result.success) {
        // Refresh themes list
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        renderActiveSection();
      }
    });

    const installGhBtn = document.createElement('button');
    installGhBtn.className = 'settings-btn-secondary';
    installGhBtn.textContent = 'Install from GitHub';
    installGhBtn.addEventListener('click', async () => {
      const url = await showPromptOverlay('Enter GitHub repository URL:');
      if (!url) return;
      const result = await api.soundThemes.installFromGitHub(url);
      if (result.success) {
        const newThemes = await api.soundThemes.list();
        themes.length = 0;
        themes.push(...newThemes);
        renderActiveSection();
      } else {
        alert('Failed: ' + (result.error || 'Unknown error'));
      }
    });

    const exportBtn = document.createElement('button');
    exportBtn.className = 'settings-btn-secondary';
    exportBtn.textContent = 'Export as ZIP';
    exportBtn.addEventListener('click', async () => {
      const themeDirName = themeSelect.value;
      if (!themeDirName || themeDirName === 'none') return;
      const result = await api.soundThemes.export(themeDirName);
      if (result && result.success) {
        const origText = exportBtn.textContent;
        exportBtn.textContent = 'Exported!';
        setTimeout(() => { exportBtn.textContent = origText; }, 2000);
      } else if (result && !result.success && result.error) {
        alert('Export failed: ' + result.error);
      }
    });

    installRow.appendChild(installZipBtn);
    installRow.appendChild(installGhBtn);
    installRow.appendChild(exportBtn);
    wrapper.appendChild(installRow);

    // Save theme setting (above the event table so it stays visible)
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-save-btn';
    saveBtn.dataset.testid = 'settings-sound-save-btn';
    saveBtn.textContent = 'Save Sound Settings';
    saveBtn.addEventListener('click', async () => {
      if (isProject && selectedProjectPath) {
        await api.appConfig.setProject(selectedProjectPath, editProject);
      } else {
        await api.appConfig.setGlobal(editGlobal);
      }
      // Reload sound cache
      await loadSoundTheme();
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = 'Save Sound Settings'; }, 1500);
    });
    actionsDiv.appendChild(saveBtn);
    wrapper.appendChild(actionsDiv);

    // Event sound table
    const tableHeading = document.createElement('h4');
    tableHeading.className = 'settings-subsection-title';
    tableHeading.textContent = 'Event Sounds';
    wrapper.appendChild(tableHeading);

    const tableDesc = document.createElement('div');
    tableDesc.className = 'settings-description';
    tableDesc.textContent = isCurrentBuiltIn
      ? 'Built-in themes are read-only. Duplicate to customize sounds.'
      : 'Upload custom sounds per event.';
    wrapper.appendChild(tableDesc);

    const table = document.createElement('div');
    table.className = 'settings-sound-table';

    // Header row
    const headerRow = document.createElement('div');
    headerRow.className = 'settings-sound-row settings-sound-header';
    headerRow.innerHTML = '<span class="settings-sound-event">Event</span><span class="settings-sound-source">Source</span><span class="settings-sound-actions">Actions</span>';
    table.appendChild(headerRow);

    for (const eventName of ALL_HOOK_EVENTS) {
      const entry = resolvedSoundMap && resolvedSoundMap[eventName];
      const hasSound = !!entry;

      const row = document.createElement('div');
      row.className = 'settings-sound-row';
      row.dataset.testid = `settings-sound-row-${eventName}`;

      const eventCell = document.createElement('span');
      eventCell.className = 'settings-sound-event';
      eventCell.textContent = eventName;
      row.appendChild(eventCell);

      const sourceCell = document.createElement('span');
      sourceCell.className = 'settings-sound-source';
      if (hasSound) {
        sourceCell.textContent = isCurrentBuiltIn ? 'Built-in' : (currentThemeMeta ? currentThemeMeta.name : 'Theme');
      } else {
        sourceCell.textContent = '\u2014';
      }
      row.appendChild(sourceCell);

      const actionsCell = document.createElement('span');
      actionsCell.className = 'settings-sound-actions';

      // Play button
      if (entry) {
        const playBtn = document.createElement('button');
        playBtn.className = 'settings-btn-icon';
        playBtn.dataset.testid = `settings-sound-play-${eventName}`;
        playBtn.title = 'Play';
        playBtn.textContent = '\u25B6';
        playBtn.addEventListener('click', () => {
          if (window._settingsPreviewAudio) {
            window._settingsPreviewAudio.pause();
            window._settingsPreviewAudio.currentTime = 0;
          }
          const a = new Audio(entry.url);
          if (entry.trimStart != null) a.currentTime = entry.trimStart;
          if (entry.trimEnd != null) {
            a.addEventListener('timeupdate', () => {
              if (a.currentTime >= entry.trimEnd) a.pause();
            });
          }
          window._settingsPreviewAudio = a;
          a.play().catch(() => {});
        });
        actionsCell.appendChild(playBtn);
      }

      // Upload button (disabled for built-in themes)
      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'settings-btn-icon';
      uploadBtn.dataset.testid = `settings-sound-upload-${eventName}`;
      uploadBtn.title = isCurrentBuiltIn ? 'Duplicate theme to customize' : 'Upload custom sound';
      uploadBtn.textContent = '\u2191';
      uploadBtn.disabled = isCurrentBuiltIn;
      uploadBtn.addEventListener('click', async () => {
        const projectPath = settingsScope === 'project' ? selectedProjectPath : undefined;
        const result = await api.soundThemes.uploadSound(eventName, projectPath);
        if (result && result.success) {
          if (result.forked) {
            values.soundTheme = result.dirName;
            const newThemes = await api.soundThemes.list();
            themes.length = 0;
            themes.push(...newThemes);
          }
          resolvedSoundMap = await api.soundThemes.getSoundMap(result.dirName || themeSelect.value) || {};
          await loadSoundTheme();
          renderActiveSection();
        } else if (result && !result.success && result.error) {
          alert('Upload failed: ' + result.error);
        }
      });
      actionsCell.appendChild(uploadBtn);

      // Trim button (disabled for built-in themes)
      if (entry) {
        const trimBtn = document.createElement('button');
        trimBtn.className = 'settings-btn-icon';
        trimBtn.dataset.testid = `settings-sound-trim-${eventName}`;
        trimBtn.title = isCurrentBuiltIn ? 'Duplicate theme to customize' : 'Trim sound';
        trimBtn.textContent = '\u2702';
        trimBtn.disabled = isCurrentBuiltIn;
        trimBtn.addEventListener('click', () => {
          openTrimUI(eventName, entry.url, wrapper, settingsScope, entry.trimStart, entry.trimEnd, async (trimResult) => {
            if (trimResult && trimResult.forked) {
              values.soundTheme = trimResult.dirName;
              const newThemes = await api.soundThemes.list();
              themes.length = 0;
              themes.push(...newThemes);
            }
            renderActiveSection();
          });
        });
        actionsCell.appendChild(trimBtn);
      }

      // Remove sound button (only for custom themes, not built-in)
      if (hasSound && !isCurrentBuiltIn) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'settings-btn-icon settings-btn-icon-danger';
        removeBtn.dataset.testid = `settings-sound-remove-${eventName}`;
        removeBtn.title = 'Remove sound from theme';
        removeBtn.textContent = '\u2715';
        removeBtn.addEventListener('click', async () => {
          if (window._settingsPreviewAudio) {
            window._settingsPreviewAudio.pause();
            window._settingsPreviewAudio.currentTime = 0;
            window._settingsPreviewAudio = null;
          }
          const trimPanel = document.querySelector('.trim-ui');
          if (trimPanel) {
            trimPanel.querySelector('.trim-ui-close')?.click();
          }
          const liveTheme = themeSelect.value;
          const result = await api.soundThemes.removeSound(liveTheme, eventName);
          if (result && result.success) {
            resolvedSoundMap = await api.soundThemes.getSoundMap(liveTheme) || {};
            await loadSoundTheme();
            renderActiveSection();
          } else if (result && !result.success) {
            alert('Remove failed: ' + (result.error || 'Unknown error'));
          }
        });
        actionsCell.appendChild(removeBtn);
      }

      row.appendChild(actionsCell);
      table.appendChild(row);
    }

    wrapper.appendChild(table);

    contentArea.appendChild(wrapper);
  }

  function renderAboutSection() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    const heading = document.createElement('h3');
    heading.className = 'settings-section-title';
    heading.textContent = 'About';
    wrapper.appendChild(heading);

    const infoGrid = document.createElement('div');
    infoGrid.className = 'settings-about-grid';
    infoGrid.innerHTML = `
      <div class="settings-about-row"><span class="settings-about-label">Version</span><span class="settings-about-value">${version}</span></div>
      <div class="settings-about-row"><span class="settings-about-label">Electron</span><span class="settings-about-value">${navigator.userAgent.match(/Electron\/([^\s]+)/)?.[1] || '\u2014'}</span></div>
      <div class="settings-about-row"><span class="settings-about-label">Chrome</span><span class="settings-about-value">${navigator.userAgent.match(/Chrome\/([^\s]+)/)?.[1] || '\u2014'}</span></div>
      <div class="settings-about-row"><span class="settings-about-label">Platform</span><span class="settings-about-value">${navigator.platform}</span></div>
    `;
    wrapper.appendChild(infoGrid);

    contentArea.appendChild(wrapper);
  }

  // Initial render
  renderActiveSection();
}

// ── Audio Trim UI ────────────────────────────────────────────

/**
 * Open a Voice Memos-style trim panel on the right side of settings.
 * Uses Web Audio API for waveform + OfflineAudioContext for export.
 */
function openTrimUI(eventName, audioUrl, parentEl, scope, initTrimStart, initTrimEnd, onSave) {
  const settingsContent = parentEl.closest('.settings-content');
  if (!settingsContent) return;

  // Remove any existing trim panel
  const existingTrim = settingsContent.querySelector('.trim-ui');
  if (existingTrim) {
    existingTrim.querySelector('.trim-ui-close')?.click();
  }

  // Wrap existing content if not already wrapped
  let sectionWrap = settingsContent.querySelector('.settings-section-wrap');
  if (!sectionWrap) {
    sectionWrap = document.createElement('div');
    sectionWrap.className = 'settings-section-wrap';
    while (settingsContent.firstChild) {
      sectionWrap.appendChild(settingsContent.firstChild);
    }
    settingsContent.appendChild(sectionWrap);
  }
  settingsContent.classList.add('has-trim-panel');

  // ── Build trim panel ──
  const trimPanel = document.createElement('div');
  trimPanel.className = 'trim-ui';
  trimPanel.dataset.testid = `trim-ui-${eventName}`;

  let ws = null; // wavesurfer instance
  let wsRegions = null; // regions plugin
  let trimRegion = null;

  function closeTrimPanel() {
    if (ws) { ws.destroy(); ws = null; }
    trimPanel.remove();
    settingsContent.classList.remove('has-trim-panel');
    const wrap = settingsContent.querySelector('.settings-section-wrap');
    if (wrap) {
      while (wrap.firstChild) settingsContent.appendChild(wrap.firstChild);
      wrap.remove();
    }
  }

  // Title bar
  const titleBar = document.createElement('div');
  titleBar.className = 'trim-ui-title';
  const titleSpan = document.createElement('span');
  titleSpan.textContent = `Trim: ${eventName}`;
  titleBar.appendChild(titleSpan);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'trim-ui-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeTrimPanel);
  titleBar.appendChild(closeBtn);
  trimPanel.appendChild(titleBar);

  // Body
  const body = document.createElement('div');
  body.className = 'trim-ui-body';

  // Waveform container (wavesurfer renders into this)
  const waveWrap = document.createElement('div');
  waveWrap.className = 'trim-ui-waveform-wrap';
  const waveContainer = document.createElement('div');
  waveContainer.className = 'trim-ui-wave-container';
  waveWrap.appendChild(waveContainer);
  body.appendChild(waveWrap);

  // Controls row
  const controls = document.createElement('div');
  controls.className = 'trim-ui-controls';

  const playBtn = document.createElement('button');
  playBtn.className = 'trim-ui-play-btn';
  playBtn.dataset.testid = 'trim-play-btn';
  playBtn.innerHTML = '&#9654;'; // play triangle
  controls.appendChild(playBtn);

  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'trim-ui-time';
  controls.appendChild(timeDisplay);

  body.appendChild(controls);

  // Actions
  const btnRow = document.createElement('div');
  btnRow.className = 'trim-ui-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'settings-save-btn';
  saveBtn.textContent = 'Save Trimmed';
  btnRow.appendChild(saveBtn);
  body.appendChild(btnRow);

  trimPanel.appendChild(body);
  settingsContent.appendChild(trimPanel);

  // ── Helper ──
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }

  function updateTimeDisplay() {
    if (!trimRegion) return;
    timeDisplay.textContent = `${formatTime(trimRegion.start)} \u2014 ${formatTime(trimRegion.end)}`;
  }

  // ── Init wavesurfer ──
  wsRegions = RegionsPlugin.create();

  ws = WaveSurfer.create({
    container: waveContainer,
    height: 100,
    waveColor: 'rgba(255,255,255,0.25)',
    progressColor: 'rgba(232,167,53,0.6)',
    cursorColor: '#fff',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 1,
    backend: 'WebAudio',
    normalize: true,
    plugins: [wsRegions],
  });

  ws.load(audioUrl);

  ws.on('ready', () => {
    const duration = ws.getDuration();
    trimRegion = wsRegions.addRegion({
      start: initTrimStart != null ? initTrimStart : 0,
      end: initTrimEnd != null ? initTrimEnd : duration,
      color: 'rgba(232, 167, 53, 0.15)',
      drag: false,
      resize: true,
    });
    updateTimeDisplay();
  });

  // Update time display when region is resized
  wsRegions.on('region-update', (region) => {
    if (region === trimRegion) updateTimeDisplay();
  });

  // ── Play/Pause — plays only the trimmed region ──
  playBtn.addEventListener('click', () => {
    if (!ws || !trimRegion) return;
    if (ws.isPlaying()) {
      ws.pause();
    } else {
      trimRegion.play();
    }
  });

  ws.on('play', () => { playBtn.innerHTML = '&#9646;&#9646;'; });
  ws.on('pause', () => { playBtn.innerHTML = '&#9654;'; });
  ws.on('finish', () => { playBtn.innerHTML = '&#9654;'; });

  // Stop at region end during playback
  ws.on('timeupdate', (currentTime) => {
    if (trimRegion && ws.isPlaying() && currentTime >= trimRegion.end) {
      ws.pause();
    }
  });

  // ── Save trim metadata ──
  saveBtn.addEventListener('click', async () => {
    if (!trimRegion || !api.soundThemes) return;
    const start = trimRegion.start;
    const end = trimRegion.end;
    const result = await api.soundThemes.saveTrim(eventName, start, end, getSelectedProjectPath());
    resolvedSoundMap = await api.soundThemes.getSounds(getSelectedProjectPath()) || {};
    await loadSoundTheme();
    closeTrimPanel();
    if (onSave) onSave(result);
  });

  // ── Cleanup when panel is removed externally (e.g. section switch) ──
  const observer = new MutationObserver(() => {
    if (!trimPanel.isConnected) {
      if (ws) { ws.destroy(); ws = null; }
      observer.disconnect();
    }
  });
  observer.observe(settingsContent, { childList: true, subtree: true });
}

export { openSettings, findSettingsTab };

/**
 * Settings tab — general settings, sound themes, hooks config
 */

import {
  sessions,
  getTerminalsContainer, getTabBarTabs,
  activateTab, closeTab,
  loadSoundTheme, applyThemeSetting,
} from './terminal.js';
import { openTrimUI } from './audioTrim.js';
import { projects, getSelectedProjectPath, renderSidebar, updateGlowIntensity, updateGlowStyle } from './sidebar.js';
import { showPromptOverlay } from './overlays.js';
import { getProjectColor } from './projectColors.js';

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

/** Re-render the settings tab for the currently selected project (if open) */
async function refreshSettingsTab() {
  const existing = findSettingsTab();
  if (existing === null) return;
  const session = sessions.get(existing);
  if (!session) return;

  // Update tab icon color to match new project
  const selectedProject = getSelectedProjectPath();
  const selectedProjectName = selectedProject
    ? projects.find(p => p.path === selectedProject)?.name || null
    : null;
  const iconEl = session.tabEl.querySelector('.tab-icon-settings');
  if (iconEl) {
    if (selectedProjectName) {
      const pc = getProjectColor(selectedProjectName);
      const col = `hsl(${pc.hue}, ${pc.s}%, ${pc.l}%)`;
      iconEl.style.cssText = `background:hsla(${pc.hue}, ${pc.s}%, ${pc.l}%, 0.15);color:${col}`;
    } else {
      iconEl.style.cssText = 'background:var(--hover-bg);color:var(--text-primary)';
    }
  }

  // Re-render content
  session.panelEl.innerHTML = '';
  await renderSettingsTab(session.panelEl);
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

  // Build settings icon for tab — use project color if a project is selected
  const settingsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></svg>`;
  const selectedProject = getSelectedProjectPath();
  const selectedProjectName = selectedProject
    ? projects.find(p => p.path === selectedProject)?.name || null
    : null;
  let tabIconStyle = 'background:var(--hover-bg);color:var(--text-primary)';
  if (selectedProjectName) {
    const pc = getProjectColor(selectedProjectName);
    const col = `hsl(${pc.hue}, ${pc.s}%, ${pc.l}%)`;
    tabIconStyle = `background:hsla(${pc.hue}, ${pc.s}%, ${pc.l}%, 0.15);color:${col}`;
  }
  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.innerHTML = `<span class="tab-icon tab-icon-settings" style="${tabIconStyle}">${settingsSvg}</span><span class="tab-label" data-testid="tab-label">Settings</span><button class="tab-close" data-testid="tab-close">&times;</button>`;
  getTabBarTabs().appendChild(tabEl);

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) activateTab(id);
  });
  tabEl.querySelector('.tab-close').addEventListener('click', () => closeTab(id));

  sessions.set(id, {
    terminal: null, fitAddon: null, searchAddon: null,
    panelEl, tabEl, cleanup() {}, // no PTY to dispose
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
  const [schema, globalConfig, projectConfig, themes] = await Promise.all([
    api.appConfig.getSchema(),
    api.appConfig.getGlobal(),
    selectedProjectPath ? api.appConfig.getProject(selectedProjectPath) : Promise.resolve(null),
    api.soundThemes ? api.soundThemes.list() : Promise.resolve([]),
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

  /** Re-fetch the themes list from disk and update the in-memory array */
  async function refreshThemesList() {
    const updated = await api.soundThemes.list();
    themes.length = 0;
    themes.push(...updated);
  }

  /** Debounced auto-save for general settings (400ms) */
  let autoSaveTimer = null;
  function autoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      const isProject = settingsScope === 'project';
      if (isProject && selectedProjectPath) {
        await api.appConfig.setProject(selectedProjectPath, editProject);
      } else {
        await api.appConfig.setGlobal(editGlobal);
      }
    }, 400);
  }

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

  // Compute project color for the scope tab
  let projectColorHsl = null;
  if (selectedProjectPath && currentProjectName !== 'Project') {
    const pc = getProjectColor(currentProjectName);
    projectColorHsl = `hsl(${pc.hue}, ${pc.s}%, ${pc.l}%)`;
  }

  scopeBar.appendChild(scopeGlobalBtn);
  scopeBar.appendChild(scopeProjectBtn);
  container.appendChild(scopeBar);

  function updateScopeColors() {
    if (settingsScope === 'project' && projectColorHsl) {
      scopeProjectBtn.style.color = projectColorHsl;
      scopeProjectBtn.style.setProperty('--scope-underline-color', projectColorHsl);
      scopeGlobalBtn.style.color = '';
      scopeGlobalBtn.style.removeProperty('--scope-underline-color');
    } else {
      scopeProjectBtn.style.color = '';
      scopeProjectBtn.style.removeProperty('--scope-underline-color');
      scopeGlobalBtn.style.color = '';
      scopeGlobalBtn.style.removeProperty('--scope-underline-color');
    }
  }

  scopeGlobalBtn.addEventListener('click', () => {
    settingsScope = 'global';
    scopeGlobalBtn.classList.add('active');
    scopeProjectBtn.classList.remove('active');
    updateScopeColors();
    renderActiveSection();
  });
  scopeProjectBtn.addEventListener('click', () => {
    if (!selectedProjectPath) return;
    settingsScope = 'project';
    scopeProjectBtn.classList.add('active');
    scopeGlobalBtn.classList.remove('active');
    updateScopeColors();
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
    { id: 'sounds', label: 'Theme', icon: '\uD83D\uDD0A' },
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
      row.dataset.settingsKey = key;

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
              autoSave();
            });
            inputRow.appendChild(clearBtn);
          }
        } else {
          select.value = values[key] !== undefined ? values[key] : schemaDef.default;
        }

        select.addEventListener('change', () => {
          values[key] = select.value;
          autoSave();
          if (key === 'glowStyle') {
            updateGlowStyle(select.value);
            const intensityRow = row.parentElement.querySelector('[data-settings-key="glowIntensity"]');
            if (intensityRow) intensityRow.style.display = (select.value === 'glow' || select.value === 'border') ? '' : 'none';
          }
          if (key === 'theme') applyThemeSetting(select.value);
        });
        inputEl = select;
      } else if (schemaDef.type === 'range') {
        const rangeWrap = document.createElement('div');
        rangeWrap.className = 'settings-range-wrap';

        const range = document.createElement('input');
        range.className = 'settings-range';
        range.dataset.testid = `settings-input-${key}`;
        range.type = 'range';
        range.min = schemaDef.min;
        range.max = schemaDef.max;

        const currentValue = isProject
          ? (values[key] !== undefined ? values[key] : (editGlobal[key] ?? schemaDef.default))
          : (values[key] !== undefined ? values[key] : schemaDef.default);
        range.value = currentValue;

        const valueLabel = document.createElement('span');
        valueLabel.className = 'settings-range-value';
        valueLabel.textContent = `${currentValue}%`;

        range.addEventListener('input', () => {
          const v = Number(range.value);
          values[key] = v;
          valueLabel.textContent = `${v}%`;
          updateGlowIntensity(v);
          autoSave();
        });

        rangeWrap.appendChild(range);
        rangeWrap.appendChild(valueLabel);

        if (isProject && values[key] !== undefined) {
          const globalValue = editGlobal[key] ?? schemaDef.default;
          const clearBtn = document.createElement('button');
          clearBtn.className = 'settings-clear-btn';
          clearBtn.dataset.testid = `settings-clear-${key}`;
          clearBtn.textContent = '\u00d7';
          clearBtn.title = 'Use global default';
          clearBtn.addEventListener('click', () => {
            delete editProject[key];
            range.value = globalValue;
            valueLabel.textContent = `${globalValue}%`;
            updateGlowIntensity(globalValue);
            clearBtn.remove();
            autoSave();
          });
          rangeWrap.appendChild(clearBtn);
        }

        inputRow.appendChild(rangeWrap);
        inputEl = null; // already appended via rangeWrap
      } else if (schemaDef.type === 'file') {
        const fileWrap = document.createElement('div');
        fileWrap.className = 'settings-file-wrap';

        const currentValue = isProject
          ? (values[key] !== undefined ? values[key] : '')
          : (values[key] !== undefined ? values[key] : '');

        // Thumbnail preview
        if (currentValue) {
          const thumb = document.createElement('img');
          thumb.className = 'settings-file-thumb';
          thumb.src = `file://${currentValue}`;
          thumb.alt = 'Preview';
          fileWrap.appendChild(thumb);
        }

        const fileInput = document.createElement('input');
        fileInput.className = 'settings-input settings-file-input';
        fileInput.dataset.testid = `settings-input-${key}`;
        fileInput.type = 'text';
        fileInput.readOnly = true;
        fileInput.value = currentValue ? currentValue.split('/').pop() : '';
        fileInput.placeholder = 'No file selected';
        fileWrap.appendChild(fileInput);

        const browseBtn = document.createElement('button');
        browseBtn.className = 'settings-btn-secondary';
        browseBtn.textContent = 'Browse\u2026';
        browseBtn.addEventListener('click', async () => {
          const filePath = await api.appConfig.pickFile({
            filters: schemaDef.fileFilters || [],
          });
          if (!filePath) return;
          values[key] = filePath;
          autoSave();

          renderActiveSection();
        });
        fileWrap.appendChild(browseBtn);

        if (isProject && values[key] !== undefined) {
          const clearBtn = document.createElement('button');
          clearBtn.className = 'settings-clear-btn';
          clearBtn.dataset.testid = `settings-clear-${key}`;
          clearBtn.textContent = '\u00d7';
          clearBtn.title = 'Use global default';
          clearBtn.addEventListener('click', () => {
            delete editProject[key];
            autoSave();

            renderActiveSection();
          });
          fileWrap.appendChild(clearBtn);
        } else if (!isProject && values[key]) {
          const clearBtn = document.createElement('button');
          clearBtn.className = 'settings-clear-btn';
          clearBtn.textContent = '\u00d7';
          clearBtn.title = 'Clear';
          clearBtn.addEventListener('click', () => {
            delete values[key];
            autoSave();

            renderActiveSection();
          });
          fileWrap.appendChild(clearBtn);
        }

        inputRow.appendChild(fileWrap);
        inputEl = null;
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
              autoSave();
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
          autoSave();
        });

        inputEl = input;
      }

      if (inputEl) inputRow.insertBefore(inputEl, inputRow.firstChild);
      row.appendChild(inputRow);
      wrapper.appendChild(row);
    }

    // Hide glowIntensity when glowStyle is not 'glow'
    const glowStyle = values.glowStyle || (isProject ? editGlobal.glowStyle : null) || schema.glowStyle.default;
    const intensityRow = wrapper.querySelector('[data-settings-key="glowIntensity"]');
    if (intensityRow && glowStyle !== 'glow' && glowStyle !== 'border') intensityRow.style.display = 'none';

    contentArea.appendChild(wrapper);
  }

  function renderSoundsSection() {
    const isProject = settingsScope === 'project';
    const values = isProject ? editProject : editGlobal;
    const currentTheme = values.soundTheme !== undefined ? values.soundTheme : (editGlobal.soundTheme || schema.soundTheme.default || 'none');
    const currentThemeMeta = themes.find(t => t.dirName === currentTheme);
    const isCurrentBuiltIn = currentThemeMeta ? currentThemeMeta.builtIn : false;
    const isNone = currentTheme === 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'settings-section';

    // ── Theme header (persistent across sub-tabs) ──────────────
    const header = document.createElement('div');
    header.className = 'theme-header';
    header.dataset.testid = 'theme-header';

    // Left side: theme info
    const headerInfo = document.createElement('div');
    headerInfo.className = 'theme-header-info';

    const themeName = document.createElement('span');
    themeName.className = 'theme-header-name';
    themeName.textContent = isNone ? 'No theme' : (currentThemeMeta ? currentThemeMeta.name : currentTheme);
    headerInfo.appendChild(themeName);

    if (isCurrentBuiltIn) {
      const badge = document.createElement('span');
      badge.className = 'theme-header-badge';
      badge.textContent = 'built-in \u00b7 read-only';
      headerInfo.appendChild(badge);
    } else if (!isNone) {
      const badge = document.createElement('span');
      badge.className = 'theme-header-badge theme-header-badge-custom';
      badge.textContent = 'custom';
      headerInfo.appendChild(badge);
    }

    header.appendChild(headerInfo);

    // Right side: theme switcher
    const themeSelect = document.createElement('select');
    themeSelect.className = 'settings-select theme-header-select';
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
    themeSelect.value = currentTheme;

    themeSelect.addEventListener('change', async () => {
      values.soundTheme = themeSelect.value;
      resolvedSoundMap = await api.soundThemes.getSoundMap(themeSelect.value) || {};
      renderActiveSection();
    });
    header.appendChild(themeSelect);

    wrapper.appendChild(header);

    // ── Theme management actions ───────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'theme-actions';

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'settings-btn-secondary';
    duplicateBtn.textContent = 'Duplicate';
    duplicateBtn.disabled = isNone;
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
        await refreshThemesList();
        resolvedSoundMap = await api.soundThemes.getSoundMap(result.dirName) || {};
        renderActiveSection();
      } else {
        alert('Duplicate failed: ' + (result.error || 'Unknown error'));
      }
    });
    actions.appendChild(duplicateBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'settings-btn-secondary';
    renameBtn.textContent = 'Rename';
    renameBtn.disabled = isCurrentBuiltIn || isNone;
    renameBtn.addEventListener('click', async () => {
      const dirName = themeSelect.value;
      if (!dirName || dirName === 'none') return;
      const meta = themes.find(t => t.dirName === dirName);
      const newName = await showPromptOverlay('New name:', meta ? meta.name : dirName);
      if (!newName) return;
      const result = await api.soundThemes.rename(dirName, newName);
      if (result.success) {
        values.soundTheme = result.dirName;
        await refreshThemesList();
        resolvedSoundMap = await api.soundThemes.getSoundMap(result.dirName) || {};
        renderActiveSection();
      } else {
        alert('Rename failed: ' + (result.error || 'Unknown error'));
      }
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'settings-btn-secondary settings-btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.disabled = isCurrentBuiltIn || isNone;
    deleteBtn.addEventListener('click', async () => {
      const dirName = themeSelect.value;
      if (!dirName || dirName === 'none') return;
      const meta = themes.find(t => t.dirName === dirName);
      if (!confirm(`Delete theme "${meta ? meta.name : dirName}"? This cannot be undone.`)) return;
      const result = await api.soundThemes.remove(dirName);
      if (result.success) {
        values.soundTheme = 'default';
        await refreshThemesList();
        resolvedSoundMap = await api.soundThemes.getSounds(selectedProjectPath) || {};
        renderActiveSection();
      } else {
        alert('Delete failed: ' + (result.error || 'Unknown error'));
      }
    });
    actions.appendChild(deleteBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'settings-btn-secondary';
    downloadBtn.textContent = 'Download';
    downloadBtn.disabled = isNone;
    downloadBtn.addEventListener('click', async () => {
      const themeDirName = themeSelect.value;
      if (!themeDirName || themeDirName === 'none') return;
      const result = await api.soundThemes.export(themeDirName);
      if (result && result.success) {
        const origText = downloadBtn.textContent;
        downloadBtn.textContent = 'Downloaded!';
        setTimeout(() => { downloadBtn.textContent = origText; }, 2000);
      } else if (result && !result.success && result.error) {
        alert('Download failed: ' + result.error);
      }
    });
    actions.appendChild(downloadBtn);

    const importBtn = document.createElement('button');
    importBtn.className = 'settings-btn-secondary';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', async () => {
      const result = await api.soundThemes.installFromZip();
      if (result && result.success) {
        await refreshThemesList();
        if (result.dirName) values.soundTheme = result.dirName;
        resolvedSoundMap = await api.soundThemes.getSoundMap(values.soundTheme || themeSelect.value) || {};
        renderActiveSection();
      } else if (result && !result.success && result.error) {
        alert('Import failed: ' + result.error);
      }
    });
    actions.appendChild(importBtn);

    wrapper.appendChild(actions);

    // ── Sub-tab bar ────────────────────────────────────────────
    const subTabBar = document.createElement('div');
    subTabBar.className = 'theme-subtabs';

    const soundsSubTab = document.createElement('button');
    soundsSubTab.className = 'theme-subtab active';
    soundsSubTab.dataset.testid = 'theme-subtab-sounds';
    soundsSubTab.textContent = 'Sounds';
    subTabBar.appendChild(soundsSubTab);

    wrapper.appendChild(subTabBar);

    // ── Sub-tab content: Sounds ────────────────────────────────
    const subContent = document.createElement('div');
    subContent.className = 'theme-subcontent';

    if (isNone) {
      const noTheme = document.createElement('div');
      noTheme.className = 'settings-description';
      noTheme.style.padding = '16px 0';
      noTheme.textContent = 'Select a theme to configure sounds.';
      subContent.appendChild(noTheme);
    } else {
      // Save button
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
        await loadSoundTheme();
        saveBtn.textContent = 'Saved!';
        setTimeout(() => { saveBtn.textContent = 'Save Sound Settings'; }, 1500);
      });
      actionsDiv.appendChild(saveBtn);
      subContent.appendChild(actionsDiv);

      if (isCurrentBuiltIn) {
        const readOnlyNote = document.createElement('div');
        readOnlyNote.className = 'settings-description';
        readOnlyNote.textContent = 'Built-in themes are read-only. Duplicate to customize sounds.';
        subContent.appendChild(readOnlyNote);
      }

      // Event sound table
      const table = document.createElement('div');
      table.className = 'settings-sound-table';

      const headerRow = document.createElement('div');
      headerRow.className = 'settings-sound-row settings-sound-header';
      headerRow.innerHTML = '<span class="settings-sound-event">Event</span><span class="settings-sound-source">File</span><span class="settings-sound-actions">Actions</span>';
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
        if (hasSound && entry.url) {
          const filename = decodeURIComponent(entry.url.split('/').pop());
          sourceCell.textContent = isCurrentBuiltIn ? 'Built-in' : filename;
        } else {
          sourceCell.textContent = '\u2014';
        }
        row.appendChild(sourceCell);

        const actionsCell = document.createElement('span');
        actionsCell.className = 'settings-sound-actions';

        if (entry) {
          const playBtn = document.createElement('button');
          playBtn.className = 'settings-btn-icon';
          playBtn.dataset.testid = `settings-sound-play-${eventName}`;
          playBtn.title = 'Play';
          playBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,1.5 10,6 3,10.5"/></svg>';
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

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'settings-btn-icon';
        uploadBtn.dataset.testid = `settings-sound-upload-${eventName}`;
        uploadBtn.title = isCurrentBuiltIn ? 'Duplicate theme to customize' : 'Upload custom sound';
        uploadBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8V2M3.5 4.5L6 2l2.5 2.5M2 10h8"/></svg>';
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

        if (entry) {
          const trimBtn = document.createElement('button');
          trimBtn.className = 'settings-btn-icon';
          trimBtn.dataset.testid = `settings-sound-trim-${eventName}`;
          trimBtn.title = isCurrentBuiltIn ? 'Duplicate theme to customize' : 'Trim sound';
          trimBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h2l1.5 3L3 9H1M7 3h4M7 6h4M7 9h4"/></svg>';
          trimBtn.disabled = isCurrentBuiltIn;
          trimBtn.addEventListener('click', () => {
            openTrimUI(eventName, entry.url, subContent, settingsScope, entry.trimStart, entry.trimEnd, async (trimResult) => {
              if (trimResult && trimResult.forked) {
                values.soundTheme = trimResult.dirName;
                await refreshThemesList();
              }
              resolvedSoundMap = await api.soundThemes.getSounds(getSelectedProjectPath()) || {};
              renderActiveSection();
            });
          });
          actionsCell.appendChild(trimBtn);
        }

        if (hasSound && !isCurrentBuiltIn) {
          const removeBtn = document.createElement('button');
          removeBtn.className = 'settings-btn-icon settings-btn-icon-danger';
          removeBtn.dataset.testid = `settings-sound-remove-${eventName}`;
          removeBtn.title = 'Remove sound from theme';
          removeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3"/></svg>';
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

      subContent.appendChild(table);
    }

    wrapper.appendChild(subContent);
    contentArea.appendChild(wrapper);
  }


  // Initial render
  renderActiveSection();
}

export { openSettings, findSettingsTab, refreshSettingsTab };

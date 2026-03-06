/**
 * Tabs — tab creation, drag/drop, rename, context menu, navigation
 */

import {
  sessions, getActiveId, getActiveSession,
  activateTab, closeTab, createSession,
  getTabBarTabs,
} from './terminal.js';
import {
  getSelectedProjectPath, sessionsForProject,
} from './sidebar.js';

const api = window.electron_api;


// ── Tab element creation ─────────────────────────────────────

/**
 * Build a tab DOM element with all event wiring.
 * @param {number} id — session id
 * @param {{ projectName: string, projectColor: object, type: string, num: number }} display
 * @param {{ onActivate: Function, onClose: Function }} callbacks
 * @returns {HTMLElement} the tab element
 */
export function createTabElement(id, { projectName, projectColor, type, num }, { onActivate, onClose }) {
  const isClaude = type === 'claude';
  const projColor = `hsl(${projectColor.hue}, ${projectColor.s}%, ${projectColor.l}%)`;
  const projColorBg = `hsla(${projectColor.hue}, ${projectColor.s}%, ${projectColor.l}%, 0.15)`;

  const claudeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>`;
  const termSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,5 8,8 4,11"/><line x1="9" y1="11" x2="12" y2="11"/></svg>`;

  const icon = isClaude
    ? `<span class="tab-icon tab-icon-claude" style="background:${projColorBg};color:${projColor}">${claudeSvg}</span>`
    : `<span class="tab-icon tab-icon-terminal" style="background:${projColorBg};color:${projColor}">${termSvg}</span>`;
  const typeLabel = type === 'notes' ? 'Notes' : (isClaude ? 'Claude' : 'Terminal');
  const displayLabel = type === 'notes' ? typeLabel : `${typeLabel} ${num}`;
  const dot = `<span class="tab-color-dot" style="background:${projColor}"></span>`;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.testid = 'tab';
  tabEl.dataset.tabId = String(id);
  tabEl.draggable = true;
  tabEl.innerHTML = `${icon}<span class="tab-label" data-testid="tab-label">${displayLabel}</span>${dot}<button class="tab-close" data-testid="tab-close">&times;</button>`;

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.tab-close')) onActivate();
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTabContextMenu(id);
  });

  tabEl.querySelector('.tab-close').addEventListener('click', () => onClose());

  // Drag-and-drop reordering
  tabEl.addEventListener('dragstart', (e) => {
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
  });
  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.remove('drop-before', 'drop-after');
    });
  });
  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = tabEl.getBoundingClientRect();
    const midX = rect.x + rect.width / 2;
    tabEl.classList.toggle('drop-before', e.clientX < midX);
    tabEl.classList.toggle('drop-after', e.clientX >= midX);
  });
  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('drop-before', 'drop-after');
  });
  tabEl.addEventListener('drop', (e) => {
    e.preventDefault();
    tabEl.classList.remove('drop-before', 'drop-after');
    const draggedId = e.dataTransfer.getData('text/plain');
    const draggedTab = document.querySelector(`[data-testid="tab"][data-tab-id="${draggedId}"]`);
    if (!draggedTab || draggedTab === tabEl) return;
    const rect = tabEl.getBoundingClientRect();
    const midX = rect.x + rect.width / 2;
    const parent = tabEl.parentNode;
    if (e.clientX < midX) {
      parent.insertBefore(draggedTab, tabEl);
    } else {
      parent.insertBefore(draggedTab, tabEl.nextSibling);
    }
  });

  // Double-click to rename
  const labelEl = tabEl.querySelector('.tab-label');
  labelEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startTabRename(tabEl, labelEl);
  });

  return tabEl;
}


// ── Tab context menu ─────────────────────────────────────────

async function showTabContextMenu(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;

  const projectPath = session.projectPath;
  const projectSessions = sessionsForProject(projectPath);
  const hasOthers = projectSessions.length > 1;

  const action = await api.contextMenu.show([
    { label: 'Duplicate', action: 'duplicate' },
    { type: 'separator' },
    { label: 'Close', action: 'close' },
    { label: 'Close Others', action: 'closeOthers', enabled: hasOthers },
    { label: 'Close All', action: 'closeAll' },
  ]);

  switch (action) {
    case 'duplicate':
      createSession(session.type);
      break;
    case 'close':
      closeTab(tabId);
      break;
    case 'closeOthers':
      closeOtherTabs(tabId);
      break;
    case 'closeAll':
      closeAllTabs(projectPath);
      break;
  }
}

function closeOtherTabs(keepId) {
  const session = sessions.get(keepId);
  if (!session) return;
  const toClose = sessionsForProject(session.projectPath)
    .filter(([id]) => id !== keepId)
    .map(([id]) => id);
  for (const id of toClose) closeTab(id);
  activateTab(keepId);
}

function closeAllTabs(projectPath) {
  const toClose = sessionsForProject(projectPath).map(([id]) => id);
  for (const id of toClose) closeTab(id);
}

// ── Tab navigation ───────────────────────────────────────────

/** Cycle to next or previous tab (within current project) */
function cycleTab(direction) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length < 2) return;
  const idx = ids.indexOf(getActiveId());
  const offset = direction === 'next' ? 1 : ids.length - 1;
  activateTab(ids[(idx + offset) % ids.length]);
}

/** Activate the Nth tab (0-indexed) in the current project; -1 for last tab */
function goToTab(n) {
  const selectedProjectPath = getSelectedProjectPath();
  if (!selectedProjectPath) return;
  const ids = sessionsForProject(selectedProjectPath).map(([id]) => id);
  if (ids.length === 0) return;
  const idx = n === -1 ? ids.length - 1 : Math.min(n, ids.length - 1);
  activateTab(ids[idx]);
}

// ── Move tab (Cmd+Shift+Left/Right) ──────────────────────────

function moveTab(direction) {
  const session = getActiveSession();
  const selectedProjectPath = getSelectedProjectPath();
  if (!session || !selectedProjectPath) return;

  const tabBarTabs = getTabBarTabs();
  // Get visible tab elements for the current project
  const allTabs = [...tabBarTabs.children];
  const projectTabs = allTabs.filter(el => {
    const tabId = Number(el.dataset.tabId);
    const s = sessions.get(tabId);
    return s && s.projectPath === selectedProjectPath;
  });

  if (projectTabs.length < 2) return;

  const currentTab = session.tabEl;
  const idx = projectTabs.indexOf(currentTab);
  if (idx === -1) return;

  if (direction === 'left') {
    if (idx === 0) {
      // Wrap: move to after the last project tab
      const lastTab = projectTabs[projectTabs.length - 1];
      tabBarTabs.insertBefore(currentTab, lastTab.nextSibling);
    } else {
      // Move before the previous project tab
      tabBarTabs.insertBefore(currentTab, projectTabs[idx - 1]);
    }
  } else {
    if (idx === projectTabs.length - 1) {
      // Wrap: move to before the first project tab
      tabBarTabs.insertBefore(currentTab, projectTabs[0]);
    } else {
      // Move after the next project tab
      tabBarTabs.insertBefore(currentTab, projectTabs[idx + 1].nextSibling);
    }
  }
}

// ── Tab rename ────────────────────────────────────────────────

function startTabRename(tabEl, labelEl) {
  const currentName = labelEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-rename-input';
  input.dataset.testid = 'tab-rename-input';
  input.value = currentName;

  labelEl.style.display = 'none';
  tabEl.insertBefore(input, labelEl.nextSibling);
  input.focus();
  input.select();

  let done = false;

  const commit = () => {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    labelEl.textContent = newName || currentName;
    labelEl.style.display = '';
    input.remove();
  };

  const cancel = () => {
    if (done) return;
    done = true;
    labelEl.style.display = '';
    input.remove();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

// ── Exports ──────────────────────────────────────────────────

export {
  showTabContextMenu,
  closeOtherTabs, closeAllTabs,
  cycleTab, goToTab, moveTab,
};

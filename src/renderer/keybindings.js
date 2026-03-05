/**
 * Keybindings — data-driven keyboard shortcuts and dispatch
 * Extracted from renderer/index.js
 */

// Data-driven keybindings
const DEFAULT_KEYBINDINGS = {
  'Meta+n': 'createClaudeSession',
  'Meta+t': 'createTerminalSession',
  'Meta+w': 'closeActiveTab',
  'Meta+e': 'openProjectPicker',
  'Meta+o': 'addProject',
  'Meta+ArrowLeft': 'prevTab',
  'Meta+ArrowRight': 'nextTab',
  'Meta+ArrowUp': 'prevProject',
  'Meta+ArrowDown': 'nextProject',
  'Meta+f': 'openSearchBar',
  'Meta+=': 'zoomIn',
  'Meta+-': 'zoomOut',
  'Meta+0': 'zoomReset',
  'Meta+k': 'clearTerminal',
  'Shift+Meta+C': 'copySelection',
  'Shift+Meta+V': 'pasteClipboard',
  'Shift+Meta+ArrowLeft': 'moveTabLeft',
  'Shift+Meta+ArrowRight': 'moveTabRight',
  'Meta+a': 'selectAll',
  'Meta+b': 'toggleSidebar',
  'Shift+Meta+W': 'closeOtherTabs',
  'Meta+,': 'openSettings',
  'Meta+/': 'showShortcutHelp',
  'Meta+1': 'goToTab1',
  'Meta+2': 'goToTab2',
  'Meta+3': 'goToTab3',
  'Meta+4': 'goToTab4',
  'Meta+5': 'goToTab5',
  'Meta+6': 'goToTab6',
  'Meta+7': 'goToTab7',
  'Meta+8': 'goToTab8',
  'Meta+9': 'goToLastTab',
  'Meta+j': 'toggleDebugPane',
};

let keybindings = { ...DEFAULT_KEYBINDINGS };

const actions = new Map();

function normalizeKeyEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(e.key);
  return parts.join('+');
}

function initKeyboardDispatch() {
  document.addEventListener('keydown', (e) => {
    const key = normalizeKeyEvent(e);
    const actionName = keybindings[key];
    if (!actionName) return;
    const handler = actions.get(actionName);
    if (!handler) return;
    e.preventDefault();
    handler();
  });
}

export {
  DEFAULT_KEYBINDINGS, keybindings, actions,
  normalizeKeyEvent, initKeyboardDispatch,
};

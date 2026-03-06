/**
 * Keybindings — data-driven keyboard shortcuts and dispatch
 */

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
  'Meta+l': 'toggleNotes',
  'Meta+m': 'toggleMute',
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

/** Keys that should use native behavior when a text input is focused */
const TEXT_NATIVE_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'Shift+z']);

function isTextInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  // xterm's hidden textarea is not a real text input — app keybindings should take priority
  if (el.classList.contains('xterm-helper-textarea')) return false;
  return el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'range' && el.type !== 'checkbox');
}

function initKeyboardDispatch() {
  // Use capture phase so app keybindings fire before xterm.js can stopPropagation
  document.addEventListener('keydown', (e) => {
    const key = normalizeKeyEvent(e);
    const actionName = keybindings[key];
    if (!actionName) return;

    // Let native text-editing shortcuts through when a text input has focus
    if (isTextInputFocused()) {
      const nonMeta = key.replace(/Meta\+/, '').replace(/Shift\+/, '');
      const shiftPrefix = e.shiftKey ? 'Shift+' : '';
      if (TEXT_NATIVE_KEYS.has(shiftPrefix + nonMeta) || TEXT_NATIVE_KEYS.has(nonMeta)) return;
    }

    const handler = actions.get(actionName);
    if (!handler) return;
    e.preventDefault();
    e.stopPropagation();
    handler();
  }, true);
}

export {
  DEFAULT_KEYBINDINGS, keybindings, actions,
  normalizeKeyEvent, initKeyboardDispatch,
};

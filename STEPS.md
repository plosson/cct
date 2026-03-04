## Steps

### Step 33 - Configuration screen 

We should have a global configuration screen for :
  - command line to use for claude code session (by default) 
  - command line to use for terminal session (by default)

All configuration can be overriden at project level 

Meaning we should find a nice way to reuse the same screen in essence when configuring a project 
with the global default show in grey or something, a way to set or unset a project specific value. 

Make the configuration code properly architected so that the config is type but generic as well and can be extended 
to more configuration settings in the feature. 

### Step 34 - Command line invocation 

I would like user to be able to do : 

```bash
claudiu .
``` 
or
```bash
claudiu $HOME/devel/project/my-project
```

to open the project in Claudiu. The flow is as follows :

1/ is Claudiu already open. If so, reuse the same process, if not open Claudiu
2/ does the project already exists, if so, just select the project, if not, create the project.

### Step 35 - Debug pane

Add a collapsible bottom panel that displays structured log entries so users can diagnose
issues (e.g. "claude not found in PATH") without opening DevTools.

**Architecture:**

1. **LogService** (main process, `src/main/services/LogService.js`)
   - Singleton with `.info()`, `.warn()`, `.error()` methods
   - Each entry: `{ timestamp, level, source, message }`
   - Keeps a ring buffer (last ~500 entries) in memory
   - Forwards every entry to the renderer via IPC (`log-entry` send)
   - Replace existing `console.error` / `.catch(() => {})` calls across the codebase to use LogService instead

2. **IPC layer** (`src/main/ipc/log.ipc.js` + preload)
   - `log-entry` (send, main→renderer) — streams entries in real time
   - `log-get-history` (invoke) — renderer can fetch the ring buffer on open (so entries logged before the pane was opened are visible)

3. **Renderer pane** (in `src/renderer/index.js` + CSS)
   - Sits between `.terminals-container` and `.status-bar` — a flex child of `.app-body` column or `.main-area` column
   - Collapsed (height 0) by default; toggled with **Cmd+J** (same convention as VS Code)
   - Resizable via drag handle (same pattern as sidebar resize)
   - Content: scrollable list of log entries, styled by level (dim for info, yellow for warn, red for error)
   - Auto-scrolls to bottom on new entries (unless user has scrolled up)
   - Clear button to reset the view
   - Persists collapsed/expanded state + height via window state (like sidebar width)

4. **Instrument the codebase**
   - PTY spawn errors → `logService.error('terminal', message)`
   - Config load/save errors → `logService.warn('config', message)`
   - Hook failures → `logService.error('hooks', message)`
   - Auto-updater events → `logService.info('updater', message)`
   - IPC errors → `logService.error('ipc', message)`

/**
 * The one bridge between the window and the shell. Deliberately narrow: the
 * window may ask for the palette, open a path, and learn where the runtime is —
 * and nothing else. Anything that touches the filesystem or a process stays on
 * the shell side of this line.
 *
 * CommonJS for the same reason `main.cjs` is: Electron's preload runs in a
 * CommonJS context and its `electron` module is reached by `require`.
 */
const { contextBridge, ipcRenderer } = require('electron')

const params = new URLSearchParams(globalThis.location?.search ?? '')

contextBridge.exposeInMainWorld('mimir', {
  bridgeUrl: params.get('bridge') ?? '',
  vaultPath: params.get('vault') ?? '',
  tokens: () => ipcRenderer.invoke('mimir:tokens'),
  openExternal: (url) => ipcRenderer.invoke('mimir:open-external', url),
  openVault: () => ipcRenderer.invoke('mimir:open-vault'),
})

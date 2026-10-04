/**
 * The setup sheet's bridge to the shell. Narrow on purpose: the page learns
 * where credentials are kept, can open a link in the real browser, and can hand
 * over one key. It cannot read a file, list a directory, or ask for the key back.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mimirSetup', {
  describe: () => ipcRenderer.invoke('mimir:setup-describe'),
  connect: (payload) => ipcRenderer.invoke('mimir:setup-connect', payload),
  openExternal: (url) => ipcRenderer.invoke('mimir:open-external', url),
})

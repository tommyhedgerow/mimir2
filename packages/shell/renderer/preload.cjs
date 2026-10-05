/**
 * The one bridge between the application's window and the shell.
 *
 * Narrow on purpose. The page is Mimir's own HTML on disk, and it is given a
 * named set of things it may ask for — the vault's documents, one document's
 * markdown, one conversation with the teacher — and nothing else. It cannot
 * read a file, start a process, or reach the kernel's token, which stays in the
 * shell.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mimir', {
  /** Where things are, and whether the runtime came up. */
  status: () => ipcRenderer.invoke('mimir:status'),

  /** The vault as a list of documents. */
  vaultTree: () => ipcRenderer.invoke('mimir:vault-tree'),

  /** A cheap value that changes when notes are added or removed. */
  vaultToken: () => ipcRenderer.invoke('mimir:vault-token'),

  /** When one note was last written. What following a lesson actually asks. */
  docStamp: (docPath) => ipcRenderer.invoke('mimir:doc-stamp', docPath),

  /** One document's markdown, by id. */
  document: (docId) => ipcRenderer.invoke('mimir:document', docId),

  /** A note referred to by name, for a wikilink. */
  find: (title) => ipcRenderer.invoke('mimir:vault-find', title),

  /** Which notes refer to this one. */
  backlinks: (title) => ipcRenderer.invoke('mimir:vault-backlinks', title),

  /** One turn with the teacher. Resolves with the committed answer. */
  ask: (sessionId, text) => ipcRenderer.invoke('mimir:ask', { sessionId, text }),

  /** A conversation so far, for a reload. */
  conversation: (sessionId) => ipcRenderer.invoke('mimir:conversation', sessionId),

  /** Streamed events for a session. Returns an unsubscribe function. */
  onEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('mimir:event', listener)
    return () => ipcRenderer.removeListener('mimir:event', listener)
  },

  openExternal: (url) => ipcRenderer.invoke('mimir:open-external', url),

  /** Show the vault in the Finder. */
  openVault: () => ipcRenderer.invoke('mimir:open-vault'),
})

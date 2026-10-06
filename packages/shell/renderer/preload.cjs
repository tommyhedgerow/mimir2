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

  /** Told when the runtime restarts on a different model. */
  onModel: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('mimir:model', listener)
    return () => ipcRenderer.removeListener('mimir:model', listener)
  },

  /** Streamed events for a session. Returns an unsubscribe function. */
  onEvent: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('mimir:event', listener)
    return () => ipcRenderer.removeListener('mimir:event', listener)
  },

  openExternal: (url) => ipcRenderer.invoke('mimir:open-external', url),

  /** Saves the conversation so it can be reread after the window closes. */
  saveConversation: (sessionId, state, lessonPath) =>
    ipcRenderer.invoke('mimir:conversation-save', { sessionId, state, lessonPath }),

  /** Which model answers, what else there is, and whether each has a key. */
  models: () => ipcRenderer.invoke('mimir:models'),

  /** Chooses a model. Restarts the runtime, because that is where it is taken. */
  chooseModel: (choice) => ipcRenderer.invoke('mimir:model-choose', choice),

  /** Adds a model, so the choice is not limited to the ones shipped. */
  addModel: (entry) => ipcRenderer.invoke('mimir:model-add', entry),

  /** Forgets an added model. */
  removeModel: (entry) => ipcRenderer.invoke('mimir:model-remove', entry),

  /** Which providers hold a key. Names only, never the secrets. */
  providerKeys: () => ipcRenderer.invoke('mimir:provider-keys'),

  /** Sets a provider's key. It never comes back out of the shell. */
  setProviderKey: (provider, apiKey) => ipcRenderer.invoke('mimir:provider-key', { provider, apiKey }),

  /** Forgets a provider's key. */
  removeProviderKey: (provider) => ipcRenderer.invoke('mimir:provider-key-remove', provider),

  /** Deletes a chat and its transcript. */
  deleteChat: (sessionId) => ipcRenderer.invoke('mimir:chat-delete', sessionId),

  /** Copies the notes and the conversations to a folder the learner picks. */
  exportVault: () => ipcRenderer.invoke('mimir:vault-export'),

  /** Empties the vault and writes a fresh one. No undo. */
  clearVault: () => ipcRenderer.invoke('mimir:vault-clear'),

  /** Every chat there is, newest first. */
  chats: () => ipcRenderer.invoke('mimir:chats'),

  /** One chat by its session id. */
  chat: (sessionId) => ipcRenderer.invoke('mimir:chat', sessionId),

  /** The most recent conversation, or null if there is not one. */
  loadConversation: () => ipcRenderer.invoke('mimir:conversation-load'),

  /** A Wikipedia article's own summary of itself, for a link's hover card. */
  preview: (url) => ipcRenderer.invoke('mimir:preview', url),

  /** Show the vault in the Finder. */
  openVault: () => ipcRenderer.invoke('mimir:open-vault'),
})

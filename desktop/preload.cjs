const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nbems", {
  start: (opts) => ipcRenderer.invoke("nbems:start", opts),
  stop: () => ipcRenderer.invoke("nbems:stop"),
  catchUp: () => ipcRenderer.invoke("nbems:catchup"),
  queueTx: (opts) => ipcRenderer.invoke("nbems:queue-tx", opts),
  onRx: (fn) => {
    const handler = (_event, text) => fn(String(text ?? ""));
    ipcRenderer.on("nbems:rx", handler);
    return () => ipcRenderer.removeListener("nbems:rx", handler);
  },
  onStatus: (fn) => {
    const handler = (_event, status) => fn(status);
    ipcRenderer.on("nbems:status", handler);
    return () => ipcRenderer.removeListener("nbems:status", handler);
  },
});

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { createBridge } = require("./nbems.cjs");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "OPIN Net Assistant",
    backgroundColor: "#12160f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const bridge = createBridge(win);
  ipcMain.removeHandler("nbems:start");
  ipcMain.removeHandler("nbems:stop");
  ipcMain.removeHandler("nbems:catchup");
  ipcMain.handle("nbems:start", (_event, opts) => bridge.start(opts));
  ipcMain.handle("nbems:stop", () => {
    bridge.stop();
    return true;
  });
  ipcMain.handle("nbems:catchup", () => bridge.catchUp());
  win.on("closed", () => bridge.stop());
  win.loadFile(path.join(__dirname, "dist", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

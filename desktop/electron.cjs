const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: "OPIN Net Assistant",
    backgroundColor: "#12160f",
    autoHideMenuBar: true,
  });
  win.loadFile(path.join(__dirname, "dist", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

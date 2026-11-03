const fs = require("fs");
const os = require("os");
const path = require("path");
const { callXmlRpc } = require("./xmlrpc.cjs");

function flampDirs() {
  const home = os.homedir();
  return [
    path.join(home, ".nbems", "FLAMP", "rx"),
    path.join(home, "NBEMS", "FLAMP", "rx"),
    path.join(home, "nbems", "FLAMP", "rx"),
  ];
}

function blankStatus() {
  return { fldigi: "down", flamp: "down", flrig: "down", frequency: "", mode: "", modem: "", radio: "", note: "", file: "" };
}

function formatHz(value) {
  const hz = Number(String(value).replace(/[^\d.]/g, ""));
  if (!hz) return "";
  const khz = hz / 1000;
  return `${khz >= 100 ? khz.toFixed(1) : khz.toFixed(3)} kHz`;
}

function createBridge(win) {
  let timer = null;
  let cursor = null;
  let skipped = 0;
  let primed = false;
  const seen = new Set();
  let opts = { fldigiPort: 7362, flrigPort: 12345 };
  let status = blankStatus();

  function sendStatus(extra = {}) {
    status = { ...status, ...extra };
    if (!win.isDestroyed()) win.webContents.send("nbems:status", status);
  }

  function scanFlamp() {
    let watching = false;
    const fresh = [];
    for (const dir of flampDirs()) {
      if (!fs.existsSync(dir)) continue;
      watching = true;
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.startsWith(".")) continue;
        const full = path.join(dir, name);
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const key = `${full}:${stat.mtimeMs}:${stat.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (primed) fresh.push(name);
      }
    }
    primed = true;
    return { watching, fresh };
  }

  async function tick() {
    const next = blankStatus();
    try {
      const length = Number(await callXmlRpc(opts.fldigiPort, "text.get_rx_length")) || 0;
      next.fldigi = "up";
      if (cursor === null || length < cursor) {
        cursor = length;
        skipped = length;
      } else if (length > cursor) {
        const chunk = await callXmlRpc(opts.fldigiPort, "text.get_rx", [cursor, length - cursor]);
        cursor = length;
        if (chunk && !win.isDestroyed()) win.webContents.send("nbems:rx", String(chunk));
      }
      try {
        next.modem = String(await callXmlRpc(opts.fldigiPort, "modem.get_name") ?? "");
      } catch { /* modem name is optional */ }
      try {
        const hz = await callXmlRpc(opts.fldigiPort, "main.get_frequency");
        if (!next.frequency) next.frequency = formatHz(hz);
      } catch { /* fldigi may have no rig frequency */ }
    } catch {
      next.fldigi = "down";
      cursor = null;
    }
    try {
      const vfo = await callXmlRpc(opts.flrigPort, "rig.get_vfo");
      next.flrig = "up";
      next.frequency = formatHz(vfo) || next.frequency;
      try {
        next.mode = String(await callXmlRpc(opts.flrigPort, "rig.get_mode") ?? "");
      } catch { /* mode is optional */ }
      try {
        next.radio = String(await callXmlRpc(opts.flrigPort, "rig.get_xcvr") ?? "");
      } catch { /* radio name is optional */ }
    } catch {
      next.flrig = "down";
    }
    const flamp = scanFlamp();
    next.flamp = flamp.watching ? "up" : "down";
    next.note = flamp.watching ? "Watching the FLAMP receive folder." : "No FLAMP receive folder yet.";
    if (flamp.fresh.length) next.file = flamp.fresh[flamp.fresh.length - 1];
    sendStatus(next);
  }

  return {
    start(nextOpts) {
      opts = {
        fldigiPort: Number(nextOpts?.fldigiPort) || 7362,
        flrigPort: Number(nextOpts?.flrigPort) || 12345,
      };
      cursor = null;
      skipped = 0;
      if (timer) clearInterval(timer);
      void tick();
      timer = setInterval(() => void tick(), 800);
      return status;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      cursor = null;
      sendStatus({ fldigi: "down", flamp: status.flamp, flrig: "down", note: "Live read is off." });
    },
    async catchUp() {
      const end = skipped || cursor || 0;
      if (end <= 0) return "";
      const text = await callXmlRpc(opts.fldigiPort, "text.get_rx", [0, end]);
      return String(text ?? "");
    },
  };
}

module.exports = { createBridge, formatHz, flampDirs };

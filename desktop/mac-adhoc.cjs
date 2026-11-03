const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function bundlesUnder(dir) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let names = [];
    try {
      names = fs.readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(current, name);
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (!stat.isDirectory()) continue;
      if (name.endsWith(".app") || name.endsWith(".framework")) found.push(full);
      stack.push(full);
    }
  }
  return found;
}

function sign(target) {
  execFileSync("codesign", ["--force", "--sign", "-", target], { stdio: "inherit" });
}

exports.default = async function macAdhoc(context) {
  if (context.electronPlatformName !== "darwin") return;
  const apps = fs.readdirSync(context.appOutDir).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`expected one Mac app, found ${apps.join(", ") || "none"}`);
  const app = path.join(context.appOutDir, apps[0]);
  execFileSync("xattr", ["-cr", app], { stdio: "inherit" });
  const nested = bundlesUnder(app)
    .filter((item) => item !== app)
    .sort((a, b) => b.length - a.length);
  for (const item of nested) sign(item);
  sign(app);
  const checked = spawnSync("codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" });
  const details = `${checked.stdout || ""}\n${checked.stderr || ""}`;
  if (checked.status !== 0 || !/Signature=adhoc/.test(details)) {
    throw new Error(`Mac app was not ad-hoc signed:\n${details}`);
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
};

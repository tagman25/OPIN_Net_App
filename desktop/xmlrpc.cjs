const http = require("http");

function unescapeXml(value) {
  return value
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&/g, "&");
}

function parseXmlRpc(xml) {
  if (/<fault>/i.test(xml)) {
    const message = xml.match(/<string>([\s\S]*?)<\/string>/i);
    throw new Error(unescapeXml(message?.[1] ?? "XML-RPC fault"));
  }
  const value = xml.match(/<value>([\s\S]*?)<\/value>/i);
  if (!value) return "";
  const typed = value[1].match(/<(string|int|i4|double|boolean|base64)>([\s\S]*?)<\/\1>/i);
  if (!typed) return unescapeXml(value[1].replace(/<[^>]+>/g, "").trim());
  const kind = typed[1].toLowerCase();
  const raw = typed[2];
  if (kind === "base64") return Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf8");
  if (kind === "int" || kind === "i4" || kind === "double") return Number(raw);
  if (kind === "boolean") return raw.trim() === "1";
  return unescapeXml(raw);
}

function callXmlRpc(port, method, params = []) {
  const body = `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params
    .map((param) => {
      if (typeof param === "number" && Number.isInteger(param)) return `<param><value><i4>${param}</i4></value></param>`;
      if (typeof param === "number") return `<param><value><double>${param}</double></value></param>`;
      return `<param><value><string>${String(param).replace(/&/g, "&").replace(/</g, "<")}</string></value></param>`;
    })
    .join("")}</params></methodCall>`;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/RPC2",
        method: "POST",
        headers: { "Content-Type": "text/xml", "Content-Length": Buffer.byteLength(body) },
        timeout: 1200,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(parseXmlRpc(Buffer.concat(chunks).toString("utf8")));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { parseXmlRpc, callXmlRpc };

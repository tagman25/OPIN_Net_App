const http = require("http");
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseXmlRpc } = require("./xmlrpc.cjs");
const { formatHz } = require("./nbems.cjs");
const { queueFldigiTx } = require("./nbems.cjs");

test("fldigi rx bytes decode from base64", () => {
  const xml = `<?xml version="1.0"?><methodResponse><params><param><value><base64>${Buffer.from("N8TAG DE KE8YTX ZKE K\n", "utf8").toString("base64")}</base64></value></param></params></methodResponse>`;
  assert.equal(parseXmlRpc(xml), "N8TAG DE KE8YTX ZKE K\n");
});

test("flrig frequency is a string of hertz", () => {
  const xml = "<methodResponse><params><param><value><string>3583000</string></value></param></params></methodResponse>";
  assert.equal(parseXmlRpc(xml), "3583000");
  assert.equal(formatHz("3583000"), "3583.0 kHz");
});

test("an XML-RPC fault is an error and does not look like text", () => {
  const xml = "<methodResponse><fault><value><struct><member><name>faultString</name><value><string>unknown method</string></value></member></struct></value></fault></methodResponse>";
  assert.throws(() => parseXmlRpc(xml), /unknown method/);
});

test("queue to fldigi writes the blue box and does not key the radio", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push(Buffer.concat(chunks).toString("utf8"));
      res.end("<?xml version=\"1.0\"?><methodResponse><params><param><value><string></string></value></param></params></methodResponse>");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    assert.equal(await queueFldigiTx(port, "N8NCS DE N8TAG ZKE K"), true);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /<methodName>text\.add_tx<\/methodName>/);
    assert.doesNotMatch(seen[0], /main\.tx|text\.add_tx_bytes|run_macro/);
    assert.match(seen[0], /N8NCS DE N8TAG ZKE K\n/);
    assert.equal(await queueFldigiTx(port, "A & B <C>"), true);
    assert.match(seen[1], /A & B <C>\n/);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

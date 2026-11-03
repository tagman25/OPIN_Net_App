const test = require("node:test");
const assert = require("node:assert/strict");
const { parseXmlRpc } = require("./xmlrpc.cjs");
const { formatHz } = require("./nbems.cjs");

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

// Net-control decisions for an OPIN digital session.
// Matches Black Swan SOI version D and the digital control script:
// the speaker is the callsign after DE, ZNB ABC means "AB authenticates as C",
// a wrong authenticator is ZND 2, ZUG ZNB joins the roll without a DRYAD,
// ZEV means the station has the file, ZUG ZEV means it does not.

export type Rows = Record<string, string>;

export type Station = {
  call: string;
  authenticated: boolean;
  pending: boolean;
  zug: boolean;
  challenge: string | null;
  volunteered: string | null;
};

export type Traffic = {
  id: number;
  originator: string;
  quantity: number;
  precedence: string;
  destination: string;
  file: string | null;
  received: string[];
  refused: string[];
  zof: boolean;
};

export type LogLine = { time: string; source: string; message: string };

export type Net = {
  ncs: string;
  band: string;
  stations: Station[];
  zks: string[];
  traffic: Traffic[];
  done: Traffic[];
  log: LogLine[];
  lastTx: string;
  nextId: number;
  started: string;
};

const CALL = /^[A-Z]{1,2}\d[A-Z]{1,4}$/;
const STOP = new Set([
  "K", "AR", "AS", "QRU", "ZNB", "ZKE", "ZUG", "ZEV", "ZOF", "ZKA", "ZKB",
  "ZKJ", "INT", "IMI", "QSY", "R",
]);

export function emptyNet(ncs = "N8TAG"): Net {
  return {
    ncs,
    band: "",
    stations: [],
    zks: [],
    traffic: [],
    done: [],
    log: [],
    lastTx: "",
    nextId: 1,
    started: new Date().toISOString(),
  };
}

function stamp(): string {
  return new Date().toISOString().slice(11, 16);
}

function log(net: Net, message: string, source = "SYSTEM"): Net {
  return { ...net, log: [...net.log, { time: stamp(), source, message }].slice(-300) };
}

export function authenticate(rows: Rows, row: string, letter: string): string | null {
  const line = rows[row];
  if (!line) return null;
  const col = line.indexOf(letter);
  if (col < 0) return null;
  const next = row === "Y" ? "A" : String.fromCharCode(row.charCodeAt(0) + 1);
  const below = rows[next];
  if (!below || col >= below.length) return null;
  return below[col];
}

export function extractSpeaker(line: string): string | null {
  let text = line.toUpperCase().trim().replace(/\s+/g, " ");
  if (text.startsWith("DE ")) text = `X ${text}`;
  if (!text.includes(" DE ")) return null;
  const token = text.split(" DE ")[1]?.split(" ")[0]?.split("/")[0]?.replace(/[.,:;<>]/g, "");
  if (!token || !CALL.test(token)) return null;
  return token;
}

function znbGroup(line: string): string | null {
  const tokens = line.split(" ");
  const i = tokens.indexOf("ZNB");
  if (i < 0 || i + 1 >= tokens.length) return null;
  const cand = tokens[i + 1].replace(/[.,]/g, "");
  if (/^[A-Z]{1}$/.test(cand) || /^[A-Z]{3}$/.test(cand)) return cand;
  return null;
}

function filenameOf(line: string): string | null {
  if (line.includes("FILE :")) {
    return line.split("FILE :")[1]?.trim().split(" ")[0]?.replace(/[<>]/g, "") ?? null;
  }
  for (const token of line.replace(/[<>]/g, " ").split(" ")) {
    if (/\.(TXT|K2S|CSV|HTML)$/.test(token)) return token;
  }
  return null;
}

function parseZbo(line: string): [number, string, string] | null {
  const tokens = line.replace("ZBO1", "ZBO 1").split(" ");
  const i = tokens.indexOf("ZBO");
  if (i < 0) return null;
  let rest = tokens.slice(i + 1);
  let qty = 1;
  if (rest[0] && /^\d+$/.test(rest[0])) {
    qty = Number(rest[0]);
    rest = rest.slice(1);
  }
  let prec = "R";
  if (rest[0] && ["R", "P", "O", "Z", "Y", "M", "C"].includes(rest[0])) {
    prec = rest[0];
    rest = rest.slice(1);
  }
  const dest = rest[0] && !STOP.has(rest[0]) ? rest[0] : "OPIN";
  return [qty, prec, dest];
}

export function challengeFrom(rows: Rows): string | null {
  const keys = Object.keys(rows).filter((r) => r !== "Y" && rows[r]?.length === 25);
  if (!keys.length) return null;
  const row = keys[Math.floor(Math.random() * keys.length)];
  const letters = rows[row];
  const letter = letters[Math.floor(Math.random() * letters.length)];
  return `${row}${letter}`;
}

export function makeTriplet(rows: Rows, good: boolean): string {
  const row = "C";
  const letter = rows[row]?.[3] ?? "A";
  const answer = authenticate(rows, row, letter) ?? "A";
  const bad = answer === "A" ? "B" : "A";
  return `${row}${letter}${good ? answer : bad}`;
}

function station(net: Net, call: string): Station | undefined {
  return net.stations.find((s) => s.call === call);
}

function upsert(net: Net, call: string): Net {
  if (station(net, call)) {
    return {
      ...net,
      stations: net.stations.map((s) => (s.call === call ? { ...s } : s)),
    };
  }
  return {
    ...net,
    stations: [
      ...net.stations,
      { call, authenticated: false, pending: true, zug: false, challenge: null, volunteered: null },
    ],
  };
}

function patch(net: Net, call: string, partial: Partial<Station>): Net {
  return {
    ...net,
    stations: net.stations.map((s) => (s.call === call ? { ...s, ...partial } : s)),
  };
}

function addZks(net: Net, call: string, reason: string): Net {
  if (net.zks.includes(call)) return log(net, `${call} already on ZKS`, call);
  return log({ ...net, zks: [...net.zks, call] }, `${call} added to ZKS (${reason})`, call);
}

function addTraffic(net: Net, originator: string, qty: number, prec: string, dest: string): Net {
  const dup = [...net.traffic].reverse().find(
    (t) => t.originator === originator && t.quantity === qty && t.precedence === prec && t.destination === dest,
  );
  if (dup) return log(net, `${originator} repeated ZBO ${qty} ${prec} ${dest} — already listed`);
  const item: Traffic = {
    id: net.nextId,
    originator,
    quantity: qty,
    precedence: prec,
    destination: dest,
    file: null,
    received: [],
    refused: [],
    zof: false,
  };
  return log(
    { ...net, nextId: net.nextId + 1, traffic: [...net.traffic, item] },
    `${originator} has traffic: ${qty} ${prec} for ${dest}`,
    originator,
  );
}

function markZof(net: Net, file: string | null): Net {
  const idx = file
    ? net.traffic.findIndex((t) => t.file === file || t.file === null)
    : net.traffic.length - 1;
  if (idx < 0) return log(net, "ZOF seen with no open traffic");
  const traffic = net.traffic.map((t, i) =>
    i === idx ? { ...t, zof: true, file: file ?? t.file } : t,
  );
  return log({ ...net, traffic }, `ZOF for ${file ?? traffic[idx].destination}`);
}

function recordZev(net: Net, call: string, file: string | null, negative: boolean): Net {
  let idx = file ? net.traffic.findIndex((t) => t.file === file) : -1;
  if (idx < 0) idx = [...net.traffic].reverse().findIndex((t) => t.zof);
  if (idx >= 0 && file) {
    // reverse findIndex is from the end; convert
  }
  let real = file ? net.traffic.findIndex((t) => t.file === file) : -1;
  if (real < 0) {
    for (let i = net.traffic.length - 1; i >= 0; i--) {
      if (net.traffic[i].zof) {
        real = i;
        break;
      }
    }
  }
  if (real < 0 && net.traffic.length) real = net.traffic.length - 1;
  if (real < 0) return log(net, `${call} sent ${negative ? "ZUG ZEV" : "ZEV"} but no traffic is open`, call);

  let traffic = net.traffic.map((t, i) => {
    if (i !== real) return t;
    const received = new Set(t.received);
    const refused = new Set(t.refused);
    if (negative) {
      refused.add(call);
      received.delete(call);
    } else {
      received.add(call);
      refused.delete(call);
    }
    return {
      ...t,
      file: file ?? t.file,
      received: [...received],
      refused: [...refused],
    };
  });
  let next = log(
    { ...net, traffic },
    negative
      ? `${call} ZUG ZEV — does not have ${traffic[real].file ?? traffic[real].destination}`
      : `${call} ZEV — has ${traffic[real].file ?? traffic[real].destination}`,
    call,
  );
  const item = next.traffic[real];
  const answered = new Set([...item.received, ...item.refused]);
  const everyone = next.zks.length > 0 && next.zks.every((c) => answered.has(c));
  if (item.zof && everyone) {
    next = log(
      {
        ...next,
        traffic: next.traffic.filter((_, i) => i !== real),
        done: [...next.done, item],
      },
      `Completed ${item.file ?? item.destination} — on the Winlink follow-up list`,
    );
  }
  return next;
}

export function pendingCalls(net: Net): string[] {
  return net.stations.filter((s) => s.pending && !net.zks.includes(s.call)).map((s) => s.call);
}

export function unanswered(net: Net, item: Traffic): string[] {
  const answered = new Set([...item.received, ...item.refused]);
  return net.zks.filter((c) => !answered.has(c));
}

export function scriptOpen(ncs: string) {
  return `OPIN DE ${ncs} ZKA ZKB AS`;
}
export function scriptAgency(ncs: string) {
  return `OPIN DE ${ncs} INT AGENCY K`;
}
export function scriptTrafficCall(ncs: string) {
  return `OPIN DE ${ncs} INT ZBO K`;
}
export function scriptCheckin(ncs: string) {
  return `OPIN DE ${ncs} INT ZKE K`;
}
export function scriptClose(ncs: string) {
  return `OPIN DE ${ncs} ZKJ 73 AR`;
}
export function scriptZks(ncs: string, calls: string[]) {
  return `OPIN DE ${ncs} ZKS ${calls.join(" ")}`.trim();
}
export function scriptImi(ncs: string, station: string) {
  return `${station} DE ${ncs} IMI K`;
}
export function scriptCloseOne(ncs: string, station: string) {
  return `${station} DE ${ncs} ZKJ K`;
}

function ack(ncs: string, station: string) {
  return `${station} DE ${ncs} R AS AR`;
}
function ackTraffic(ncs: string, station: string, qty: number, prec: string, dest: string) {
  return `${station} DE ${ncs} R ZBO ${qty} ${prec} ${dest} AS AR`;
}
function challenge(ncs: string, station: string, chal: string, znd?: string) {
  return `${station} DE ${ncs} ${znd ? `ZND ${znd} ` : ""}INT ZNB ${chal}`;
}

export function interpret(net: Net, raw: string, rows: Rows | null, ncsMode: boolean): { net: Net; suggestion: string | null } {
  const text = raw.toUpperCase().trim().replace(/\s+/g, " ");
  if (text.length < 4) return { net, suggestion: null };
  const speaker = extractSpeaker(text);
  const ncs = net.ncs;
  const isUs = speaker === ncs;
  let suggestion: string | null = null;

  if (text.includes("ZOF") && !text.includes("INT")) {
    net = markZof(net, filenameOf(text));
  }
  if (speaker && !isUs && text.split(" ").includes("IMI")) {
    net = log(net, `${speaker} sent IMI — say again`, speaker);
    if (net.lastTx) return { net, suggestion: net.lastTx };
  }
  if (isUs || !speaker) return { net, suggestion };

  if (text.includes("ZUG") && text.includes("ZNB") && !text.includes("ZEV")) {
    net = upsert(net, speaker);
    net = patch(net, speaker, { zug: true, pending: false, authenticated: false });
    net = addZks(net, speaker, "ZUG ZNB");
    suggestion = ack(ncs, speaker);
  } else if (text.includes("ZKE") && !text.includes("INT")) {
    net = upsert(log(net, `${speaker} checked in (ZKE) — pending authentication`, speaker), speaker);
    const group = znbGroup(text);
    if (group && group.length === 3) net = patch(net, speaker, { volunteered: group });
    let authed = false;
    if (ncsMode && group && group.length === 3 && rows) {
      const expected = authenticate(rows, group[0], group[1]);
      if (expected && expected === group[2]) {
        net = patch(net, speaker, { authenticated: true, pending: false });
        net = addZks(net, speaker, "DRYAD authenticated");
        net = log(net, `${speaker} volunteered ZNB ${group} — matches the DRYAD`, speaker);
        authed = true;
      } else {
        const chal = challengeFrom(rows) ?? "??";
        net = patch(net, speaker, { challenge: chal });
        suggestion = challenge(ncs, speaker, chal, "2");
        net = log(net, `${speaker} volunteered ZNB ${group} — does not match. Suggested ZND 2.`, speaker);
      }
    } else if (ncsMode && rows && !station(net, speaker)?.authenticated) {
      const chal = challengeFrom(rows);
      if (chal) {
        net = patch(net, speaker, { challenge: chal });
        suggestion = challenge(ncs, speaker, chal);
        net = log(net, `Suggested INT ZNB ${chal} for ${speaker}`);
      }
    }
    if (authed) {
      const zbo = parseZbo(text);
      suggestion = zbo && !text.includes("QRU") ? ackTraffic(ncs, speaker, ...zbo) : ack(ncs, speaker);
    }
  } else if (text.includes("ZNB") && !text.includes("INT") && !text.includes("ZUG")) {
    const group = znbGroup(text);
    const st = station(net, speaker);
    if (ncsMode && group && st?.challenge && rows) {
      const expected = authenticate(rows, st.challenge[0], st.challenge[1]);
      const got = group.length === 1 ? group[0] : group.length === 3 ? group[2] : "";
      if (expected && got === expected) {
        net = patch(net, speaker, { authenticated: true, pending: false });
        net = addZks(net, speaker, "DRYAD authenticated");
        suggestion = ack(ncs, speaker);
        net = log(net, `${speaker} authenticated with ZNB ${group}`, speaker);
      } else {
        const chal = challengeFrom(rows) ?? "??";
        net = patch(net, speaker, { challenge: chal });
        suggestion = challenge(ncs, speaker, chal, "2");
        net = log(net, `${speaker} ZNB mismatch (got ${got}, expected ${expected})`, speaker);
      }
    }
  }

  const zbo = parseZbo(text);
  if (zbo && !text.includes("INT")) {
    net = addTraffic(net, speaker, zbo[0], zbo[1], zbo[2]);
    if (!suggestion && net.zks.includes(speaker) && !text.includes("ZKE")) {
      suggestion = ackTraffic(ncs, speaker, zbo[0], zbo[1], zbo[2]);
    }
  }
  if (text.includes("ZEV") && !text.includes("INT")) {
    net = recordZev(net, speaker, filenameOf(text), text.includes("ZUG"));
  }
  if (text.includes("CONFIRMED")) {
    const file = filenameOf(text);
    if (file) net = recordZev(net, speaker, file, false);
  }
  if (text.includes("ZKJ") && !text.includes("INT")) {
    net = log(net, `${speaker} closing down (ZKJ)`, speaker);
  }
  return { net, suggestion };
}

export function markComplete(net: Net, id: number): Net {
  const item = net.traffic.find((t) => t.id === id);
  if (!item) return net;
  return log(
    {
      ...net,
      traffic: net.traffic.filter((t) => t.id !== id),
      done: [...net.done, { ...item, zof: true }],
    },
    `Operator marked complete: ${item.file ?? item.destination}`,
  );
}

export function sessionReport(net: Net): string {
  const end = new Date();
  const start = new Date(net.started);
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const lines = [
    "OPIN RF SESSION REPORT",
    `NCS: ${net.ncs}`,
    `Start: ${start.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `End:   ${end.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    `Duration: ${minutes} minutes`,
    `Band: ${net.band || "(set this before sending)"}`,
    "",
    "Stations in the net (ZKS order):",
    net.zks.join(" ") || "(none)",
    "",
    "Still pending authentication:",
    pendingCalls(net).join(" ") || "(none)",
    "",
    "Traffic still open:",
  ];
  if (!net.traffic.length) lines.push("(none)");
  for (const t of net.traffic) {
    lines.push(
      `  ${t.originator} ZBO ${t.quantity} ${t.precedence} ${t.destination}  file=${t.file ?? "-"} ZOF=${t.zof}  ZEV=${t.received.join(",") || "-"}  ZUG ZEV=${t.refused.join(",") || "-"}`,
    );
  }
  lines.push("", "Follow-up after the net (Winlink for anyone who sent ZUG ZEV):");
  if (!net.done.length) lines.push("(none)");
  for (const t of net.done) {
    const silent = net.zks.filter((c) => !t.received.includes(c) && !t.refused.includes(c));
    lines.push(`  ${t.file ?? t.destination} from ${t.originator} ${t.precedence} ${t.destination}`);
    lines.push(`    received: ${t.received.join(", ") || "none"}`);
    lines.push(`    need Winlink: ${t.refused.join(", ") || "none"}`);
    lines.push(`    no report: ${silent.join(", ") || "none"}`);
  }
  return lines.join("\n");
}

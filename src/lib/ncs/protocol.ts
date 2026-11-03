import { authenticate, challengeFrom, type Rows } from "./dryad";

export type Role = "ncs" | "wl2k" | "ip" | "operator";
export type Method = "RF" | "WL2K" | "IP";

export type Station = {
  call: string;
  method: Method;
  authenticated: boolean;
  pending: boolean;
  zug: boolean;
  exempt: boolean;
  challenge: string | null;
  volunteered: string | null;
  qsyChannel: string | null;
  qsySince: string | null;
  agency: string;
};

export type Traffic = {
  id: number;
  originator: string;
  quantity: number;
  precedence: string;
  destination: string;
  file: string | null;
  blocks: number | null;
  received: string[];
  refused: string[];
  missingBy: Record<string, number[]>;
  zof: boolean;
  via: "air" | "wl2k" | "undecided";
};

export type LogLine = { time: string; source: string; message: string };

export type InboxItem = {
  id: number;
  from: string;
  text: string;
  acked: boolean;
  bounce: boolean;
};

export type FolderFile = {
  id: number;
  folder: string;
  name: string;
  precedence: string;
  destination: string;
  listed: boolean;
};

export type Net = {
  ncs: string;
  myCall: string;
  role: Role;
  band: string;
  channel: string;
  netOpen: boolean;
  turn: string | null;
  stations: Station[];
  zks: string[];
  traffic: Traffic[];
  done: Traffic[];
  log: LogLine[];
  lastTx: string;
  nextId: number;
  inbox: InboxItem[];
  files: FolderFile[];
  started: string;
};

export const CHANNELS = [
  "60C4", "60C5", "60C1", "60C2",
  "80F1", "80F2", "80F3", "80F4", "80F5", "80F6", "80F7", "80F8",
  "40F1", "40F2", "40F3", "40F4", "40F5", "40F6", "40F7", "40F8",
  "75P", "75S", "75T", "40P", "40S", "40T",
];

export const GROUPS = ["OPIN", "US", "OH", "OHCE", "ALL"];
export const FOLDERS = ["Incoming", "Ready", "Sent", "Archive"];
export const PRECEDENCE = ["Z", "O", "P", "R"] as const;

const CALL = /^[A-Z]{1,2}\d[A-Z]{1,4}$/;
const STOP = new Set([
  "K", "AR", "AS", "QRU", "ZNB", "ZKE", "ZUG", "ZEV", "ZOF", "ZOK", "ZKA", "ZKB",
  "ZKJ", "ZKS", "INT", "IMI", "QSY", "R", "IP", "WL2K", "BACK",
]);

export function emptyNet(ncs = "N8TAG"): Net {
  return {
    ncs,
    myCall: ncs,
    role: "ncs",
    band: "80m",
    channel: "80F1",
    netOpen: false,
    turn: null,
    stations: [],
    zks: [],
    traffic: [],
    done: [],
    log: [],
    lastTx: "",
    nextId: 1,
    inbox: [],
    files: [],
    started: new Date().toISOString(),
  };
}

function stamp(): string {
  return new Date().toISOString().slice(11, 16);
}

function log(net: Net, message: string, source = "SYSTEM"): Net {
  return { ...net, log: [...net.log, { time: stamp(), source, message }].slice(-400) };
}

export function extractSpeaker(line: string): string | null {
  let text = line.toUpperCase().trim().replace(/\s+/g, " ");
  if (text.startsWith("DE ")) text = `X ${text}`;
  if (!text.includes(" DE ")) return null;
  const token = text.split(" DE ")[1]?.split(" ")[0]?.split("/")[0]?.replace(/[.,:;<>]/g, "");
  if (!token || !CALL.test(token)) return null;
  return token;
}

function calledStation(line: string): string | null {
  const text = line.toUpperCase().trim().replace(/\s+/g, " ");
  if (!text.includes(" DE ")) return null;
  const token = text.split(" DE ")[0]?.trim().split(" ").pop()?.split("/")[0]?.replace(/[.,:;<>]/g, "");
  if (!token || !CALL.test(token)) return null;
  return token;
}

function znbGroup(line: string): string | null {
  const tokens = line.split(" ");
  const i = tokens.indexOf("ZNB");
  if (i < 0 || i + 1 >= tokens.length) return null;
  const cand = tokens[i + 1].replace(/[.,]/g, "");
  if (/^[A-Z]$/.test(cand) || /^[A-Z]{3}$/.test(cand)) return cand;
  return null;
}

function filenameOf(line: string): string | null {
  if (line.includes("FILE :")) {
    return line.split("FILE :")[1]?.trim().split(/\s+/)[0]?.replace(/[<>]/g, "") ?? null;
  }
  if (line.includes("FILE:")) {
    return line.split("FILE:")[1]?.trim().split(/\s+/)[0]?.replace(/[<>]/g, "") ?? null;
  }
  for (const token of line.replace(/[<>]/g, " ").split(" ")) {
    if (/\.(TXT|K2S|CSV|HTML|PDF)$/.test(token)) return token;
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

function detectMethod(text: string): Method {
  if (text.includes("/WL2K") || /\bWL2K\b/.test(text)) return "WL2K";
  if (/\bZKE\b/.test(text) && /\bIP\b/.test(text)) return "IP";
  return "RF";
}

function channelIn(text: string): string | null {
  const tokens = text.split(" ");
  const i = tokens.indexOf("QSY");
  if (i < 0) return null;
  const next = tokens[i + 1];
  if (!next || next === "BACK" || next === "NET") return null;
  return next.replace(/[^A-Z0-9]/g, "");
}

function missingBlocks(text: string): number[] | null {
  const m = text.match(/MISSING(?:\s+BLOCKS)?\s*:?\s*([0-9,\s]+)/);
  if (!m) return null;
  const nums = m[1].split(/[^0-9]+/).filter(Boolean).map(Number);
  return nums;
}

function blockCount(text: string): number | null {
  const m = text.match(/\b(?:NBLK|BLKS|BLOCKS)\s*:?\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function stationOf(net: Net, call: string): Station | undefined {
  return net.stations.find((s) => s.call === call);
}

function upsert(net: Net, call: string, method: Method): Net {
  const existing = stationOf(net, call);
  if (existing) {
    return {
      ...net,
      stations: net.stations.map((s) => (s.call === call ? { ...s, method: s.method === "RF" ? method : s.method } : s)),
    };
  }
  return {
    ...net,
    stations: [
      ...net.stations,
      {
        call,
        method,
        authenticated: false,
        pending: true,
        zug: false,
        exempt: false,
        challenge: null,
        volunteered: null,
        qsyChannel: null,
        qsySince: null,
        agency: "",
      },
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
  if (net.zks.includes(call) || call === net.ncs) return log(net, `${call} already on the roll`, call);
  const method = stationOf(net, call)?.method ?? "RF";
  const zks = [...net.zks];
  if (method === "WL2K") zks.push(call);
  else {
    const firstWl = zks.findIndex((c) => stationOf(net, c)?.method === "WL2K");
    if (firstWl < 0) zks.push(call);
    else zks.splice(firstWl, 0, call);
  }
  return log({ ...net, zks }, `${call} added to ZKS (${reason})`, call);
}

function addTraffic(net: Net, originator: string, qty: number, prec: string, dest: string, file: string | null): Net {
  const dup = [...net.traffic].reverse().find(
    (t) => t.originator === originator && t.quantity === qty && t.precedence === prec && t.destination === dest && (file === null || t.file === file || t.file === null),
  );
  if (dup) return log(net, `${originator} repeated ZBO ${qty} ${prec} ${dest} — already listed`);
  const item: Traffic = {
    id: net.nextId,
    originator,
    quantity: qty,
    precedence: prec,
    destination: dest,
    file,
    blocks: null,
    received: [],
    refused: [],
    missingBy: {},
    zof: false,
    via: dest.includes("WL2K") ? "wl2k" : "undecided",
  };
  return log(
    { ...net, nextId: net.nextId + 1, traffic: [...net.traffic, item] },
    `${originator} listed ${qty} ${prec} for ${dest}`,
    originator,
  );
}

function trafficIndex(net: Net, file: string | null): number {
  if (file) {
    const exact = net.traffic.findIndex((t) => t.file === file);
    if (exact >= 0) return exact;
  }
  for (let i = net.traffic.length - 1; i >= 0; i--) if (net.traffic[i].zof) return i;
  return net.traffic.length ? net.traffic.length - 1 : -1;
}

function maybeComplete(net: Net, index: number): Net {
  const item = net.traffic[index];
  if (!item?.zof || net.zks.length === 0) return net;
  const answered = new Set([...item.received, ...item.refused]);
  if (!net.zks.every((c) => answered.has(c))) return net;
  return log(
    {
      ...net,
      traffic: net.traffic.filter((_, i) => i !== index),
      done: [...net.done, item],
    },
    `Completed ${item.file ?? item.destination} — Winlink follow-up for anyone with ZUG ZEV`,
  );
}

function recordZev(net: Net, call: string, file: string | null, negative: boolean, missing: number[] | null): Net {
  const real = trafficIndex(net, file);
  if (real < 0) return log(net, `${call} sent ${negative ? "ZUG ZEV" : "ZEV"} but no traffic is open`, call);
  const traffic = net.traffic.map((t, i) => {
    if (i !== real) return t;
    const received = new Set(t.received);
    const refused = new Set(t.refused);
    const missingBy = { ...t.missingBy };
    if (negative || (missing && missing.length)) {
      refused.add(call);
      received.delete(call);
      if (missing?.length) missingBy[call] = missing;
    } else {
      received.add(call);
      refused.delete(call);
      delete missingBy[call];
    }
    return { ...t, file: file ?? t.file, blocks: t.blocks, received: [...received], refused: [...refused], missingBy };
  });
  let next = log(
    { ...net, traffic },
    negative || missing?.length
      ? `${call} ${missing?.length ? `missing blocks ${missing.join(" ")}` : "ZUG ZEV"} on ${traffic[real].file ?? traffic[real].destination}`
      : `${call} ZEV — has ${traffic[real].file ?? traffic[real].destination}`,
    call,
  );
  return maybeComplete(next, real);
}

function markZof(net: Net, file: string | null, call: string | null): Net {
  const idx = trafficIndex(net, file);
  if (idx < 0) return log(net, "ZOF seen with no open traffic");
  const traffic = net.traffic.map((t, i) => (i === idx ? { ...t, zof: true, file: file ?? t.file, via: t.via === "undecided" ? "air" : t.via } : t));
  let next = log({ ...net, traffic }, `ZOF for ${file ?? traffic[idx].destination}`);
  if (call) next = { ...next, turn: call };
  return next;
}

export function pendingCalls(net: Net): string[] {
  return net.stations.filter((s) => s.pending && !net.zks.includes(s.call) && s.call !== net.ncs).map((s) => s.call);
}

export function onAir(net: Net): Station[] {
  return net.zks
    .map((c) => stationOf(net, c))
    .filter((s): s is Station => Boolean(s))
    .filter((s) => s.method !== "WL2K");
}

export function wl2kStations(net: Net): Station[] {
  return net.zks
    .map((c) => stationOf(net, c))
    .filter((s): s is Station => Boolean(s))
    .filter((s) => s.method === "WL2K");
}

export function awayStations(net: Net): Station[] {
  return net.stations.filter((s) => s.qsyChannel);
}

export function zksLine(net: Net): string {
  const parts = [
    ...onAir(net).map((s) => (s.method === "IP" ? `${s.call}/IP` : s.call)),
    ...wl2kStations(net).map((s) => `${s.call}/WL2K`),
    `${net.ncs}/NCS`,
  ];
  return parts.join(" ");
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
export function scriptZks(net: Net) {
  return `OPIN DE ${net.ncs} ZKS ${zksLine(net)}`.trim();
}
export function scriptImi(ncs: string, station: string) {
  return `${station} DE ${ncs} IMI K`;
}
export function scriptCloseOne(ncs: string, station: string) {
  return `${station} DE ${ncs} ZKJ K`;
}
export function scriptZof(ncs: string, station: string, item: Traffic) {
  const file = item.file ? ` ${item.file}` : "";
  return `${station} DE ${ncs} ZOF ${item.quantity} ${item.precedence} ${item.destination}${file} K`;
}
export function scriptQsy(ncs: string, station: string, channel: string) {
  return `${station} DE ${ncs} QSY ${channel} K`;
}
export function scriptReturn(ncs: string, station: string) {
  return `${station} DE ${ncs} QSY NET K`;
}
export function scriptChallenge(ncs: string, station: string, chal: string, znd?: string) {
  return `${station} DE ${ncs} ${znd ? `ZND ${znd} ` : ""}INT ZNB ${chal} K`;
}

function ack(ncs: string, station: string) {
  return `${station} DE ${ncs} R AS AR`;
}
function ackTraffic(ncs: string, station: string, qty: number, prec: string, dest: string) {
  return `${station} DE ${ncs} R ZBO ${qty} ${prec} ${dest} AS AR`;
}

export function operatorCheckin(ncs: string, me: string, method: Method, group: string | null): string {
  const znb = group ? ` ZNB ${group}` : "";
  if (method === "WL2K") return `${ncs} DE ${me}/WL2K ZKE${znb} K`;
  if (method === "IP") return `${ncs} DE ${me} ZKE IP${znb} K`;
  return `${ncs} DE ${me} ZKE${znb} K`;
}

export function operatorZbo(ncs: string, me: string, qty: number, prec: string, dest: string) {
  return `${ncs} DE ${me} ZBO ${qty} ${prec} ${dest} K`;
}

export function operatorZev(ncs: string, me: string, negative: boolean) {
  return `${ncs} DE ${me} ${negative ? "ZUG ZEV" : "ZEV"} AR`;
}

export function interpret(net: Net, raw: string, rows: Rows | null, ncsMode: boolean): { net: Net; suggestion: string | null } {
  const text = raw.toUpperCase().trim().replace(/\s+/g, " ");
  if (text.length < 4) return { net, suggestion: null };
  const speaker = extractSpeaker(text);
  const ncs = net.ncs;
  const isUs = speaker === ncs;
  let suggestion: string | null = null;
  const method = detectMethod(text);

  if (text.includes("ZKA") && isUs) net = { ...net, netOpen: true };
  if (text.includes("ZKJ") && isUs && text.includes("OPIN")) net = { ...net, netOpen: false };

  if (text.includes("QSY")) {
    const who = isUs ? calledStation(text) : speaker;
    const channel = channelIn(text);
    const back = /\bQSY\s+(BACK|NET)\b/.test(text);
    if (who && back) {
      net = patch(log(net, `${who} returned from QSY`, who), who, { qsyChannel: null, qsySince: null });
    } else if (who && channel) {
      net = upsert(net, who, stationOf(net, who)?.method ?? "RF");
      net = patch(log(net, `${who} sent to ${channel}`, who), who, { qsyChannel: channel, qsySince: stamp() });
      if (isUs) net = { ...net, turn: who };
    }
  }

  if (text.includes("ZOF") && !text.includes("INT")) {
    net = markZof(net, filenameOf(text), isUs ? calledStation(text) : speaker);
  }

  if (speaker && !isUs && text.split(" ").includes("IMI")) {
    net = log(net, `${speaker} sent IMI — say again`, speaker);
    if (net.lastTx) return { net, suggestion: net.lastTx };
  }

  if (!isUs && speaker) {
    if (text.includes("ZUG") && text.includes("ZNB") && !text.includes("ZEV")) {
      net = upsert(net, speaker, method);
      net = patch(net, speaker, { zug: true, exempt: true, pending: false, authenticated: false, method });
      net = addZks(net, speaker, "ZUG ZNB");
      suggestion = ncsMode ? ack(ncs, speaker) : null;
    } else if (text.includes("ZKE") && !text.includes("INT")) {
      net = upsert(log(net, `${speaker} checked in (${method})`, speaker), speaker, method);
      net = patch(net, speaker, { method });
      const group = znbGroup(text);
      if (group && group.length === 3) net = patch(net, speaker, { volunteered: group });
      let authed = false;
      if (method === "WL2K") {
        net = patch(net, speaker, { exempt: true, pending: false, method: "WL2K" });
        net = addZks(net, speaker, "Winlink check-in");
        suggestion = ncsMode ? ack(ncs, speaker) : null;
        authed = true;
      } else if (ncsMode && group && group.length === 3 && rows) {
        const expected = authenticate(rows, group[0], group[1]);
        if (expected && expected === group[2]) {
          net = patch(net, speaker, { authenticated: true, pending: false });
          net = addZks(net, speaker, "DRYAD authenticated");
          net = log(net, `${speaker} volunteered ZNB ${group} — matches`, speaker);
          authed = true;
        } else {
          const chal = challengeFrom(rows) ?? "??";
          net = patch(net, speaker, { challenge: chal });
          suggestion = scriptChallenge(ncs, speaker, chal, "2");
          net = log(net, `${speaker} volunteered ZNB ${group} — does not match. ZND 2.`, speaker);
        }
      } else if (ncsMode && rows && !stationOf(net, speaker)?.authenticated && !stationOf(net, speaker)?.exempt) {
        const chal = rows ? challengeFrom(rows) : null;
        if (chal) {
          net = patch(net, speaker, { challenge: chal });
          suggestion = scriptChallenge(ncs, speaker, chal);
          net = log(net, `Suggested INT ZNB ${chal} for ${speaker}`);
        }
      } else if (!rows && ncsMode) {
        net = log(net, `${speaker} is pending. Load a DRYAD or accept ZUG ZNB.`, speaker);
      }
      if (authed) {
        const zbo = parseZbo(text);
        suggestion = ncsMode && zbo && !text.includes("QRU") ? ackTraffic(ncs, speaker, ...zbo) : suggestion;
      }
    } else if (text.includes("ZNB") && !text.includes("INT") && !text.includes("ZUG")) {
      const group = znbGroup(text);
      const st = stationOf(net, speaker);
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
          suggestion = scriptChallenge(ncs, speaker, chal, "2");
          net = log(net, `${speaker} ZNB mismatch (got ${got || "—"}, expected ${expected || "—"})`, speaker);
        }
      }
    }

    const zbo = parseZbo(text);
    if (zbo && !text.includes("INT")) {
      net = addTraffic(net, speaker, zbo[0], zbo[1], zbo[2], filenameOf(text));
      if (!suggestion && net.zks.includes(speaker) && !text.includes("ZKE")) {
        suggestion = ncsMode ? ackTraffic(ncs, speaker, zbo[0], zbo[1], zbo[2]) : null;
      }
    }

    const file = filenameOf(text);
    const missing = missingBlocks(text);
    const blocks = blockCount(text);
    if (blocks !== null) {
      const idx = trafficIndex(net, file);
      if (idx >= 0) {
        const traffic = net.traffic.map((t, i) => (i === idx ? { ...t, blocks, file: file ?? t.file } : t));
        net = { ...net, traffic };
      }
    }
    if ((text.includes("ZEV") && !text.includes("INT")) || text.includes("CONFIRMED") || missing) {
      const negative = text.includes("ZUG") || Boolean(missing?.length);
      const confirmed = text.includes("CONFIRMED") || (text.includes("ZEV") && !text.includes("ZUG") && !missing?.length);
      if (confirmed || negative) net = recordZev(net, speaker, file, !confirmed, missing);
    }
    if (text.includes("ZKJ") && !text.includes("INT")) {
      net = log(net, `${speaker} closing down (ZKJ)`, speaker);
    }
  } else if (!speaker) {
    const file = filenameOf(text);
    if (file || text.includes("MISSING") || text.includes("CONFIRMED")) {
      net = log(net, `FLAMP note: ${text}`);
    }
  }

  return { net, suggestion };
}

export function ingest(net: Net, block: string, rows: Rows | null, ncsMode: boolean): { net: Net; suggestion: string | null } {
  let next = net;
  let suggestion: string | null = null;
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const result = interpret(next, trimmed, rows, ncsMode);
    next = result.net;
    if (result.suggestion) suggestion = result.suggestion;
  }
  if (suggestion) next = { ...next, lastTx: suggestion };
  return { net: next, suggestion };
}

export function acceptExempt(net: Net, call: string): Net {
  let next = upsert(net, call, stationOf(net, call)?.method ?? "RF");
  next = patch(next, call, { exempt: true, pending: false, zug: true });
  return addZks(next, call, "accepted without DRYAD");
}

export function addManualStation(net: Net, call: string, method: Method, exempt: boolean): Net {
  const clean = call.toUpperCase().split("/")[0].replace(/[^A-Z0-9]/g, "");
  if (!CALL.test(clean)) return log(net, `${call} is not a callsign`);
  let next = upsert(net, clean, method);
  next = patch(next, clean, { method, exempt, pending: !exempt, zug: exempt });
  if (exempt || method === "WL2K") next = addZks(next, clean, method === "WL2K" ? "Winlink" : "manual");
  else next = log(next, `${clean} added, pending authentication`, clean);
  return next;
}

export function setQsy(net: Net, call: string, channel: string | null): Net {
  const next = stationOf(net, call) ? net : upsert(net, call, "RF");
  if (!channel) return patch(log(next, `${call} back on the net`, call), call, { qsyChannel: null, qsySince: null });
  return patch(log({ ...next, turn: call }, `${call} QSY ${channel}`, call), call, { qsyChannel: channel, qsySince: stamp() });
}

export function setTurn(net: Net, call: string | null): Net {
  return log({ ...net, turn: call }, call ? `${call} has the circuit` : "Circuit clear");
}

export function addManualTraffic(net: Net, originator: string, qty: number, prec: string, dest: string, file: string): Net {
  return addTraffic(net, originator.toUpperCase(), qty, prec, dest.toUpperCase(), file.trim() ? file.trim().toUpperCase() : null);
}

export function setVia(net: Net, id: number, via: Traffic["via"]): Net {
  return {
    ...net,
    traffic: net.traffic.map((t) => (t.id === id ? { ...t, via } : t)),
  };
}

export function directTraffic(net: Net, id: number, station: string): Net {
  const item = net.traffic.find((t) => t.id === id);
  if (!item) return net;
  const traffic = net.traffic.map((t) => (t.id === id ? { ...t, zof: true, via: t.via === "undecided" ? "air" : t.via } : t));
  return log({ ...net, traffic, turn: station }, `Directed ${station} — ZOF ${item.quantity} ${item.precedence} ${item.destination}`, net.ncs);
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
    `Moved to follow-up: ${item.file ?? item.destination}`,
  );
}

export function recordManualZev(net: Net, id: number, call: string, kind: "zev" | "miss" | "partial", blocks: number[]): Net {
  const index = net.traffic.findIndex((t) => t.id === id);
  if (index < 0) return net;
  return recordZev(net, call.toUpperCase(), net.traffic[index].file, kind !== "zev", kind === "partial" ? blocks : kind === "miss" ? [] : null);
}

export function addInbox(net: Net, text: string): Net {
  const speaker = extractSpeaker(text) ?? "UNKNOWN";
  const item: InboxItem = { id: net.nextId, from: speaker, text: text.trim(), acked: false, bounce: false };
  return log({ ...net, nextId: net.nextId + 1, inbox: [item, ...net.inbox] }, `Winlink note from ${speaker}`);
}

export function ackInbox(net: Net, id: number): { net: Net; suggestion: string } {
  const item = net.inbox.find((m) => m.id === id);
  if (!item) return { net, suggestion: "" };
  let next = ingest(net, item.text.includes("ZKE") ? item.text : `${net.ncs} DE ${item.from}/WL2K ZKE K`, null, true).net;
  next = {
    ...next,
    inbox: next.inbox.map((m) => (m.id === id ? { ...m, acked: true } : m)),
  };
  const suggestion = `${item.from} checked in via Winlink. On-air roll carries ${item.from}/WL2K.`;
  return { net: log(next, suggestion), suggestion: scriptZks(next) };
}

export function setBounce(net: Net, id: number, bounce: boolean): Net {
  return {
    ...net,
    inbox: net.inbox.map((m) => (m.id === id ? { ...m, bounce } : m)),
  };
}

export function addFile(net: Net, folder: string, name: string, precedence: string, destination: string): Net {
  const file: FolderFile = {
    id: net.nextId,
    folder,
    name: name.trim(),
    precedence,
    destination: destination.toUpperCase(),
    listed: false,
  };
  return log(
    { ...net, nextId: net.nextId + 1, files: [...net.files, file] },
    `${name} placed in ${folder}`,
  );
}

export function moveFile(net: Net, id: number, folder: string): Net {
  return { ...net, files: net.files.map((f) => (f.id === id ? { ...f, folder } : f)) };
}

export function listFile(net: Net, id: number): { net: Net; suggestion: string } {
  const file = net.files.find((f) => f.id === id);
  if (!file) return { net, suggestion: "" };
  let next = addManualTraffic(net, net.myCall || net.ncs, 1, file.precedence, file.destination, file.name);
  next = { ...next, files: next.files.map((f) => (f.id === id ? { ...f, listed: true } : f)) };
  const suggestion = operatorZbo(net.ncs, net.myCall || net.ncs, 1, file.precedence, file.destination);
  return { net: { ...next, lastTx: suggestion }, suggestion };
}

export function gatewayMessage(net: Net): string {
  const lines = [
    `OPIN gateway — ${net.ncs}`,
    `Channel ${net.channel}  ${net.band}`,
    "",
    `ZKS ${zksLine(net)}`,
    "",
    "On-air traffic:",
  ];
  const all = [...net.traffic, ...net.done];
  if (!all.length) lines.push("(none listed)");
  for (const t of all) {
    lines.push(`${t.originator} ZBO ${t.quantity} ${t.precedence} ${t.destination} file=${t.file ?? "-"} via=${t.via}`);
    if (t.refused.length) lines.push(`  need Winlink: ${t.refused.join(" ")}`);
    if (t.received.length) lines.push(`  ZEV: ${t.received.join(" ")}`);
  }
  const bounced = net.inbox.filter((m) => m.bounce).map((m) => m.from);
  lines.push("", `Bounces: ${bounced.join(" ") || "none"}`, `Groups: ${GROUPS.join(" ")}`);
  return lines.join("\n");
}

export function sessionReport(net: Net): string {
  const end = new Date();
  const start = new Date(net.started);
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const lines = [
    "OPIN RF SESSION REPORT",
    `NCS: ${net.ncs}`,
    `Operator role: ${net.role}`,
    `Start: ${start.toISOString().slice(0, 16).replace("T", " ")}Z`,
    `End:   ${end.toISOString().slice(0, 16).replace("T", " ")}Z`,
    `Duration: ${minutes} minutes`,
    `Band / channel: ${net.band} ${net.channel}`,
    "",
    "ZKS:",
    zksLine(net),
    "",
    "Pending authentication:",
    pendingCalls(net).join(" ") || "(none)",
    "",
    "QSY still out:",
    awayStations(net).map((s) => `${s.call} ${s.qsyChannel} since ${s.qsySince}`).join("\n") || "(none)",
    "",
    "Traffic still open:",
  ];
  if (!net.traffic.length) lines.push("(none)");
  for (const t of net.traffic) {
    lines.push(`  ${t.originator} ZBO ${t.quantity} ${t.precedence} ${t.destination} file=${t.file ?? "-"} ZOF=${t.zof} via=${t.via}`);
    lines.push(`    ZEV: ${t.received.join(", ") || "-"}`);
    lines.push(`    ZUG ZEV / partial: ${t.refused.join(", ") || "-"}`);
    const missing = Object.entries(t.missingBy).map(([c, b]) => `${c} missing ${b.join(" ")}`);
    if (missing.length) lines.push(`    blocks: ${missing.join("; ")}`);
  }
  lines.push("", "Winlink follow-up:");
  if (!net.done.length) lines.push("(none)");
  for (const t of net.done) {
    lines.push(`  ${t.file ?? t.destination} from ${t.originator} ${t.precedence} ${t.destination}`);
    lines.push(`    received: ${t.received.join(", ") || "none"}`);
    lines.push(`    need Winlink: ${t.refused.join(", ") || "none"}`);
  }
  return lines.join("\n");
}

export function sessionK2s(net: Net): string {
  const report = sessionReport(net).replace(/\n/g, "\n");
  return [
    "<flmsg>",
    ":hdr_fm:21",
    ":hdr_ed:21",
    "<customform>",
    "OPIN_SESSION",
    `:from:${net.ncs}`,
    ":to:OPIN",
    ":subj:OPIN RF session report",
    `:dtg:${new Date().toISOString().slice(0, 16).replace("T", " ")}Z`,
    `:zks:${zksLine(net)}`,
    `:band:${net.band} ${net.channel}`,
    `:report:${report}`,
  ].join("\n");
}

export function myPlace(net: Net): number {
  const me = net.myCall.toUpperCase();
  const order = zksLine(net).split(" ").map((p) => p.split("/")[0]);
  return order.indexOf(me) + 1;
}

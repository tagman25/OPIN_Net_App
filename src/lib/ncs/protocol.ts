import { authenticate, challengeFrom, tripletValid, volunteerTriplet, type Rows } from "./dryad";

export type Role = "ncs" | "wl2k" | "ip" | "operator";
export type Method = "RF" | "WL2K" | "IP";
/** Whether the station that sent ZKA proved it with today's DRYAD. */
export type NcsProof = "unknown" | "good" | "bad" | "none" | "other";

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
  /** Left the frequency (ZKJ) or has equipment trouble (ZCJ). Remaining files go by Winlink. */
  relay: boolean;
  /** Asked INT ZKJ and is waiting for net control to allow it. */
  closeAsk: boolean;
  /** Stations that were ahead of this one on the roll when ZCJ took them off. */
  zksAhead: string[] | null;
};

export type Piece = {
  quantity: number;
  precedence: string;
  destinations: string[];
  /** Stations who have ZEV'd this piece. */
  zev?: string[];
};

export type OutboundItem = Piece & { sender: string };

export type Traffic = {
  id: number;
  originator: string;
  pieces: Piece[];
};

export type Offer = {
  id: number;
  from: string;
  pieces: Piece[];
};

export type FileReport = {
  status: "have" | "miss" | "none";
  missing: number[];
  preamble: boolean;
};

export type Transfer = {
  id: number;
  hash: string;
  file: string;
  originator: string | null;
  blocks: number | null;
  /** Set once, when this file takes one message off the sender's ZBO list. */
  counted: boolean;
  /** Precedence and destinations of the message this file took, such as R US. */
  listing: string | null;
  reports: Record<string, FileReport>;
  /** Stations moved by hand onto the Winlink send line for this file. */
  viaWl2k: string[];
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

export type QsyJob = {
  id: number;
  /** Station that has the traffic. */
  from: string;
  /** IP station they are sent to work with. */
  with: string;
  channel: string;
  quantity: number;
  name: string;
  fromAck: boolean;
  withAck: boolean;
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
  /** Listings this desk still wants to send. Not on the net until NCS acknowledges. */
  outbound: OutboundItem[];
  /** Heard ZBO that net control has not acknowledged. */
  offers: Offer[];
  traffic: Traffic[];
  done: Traffic[];
  /** Files actually on the air, keyed by the FLAMP hash. */
  transfers: Transfer[];
  log: LogLine[];
  lastTx: string;
  nextId: number;
  inbox: InboxItem[];
  files: FolderFile[];
  /** Off-frequency passes waiting on a roger from both stations. */
  qsos: QsyJob[];
  started: string;
  ncsProof: NcsProof;
  ncsProofNote: string;
  ncsTriplet: string | null;
  ncsTripletOk: boolean | null;
  /** Stations the gateway operator will check in after its own ZKE, as CALL/WL2K. */
  gateway: string[];
};

export const CHANNELS = [
  "60C4", "60C5", "60C1", "60C2",
  "80F1", "80F2", "80F3", "80F4", "80F5", "80F6", "80F7", "80F8",
  "40F1", "40F2", "40F3", "40F4", "40F5", "40F6", "40F7", "40F8",
  "75P", "75S", "75T", "40P", "40S", "40T",
];

/** 80F3 is 80 meters, 40P is 40 meters. */
export function bandForChannel(channel: string): string {
  const meters = channel.toUpperCase().match(/^(\d+)/)?.[1];
  return meters ? `${meters}m` : "";
}

/** The whole net changed frequency. Stations sent off on their own QSY stay where they are. */
export function moveNetChannel(net: Net, channel: string, source = "SYSTEM"): Net {
  const next = channel.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!next || next === net.channel) return net;
  const band = bandForChannel(next) || net.band;
  return log(
    { ...net, channel: next, band },
    `Net moved from ${net.channel} ${net.band} to ${next} ${band}`,
    source,
  );
}

export const GROUPS = ["OPIN", "US", "OH", "OHCE", "ALL"];
export const FOLDERS = ["Incoming", "Ready", "Sent", "Archive"];
export const PRECEDENCE = ["Z", "O", "P", "R"] as const;

const CALL = /^[A-Z]{1,2}\d[A-Z]{1,4}$/;
const STOP = new Set([
  "K", "AR", "AS", "QRU", "ZNB", "ZKE", "ZUG", "ZEV", "ZOF", "ZOK", "ZKA", "ZKB",
  "ZKJ", "ZKS", "ZGO", "INT", "IMI", "QSY", "R", "IP", "WL2K", "BACK",
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
    outbound: [],
    offers: [],
    traffic: [],
    done: [],
    transfers: [],
    log: [],
    lastTx: "",
    nextId: 1,
    inbox: [],
    files: [],
    qsos: [],
    started: new Date().toISOString(),
    ncsProof: "unknown",
    ncsProofNote: "",
    ncsTriplet: null,
    ncsTripletOk: null,
    gateway: [],
  };
}

function asPieces(item: Partial<Traffic> & { quantity?: number; precedence?: string; destination?: string }): Traffic {
  if (item.pieces?.length) {
    return {
      id: item.id ?? 0,
      originator: item.originator ?? "",
      pieces: item.pieces.map((p) => ({ ...p, destinations: p.destinations ?? [], zev: p.zev ?? [] })),
    };
  }
  if (item.quantity) {
    return {
      id: item.id ?? 0,
      originator: item.originator ?? "",
      pieces: [{ quantity: item.quantity, precedence: item.precedence ?? "R", destinations: [item.destination ?? "OPIN"] }],
    };
  }
  return { id: item.id ?? 0, originator: item.originator ?? "", pieces: [] };
}

/** Old sessions stored one destination and a file name on each ZBO. Fold those into pieces. */
export function normalizeNet(raw: Partial<Net> | null | undefined): Net {
  const base = { ...emptyNet(), ...(raw ?? {}) };
  base.outbound = Array.isArray(raw?.outbound)
    ? raw.outbound.map((item) => ({
        sender: item.sender || "",
        quantity: item.quantity,
        precedence: item.precedence,
        destinations: item.destinations ?? [],
      }))
    : [];
  base.offers = Array.isArray(raw?.offers) ? raw.offers : [];
  base.transfers = Array.isArray(raw?.transfers)
    ? raw.transfers.map((item) => ({ ...item, counted: item.counted ?? true, listing: item.listing ?? null, reports: item.reports ?? {}, viaWl2k: item.viaWl2k ?? [] }))
    : [];
  base.traffic = Array.isArray(raw?.traffic) ? raw.traffic.map((item) => asPieces(item)) : [];
  base.done = Array.isArray(raw?.done) ? raw.done.map((item) => asPieces(item as Partial<Traffic> & { quantity?: number })) : [];
  base.qsos = Array.isArray(raw?.qsos) ? raw.qsos : [];
  base.stations = (base.stations ?? []).map((s) => ({ ...s, relay: s.relay ?? false, closeAsk: s.closeAsk ?? false, zksAhead: s.zksAhead ?? null }));
  base.gateway = Array.isArray(raw?.gateway)
    ? raw.gateway.map((call) => call.toUpperCase().split("/")[0].replace(/[^A-Z0-9]/g, "")).filter((call) => CALL.test(call))
    : [];
  return base;
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

function addressedToNet(text: string): boolean {
  if (!text.includes(" DE ")) return false;
  const head = text.split(" DE ")[0];
  return /\b(OPIN|ALL|NET)\b/.test(head) && calledStations(text).length === 0;
}

function calledStation(line: string): string | null {
  return calledStations(line).at(-1) ?? null;
}

function calledStations(line: string): string[] {
  const text = line.toUpperCase().trim().replace(/\s+/g, " ");
  if (!text.includes(" DE ")) return [];
  return text
    .split(" DE ")[0]
    .trim()
    .split(" ")
    .map((token) => token.split("/")[0].replace(/[.,:;<>]/g, ""))
    .filter((token) => CALL.test(token));
}

function znbGroup(line: string): string | null {
  const tokens = line.split(" ");
  const i = tokens.indexOf("ZNB");
  if (i < 0 || i + 1 >= tokens.length) return null;
  const cand = tokens[i + 1].replace(/[.,]/g, "");
  if (/^[A-Z]$/.test(cand) || /^[A-Z]{3}$/.test(cand)) return cand;
  return null;
}

const PREC = new Set(["R", "P", "O", "Z", "Y", "M", "C"]);

function cleanToken(token: string): string {
  return token.replace(/[.,<>]/g, "");
}

/** FLAMP hash is the 4 hex digits in {HASH}. Data blocks use {HASH:n} and are not the file id. */
function hashOf(line: string): string | null {
  const m = line.match(/\{([0-9A-F]{4})\}/);
  return m ? m[1] : null;
}

function filenameOf(line: string): string | null {
  const amp = line.match(/\{[0-9A-F]{4}\}(?:\d{14}:)?([A-Z0-9_.-]+\.[A-Z0-9]+)/);
  if (amp) return amp[1];
  if (line.includes("FILE :")) {
    const name = line.split("FILE :")[1]?.trim().split(/\s+/)[0]?.replace(/[<>]/g, "");
    if (name && !/^\d+$/.test(name)) return name;
  }
  if (line.includes("FILE:")) {
    const name = line.split("FILE:")[1]?.trim().split(/\s+/)[0]?.replace(/[<>]/g, "");
    if (name && !/^\d+$/.test(name) && !name.startsWith("<")) return name;
  }
  for (const token of line.replace(/[<>{}]/g, " ").split(" ")) {
    if (/\.(TXT|K2S|CSV|HTML|PDF)$/.test(token)) return token;
  }
  return null;
}

function idCall(line: string): string | null {
  if (!line.includes("<ID")) return null;
  const m = line.match(/\{[0-9A-F]{4}\}([A-Z0-9]+)/);
  if (!m || !CALL.test(m[1])) return null;
  return m[1];
}

function sizeBlocks(line: string): number | null {
  const amp = line.match(/<SIZE\b[^>]*>\{[0-9A-F]{4}\}(\d+)\s+(\d+)/);
  if (amp) return Number(amp[2]);
  const n = line.match(/\b(?:NBLK|BLKS|BLOCKS)\s*:?\s*(\d+)/);
  return n ? Number(n[1]) : null;
}

export function pieceText(pieces: Piece[]): string {
  return pieces.map((p) => `${p.quantity} ${p.precedence} ${p.destinations.join(" ")}`).join(" ");
}

/** One ZBO can carry several qty / precedence / destination groups. AND is only a separator. */
export function parseZboPieces(line: string): Piece[] | null {
  const tokens = line.replace("ZBO1", "ZBO 1").split(" ").filter(Boolean);
  const start = tokens.indexOf("ZBO");
  if (start < 0) return null;
  const pieces: Piece[] = [];
  let i = start + 1;
  while (i < tokens.length) {
    const token = cleanToken(tokens[i]);
    if (!token || token === "AND" || token === "ZBO") {
      i++;
      continue;
    }
    if (STOP.has(token) || token.startsWith("<")) break;
    if (!/^\d+$/.test(token)) break;
    const quantity = Number(token);
    i++;
    let precedence = "R";
    const prec = cleanToken(tokens[i] ?? "");
    if (prec && PREC.has(prec)) {
      precedence = prec;
      i++;
    }
    const destinations: string[] = [];
    while (i < tokens.length) {
      const dest = cleanToken(tokens[i]);
      if (!dest || dest === "AND" || dest === "ZBO") break;
      if (/^\d+$/.test(dest) || STOP.has(dest) || dest.startsWith("<")) break;
      destinations.push(dest);
      i++;
    }
    pieces.push({ quantity, precedence, destinations: destinations.length ? destinations : ["OPIN"] });
  }
  return pieces.length ? pieces : null;
}

function hasRoger(text: string): boolean {
  const tokens = text.split(" ");
  const zbo = tokens.indexOf("ZBO");
  const head = zbo < 0 ? tokens : tokens.slice(0, zbo);
  return head.some((token, i) => token === "R" && (i === 0 || !/^\d+$/.test(head[i - 1])));
}

function flampReport(line: string): FileReport & { hash: string | null } | null {
  const amp = line.match(/<MISSING\b[^>]*>\{([0-9A-F]{4})\}(.*)$/);
  if (amp) {
    const data = amp[2].trim();
    if (data.includes("CONFIRMED")) return { hash: amp[1], status: "have", missing: [], preamble: false };
    if (data.includes("PREAMBLE")) return { hash: amp[1], status: "miss", missing: [], preamble: true };
    const missing = data.split(/[^0-9]+/).filter(Boolean).map(Number);
    return { hash: amp[1], status: missing.length ? "miss" : "none", missing, preamble: false };
  }
  if (/\bZEV\b/.test(line) && !line.includes("INT") && !line.includes("ZKE")) {
    return { hash: hashOf(line), status: line.includes("ZUG") ? "none" : "have", missing: [], preamble: false };
  }
  if (line.includes("CONFIRMED")) return { hash: hashOf(line), status: "have", missing: [], preamble: false };
  const plain = line.match(/MISSING(?:\s+BLOCKS)?\s*:\s*([0-9][0-9,\s]*)/);
  if (plain && !line.includes("<MISSING")) {
    const missing = plain[1].split(/[^0-9]+/).filter(Boolean).map(Number);
    return { hash: hashOf(line), status: "miss", missing, preamble: false };
  }
  return null;
}

function detectMethod(text: string): Method {
  if (text.includes("/WL2K") || /\bWL2K\b/.test(text)) return "WL2K";
  if (/\bZKE\b/.test(text) && /\bIP\b/.test(text)) return "IP";
  return "RF";
}

/** `ZKE ZNB ABC WL2K ZKE CALL/WL2K ...` is the gateway operator, then the Winlink stations. */
function gatewayList(text: string): string[] | null {
  const tokens = text.split(" ");
  const first = tokens.indexOf("ZKE");
  if (first < 0) return null;
  const mark = tokens.indexOf("WL2K", first + 1);
  if (mark < 0 || tokens[mark + 1] !== "ZKE") return null;
  const calls: string[] = [];
  for (let i = mark + 2; i < tokens.length; i++) {
    const token = tokens[i].replace(/[.,]/g, "");
    if (token === "QRU" || token === "K" || token === "AR" || token === "AS") break;
    const [call, suffix] = token.split("/");
    if (suffix !== "WL2K" || !CALL.test(call)) break;
    if (!calls.includes(call)) calls.push(call);
  }
  return calls;
}

function qsyRoger(text: string): boolean {
  const tokens = text.split(" ");
  const at = tokens.indexOf("QSY");
  if (at < 0) return false;
  return tokens.slice(0, at).includes("R");
}

function zofOrder(text: string): { quantity: number; name: string } | null {
  const tokens = text.split(" ");
  const at = tokens.indexOf("ZOF");
  if (at < 0) return null;
  let i = at + 1;
  let quantity = 1;
  if (/^\d+$/.test(tokens[i] ?? "")) {
    quantity = Number(tokens[i]);
    i += 1;
  }
  const name = (tokens[i] ?? "").replace(/[^A-Z0-9_.-]/g, "");
  if (!name || STOP.has(name)) return null;
  return { quantity, name };
}

function channelIn(text: string): string | null {
  const tokens = text.split(" ");
  const i = tokens.indexOf("QSY");
  if (i < 0) return null;
  const next = tokens[i + 1];
  if (!next || next === "BACK" || next === "NET") return null;
  return next.replace(/[^A-Z0-9]/g, "");
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
        relay: false,
        closeAsk: false,
        zksAhead: null,
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

function noteRelay(net: Net, call: string, why: "ZKJ" | "ZCJ"): Net {
  if (!net.netOpen || !call || call === net.ncs) return net;
  if (stationOf(net, call)?.relay) {
    return stationOf(net, call)?.closeAsk ? patch(net, call, { closeAsk: false }) : net;
  }
  let next = upsert(net, call, stationOf(net, call)?.method ?? "RF");
  const at = next.zks.indexOf(call);
  const saved = why === "ZCJ" ? (at >= 0 ? next.zks.slice(0, at) : stationOf(next, call)?.zksAhead ?? null) : stationOf(next, call)?.zksAhead ?? null;
  next = patch(next, call, { relay: true, pending: false, closeAsk: false, zksAhead: saved });
  if (why === "ZCJ" && at >= 0) next = { ...next, zks: next.zks.filter((c) => c !== call) };
  const note = why === "ZCJ" ? `${call} ZCJ — off the roll, remaining files ZOF ZOK WL2K` : `${call} ${why} — remaining files ZOF ZOK WL2K`;
  return log(next, note, call);
}

/** ZUG ZCJ: equipment is back. Return the station to the roll slot they left. */
function restoreRelay(net: Net, call: string): Net {
  if (!call || call === net.ncs) return net;
  const st = stationOf(net, call);
  let next = st ? patch(net, call, { relay: false, zksAhead: null }) : upsert(net, call, "RF");
  if (!st) next = patch(next, call, { relay: false, pending: false });
  if (next.zks.includes(call)) return log(next, `${call} ZUG ZCJ — back on the roll`, call);
  const ahead = st?.zksAhead;
  if (!ahead) return addZks(next, call, "ZUG ZCJ");
  let at = 0;
  for (const prev of ahead) {
    const i = next.zks.indexOf(prev);
    if (i >= 0) at = i + 1;
  }
  const zks = [...next.zks];
  zks.splice(at, 0, call);
  return log({ ...next, zks }, `${call} ZUG ZCJ — back on the roll`, call);
}

function closeRoger(text: string): boolean {
  if (/\b(ZBO|ZEV|ZNB|ZOF|QSY|ZKE|ZKS|IMI|ZKA|ZCJ)\b/.test(text)) return false;
  return text.split(" ").includes("R");
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

/** NCS slides a station to another station's place. On-air stays ahead of Winlink. */
export function reorderZks(net: Net, call: string, before: string): Net {
  if (!call || call === before || call === net.ncs || before === net.ncs) return net;
  const moving = stationOf(net, call);
  const target = stationOf(net, before);
  if (!moving || !target || !net.zks.includes(call) || !net.zks.includes(before)) return net;
  if ((moving.method === "WL2K") !== (target.method === "WL2K")) return net;
  const air = onAir(net).map((s) => s.call);
  const wl = wl2kStations(net).map((s) => s.call);
  const list = moving.method === "WL2K" ? wl : air;
  const from = list.indexOf(call);
  const to = list.indexOf(before);
  if (from < 0 || to < 0) return net;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (!item) return net;
  next.splice(to, 0, item);
  const zks = moving.method === "WL2K" ? [...air, ...next] : [...next, ...wl];
  if (zks.join(" ") === net.zks.join(" ")) return net;
  return { ...net, zks };
}

function parseZksRoll(text: string): { call: string; method: Method }[] | null {
  const tokens = text.split(" ");
  const at = tokens.indexOf("ZKS");
  if (at < 0 || tokens.includes("INT")) return null;
  const list: { call: string; method: Method }[] = [];
  for (let i = at + 1; i < tokens.length; i++) {
    let token = tokens[i].replace(/[.,:;]/g, "");
    if (!token || token === "K" || token === "AR" || token === "AS") break;
    let suffix = "";
    if (token.includes("/")) {
      const parts = token.split("/");
      token = parts[0];
      suffix = parts[1] ?? "";
    } else if (tokens[i + 1] === "IP" || tokens[i + 1] === "WL2K" || tokens[i + 1] === "NCS") {
      suffix = tokens[i + 1];
      i += 1;
    }
    const call = token.replace(/[^A-Z0-9]/g, "");
    if (!CALL.test(call)) break;
    if (suffix === "NCS") continue;
    const method: Method = suffix === "WL2K" ? "WL2K" : suffix === "IP" ? "IP" : "RF";
    if (!list.some((entry) => entry.call === call)) list.push({ call, method });
  }
  return list;
}

function zksSignature(entries: { call: string; method: Method }[]): string {
  const air = entries.filter((e) => e.method !== "WL2K").map((e) => (e.method === "IP" ? `${e.call}/IP` : e.call));
  const wl = entries.filter((e) => e.method === "WL2K").map((e) => `${e.call}/WL2K`);
  return [...air, ...wl].join(" ");
}

/** Non-NCS desks take a ZKS from net control as the whole roll. An identical list is ignored. */
function adoptZks(net: Net, text: string): Net {
  const list = parseZksRoll(text);
  if (!list) return net;
  const current = net.zks.map((call) => ({ call, method: stationOf(net, call)?.method ?? "RF" as Method }));
  if (zksSignature(current) === zksSignature(list)) return net;
  const ordered = [...list.filter((e) => e.method !== "WL2K"), ...list.filter((e) => e.method === "WL2K")];
  let next = net;
  for (const entry of ordered) {
    next = upsert(next, entry.call, entry.method);
    const prev = stationOf(next, entry.call);
    next = patch(next, entry.call, {
      method: entry.method,
      pending: false,
      exempt: entry.method === "WL2K" ? true : prev?.exempt ?? false,
    });
  }
  return log(
    { ...next, zks: ordered.map((e) => e.call) },
    `ZKS set from net control: ${zksSignature(ordered) || "(empty)"}`,
    net.ncs || "NCS",
  );
}

function acknowledge(net: Net, from: string, pieces: Piece[]): Net {
  const existing = net.traffic.find((t) => t.originator === from);
  const traffic = existing
    ? net.traffic.map((t) => (t.originator === from ? { ...t, pieces } : t))
    : [...net.traffic, { id: net.nextId, originator: from, pieces }];
  return log(
    {
      ...net,
      nextId: existing ? net.nextId : net.nextId + 1,
      offers: net.offers.filter((o) => o.from !== from),
      traffic,
    },
    `${from} on the ZBO list — ${pieceText(pieces)}`,
    from,
  );
}

function upsertOffer(net: Net, from: string, pieces: Piece[]): Net {
  const existing = net.offers.find((o) => o.from === from);
  const offers = existing
    ? net.offers.map((o) => (o.from === from ? { ...o, pieces } : o))
    : [...net.offers, { id: net.nextId, from, pieces }];
  return log(
    { ...net, nextId: existing ? net.nextId : net.nextId + 1, offers },
    `${from} offered ${pieceText(pieces)} — not listed until NCS acknowledges`,
    from,
  );
}

function consumeOne(net: Net, sender: string, index: number): Net {
  const transfer = net.transfers[index];
  if (!transfer || transfer.counted) return net;
  const mark = (traffic: Traffic[], listing: string | null) => ({
    ...net,
    traffic,
    transfers: net.transfers.map((t, i) => (i === index ? { ...t, counted: true, originator: t.originator ?? sender, listing: listing ?? t.listing } : t)),
  });
  const row = net.traffic.find((t) => t.originator === sender);
  if (!row) return mark(net.traffic, null);
  const tokens = new Set((transfer.file || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  let pieceAt = row.pieces.findIndex((p) => p.quantity > 0 && p.destinations.some((d) => tokens.has(d)));
  if (pieceAt < 0) pieceAt = row.pieces.findIndex((p) => p.quantity > 0);
  if (pieceAt < 0) return mark(net.traffic, null);
  const piece = row.pieces[pieceAt];
  const listing = `${piece.precedence} ${piece.destinations.join(" ")}`;
  const pieces = row.pieces
    .map((p, i) => (i === pieceAt ? { ...p, quantity: p.quantity - 1 } : p))
    .filter((p) => p.quantity > 0);
  const traffic = pieces.length
    ? net.traffic.map((t) => (t.originator === sender ? { ...t, pieces } : t))
    : net.traffic.filter((t) => t.originator !== sender);
  const note = pieces.length
    ? `${sender} sent one ${listing}. ZBO now ${pieceText(pieces)}`
    : `${sender} ${listing} moved off the ZBO list`;
  return log(mark(traffic, listing), note, sender);
}

function openFile(net: Net, hash: string, file: string | null, originator: string | null, blocks: number | null): Net {
  const existing = net.transfers.findIndex((t) => (hash && t.hash === hash) || (!hash && file && t.file === file));
  if (existing < 0) {
    const item: Transfer = {
      id: net.nextId,
      hash,
      file: file ?? "Unassigned",
      originator,
      blocks,
      counted: false,
      listing: null,
      reports: {},
      viaWl2k: [],
    };
    let next = log(
      { ...net, nextId: net.nextId + 1, transfers: [...net.transfers, item] },
      `File ${item.file}${hash ? ` {${hash}}` : ""} on the air${originator ? ` from ${originator}` : ""}`,
    );
    if (originator) next = consumeOne(next, originator, next.transfers.length - 1);
    return next;
  }
  let next: Net = {
    ...net,
    transfers: net.transfers.map((t, i) => i === existing ? {
      ...t,
      hash: t.hash || hash,
      file: file && (t.file === "Unassigned" || !t.file) ? file : t.file,
      originator: t.originator ?? originator,
      blocks: blocks ?? t.blocks,
    } : t),
  };
  const sender = next.transfers[existing].originator;
  if (sender && !next.transfers[existing].counted) next = consumeOne(next, sender, existing);
  return next;
}

function recordReport(net: Net, call: string, hash: string | null, file: string | null, report: FileReport): Net {
  let idx = hash ? net.transfers.findIndex((t) => t.hash === hash) : -1;
  if (idx < 0 && file) idx = net.transfers.findIndex((t) => t.file === file);
  if (idx < 0 && net.transfers.length === 1) idx = 0;
  if (idx < 0) {
    if (!hash && !file) return log(net, `${call} reported a file but none is on the air`, call);
    net = openFile(net, hash ?? "", file, null, null);
    idx = net.transfers.length - 1;
  }
  const transfers = net.transfers.map((t, i) => i === idx ? { ...t, reports: { ...t.reports, [call]: report } } : t);
  const item = transfers[idx];
  const note = report.status === "have"
    ? "ZEV"
    : report.preamble
      ? "missing preamble"
      : report.status === "none"
        ? "ZUG ZEV"
        : `missing ${report.missing.join(" ")}`;
  return log({ ...net, transfers }, `${call} ${note} on ${item.file}${item.hash ? ` {${item.hash}}` : ""}`, call);
}

type Cursor = { speaker: string | null; file: string | null; hash: string | null };

function applyTraffic(net: Net, text: string, cursor: Cursor, ncsMode: boolean): { net: Net; suggestion: string | null } {
  let suggestion: string | null = null;
  const speaker = extractSpeaker(text);
  if (speaker) cursor.speaker = speaker;
  const file = filenameOf(text);
  if (file) cursor.file = file;
  const hash = hashOf(text);
  if (hash) cursor.hash = hash;
  const sender = idCall(text);
  const blocks = sizeBlocks(text);
  const who = speaker ?? cursor.speaker;

  if (text.includes("<FILE") || text.includes("<ID") || text.includes("<SIZE")) {
    const h = hash ?? cursor.hash;
    if (h) {
      const from = text.includes("<FILE") ? (sender ?? cursor.speaker) : sender;
      net = openFile(net, h, file ?? cursor.file, from, blocks);
    }
  }

  const pieces = parseZboPieces(text);
  if (pieces && !text.includes("INT")) {
    const isUs = who === net.ncs;
    const called = calledStation(text);
    if (isUs && called && hasRoger(text)) net = acknowledge(net, called, pieces);
    else if (isUs) net = acknowledge(net, net.ncs, pieces);
    else if (who) {
      net = upsertOffer(net, who, pieces);
      if (ncsMode && !text.includes("ZKE")) suggestion = scriptAckZbo(net.ncs, who, pieces);
    }
  }

  if (!text.includes("INT") && !text.includes("ZKE")) {
    const report = flampReport(text);
    if (report && who) {
      const { hash: reportHash, ...body } = report;
      net = recordReport(net, who, reportHash ?? cursor.hash, file ?? cursor.file, body);
    }
  }
  return { net, suggestion };
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

export function transferRoster(net: Net, item: Transfer): { call: string; report: FileReport | null }[] {
  const calls = net.zks.filter((c) => c !== item.originator);
  if (net.ncs && net.ncs !== item.originator && !calls.includes(net.ncs)) calls.push(net.ncs);
  for (const call of Object.keys(item.reports)) {
    if (call !== item.originator && !calls.includes(call)) calls.push(call);
  }
  for (const call of item.viaWl2k ?? []) {
    if (call !== item.originator && !calls.includes(call)) calls.push(call);
  }
  return calls.map((call) => ({ call, report: item.reports[call] ?? null }));
}

/** Calls who get this file by Winlink: /WL2K check-ins, stations who ZKJ or ZCJ, plus anyone moved there by hand. */
export function fileViaWl2k(net: Net, item: Transfer): string[] {
  const auto = net.zks.filter((call) => call !== item.originator && stationOf(net, call)?.method === "WL2K");
  const relay = net.stations
    .filter((s) => s.relay && s.call !== item.originator && !auto.includes(s.call) && item.reports[s.call]?.status !== "have")
    .map((s) => s.call);
  const manual = (item.viaWl2k ?? []).filter((call) => call !== item.originator && !auto.includes(call) && !relay.includes(call));
  return [...auto, ...relay, ...manual];
}

export function sendViaWl2k(net: Net, id: number, call: string): Net {
  const clean = call.toUpperCase();
  const item = net.transfers.find((t) => t.id === id);
  if (!item || item.originator === clean) return net;
  if (stationOf(net, clean)?.method === "WL2K") return net;
  if ((item.viaWl2k ?? []).includes(clean)) return net;
  return log(
    {
      ...net,
      transfers: net.transfers.map((t) => (t.id === id ? { ...t, viaWl2k: [...(t.viaWl2k ?? []), clean] } : t)),
    },
    `${clean} moved to ZOF ZOK WL2K for ${item.file}`,
    clean,
  );
}

export function recallFromWl2k(net: Net, id: number, call: string): Net {
  return {
    ...net,
    transfers: net.transfers.map((t) => (t.id === id ? { ...t, viaWl2k: (t.viaWl2k ?? []).filter((c) => c !== call) } : t)),
  };
}

/** Manual ZEV for one ZBO piece. Click again to clear it. */
export function markPieceZev(net: Net, trafficId: number, pieceIndex: number, call: string): Net {
  const clean = call.toUpperCase().split("/")[0];
  if (!CALL.test(clean)) return net;
  let note = "";
  const traffic = net.traffic.map((item) => {
    if (item.id !== trafficId) return item;
    const pieces = item.pieces.map((piece, index) => {
      if (index !== pieceIndex) return piece;
      const zev = piece.zev ?? [];
      const on = zev.includes(clean);
      note = on
        ? `${clean} ZEV cleared on ${piece.quantity} ${piece.precedence} ${piece.destinations.join(" ")}`
        : `${clean} ZEV ${item.originator} ${piece.quantity} ${piece.precedence} ${piece.destinations.join(" ")}`;
      return { ...piece, zev: on ? zev.filter((c) => c !== clean) : [...zev, clean] };
    });
    return { ...item, pieces };
  });
  if (!note) return net;
  return log({ ...net, traffic }, note, clean);
}

/** Manual ZEV for one station on one file. Click again to clear it. */
export function markFileZev(net: Net, id: number, call: string): Net {
  const clean = call.toUpperCase().split("/")[0];
  const item = net.transfers.find((t) => t.id === id);
  if (!item || !CALL.test(clean) || clean === item.originator) return net;
  const have = item.reports[clean]?.status === "have";
  const reports = { ...item.reports };
  if (have) delete reports[clean];
  else reports[clean] = { status: "have", missing: [], preamble: false };
  return log(
    { ...net, transfers: net.transfers.map((t) => (t.id === id ? { ...t, reports } : t)) },
    have ? `${clean} ZEV cleared on ${item.file}` : `${clean} ZEV on ${item.file}`,
    clean,
  );
}

/** Put a station on the roll without a matching ZNB. */
export function forceOnRoll(net: Net, call: string): Net {
  const clean = call.toUpperCase().split("/")[0].replace(/[^A-Z0-9]/g, "");
  if (!CALL.test(clean) || clean === net.ncs || net.zks.includes(clean)) return net;
  let next = upsert(net, clean, stationOf(net, clean)?.method ?? "RF");
  next = patch(next, clean, { pending: false });
  return addZks(next, clean, "manual, ZNB not required");
}

export function scriptOpen(ncs: string, rows: Rows | null): string | null {
  if (!rows) return null;
  const group = volunteerTriplet(rows);
  if (!group) return null;
  return `OPIN DE ${ncs} ZKA ZNB ${group} ZKB AS`;
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
export function scriptDrop(ncs: string, me: string, asNcs: boolean) {
  return asNcs ? `OPIN DE ${ncs} ZKJ K` : `${ncs} DE ${me} ZKJ K`;
}
/** ZCJ: this station is having equipment trouble. */
export function scriptEquipment(ncs: string, me: string, asNcs: boolean) {
  return asNcs ? `OPIN DE ${ncs} ZCJ K` : `${ncs} DE ${me} ZCJ K`;
}
export function scriptOffer(ncs: string, me: string, pieces: Piece[]): string {
  return `${ncs} DE ${me} ZBO ${pieceText(pieces)} K`;
}
export function scriptAckZbo(ncs: string, station: string, pieces: Piece[]): string {
  return `${station} DE ${ncs} R ZBO ${pieceText(pieces)} AS AR`;
}
export function scriptIntZev(ncs: string, station: string, hash: string): string {
  return `${station} DE ${ncs} INT ZEV ${hash} K`;
}
export function scriptZof(ncs: string, station: string, item: Traffic) {
  return `${station} DE ${ncs} ZOF ${pieceText(item.pieces)} K`;
}
export function scriptQsyZof(ncs: string, from: string, partner: string, channel: string, quantity: number, name: string) {
  const title = name.toUpperCase().replace(/[^A-Z0-9_.-]/g, "");
  return `${from} ${partner} DE ${ncs} QSY ${channel} ZOF ${quantity || 1} ${title}`;
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
/** Order this station to take control of the net. */
export function scriptZkd(ncs: string, station: string) {
  return `${station} DE ${ncs} ZKD K`;
}

/** On-air station this call follows. Null when they are first, or the roll has nobody else yet. */
export function followsCall(net: Net, call: string): string | null {
  const air = onAir(net).map((s) => s.call);
  const idx = air.indexOf(call);
  if (idx > 0) return air[idx - 1];
  if (idx === 0) return null;
  const last = [...air].reverse().find((c) => c !== call);
  return last ?? null;
}

export function scriptJoinAck(net: Net, station: string): string {
  const before = followsCall(net, station);
  if (!before) return `${station} DE ${net.ncs} R`;
  return `${station} DE ${net.ncs} R ZGO ${before}`;
}

export function requestAuth(net: Net, call: string, chal: string): Net {
  let next = stationOf(net, call) ? net : upsert(net, call, stationOf(net, call)?.method ?? "RF");
  const onRoll = next.zks.includes(call);
  next = patch(next, call, { challenge: chal, pending: onRoll ? false : true });
  return log(
    next,
    onRoll ? `${call} stays in place. INT ZNB ${chal}` : `INT ZNB ${chal} for ${call}`,
    next.ncs,
  );
}

function ack(ncs: string, station: string) {
  return `${station} DE ${ncs} R AS AR`;
}
export function operatorZbo(ncs: string, me: string, qty: number, prec: string, dest: string) {
  return scriptOffer(ncs, me, [{ quantity: qty, precedence: prec, destinations: [dest] }]);
}
export function operatorCheckin(ncs: string, me: string, method: Method, group: string | null): string {
  const znb = group ? ` ZNB ${group}` : "";
  if (method === "WL2K") return `${ncs} DE ${me}/WL2K ZKE${znb} K`;
  if (method === "IP") return `${ncs} DE ${me} ZKE IP${znb} K`;
  return `${ncs} DE ${me} ZKE${znb} K`;
}

/** Own check-in, then WL2K ZKE and each CALL/WL2K, then QRU. */
export function scriptGatewayCheckin(ncs: string, me: string, group: string | null, calls: string[]): string {
  const own = operatorCheckin(ncs, me, "RF", group).replace(/ K$/, "");
  const mine = me.toUpperCase().split("/")[0];
  const list = [...new Set(calls.map((call) => call.toUpperCase().split("/")[0]).filter((call) => CALL.test(call) && call !== mine))];
  if (!list.length) return `${own} K`;
  return `${own} WL2K ZKE ${list.map((call) => `${call}/WL2K`).join(" ")} QRU K`;
}

export function addGatewayCalls(net: Net, raw: string): Net {
  const mine = net.myCall.split("/")[0];
  const found = raw
    .toUpperCase()
    .split(/[^A-Z0-9/]+/)
    .map((token) => token.split("/")[0].replace(/[^A-Z0-9]/g, ""))
    .filter((call) => CALL.test(call) && call !== mine && call !== net.ncs);
  if (!found.length) return net;
  const gateway = [...net.gateway];
  for (const call of found) if (!gateway.includes(call)) gateway.push(call);
  return { ...net, gateway };
}

export function removeGatewayCall(net: Net, call: string): Net {
  return { ...net, gateway: net.gateway.filter((item) => item !== call) };
}

export function operatorZev(ncs: string, me: string, negative: boolean) {
  return `${ncs} DE ${me} ${negative ? "ZUG ZEV" : "ZEV"} AR`;
}

function judgeOpening(expected: string, claimant: string, group: string | null, rows: Rows | null, adopt: boolean): { proof: NcsProof; note: string; open: boolean; ncs: string } {
  const triplet = group && group.length === 3 ? group : null;
  if (!triplet) {
    return {
      proof: "none",
      open: Boolean(expected) && claimant === expected,
      ncs: expected,
      note: `${claimant} sent ZKA with no DRYAD triplet. Stations cannot confirm this is the real net control.`,
    };
  }
  if (!rows) {
    return {
      proof: "unknown",
      open: Boolean(expected) && claimant === expected,
      ncs: expected,
      note: `${claimant} opened with ZNB ${triplet}. Load today's DRYAD before you trust that station.`,
    };
  }
  if (!tripletValid(rows, triplet)) {
    return {
      proof: "bad",
      open: false,
      ncs: expected,
      note: `${claimant} sent ZKA with ZNB ${triplet}, and it does not match the DRYAD. Do not follow this station as net control.`,
    };
  }
  if (adopt || !expected || claimant === expected) {
    return {
      proof: "good",
      open: true,
      ncs: claimant,
      note: `${claimant} is authenticated. ZNB ${triplet} matches the DRYAD.`,
    };
  }
  return {
    proof: "other",
    open: false,
    ncs: expected,
    note: `${claimant} authenticated ZNB ${triplet}, but this desk expects ${expected}. Do not switch net control on that alone.`,
  };
}

export function interpret(net: Net, raw: string, rows: Rows | null, ncsMode: boolean, trustKey = true): { net: Net; suggestion: string | null } {
  const text = raw.toUpperCase().trim().replace(/\s+/g, " ");
  if (text.length < 4) return { net, suggestion: null };
  const speaker = extractSpeaker(text);
  const ncs = net.ncs;
  const isUs = speaker === ncs;
  let suggestion: string | null = null;
  const method = detectMethod(text);

  if (text.includes("ZKA")) {
    const claimant = speaker;
    if (claimant) {
      const group = znbGroup(text);
      const triplet = group && group.length === 3 ? group : null;
      const judged = judgeOpening(ncs, claimant, group, trustKey ? rows : null, !ncsMode);
      const accepted = judged.proof === "good";
      const netOpen = accepted ? true : claimant === ncs ? judged.open : net.netOpen;
      const aboutUs = accepted || claimant === ncs;
      net = log(
        {
          ...net,
          ncs: judged.ncs,
          netOpen,
          ncsProof: judged.proof,
          ncsProofNote: judged.note,
          ncsTriplet: aboutUs ? triplet : net.ncsTriplet,
          ncsTripletOk: accepted ? true : aboutUs ? (judged.proof === "bad" ? false : null) : net.ncsTripletOk,
        },
        judged.note,
        claimant,
      );
    }
  }
  if (text.includes("ZKJ") && isUs && text.includes("OPIN")) net = { ...net, netOpen: false };

  if (!ncsMode && speaker && (speaker === ncs || text.includes(`${speaker}/NCS`)) && text.split(" ").includes("ZKS")) {
    net = adoptZks(net, text);
  }

  if (text.includes("QSY")) {
    const channel = channelIn(text);
    const back = /\bQSY\s+(BACK|NET)\b/.test(text);
    if (!back && channel && addressedToNet(text) && CHANNELS.includes(channel)) {
      net = moveNetChannel(net, channel, speaker ?? "SYSTEM");
    } else if (back) {
      const who = isUs ? calledStations(text) : speaker ? [speaker] : [];
      for (const call of who) {
        net = patch(log(net, `${call} returned from QSY`, call), call, { qsyChannel: null, qsySince: null });
      }
    } else if (!isUs && speaker && channel && qsyRoger(text)) {
      net = ackQsy(net, speaker, channel);
    } else if (isUs && channel) {
      const calls = calledStations(text);
      const order = zofOrder(text);
      if (calls.length >= 2 && order) net = directQsy(net, calls[0], calls[1], channel, order.quantity, order.name);
      else if (calls[0]) {
        net = upsert(net, calls[0], stationOf(net, calls[0])?.method ?? "RF");
        net = patch(log(net, `${calls[0]} sent to ${channel}`, calls[0]), calls[0], { qsyChannel: channel, qsySince: stamp() });
        net = { ...net, turn: calls[0] };
      }
    } else if (!isUs && speaker && channel) {
      net = upsert(net, speaker, stationOf(net, speaker)?.method ?? "RF");
      net = patch(log(net, `${speaker} sent to ${channel}`, speaker), speaker, { qsyChannel: channel, qsySince: stamp() });
    }
  }

  if (text.includes("ZOF") && !text.includes("INT") && !text.includes("QSY")) {
    const who = isUs ? calledStation(text) : speaker;
    net = log(net, who ? `ZOF ${who}` : "ZOF", who ?? "SYSTEM");
    if (who) net = { ...net, turn: who };
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
      suggestion = ncsMode ? scriptJoinAck(net, speaker) : null;
    } else if (text.includes("ZKE") && !text.includes("INT")) {
      const listed = gatewayList(text);
      const checkMethod = listed ? "RF" : method;
      net = upsert(log(net, `${speaker} checked in (${checkMethod})`, speaker), speaker, checkMethod);
      net = patch(net, speaker, { method: checkMethod });
      const group = znbGroup(text);
      if (group && group.length === 3) net = patch(net, speaker, { volunteered: group });
      if (listed) {
        for (const call of listed) {
          net = upsert(net, call, "WL2K");
          net = patch(net, call, { method: "WL2K", exempt: true, pending: false });
          net = addZks(net, call, "Winlink check-in");
        }
      }
      if (checkMethod === "WL2K") {
        net = patch(net, speaker, { exempt: true, pending: false, method: "WL2K" });
        net = addZks(net, speaker, "Winlink check-in");
        suggestion = ncsMode ? ack(ncs, speaker) : null;
      } else if (ncsMode && group && group.length === 3 && rows) {
        const expected = authenticate(rows, group[0], group[1]);
        if (expected && expected === group[2]) {
          net = patch(net, speaker, { authenticated: true, pending: false, volunteered: group, zug: false, exempt: false });
          net = addZks(net, speaker, "DRYAD authenticated");
          suggestion = ncsMode ? scriptJoinAck(net, speaker) : null;
          net = log(net, `${speaker} volunteered ZNB ${group} — matches`, speaker);
        } else {
          const chal = challengeFrom(rows) ?? "??";
          const onRoll = net.zks.includes(speaker);
          net = patch(net, speaker, { challenge: chal, authenticated: false, pending: onRoll ? false : true });
          suggestion = scriptChallenge(ncs, speaker, chal, "2");
          net = log(net, `${speaker} volunteered ZNB ${group} — does not match. Kept ${onRoll ? "in place" : "pending"}.`, speaker);
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
    } else if (text.includes("ZNB") && !text.includes("INT") && !text.includes("ZUG")) {
      const group = znbGroup(text);
      const st = stationOf(net, speaker);
      if (ncsMode && group && st?.challenge && rows) {
        const expected = authenticate(rows, st.challenge[0], st.challenge[1]);
        const got = group.length === 1 ? group[0] : group.length === 3 ? group[2] : "";
        if (expected && got === expected) {
          const shown = group.length === 3 ? group : `${st.challenge.slice(0, 2)}${got}`;
          const onRoll = net.zks.includes(speaker);
          net = patch(net, speaker, { authenticated: true, pending: false, volunteered: shown, zug: false, exempt: false });
          if (!onRoll) net = addZks(net, speaker, "DRYAD authenticated");
          else net = log(net, `${speaker} reauthenticated in place`, speaker);
          suggestion = scriptJoinAck(net, speaker);
          net = log(net, `${speaker} authenticated with ZNB ${shown}`, speaker);
        } else {
          const shown = group.length === 3 ? group : got ? `${st.challenge.slice(0, 2)}${got}` : st.volunteered;
          const chal = challengeFrom(rows) ?? "??";
          const onRoll = net.zks.includes(speaker);
          net = patch(net, speaker, {
            challenge: chal,
            volunteered: shown,
            authenticated: false,
            pending: onRoll ? false : true,
          });
          suggestion = scriptChallenge(ncs, speaker, chal, "2");
          net = log(net, `${speaker} ZNB mismatch (got ${got || "—"}, expected ${expected || "—"}). ${onRoll ? "Left in place." : "Still pending."}`, speaker);
        }
      }
    }

    if (text.includes("INT") && text.includes("ZKJ")) {
      net = upsert(net, speaker, stationOf(net, speaker)?.method ?? method);
      net = patch(net, speaker, { closeAsk: true });
      net = log(net, `${speaker} asked INT ZKJ`, speaker);
    }
    if (text.includes("ZKJ") && !text.includes("INT")) {
      net = log(net, `${speaker} closing down (ZKJ)`, speaker);
      net = noteRelay(net, speaker, "ZKJ");
    }
    if (text.includes("ZUG") && text.includes("ZCJ") && !text.includes("INT")) {
      net = restoreRelay(net, speaker);
    } else if (text.includes("ZCJ") && !text.includes("INT")) {
      net = noteRelay(net, speaker, "ZCJ");
    }
  }

  if (isUs && !text.includes("INT") && text.includes("ZUG") && text.includes("ZCJ")) {
    for (const call of calledStations(text)) net = restoreRelay(net, call);
  } else if (isUs && !text.includes("INT") && !text.includes("OPIN") && (text.includes("ZKJ") || text.includes("ZCJ"))) {
    const why = text.includes("ZCJ") ? "ZCJ" : "ZKJ";
    for (const call of calledStations(text)) net = noteRelay(net, call, why);
  }
  if (isUs && closeRoger(text)) {
    for (const call of calledStations(text)) {
      if (stationOf(net, call)?.closeAsk) net = noteRelay(net, call, "ZKJ");
    }
  }

  return { net, suggestion };
}

export function ingest(net: Net, block: string, rows: Rows | null, ncsMode: boolean, trustKey = true): { net: Net; suggestion: string | null } {
  let next = net;
  let suggestion: string | null = null;
  const cursor: Cursor = { speaker: null, file: null, hash: null };
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const result = interpret(next, trimmed, rows, ncsMode, trustKey);
    next = result.net;
    if (result.suggestion) suggestion = result.suggestion;
    const traffic = applyTraffic(next, trimmed.toUpperCase().replace(/\s+/g, " "), cursor, ncsMode);
    next = traffic.net;
    if (traffic.suggestion) suggestion = traffic.suggestion;
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

export function directQsy(net: Net, from: string, partner: string, channel: string, quantity: number, name: string): Net {
  const title = name.toUpperCase().replace(/[^A-Z0-9_.-]/g, "");
  const freq = channel.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!CALL.test(from) || !CALL.test(partner) || !title || !freq) return net;
  const jobs = net.qsos ?? [];
  const open = jobs.find((job) => job.from === from && job.with === partner && job.channel === freq && job.name === title && !(job.fromAck && job.withAck));
  if (open) return net;
  const job: QsyJob = {
    id: net.nextId,
    from,
    with: partner,
    channel: freq,
    quantity: quantity || 1,
    name: title,
    fromAck: false,
    withAck: false,
  };
  return log(
    { ...net, nextId: net.nextId + 1, qsos: [...jobs, job], turn: from },
    `${from} and ${partner} directed QSY ${freq} ZOF ${job.quantity} ${title}`,
    net.ncs,
  );
}

function ackQsy(net: Net, call: string, channel: string): Net {
  const jobs = net.qsos ?? [];
  const idx = jobs.findIndex((job) => job.channel === channel && (job.from === call || job.with === call) && (job.from === call ? !job.fromAck : !job.withAck));
  let next = net;
  if (idx >= 0) {
    const job = jobs[idx];
    const updated = { ...job, fromAck: job.fromAck || job.from === call, withAck: job.withAck || job.with === call };
    const both = updated.fromAck && updated.withAck;
    next = log(
      { ...next, qsos: jobs.map((item, i) => (i === idx ? updated : item)) },
      both ? `${updated.from} and ${updated.with} both rogered QSY ${channel}` : `${call} rogered QSY ${channel}`,
      call,
    );
  } else {
    next = log(next, `${call} rogered QSY ${channel}`, call);
  }
  next = upsert(next, call, stationOf(next, call)?.method ?? "RF");
  return patch(next, call, { qsyChannel: channel, qsySince: stamp() });
}

export function dismissQsy(net: Net, id: number): Net {
  return { ...net, qsos: (net.qsos ?? []).filter((job) => job.id !== id) };
}

export function setQsy(net: Net, call: string, channel: string | null): Net {
  const next = stationOf(net, call) ? net : upsert(net, call, "RF");
  if (!channel) return patch(log(next, `${call} back on the net`, call), call, { qsyChannel: null, qsySince: null });
  return patch(log({ ...next, turn: call }, `${call} QSY ${channel}`, call), call, { qsyChannel: channel, qsySince: stamp() });
}

export function setTurn(net: Net, call: string | null): Net {
  return log({ ...net, turn: call }, call ? `${call} has the circuit` : "Circuit clear");
}

export function outboundScript(ncs: string, rows: OutboundItem[]): string {
  const order: string[] = [];
  const grouped = new Map<string, Piece[]>();
  for (const row of rows) {
    if (!grouped.has(row.sender)) order.push(row.sender);
    const list = grouped.get(row.sender) ?? [];
    list.push({ quantity: row.quantity, precedence: row.precedence, destinations: row.destinations });
    grouped.set(row.sender, list);
  }
  return order.map((sender) => scriptOffer(ncs, sender, grouped.get(sender) ?? [])).join("\n");
}

export function addOutbound(net: Net, sender: string, quantity: number, precedence: string, destinations: string): Net {
  const call = sender.toUpperCase().split("/")[0].replace(/[^A-Z0-9]/g, "");
  const dests = destinations.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!CALL.test(call) || !quantity || !dests.length) return net;
  return {
    ...net,
    outbound: [...net.outbound, { sender: call, quantity, precedence, destinations: dests }],
  };
}

export function removeOutbound(net: Net, index: number): Net {
  return { ...net, outbound: net.outbound.filter((_, i) => i !== index) };
}

export function listOnNet(net: Net): Net {
  const seen = new Set<string>();
  let next = net;
  for (const row of net.outbound) {
    if (!row.sender || seen.has(row.sender)) continue;
    seen.add(row.sender);
    const pieces = net.outbound
      .filter((item) => item.sender === row.sender)
      .map(({ quantity, precedence, destinations }) => ({ quantity, precedence, destinations }));
    next = acknowledge(next, row.sender, pieces);
  }
  return next;
}

export function acknowledgeOffer(net: Net, id: number): Net {
  const offer = net.offers.find((o) => o.id === id);
  if (!offer) return net;
  return acknowledge(net, offer.from, offer.pieces);
}

export function dismissTransfer(net: Net, id: number): Net {
  const item = net.transfers.find((t) => t.id === id);
  if (!item) return net;
  return log(
    { ...net, transfers: net.transfers.filter((t) => t.id !== id) },
    `Cleared ${item.file}${item.hash ? ` {${item.hash}}` : ""}`,
  );
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
  const suggestion = scriptOffer(net.ncs, net.myCall || net.ncs, [{
    quantity: 1,
    precedence: file.precedence,
    destinations: [file.destination || "OPIN"],
  }]);
  const next = { ...net, files: net.files.map((f) => (f.id === id ? { ...f, listed: true } : f)), lastTx: suggestion };
  return { net: log(next, `Prepared ZBO for ${file.name}`), suggestion };
}

export function gatewayMessage(net: Net): string {
  return winlinkMessage(net);
}

/** Suffix of the call, at least two characters. N8ADO is ADO. NE8U is 8U. */
export function shortCall(call: string): string {
  const clean = call.toUpperCase().split("/")[0];
  const match = clean.match(/^[A-Z]{1,2}(\d+)([A-Z]+)$/);
  if (!match) return clean;
  const [, digits, suffix] = match;
  return suffix.length >= 2 ? suffix : `${digits}${suffix}`;
}

function shortNames(calls: string[]): Map<string, string> {
  const map = new Map(calls.map((call) => [call, shortCall(call)]));
  const owners = new Map<string, string[]>();
  for (const [call, name] of map) owners.set(name, [...(owners.get(name) ?? []), call]);
  for (const [name, list] of owners) {
    if (list.length < 2) continue;
    for (const call of list) {
      const match = call.toUpperCase().match(/(\d+)([A-Z]+)$/);
      map.set(call, match && `${match[1]}${match[2]}` !== name ? `${match[1]}${match[2]}` : call);
    }
  }
  return map;
}

/** End-of-net traffic in the gateway format: who still needs each piece, then who has it. */
export function trafficCloseout(net: Net): string {
  const { zug, zev } = reportSections(net);
  return ["INT ZUG ZEV", "", ...zug, "", "ZEV", "", ...zev].join("\n").replace(/\n{3,}/g, "\n\n");
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** DDHHmmJ MON YYYY in the computer's local time. J is local. */
export function localDtg(iso: string): string {
  const d = new Date(iso);
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  const dd = String(when.getDate()).padStart(2, "0");
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  return `${dd}${hh}${mm}J ${MONTHS[when.getMonth()]} ${when.getFullYear()}`;
}

function fileLabel(file: string): string {
  if (!file || file === "Unassigned") return "";
  return file.replace(/\.[^.]+$/, "");
}

type ReportRow = { calls: string[]; originator: string; zbo: string; tail: string; have: boolean };

function reportRows(net: Net): ReportRow[] {
  const rows: ReportRow[] = [];
  for (const item of net.transfers) {
    if (!item.originator) continue;
    const file = fileLabel(item.file);
    const listing = item.listing?.trim() ?? "";
    const extra = file && !listing.includes(file) ? file : "";
    const zbo = ["1", listing, extra].filter(Boolean).join(" ");
    const via = fileViaWl2k(net, item);
    const got = transferRoster(net, item)
      .filter((row) => row.report?.status === "have" && !via.includes(row.call))
      .map((row) => row.call);
    if (via.length) rows.push({ calls: via, originator: item.originator, zbo, tail: "ZOK WL2K", have: false });
    if (got.length) rows.push({ calls: got, originator: item.originator, zbo, tail: "", have: true });
  }
  const wl = wl2kStations(net).map((s) => s.call);
  for (const item of net.traffic) {
    for (const piece of item.pieces) {
      const got = (piece.zev ?? []).filter((call) => call !== item.originator);
      const need = wl.filter((call) => call !== item.originator && !got.includes(call));
      const zbo = `${piece.quantity} ${piece.precedence} ${piece.destinations.join(" ")}`.trim();
      if (need.length) rows.push({ calls: need, originator: item.originator, zbo, tail: "ZOK WL2K", have: false });
      if (got.length) rows.push({ calls: got, originator: item.originator, zbo, tail: "", have: true });
    }
  }
  for (const job of net.qsos ?? []) {
    if (!job.fromAck || !job.withAck) continue;
    rows.push({
      calls: [job.with],
      originator: job.from,
      zbo: `${job.quantity || 1} ${job.name}`,
      tail: `ZOK IP (QSY ${job.channel})`,
      have: true,
    });
  }
  return rows;
}

function reportSections(net: Net): { zug: string[]; zev: string[] } {
  const rows = reportRows(net);
  const involved = new Set<string>();
  for (const row of rows) {
    involved.add(row.originator);
    for (const call of row.calls) involved.add(call);
  }
  const names = shortNames([...involved]);
  const nameOf = (call: string) => names.get(call) ?? shortCall(call);
  const zug: string[] = [];
  const zev: string[] = [];
  for (const row of rows) {
    const line = `${row.calls.map(nameOf).join(" ")} DE ${nameOf(row.originator)} ZBO ${row.zbo}${row.tail ? ` ${row.tail}` : ""}`;
    if (row.have) zev.push(line);
    else zug.push(line);
  }
  return { zug, zev };
}

/** Winlink Express / Pat / MacWinlink body, in the WL2K-HF gateway form. */
export function winlinkMessage(net: Net): string {
  const from = (net.myCall || net.ncs).toUpperCase();
  const to = [...onAir(net).map((s) => s.call), ...wl2kStations(net).map((s) => s.call)];
  if (net.ncs && !to.includes(net.ncs)) to.push(net.ncs);
  const seen = new Set<string>();
  const addrs = to.filter((call) => {
    if (!call || call === from || seen.has(call)) return false;
    seen.add(call);
    return true;
  });
  const { zug, zev } = reportSections(net);
  return [
    `To: ${addrs.join("; ")}`,
    `Subject: //WL2K R/ WL2K-HF GATEWAY ${localDtg(net.started)}`,
    "",
    `ZKS ${zksLine(net)} K`,
    "",
    "INT ZUG ZEV",
    "",
    ...zug,
    "",
    "ZEV",
    "",
    ...zev,
    "",
    "NNNN",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
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
    `NCS authentication: ${net.ncsProof}${net.ncsProofNote ? ` — ${net.ncsProofNote}` : ""}`,
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
    "QSY orders:",
  ];
  if (!(net.qsos ?? []).length) lines.push("(none)");
  for (const job of net.qsos ?? []) {
    lines.push(`  ${job.from} ${job.with} QSY ${job.channel} ZOF ${job.quantity} ${job.name} — ${job.from} ${job.fromAck ? "R" : "waiting"}, ${job.with} ${job.withAck ? "R" : "waiting"}`);
  }
  lines.push(
    "",
    "ZBO list:",
  );
  if (!net.traffic.length) lines.push("(none)");
  for (const t of net.traffic) lines.push(`  ${t.originator} ZBO ${pieceText(t.pieces)}`);
  lines.push("", "Files:");
  if (!net.transfers.length) lines.push("(none)");
  for (const t of net.transfers) {
    lines.push(`  ${t.file}${t.hash ? ` {${t.hash}}` : ""}${t.blocks ? ` ${t.blocks} blocks` : ""}${t.originator ? ` from ${t.originator}` : ""}`);
    const via = new Set(fileViaWl2k(net, t));
    for (const row of transferRoster(net, t)) {
      if (via.has(row.call)) continue;
      if (!row.report) lines.push(`    ${row.call} not heard`);
      else if (row.report.status === "have") lines.push(`    ${row.call} ZEV`);
      else if (row.report.preamble) lines.push(`    ${row.call} missing preamble`);
      else if (row.report.status === "none") lines.push(`    ${row.call} ZUG ZEV`);
      else lines.push(`    ${row.call} missing ${row.report.missing.join(" ")}`);
    }
    if (via.size) lines.push(`    ${[...via].join(" ")} ZOF ZOK WL2K`);
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

const ROLE_TITLE: Record<Role, string> = {
  ncs: "Net Control",
  wl2k: "WL2K Gateway Operator",
  ip: "IP Station",
  operator: "Operator",
};

function esc(value: string): string {
  return value.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function localStamp(iso: string): string {
  const d = new Date(iso);
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  const m = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  return `${when.getFullYear()}-${m}-${day} ${hh}:${mm}`;
}

function formPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; margin: 1.2rem; }
  h1 { font-size: 1.15rem; margin: 0 0 0.2rem; }
  p.sub { margin: 0 0 0.8rem; font-size: 0.85rem; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 0.8rem; }
  th, td { border: 1px solid #222; padding: 0.3rem 0.4rem; vertical-align: top; font-size: 0.85rem; }
  th { text-align: left; background: #eee; width: 28%; }
  td.n, th.n { width: 5.5rem; }
  @media print { body { margin: 0.4rem; } }
</style></head><body>
${body}
</body></html>`;
}

function commRows(net: Net): { time: string; from: string; to: string; subject: string }[] {
  return net.log.map((entry) => {
    const subject = entry.message.replace(/^Prepared:\s*/, "");
    const upper = subject.toUpperCase();
    let from = CALL.test(entry.source) ? entry.source : (net.myCall || net.ncs || "OPIN");
    let to = "OPIN";
    const parts = upper.split(" DE ");
    if (parts.length >= 2) {
      const called = parts[0].split(" ").map((t) => t.split("/")[0]).filter((t) => CALL.test(t));
      const speaker = parts[1].split(" ")[0]?.split("/")[0] ?? "";
      if (CALL.test(speaker)) from = speaker;
      if (called.length) to = called.join(" ");
    }
    return { time: entry.time, from, to, subject };
  });
}

/** ICS 214 Activity Log for this desk. */
export function ics214(net: Net): string {
  const me = net.myCall || net.ncs || "";
  const position = ROLE_TITLE[net.role] ?? net.role;
  const start = localStamp(net.started);
  const end = localStamp(new Date().toISOString());
  const resources = [
    ...onAir(net).map((s) => [s.call, s.method === "IP" ? "IP" : "RF", "OPIN"]),
    ...wl2kStations(net).map((s) => [s.call, "WL2K", "OPIN"]),
  ];
  const activity = net.log.map((entry) => `<tr><td class="n">${esc(entry.time)}Z</td><td>${esc(entry.message)}</td></tr>`).join("");
  const resourceRows = resources.length
    ? resources.map(([call, pos]) => `<tr><td>${esc(call)}</td><td>${esc(pos)}</td><td>OPIN</td></tr>`).join("")
    : `<tr><td>&nbsp;</td><td></td><td></td></tr>`;
  return formPage("ICS 214", `
<h1>ICS 214 — Activity Log</h1>
<p class="sub">OPIN. Times in the log are UTC. Fill the signature on the printed copy.</p>
<table>
  <tr><th>1. Incident Name</th><td>OPIN</td></tr>
  <tr><th>2. Operational Period</th><td>From ${esc(start)} to ${esc(end)} local</td></tr>
  <tr><th>3. Name</th><td>${esc(me)}</td></tr>
  <tr><th>4. ICS Position</th><td>${esc(position)}</td></tr>
  <tr><th>5. Home Agency</th><td>OPIN</td></tr>
</table>
<p class="sub">6. Resources Assigned</p>
<table>
  <tr><th>Name</th><th>ICS Position</th><th>Home Agency</th></tr>
  ${resourceRows}
</table>
<p class="sub">7. Activity Log</p>
<table>
  <tr><th class="n">Date/Time</th><th>Notable Activities</th></tr>
  ${activity || `<tr><td class="n"></td><td></td></tr>`}
</table>
<table>
  <tr><th>8. Prepared by</th><td>${esc(me)}<br>${esc(position)}<br>${esc(end)} local<br>Signature: ____________________</td></tr>
</table>`);
}

/** ICS 309 Communications Log for this desk. */
export function ics309(net: Net): string {
  const me = net.myCall || net.ncs || "";
  const position = ROLE_TITLE[net.role] ?? net.role;
  const start = localStamp(net.started);
  const end = localStamp(new Date().toISOString());
  const rows = commRows(net).map((row) =>
    `<tr><td class="n">${esc(row.time)}Z</td><td>${esc(row.from)}</td><td>${esc(row.to)}</td><td>${esc(row.subject)}</td></tr>`,
  ).join("");
  return formPage("ICS 309", `
<h1>ICS 309 — Communications Log</h1>
<p class="sub">OPIN. Times are UTC. Fill the signature on the printed copy.</p>
<table>
  <tr><th>1. Incident Name</th><td>OPIN</td></tr>
  <tr><th>2. Operational Period</th><td>From ${esc(start)} to ${esc(end)} local</td></tr>
  <tr><th>3. Radio Operator</th><td>${esc(me)} — ${esc(position)}</td></tr>
  <tr><th>4. Station I.D.</th><td>${esc(me)} ${esc(net.channel)} ${esc(net.band)}</td></tr>
</table>
<table>
  <tr><th class="n">Time</th><th>From</th><th>To</th><th>Subject</th></tr>
  ${rows || `<tr><td class="n"></td><td></td><td></td><td></td></tr>`}
</table>
<table>
  <tr><th>5. Prepared by</th><td>${esc(me)}<br>${esc(position)}<br>${esc(end)} local<br>Signature: ____________________</td></tr>
</table>`);
}

export function myPlace(net: Net): number {
  const me = net.myCall.toUpperCase();
  const order = zksLine(net).split(" ").map((p) => p.split("/")[0]);
  return order.indexOf(me) + 1;
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ClipboardCopy,
  Download,
  Radio,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { CODES, lookupCode } from "@/lib/ncs/codes";
import {
  authenticate,
  challengeFrom,
  parseDryadText,
  todayKey,
  trainingDay,
  tripletValid,
  type DryadDay,
  type Rows,
} from "@/lib/ncs/dryad";
import { textFromDryadFile } from "@/lib/ncs/dryad-file";
import {
  CHANNELS,
  FOLDERS,
  GROUPS,
  PRECEDENCE,
  acceptExempt,
  addGatewayCalls,
  acknowledgeOffer,
  ackInbox,
  addFile,
  addInbox,
  addManualStation,
  addOutbound,
  awayStations,
  dismissTransfer,
  fileViaWl2k,
  recallFromWl2k,
  sendViaWl2k,
  dismissQsy,
  directQsy,
  emptyNet,
  gatewayMessage,
  ingest,
  listFile,
  moveNetChannel,
  listOnNet,
  moveFile,
  myPlace,
  normalizeNet,
  onAir,
  operatorCheckin,
  outboundScript,
  operatorZev,
  pendingCalls,
  pieceText,
  removeOutbound,
  requestAuth,
  scriptAgency,
  removeGatewayCall,
  scriptAckZbo,
  scriptChallenge,
  scriptCheckin,
  scriptClose,
  scriptCloseOne,
  scriptDrop,
  scriptEquipment,
  scriptGatewayCheckin,
  scriptImi,
  scriptJoinAck,
  scriptOpen,
  scriptQsyZof,
  scriptReturn,
  scriptTrafficCall,
  scriptZks,
  scriptZof,
  scriptIntZev,
  sessionK2s,
  sessionReport,
  trafficCloseout,
  setBounce,
  setQsy,
  setTurn,
  transferRoster,
  wl2kStations,
  type Method,
  type Net,
  type Role,
} from "@/lib/ncs/protocol";

type View = "desk" | "auth" | "codes" | "log" | "files";

const SESSION_KEY = "opin-assistant-v1";
const DRYAD_KEY = "opin-dryad-v1";

function loadNet(): Net {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return emptyNet();
    const parsed = JSON.parse(raw) as Net;
    if (!parsed.zks || !parsed.traffic || !parsed.ncs) return emptyNet();
    return normalizeNet(parsed);
  } catch {
    return emptyNet();
  }
}

function loadDays(): DryadDay[] {
  try {
    const raw = localStorage.getItem(DRYAD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DryadDay[];
    return Array.isArray(parsed) ? parsed.filter((d) => d.rows && d.date && !d.training) : [];
  } catch {
    return [];
  }
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const ROLES: { id: Role; label: string; hint: string }[] = [
  { id: "ncs", label: "NCS", hint: "Run the directed net" },
  { id: "wl2k", label: "WL2K-GO", hint: "Gateway operator" },
  { id: "ip", label: "IP", hint: "Folders and listings" },
  { id: "operator", label: "Operator", hint: "Check in and answer in turn" },
];

export function Console() {
  const [net, setNet] = useState<Net>(emptyNet);
  const [ready, setReady] = useState(false);
  const [days, setDays] = useState<DryadDay[]>([]);
  const [activeDate, setActiveDate] = useState(todayKey());
  const [forceTraining, setForceTraining] = useState(false);
  const [view, setView] = useState<View>("desk");
  const [rx, setRx] = useState("");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [dryadPaste, setDryadPaste] = useState("");
  const [dryadNotes, setDryadNotes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [codeKind, setCodeKind] = useState<"all" | "Q" | "Z" | "net">("all");
  const [row, setRow] = useState("A");
  const [letter, setLetter] = useState("");
  const [verify, setVerify] = useState("");
  const [manualCall, setManualCall] = useState("");
  const [manualMethod, setManualMethod] = useState<Method>("RF");
  const [manualExempt, setManualExempt] = useState(false);
  const [tPrec, setTPrec] = useState("R");
  const [tDest, setTDest] = useState("OPIN");
  const [inboxPaste, setInboxPaste] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileFolder, setFileFolder] = useState("Incoming");
  const [flamp, setFlamp] = useState("");
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  useEffect(() => {
    const loaded = loadNet();
    const stored = loadDays();
    setNet(loaded);
    setDays(stored);
    if (stored.some((d) => d.date === todayKey())) setActiveDate(todayKey());
    else if (stored[0]) setActiveDate(stored[0].date);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(SESSION_KEY, JSON.stringify(net));
  }, [net, ready]);

  useEffect(() => {
    if (ready) localStorage.setItem(DRYAD_KEY, JSON.stringify(days));
  }, [days, ready]);

  useEffect(() => {
    if (!pendingRole) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPendingRole(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingRole]);

  const training = useMemo(() => trainingDay(activeDate), [activeDate]);
  const storedDay = days.find((d) => d.date === activeDate) ?? null;
  const table: DryadDay | null = forceTraining ? training : storedDay ?? (days.length ? null : training);
  const rows: Rows | null = table?.rows ?? null;
  const usingTraining = Boolean(table?.training);

  function offer(text: string) {
    setDraft(text);
    setNet((n) => ({
      ...n,
      lastTx: text,
      log: [...n.log, { time: new Date().toISOString().slice(11, 16), source: "SYSTEM", message: `Prepared: ${text}` }].slice(-400),
    }));
  }

  function applyRole(role: Role) {
    const wasNcs = net.role === "ncs" && net.myCall.toUpperCase() === net.ncs.toUpperCase();
    const ncs = role === "ncs" ? net.ncs : wasNcs && !net.netOpen ? "" : net.ncs;
    setNet({
      ...net,
      role,
      ncs,
      myCall: role === "ncs" ? ncs || net.myCall : wasNcs ? "" : net.myCall,
    });
  }

  function chooseRole(role: Role) {
    if (role === net.role) return;
    if (net.netOpen) {
      setPendingRole(role);
      return;
    }
    applyRole(role);
  }

  function readRx(block = rx) {
    const trustKey = Boolean(rows) && (!usingTraining || forceTraining);
    const result = ingest(net, block, rows, net.role === "ncs", trustKey);
    setNet(result.net);
    if (result.suggestion) setDraft(result.suggestion);
  }

  function practice() {
    const book = training.rows;
    const good = `${"C"}${book.C?.[3] ?? "D"}${authenticate(book, "C", book.C?.[3] ?? "D") ?? "A"}`;
    const ncs = net.ncs || "N8TAG";
    const lines = [
      scriptOpen(ncs, book) ?? `OPIN DE ${ncs} ZKA ZKB AS`,
      `${ncs} DE KE8YTX ZKE ZNB ${good} ZBO 1 R OH K`,
      `${ncs} DE KD8TTE ZUG ZNB QRU K`,
      `${ncs} DE W8ABC/WL2K ZKE K`,
      `KE8YTX DE ${ncs} R ZBO 1 R OH AS AR`,
      `DE KE8YTX`,
      "<FILE 24 ABCD>{A1B2}20261103120000:FIELDSITREP.K2S",
      "<SIZE 12 8816>{A1B2}400 8 96",
      "DE KD8TTE FILE : FIELDSITREP.K2S",
      "<MISSING 12 8793>{A1B2}3 7",
      "DE KD8TTE FILE : FIELDSITREP.K2S",
      "<MISSING 8 1111>{A1B2}7",
      "DE W8ABC FILE : FIELDSITREP.K2S",
      "<MISSING 15 107D>{A1B2}CONFIRMED",
    ];
    setForceTraining(true);
    setRx(lines.join("\n"));
    const result = ingest({ ...net, ncs, netOpen: true }, lines.join("\n"), book, true);
    setNet(result.net);
    if (result.suggestion) setDraft(result.suggestion);
    setView("desk");
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const fileRef = useRef<HTMLInputElement>(null);

  function applyDryad(text: string, lead: string[]) {
    const parsed = parseDryadText(text);
    const loaded = parsed.days.length
      ? [`Loaded ${parsed.days.length} day${parsed.days.length === 1 ? "" : "s"}. Kept in this program only.`]
      : [];
    setDryadNotes([...lead, ...loaded, ...parsed.notes]);
    if (!parsed.days.length) {
      setDryadPaste(text);
      return;
    }
    setDays((prev) => {
      const map = new Map(prev.map((d) => [d.date, d]));
      for (const day of parsed.days) map.set(day.date, day);
      return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    });
    setActiveDate(parsed.days[0].date);
    setForceTraining(false);
    setDryadPaste("");
  }

  function loadDryad() {
    applyDryad(dryadPaste, []);
  }

  async function importDryadFiles(list: File[]) {
    const parts: string[] = [];
    const lead: string[] = [];
    for (const file of list) {
      try {
        parts.push(await textFromDryadFile(file));
        lead.push(`${file.name}: read.`);
      } catch (err) {
        lead.push(`${file.name}: could not read${err instanceof Error ? ` (${err.message})` : ""}.`);
      }
    }
    if (!parts.length) {
      setDryadNotes(lead);
      return;
    }
    applyDryad(parts.join("\n\n"), lead);
  }

  const needle = query.trim().toUpperCase();
  const searchHits = CODES.filter((c) => {
    if (codeKind === "Q" && c.kind !== "Q") return false;
    if (codeKind === "Z" && c.kind !== "Z") return false;
    if (codeKind === "net" && c.kind !== "prosign" && c.kind !== "precedence") return false;
    if (!needle) return true;
    return c.code.includes(needle) || c.meaning.toUpperCase().includes(needle) || (c.question ?? "").toUpperCase().includes(needle) || (c.example ?? "").toUpperCase().includes(needle);
  });
  const answer = rows && letter ? authenticate(rows, row, letter) : null;
  const verifyGroup = verify.toUpperCase().replace(/[^A-Z]/g, "");
  const verifyResult = !rows || verifyGroup.length === 0
    ? ""
    : verifyGroup.length === 3
      ? tripletValid(rows, verifyGroup) ? `${verifyGroup} matches this table` : `${verifyGroup} does not match`
      : "Enter three letters, ABC, meaning the authentication of AB is C.";

  const place = myPlace(net);
  const turn = net.turn;
  const me = net.myCall.toUpperCase();

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-3 py-4 sm:px-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Radio size={16} aria-hidden /> OPIN digital net
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Net assistant</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Suggestions stay on this page until you copy them into fldigi. Nothing is transmitted from here.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="chip">{usingTraining ? "Training DRYAD" : table ? `DRYAD ${table.label}` : "No DRYAD"}</span>
            <span className={net.netOpen ? "chip text-ok" : "chip"}>{net.netOpen ? "Net open" : "Net not open"}</span>
            {net.ncsProof === "good" && <span className="chip text-ok">NCS authenticated</span>}
            {net.ncsProof === "bad" && <span className="chip text-danger">DRYAD rejected</span>}
            {(net.ncsProof === "none" || net.ncsProof === "other") && <span className="chip text-danger">NCS not confirmed</span>}
          </div>
          <button className="btn" type="button" onClick={() => { setNet(emptyNet(net.ncs || "N8TAG")); setDraft(""); setRx(""); }}>
            <RotateCcw size={16} className="mr-1 inline" /> New session
          </button>
        </div>
      </header>

      <section className="panel mb-3 grid grid-cols-2 gap-2 p-3 lg:grid-cols-5">
        <label className="col-span-2 text-sm text-muted lg:col-span-1">
          Role
          <select className="field mt-1" value={net.role} onChange={(e) => chooseRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          My call
          <input className="field mono mt-1 uppercase" placeholder="Your call" value={net.myCall} onChange={(e) => setNet({ ...net, myCall: e.target.value.toUpperCase(), ncs: net.role === "ncs" ? e.target.value.toUpperCase() : net.ncs })} />
        </label>
        <label className="text-sm text-muted">
          NCS
          <input className="field mono mt-1 uppercase" placeholder={net.role === "ncs" ? "Net control" : "After a good ZKA"} value={net.ncs} onChange={(e) => setNet({ ...net, ncs: e.target.value.toUpperCase() })} />
        </label>
        <label className="text-sm text-muted">
          Band
          <input className="field mt-1" value={net.band} onChange={(e) => setNet({ ...net, band: e.target.value })} />
        </label>
        <label className="text-sm text-muted">
          Channel
          <select className="field mt-1" value={net.channel} onChange={(e) => setNet(moveNetChannel(net, e.target.value))}>
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {net.netOpen && (
          <p className="col-span-2 text-xs text-muted lg:col-span-5">
            The net is open. You stay {ROLES.find((r) => r.id === net.role)?.label} until you confirm a switch.
          </p>
        )}
      </section>

      <nav className="mb-3 flex gap-1 overflow-x-auto border-b border-line">
        {([
          ["desk", "Desk"],
          ["auth", "DRYAD"],
          ["codes", "Codes"],
          ["log", "Log"],
          ["files", "Files"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? "tab tab-on" : "tab"} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>

      {view === "desk" && (
        <div className="grid gap-3 lg:grid-cols-12">
          <section className="panel p-2 lg:col-span-4">
            <h2 className="mb-1 text-sm font-semibold">ZKS roll</h2>
            <ZksRoll net={net} />
            <RollList
              net={net}
              rows={rows}
              setNet={setNet}
              offer={offer}
              onCall={(call) => setNet(setTurn(net, call))}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
              <input className="field field-xs mono w-[7.5rem] uppercase" placeholder="Add call" value={manualCall} onChange={(e) => setManualCall(e.target.value.toUpperCase())} />
              <select className="field field-xs w-[5.25rem]" value={manualMethod} onChange={(e) => setManualMethod(e.target.value as Method)}>
                <option value="RF">RF</option>
                <option value="WL2K">WL2K</option>
                <option value="IP">IP</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={manualExempt} onChange={(e) => setManualExempt(e.target.checked)} /> No DRYAD
              </label>
              <button className="btn btn-xs" type="button" onClick={() => { setNet(addManualStation(net, manualCall, manualMethod, manualExempt || manualMethod === "WL2K")); setManualCall(""); }}>Add</button>
            </div>
          </section>

          <section className="panel p-3 lg:col-span-5">
            <ProofBanner net={net} />
            <RoleSteps net={net} rows={rows} canOpen={Boolean(table && !table.training)} offer={offer} blockOpen={(note) => setNet({
              ...net,
              ncsProof: "none",
              ncsProofNote: note,
            })} />
            {net.role === "operator" && (
              <p className={`mb-3 rounded-md px-3 py-2 text-sm ${turn === me ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg"}`}>
                {turn === me
                  ? "You are called. Transmit, then report."
                  : turn
                    ? `${turn} has the circuit. Stay silent until your turn.`
                    : place > 0
                      ? `You are ${place} on the ZKS list. Stay silent until called.`
                      : "You are not on the roll yet. Check in with ZKE."}
              </p>
            )}
            <h2 className="mb-2 text-sm font-semibold">What fldigi printed</h2>
            <MarkedText value={rx} onChange={setRx} tall placeholder="N8TAG DE KE8YTX ZKE ZNB ABC K" />
            <div className="mb-4 flex flex-wrap gap-2">
              <button className="btn btn-accent" type="button" onClick={() => readRx()}>Read this</button>
              <button className="btn" type="button" onClick={practice}>Practice net</button>
            </div>
            <h2 className="mb-2 text-sm font-semibold">Suggested reply — edit, then copy</h2>
            <MarkedText value={draft} onChange={setDraft} placeholder="The line to copy into fldigi" />
            <button className="btn btn-accent" type="button" onClick={copyDraft}>
              <ClipboardCopy size={16} className="mr-1 inline" /> {copied ? "Copied" : "Copy for fldigi"}
            </button>

            {net.role === "wl2k" && <WinlinkBox net={net} setNet={setNet} paste={inboxPaste} setPaste={setInboxPaste} offer={offer} />}
            {net.role === "ip" && (
              <IpBox
                net={net}
                setNet={setNet}
                fileName={fileName}
                setFileName={setFileName}
                folder={fileFolder}
                setFolder={setFileFolder}
                prec={tPrec}
                setPrec={setTPrec}
                dest={tDest}
                setDest={setTDest}
                offer={offer}
              />
            )}
          </section>

          <section className="panel max-h-[40rem] overflow-auto p-3 lg:col-span-3">
            <TrafficPanel net={net} setNet={setNet} offer={offer} />
          </section>
        </div>
      )}

      {view === "auth" && (
        <section className="panel max-w-xl p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} /> DRYAD / ZNB</h2>
          <p className="mb-3 text-sm text-muted">
            INT ZNB AB asks for the letter under B on row A. A check-in ZNB ABC already answers: the authentication of AB is C. Net control opens the same way: ZKA ZNB ABC, so the net can confirm the station holding the sheet. A real table stays in this program. It is not sent anywhere.
          </p>
          <label className="mb-2 block text-sm text-muted">Day
            <input className="field mt-1" type="date" value={activeDate} onChange={(e) => { setActiveDate(e.target.value); setForceTraining(false); }} />
          </label>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={forceTraining || (!storedDay && days.length === 0)} onChange={(e) => setForceTraining(e.target.checked)} />
            Use the training table
          </label>
          <div className="mb-4 flex flex-wrap gap-2">
            <label className="text-sm text-muted">Row
              <input className="field mono mt-1 w-16 uppercase" maxLength={1} value={row} onChange={(e) => setRow(e.target.value.toUpperCase())} />
            </label>
            <label className="text-sm text-muted">Letter
              <input className="field mono mt-1 w-16 uppercase" maxLength={1} value={letter} onChange={(e) => setLetter(e.target.value.toUpperCase())} />
            </label>
          </div>
          <p className="mono text-lg">{answer ? `ZNB ${answer}` : rows ? "That letter is not on the row." : "Load a DRYAD page first."}</p>
          {answer && net.role === "ncs" && (
            <button className="btn mt-3" type="button" onClick={() => {
              const last = pendingCalls(net)[0];
              if (last) offer(`${last} DE ${net.ncs} R ZNB ${answer} AS`);
            }}>Copy is the response, not a challenge</button>
          )}
          <h3 className="mb-2 mt-6 text-sm font-semibold">Check a volunteered triplet</h3>
          <input className="field mono uppercase" maxLength={3} value={verify} onChange={(e) => setVerify(e.target.value.toUpperCase())} placeholder="ABC" />
          <p className="mt-2 text-sm">{verifyResult}</p>
          {rows && (
            <button className="btn mt-3" type="button" onClick={() => {
              const chal = challengeFrom(rows);
              if (!chal) return;
              const who = pendingCalls(net)[0] ?? "STATION";
              offer(`${who} DE ${net.ncs} INT ZNB ${chal} K`);
            }}>Prepare a challenge</button>
          )}
          <h3 className="mb-2 mt-6 text-sm font-semibold">Import a DRYAD file</h3>
          <p className="mb-2 text-sm text-muted">Pick one or more PDF or text files. A PDF with several days loads all of them. You can still paste a page below.</p>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept=".pdf,.txt,.text,application/pdf,text/plain"
            multiple
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = "";
              if (list.length) void importDryadFiles(list);
            }}
          />
          <button className="btn btn-accent" type="button" onClick={() => fileRef.current?.click()}>Import DRYAD files</button>
          <h3 className="mb-2 mt-6 text-sm font-semibold">Or paste a daily page</h3>
          <textarea className="field mono mb-2 h-36" value={dryadPaste} onChange={(e) => setDryadPaste(e.target.value)} placeholder={"From: 030001Z NOV 2026\nUntil: 032359Z NOV 2026\nA ...."} />
          <button className="btn btn-accent" type="button" onClick={loadDryad}>Load pages</button>
          <ul className="mt-2 text-sm text-muted">
            {dryadNotes.map((n) => <li key={n}>{n}</li>)}
            {days.map((d) => (
              <li key={d.date} className="mt-1 flex items-center justify-between gap-2">
                <button type="button" className="btn" onClick={() => { setActiveDate(d.date); setForceTraining(false); }}>{d.label}</button>
                <button type="button" className="btn" onClick={() => setDays(days.filter((x) => x.date !== d.date))}>Remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "codes" && (
        <section className="panel p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><BookOpen size={16} /> Z-codes and Q-codes</h2>
          <p className="mb-2 text-xs text-muted">ACP 131(F) assigned signals, plus the amateur Q signals that publication does not list. Hover a code in what fldigi printed for the short meaning.</p>
          <div className="mb-2 flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["Z", "Z codes"],
              ["Q", "Q codes"],
              ["net", "Prosigns"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" className={codeKind === id ? "btn btn-accent" : "btn"} onClick={() => setCodeKind(id)}>{label}</button>
            ))}
          </div>
          <input className="field mb-3 max-w-md" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ZKE, QSY, relay…" />
          <p className="mb-2 text-xs text-muted">{searchHits.length} shown</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {searchHits.map((c) => (
              <li key={`${c.kind}-${c.code}`} className="border-b border-line py-2">
                <p className="mono text-accent">{c.code} <span className="text-muted">{c.kind}</span></p>
                <p className="text-sm">{c.meaning}</p>
                {c.question && <p className="text-sm text-muted">{c.question}</p>}
                {c.example && <p className="text-sm text-muted">{c.example}</p>}
              </li>
            ))}
          </ul>
          {needle && searchHits.length === 0 && <p className="text-sm text-muted">No match.</p>}
        </section>
      )}

      {view === "log" && (
        <section className="panel p-3">
          <ul className="mono max-h-96 overflow-auto text-sm">
            {net.log.length === 0 && <li className="text-muted">The log fills as you read traffic, direct stations, and move files.</li>}
            {net.log.map((e, i) => (
              <li key={`${e.time}-${i}`} className="border-b border-line py-1">{e.time} {e.source} {e.message}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn" type="button" onClick={() => download("OPIN-session-report.txt", sessionReport(net))}><Download size={16} className="mr-1 inline" /> Session report</button>
            <button className="btn" type="button" onClick={() => download("OPIN-session.k2s", sessionK2s(net))}>flmsg .k2s draft</button>
          </div>
        </section>
      )}

      {view === "files" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="panel p-3">
            <h2 className="mb-2 text-sm font-semibold">FLAMP report</h2>
            <p className="mb-2 text-sm text-muted">Paste a reception report. CONFIRMED counts as ZEV. MISSING blocks stay partial and go to Winlink follow-up.</p>
            <textarea className="field mono mb-2 h-32" value={flamp} onChange={(e) => setFlamp(e.target.value)} placeholder={"DE KE8YTX\nFILE : FIELDSITREP.K2S\nNBLK : 8\nMISSING : 3 7"} />
            <button className="btn btn-accent" type="button" onClick={() => { readRx(flamp); setFlamp(""); }}>Apply report</button>
          </section>
          <section className="panel p-3">
            <h2 className="mb-2 text-sm font-semibold">Session file</h2>
            <p className="mb-2 text-sm text-muted">The session lives in this browser. Export it if you want a copy, or bring one back.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn" type="button" onClick={() => download("opin-session.json", JSON.stringify(net, null, 2))}>Export JSON</button>
              <button className="btn" type="button" onClick={() => download("OPIN-gateway.txt", gatewayMessage(net))}>Gateway message</button>
              <label className="btn">
                Import JSON
                <input className="sr-only" type="file" accept="application/json,.json" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const parsed = JSON.parse(text) as Net;
                    if (parsed?.zks && parsed?.traffic) setNet(normalizeNet(parsed));
                  } catch {
                    setDryadNotes(["That file is not a session export."]);
                  }
                }} />
              </label>
            </div>
          </section>
        </div>
      )}
      {pendingRole && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4" onClick={() => setPendingRole(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="role-switch-title"
            className="panel w-full max-w-md p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="role-switch-title" className="text-lg font-semibold">Switch roles during the net?</h2>
            <p className="mt-2 text-sm text-muted">
              The net is open and you are working as {ROLES.find((r) => r.id === net.role)?.label}. Switch to {ROLES.find((r) => r.id === pendingRole)?.label} now?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="btn" type="button" onClick={() => setPendingRole(null)}>Stay as {ROLES.find((r) => r.id === net.role)?.label}</button>
              <button className="btn btn-accent" type="button" onClick={() => { applyRole(pendingRole); setPendingRole(null); }}>Switch</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function codeTip(token: string, asked = false): { code: string; text: string } | null {
  const hit = lookupCode(token).find((c) => c.kind === "Q" || c.kind === "Z");
  if (!hit) return null;
  const raw = asked ? (hit.question || `Question form. ${hit.meaning}`) : hit.meaning;
  const text = raw.length > 180 ? `${raw.slice(0, 177)}…` : raw;
  return { code: asked ? `INT ${hit.code}` : hit.code, text };
}

function intBefore(text: string): boolean {
  return /\bINT\s*$/i.test(text);
}

function MarkedText({ value, onChange, tall, placeholder }: { value: string; onChange: (v: string) => void; tall?: boolean; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; code: string; text: string } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const height = tall ? "h-72" : "h-16";
  useEffect(() => {
    if (editing) box.current?.focus();
  }, [editing]);
  function show(token: string, x: number, y: number, asked = false) {
    const found = codeTip(token, asked);
    setTip(found ? { ...found, x, y } : null);
  }
  const parts = value.split(/(\bQRRR\b|\b[QZ][A-Z]{2}\b)/g);
  const showEditor = editing || !value.trim();
  return (
    <div className="relative mb-2">
      {showEditor ? (
        <textarea
          ref={box}
          className={`field mono ${height}`}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => { setEditing(false); setTip(null); }}
          onMouseUp={(e) => {
            const el = e.currentTarget;
            const raw = el.value.slice(el.selectionStart, el.selectionEnd).trim().toUpperCase();
            const picked = raw.match(/^(?:INT\s+)?(QRRR|[QZ][A-Z]{2})$/);
            if (picked) show(picked[1], e.clientX, e.clientY, picked[0].startsWith("INT") || intBefore(el.value.slice(0, el.selectionStart)));
            else setTip(null);
          }}
        />
      ) : (
        <div
          className={`field mono ${height} cursor-text overflow-auto whitespace-pre-wrap`}
          onClick={() => setEditing(true)}
        >
          {parts.map((part, i) => {
            const asked = intBefore(parts[i - 1] ?? "");
            const found = /^(QRRR|[QZ][A-Z]{2})$/.test(part) ? codeTip(part, asked) : null;
            if (!found) return <span key={i}>{part}</span>;
            return (
              <span
                key={i}
                className="cursor-help text-accent underline decoration-dotted underline-offset-2"
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={(e) => show(part, e.clientX, e.clientY, asked)}
                onMouseLeave={() => setTip(null)}
              >{part}</span>
            );
          })}
        </div>
      )}
      {tip && (
        <div
          className="pointer-events-none fixed z-30 max-w-xs rounded-md border border-line bg-surface px-2 py-1 text-xs shadow"
          style={{ left: Math.min(tip.x, window.innerWidth - 280), top: tip.y + 16 }}
        >
          <span className="mono text-accent">{tip.code}</span> {tip.text}
        </div>
      )}
    </div>
  );
}

function Triplet({ value, ok }: { value: string | null; ok: boolean | null }) {
  if (!value || value.length !== 3) return null;
  const tone = ok === true ? "text-ok" : ok === false ? "text-danger" : "text-muted";
  return <span className={tone}> {value}</span>;
}

function ZksRoll({ net }: { net: Net }) {
  const labels = [
    ...onAir(net).map((s) => (s.method === "IP" ? `${s.call}/IP` : s.call)),
    ...wl2kStations(net).map((s) => `${s.call}/WL2K`),
    `${net.ncs ? `${net.ncs}/NCS` : ""}`,
  ].filter(Boolean);
  return (
    <p className="mono mb-2 flex flex-wrap gap-x-2 gap-y-0 text-xs leading-5">
      {labels.map((label) => (
        <span key={label} className="whitespace-nowrap">{label}</span>
      ))}
    </p>
  );
}

function RollList({
  net, rows, setNet, offer, onCall,
}: {
  net: Net;
  rows: Rows | null;
  setNet: (n: Net) => void;
  offer: (text: string) => void;
  onCall: (call: string) => void;
}) {
  function ask(call: string) {
    if (!rows) {
      offer("Load today's DRYAD before INT ZNB.");
      return;
    }
    const chal = challengeFrom(rows);
    if (!chal) return;
    setNet(requestAuth(net, call, chal));
    offer(scriptChallenge(net.ncs, call, chal));
  }
  function place(call: string) {
    offer(scriptJoinAck(net, call));
  }
  function zug(call: string) {
    const next = acceptExempt(net, call);
    setNet(next);
    offer(scriptJoinAck(next, call));
  }

  const pending = pendingCalls(net);
  const air = onAir(net);
  const wl = wl2kStations(net);
  const away = awayStations(net);

  return (
    <div className="max-h-[32rem] overflow-auto">
      {pending.length > 0 && (
        <>
          <h3 className="mb-0.5 text-xs font-medium text-muted">Pending</h3>
          <ul>
            {pending.map((c) => {
              const st = net.stations.find((s) => s.call === c);
              return (
                <li key={c} className="flex flex-wrap items-center gap-1 border-b border-line py-0.5">
                  <span className="mono text-xs">
                    {c}
                    <Triplet value={st?.volunteered ?? null} ok={st?.volunteered ? (st.challenge && !st.authenticated ? false : null) : null} />
                  </span>
                  <button className="btn btn-xs btn-accent" type="button" onClick={() => ask(c)}>INT ZNB</button>
                  <button className="btn btn-xs" type="button" onClick={() => zug(c)}>ZUG ZNB</button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <h3 className="mb-0.5 mt-1 text-xs font-medium text-muted">On air, then Winlink, then NCS</h3>
      {air.length === 0 && wl.length === 0 && <p className="text-xs text-muted">No one on the roll yet.</p>}
      <ul>
        {air.map((s) => {
          const ack = scriptJoinAck(net, s.call);
          const placeLabel = ack.endsWith(" R") ? "R" : `ZGO ${ack.split(" ").pop()}`;
          return (
            <li key={s.call} className="flex flex-wrap items-center gap-1 border-b border-line py-0.5">
              <button type="button" className="mono text-left text-xs" onClick={() => onCall(s.call)}>
                {s.method === "IP" ? `${s.call}/IP` : s.call}
                <Triplet value={s.volunteered} ok={s.volunteered ? s.authenticated : null} />
                {s.zug ? <span className="text-muted"> ZUG</span> : ""}
                {s.qsyChannel ? <span className="text-muted"> {s.qsyChannel}</span> : ""}
                {net.turn === s.call ? <span className="text-accent"> called</span> : ""}
              </button>
              {(s.authenticated || s.zug) && (
                <button className="btn btn-xs btn-accent" type="button" onClick={() => place(s.call)}>{placeLabel}</button>
              )}
              <button className="btn btn-xs" type="button" onClick={() => ask(s.call)}>INT ZNB</button>
              {s.qsyChannel && (
                <button className="btn btn-xs" type="button" onClick={() => { setNet(setQsy(net, s.call, null)); offer(scriptReturn(net.ncs, s.call)); }}>Back</button>
              )}
              <button className="btn btn-xs" type="button" onClick={() => offer(scriptCloseOne(net.ncs, s.call))}>ZKJ</button>
            </li>
          );
        })}
        {wl.map((s) => (
          <li key={s.call} className="flex flex-wrap items-center gap-1 border-b border-line py-0.5">
            <span className="mono text-xs">{s.call}/WL2K</span>
            <button className="btn btn-xs" type="button" onClick={() => offer(scriptCloseOne(net.ncs, s.call))}>ZKJ</button>
          </li>
        ))}
        {net.ncs ? (
          <li className="flex items-center gap-1 py-0.5">
            <span className="mono text-xs">{net.ncs}/NCS<Triplet value={net.ncsTriplet} ok={net.ncsTripletOk} /></span>
          </li>
        ) : (
          <li className="py-0.5 text-xs text-muted">NCS not heard yet.</li>
        )}
      </ul>
      {away.length > 0 && (
        <p className="mt-1 text-xs text-muted">Out: {away.map((s) => `${s.call} ${s.qsyChannel}`).join(", ")}</p>
      )}
    </div>
  );
}

function ProofBanner({ net }: { net: Net }) {
  if (net.ncsProof === "unknown" && !net.ncsProofNote) return null;
  const tone = net.ncsProof === "good" ? "text-ok" : net.ncsProof === "unknown" ? "text-accent" : "text-danger";
  return (
    <p className={`mb-3 rounded-md border border-line px-3 py-2 text-sm ${tone}`}>
      {net.ncsProofNote || "Net control has not authenticated yet."}
    </p>
  );
}

function LineButtons({ title, hint, items }: { title: string; hint: string; items: { label: string; run: () => void; title?: string }[] }) {
  return (
    <div className="mb-3">
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      <p className="mb-2 text-sm text-muted">{hint}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => (
          <button key={item.label} className="btn btn-xs" type="button" title={item.title} onClick={item.run}>{item.label}</button>
        ))}
      </div>
    </div>
  );
}

function RoleSteps({ net, rows, canOpen, offer, blockOpen }: { net: Net; rows: Rows | null; canOpen: boolean; offer: (text: string) => void; blockOpen: (note: string) => void }) {
  const asNcs = net.role === "ncs";
  const leave = () => {
    if (!asNcs && !callReady()) return;
    offer(scriptDrop(net.ncs, net.myCall, asNcs));
  };
  const trouble = () => {
    if (!asNcs && !callReady()) return;
    offer(scriptEquipment(net.ncs, net.myCall, asNcs));
  };
  const own = [
    { label: "ZKJ", title: "I am closing down", run: leave },
    { label: "ZCJ", title: "Equipment trouble", run: trouble },
  ];
  const callReady = () => {
    if (!net.myCall.trim()) {
      offer("Enter your call first.");
      return false;
    }
    if (!net.ncs.trim()) {
      offer("NCS is blank until an authenticated ZKA is read, or you type that call.");
      return false;
    }
    return true;
  };
  const group = () => {
    if (!rows) return null;
    const chal = challengeFrom(rows);
    const ans = chal ? authenticate(rows, chal[0], chal[1]) : null;
    return chal && ans ? `${chal}${ans}` : null;
  };
  const checkin = [
    { label: "ZKE + ZNB", run: () => { if (callReady()) offer(operatorCheckin(net.ncs, net.myCall, "RF", group())); } },
    { label: "ZKE only", title: "Back from another frequency. Nothing after ZKE.", run: () => { if (callReady()) offer(`${net.ncs} DE ${net.myCall} ZKE K`); } },
    { label: "ZUG ZNB", run: () => { if (callReady()) offer(`${net.ncs} DE ${net.myCall} ZUG ZNB K`); } },
    { label: "ZEV", run: () => { if (callReady()) offer(operatorZev(net.ncs, net.myCall, false)); } },
    { label: "ZUG ZEV", run: () => { if (callReady()) offer(operatorZev(net.ncs, net.myCall, true)); } },
  ];
  if (net.role === "ncs") {
    return (
      <LineButtons
        key="ncs"
        title="Net control"
        hint="Open sends ZKA with a DRYAD triplet. Stations check those three letters before they treat you as net control."
        items={[
          { label: "Open", run: () => {
            const line = canOpen ? scriptOpen(net.ncs, rows) : null;
            if (!line) {
              blockOpen(rows
                ? "The training sheet is not today's DRYAD. Load the real page before you open, or stations will reject the triplet."
                : "No DRYAD is loaded for that day. Do not open until the line can carry a ZNB triplet.");
              return;
            }
            offer(line);
          } },
          { label: "Agency", run: () => offer(scriptAgency(net.ncs)) },
          { label: "Traffic", run: () => offer(scriptTrafficCall(net.ncs)) },
          { label: "Check-ins", run: () => offer(scriptCheckin(net.ncs)) },
          { label: "ZKS", run: () => offer(scriptZks(net)) },
          { label: "Close", run: () => offer(scriptClose(net.ncs)) },
          { label: "Traffic report", title: "Who has each file, and who still needs it by Winlink", run: () => offer(trafficCloseout(net)) },
          { label: "IMI", run: () => {
            const last = [...net.zks].reverse()[0];
            if (last) offer(scriptImi(net.ncs, last));
          } },
          ...own,
        ]}
      />
    );
  }
  if (net.role === "operator") {
    return (
      <LineButtons
        key="operator"
        title="Operator"
        hint={net.ncsProof === "unknown"
          ? "Wait for net control to open with ZKA ZNB and three letters. Paste that line and Read it before you follow."
          : "Check in, then stay silent until net control calls you."}
        items={[...checkin, ...own]}
      />
    );
  }
  if (net.role === "wl2k") {
    const withList = checkin.map((item) =>
      item.label === "ZKE + ZNB"
        ? { ...item, run: () => { if (callReady()) offer(scriptGatewayCheckin(net.ncs, net.myCall, group(), net.gateway)); } }
        : item);
    return (
      <LineButtons
        key="wl2k"
        title="WL2K-GO"
        hint="ZKE + ZNB writes your triplet, then WL2K ZKE and each station below as CALL/WL2K, then QRU. ZKE only is just ZKE, for coming back from another frequency."
        items={[
          ...withList,
          { label: "Gateway message", run: () => offer(gatewayMessage(net)) },
          { label: "Traffic report", title: "Who has each file, and who still needs it by Winlink", run: () => offer(trafficCloseout(net)) },
          ...own,
        ]}
      />
    );
  }
  return (
    <LineButtons
      key="ip"
      title="IP"
      hint="Check in as CALL/IP. List a file with ZBO when net control calls for traffic."
      items={[
        { label: "Check in as IP", run: () => { if (callReady()) offer(operatorCheckin(net.ncs, net.myCall, "IP", null)); } },
        { label: "ZKE only", title: "Back from another frequency. Nothing after ZKE.", run: () => { if (callReady()) offer(`${net.ncs} DE ${net.myCall} ZKE K`); } },
        { label: "ZEV", run: () => { if (callReady()) offer(operatorZev(net.ncs, net.myCall, false)); } },
        { label: "ZUG ZEV", run: () => { if (callReady()) offer(operatorZev(net.ncs, net.myCall, true)); } },
        ...own,
      ]}
    />
  );
}

function TrafficPanel({ net, setNet, offer }: { net: Net; setNet: (n: Net) => void; offer: (text: string) => void }) {
  const [from, setFrom] = useState(() => (net.myCall || net.ncs).toUpperCase());
  const [qty, setQty] = useState("1");
  const [prec, setPrec] = useState("R");
  const [dest, setDest] = useState("");
  const [qsyFor, setQsyFor] = useState<string | null>(null);
  const [partner, setPartner] = useState("");
  const [qsyChannel, setQsyChannel] = useState("80F3");
  const [qsyQty, setQsyQty] = useState("1");
  const [qsyName, setQsyName] = useState("");
  const ipChoices = net.stations.filter((s) => s.method === "IP" && net.zks.includes(s.call) && s.call !== qsyFor);
  const knownFiles = [...new Set(
    net.transfers
      .filter((item) => item.originator === qsyFor && item.file && item.file !== "Unassigned")
      .map((item) => item.file.replace(/\.[^.]+$/, "")),
  )];
  function openQsy(call: string) {
    const choices = net.stations.filter((s) => s.method === "IP" && net.zks.includes(s.call) && s.call !== call);
    setQsyFor(call);
    setPartner(choices.length === 1 ? choices[0].call : "");
    const sameBand = CHANNELS.filter((c) => c !== net.channel && c.slice(0, 2) === net.channel.slice(0, 2));
    setQsyChannel(sameBand[0] ?? CHANNELS.find((c) => c !== net.channel) ?? "80F3");
    setQsyQty("1");
    setQsyName("");
  }
  function sendQsy() {
    if (!qsyFor || !partner || !qsyName.trim() || !Number(qsyQty)) return;
    const line = scriptQsyZof(net.ncs, qsyFor, partner, qsyChannel, Number(qsyQty), qsyName);
    setNet(directQsy(net, qsyFor, partner, qsyChannel, Number(qsyQty), qsyName));
    offer(line);
    setQsyFor(null);
  }
  function prepare() {
    if (!net.outbound.length) return;
    offer(outboundScript(net.ncs, net.outbound));
  }
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold">Traffic</h2>
      <p className="mb-2 text-xs text-muted">Each row is one station's traffic. When their file starts, that count drops by one and the file is tracked below.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-[calc(10ch+1.5rem)] shrink-0 text-xs text-muted">From
          <input className="field mono mt-1 uppercase" maxLength={10} value={from} onChange={(e) => setFrom(e.target.value.toUpperCase().slice(0, 10))} placeholder="CALL" />
        </label>
        <label className="w-[calc(2ch+1.35rem)] shrink-0 text-xs text-muted">Qty
          <input className="field mt-1 px-1 text-center" inputMode="numeric" maxLength={2} value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 2))} />
        </label>
        <label className="w-14 shrink-0 text-xs text-muted">Prec
          <select className="field mt-1 px-1" value={prec} onChange={(e) => setPrec(e.target.value)}>
            {PRECEDENCE.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="w-1/2 text-xs text-muted">To
          <input className="field mono mt-1 uppercase" list="groups" value={dest} onChange={(e) => setDest(e.target.value.toUpperCase())} placeholder="OH or GREE WILM" />
        </label>
      </div>
      <datalist id="groups">{GROUPS.map((g) => <option key={g} value={g} />)}</datalist>
      <button className="btn mt-2" type="button" onClick={() => { setNet(addOutbound(net, from, Number(qty), prec, dest)); setDest(""); }}>Add</button>
      {net.outbound.length > 0 && (
        <ul className="mt-2">
          {net.outbound.map((piece, i) => (
            <li key={`${piece.sender}-${piece.quantity}-${piece.precedence}-${piece.destinations.join("-")}-${i}`} className="flex items-center justify-between gap-2 border-b border-line py-1">
              <span className="mono text-xs">{piece.sender} {piece.quantity} {piece.precedence} {piece.destinations.join(" ")}</span>
              <button className="btn btn-xs" type="button" onClick={() => setNet(removeOutbound(net, i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn btn-accent" type="button" onClick={prepare} disabled={!net.outbound.length}>Prepare ZBO</button>
        {net.role === "ncs" && (
          <button className="btn" type="button" disabled={!net.outbound.length} onClick={() => { setNet(listOnNet(net)); offer(outboundScript(net.ncs, net.outbound)); }}>On the ZBO list</button>
        )}
      </div>

      {net.role === "ncs" && net.offers.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium">Heard — not listed</h3>
          <p className="mb-1 text-xs text-muted">R acknowledges it and puts it on the ZBO list.</p>
          <ul>
            {net.offers.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-1 border-b border-line py-1">
                <span className="mono text-xs">{item.from} {pieceText(item.pieces)}</span>
                <button className="btn btn-xs btn-accent" type="button" onClick={() => { setNet(acknowledgeOffer(net, item.id)); offer(scriptAckZbo(net.ncs, item.from, item.pieces)); }}>R</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mb-1 mt-4 text-sm font-medium">ZBO list</h3>
      {net.traffic.length === 0 && <p className="text-xs text-muted">Nothing listed yet. A station stays off this list until net control says R. Net control's own listing goes on immediately.</p>}
      <ul>
        {net.traffic.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-1 border-b border-line py-1">
            <span className="mono text-xs">{item.originator} {pieceText(item.pieces)}</span>
            {net.role === "ncs" && (
              <>
                <button className="btn btn-xs" type="button" onClick={() => { setNet(setTurn(net, item.originator)); offer(scriptZof(net.ncs, item.originator, item)); }}>ZOF</button>
                <button className="btn btn-xs" type="button" onClick={() => openQsy(item.originator)}>QSY</button>
              </>
            )}
          </li>
        ))}
      </ul>

      {(net.qsos ?? []).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium">QSY</h3>
          <ul>
            {(net.qsos ?? []).map((job) => (
              <li key={job.id} className="border-b border-line py-1">
                <p className="mono text-xs">{job.from} {job.with} QSY {job.channel} ZOF {job.quantity} {job.name}</p>
                <p className="mt-0.5 text-xs">
                  <span className={job.fromAck ? "text-ok" : "text-muted"}>{job.from} {job.fromAck ? "R" : "waiting"}</span>
                  <span className="text-muted"> · </span>
                  <span className={job.withAck ? "text-ok" : "text-muted"}>{job.with} {job.withAck ? "R" : "waiting"}</span>
                </p>
                <button className="btn btn-xs mt-1" type="button" onClick={() => setNet(dismissQsy(net, job.id))}>Clear</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mb-1 mt-4 text-sm font-medium">Files</h3>
      {net.transfers.length === 0 && <p className="text-xs text-muted">No file on the air. Paste the FLAMP header and the station reports.</p>}
      {net.transfers.map((item) => (
        <div key={item.id} className="mb-3 border-b border-line pb-2">
          <p className="mono text-xs">
            {item.originator ? <span>{item.originator} </span> : null}
            {item.file}
            {item.listing ? <span className="text-muted"> {item.listing}</span> : null}
            {item.hash ? <span className="text-accent"> {`{${item.hash}}`}</span> : null}
            {item.blocks ? <span className="text-muted"> {item.blocks} blk</span> : null}
          </p>
          <ul className="mt-1">
            {transferRoster(net, item)
              .filter((row) => (net.role !== "ncs" && net.role !== "wl2k") || !fileViaWl2k(net, item).includes(row.call))
              .map((row) => (
              <li key={row.call} className="flex flex-wrap items-center gap-1 py-0.5">
                <span className="mono text-xs">{row.call}</span>
                {!row.report && <span className="text-xs text-muted">not heard</span>}
                {row.report?.status === "have" && <span className="text-xs text-ok">ZEV</span>}
                {row.report?.status === "none" && <span className="text-xs text-danger">ZUG ZEV</span>}
                {row.report?.preamble && <span className="text-xs text-danger">missing preamble</span>}
                {row.report?.status === "miss" && !row.report.preamble && (
                  <span className="text-xs text-danger">missing {row.report.missing.join(" ")}</span>
                )}
                {row.report?.status !== "have" && (
                  <button className="btn btn-xs btn-accent" type="button" onClick={() => offer(scriptIntZev(net.ncs || net.myCall, row.call, item.hash || item.file || "FILE"))}>INT ZEV</button>
                )}
                {(net.role === "ncs" || net.role === "wl2k") && row.report?.status !== "have" && (
                  <button className="btn btn-xs" type="button" onClick={() => setNet(sendViaWl2k(net, item.id, row.call))}>To WL2K</button>
                )}
              </li>
            ))}
          </ul>
          {(net.role === "ncs" || net.role === "wl2k") && fileViaWl2k(net, item).length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              <span className="mono">{fileViaWl2k(net, item).join(" ")}</span>
              <span className="text-muted">ZOF ZOK WL2K</span>
              {fileViaWl2k(net, item).filter((call) => (item.viaWl2k ?? []).includes(call)).map((call) => (
                <button key={call} className="btn btn-xs" type="button" onClick={() => setNet(recallFromWl2k(net, item.id, call))}>Return {call}</button>
              ))}
            </p>
          )}
          <button className="btn btn-xs mt-1" type="button" onClick={() => setNet(dismissTransfer(net, item.id))}>Clear</button>
        </div>
      ))}
      {qsyFor && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4" onClick={() => setQsyFor(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="qsy-title" className="panel w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <h2 id="qsy-title" className="text-lg font-semibold">QSY {qsyFor}</h2>
            <p className="mt-1 text-sm text-muted">Pick the IP station and the channel. Both have to roger before they leave this frequency.</p>
            <fieldset className="mt-3">
              <legend className="text-xs text-muted">With</legend>
              {ipChoices.length === 0 && <p className="mt-1 text-sm text-muted">No IP station is on the roll. Check one in as CALL ZKE IP, or add them as IP.</p>}
              <div className="mt-1 flex flex-col gap-1">
                {ipChoices.map((s) => (
                  <label key={s.call} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name="qsy-ip" checked={partner === s.call} onChange={() => setPartner(s.call)} />
                    <span className="mono">{s.call}/IP</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-3 grid grid-cols-[7rem_4rem_1fr] gap-2">
              <label className="text-xs text-muted">Channel
                <select className="field mt-1" value={qsyChannel} onChange={(e) => setQsyChannel(e.target.value)}>
                  {CHANNELS.filter((c) => c !== net.channel).map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted">Qty
                <input className="field mt-1" inputMode="numeric" value={qsyQty} onChange={(e) => setQsyQty(e.target.value.replace(/\D/g, ""))} />
              </label>
              <label className="text-xs text-muted">File
                <input className="field mono mt-1 uppercase" value={qsyName} onChange={(e) => setQsyName(e.target.value.toUpperCase())} placeholder="FIELDSITREP" />
              </label>
            </div>
            {knownFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {knownFiles.map((name) => (
                  <button key={name} className="btn btn-xs" type="button" onClick={() => setQsyName(name)}>{name}</button>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="btn" type="button" onClick={() => setQsyFor(null)}>Cancel</button>
              <button className="btn btn-accent" type="button" disabled={!partner || !qsyName.trim() || !Number(qsyQty)} onClick={sendQsy}>Prepare</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WinlinkBox({
  net, setNet, paste, setPaste, offer,
}: {
  net: Net;
  setNet: (n: Net) => void;
  paste: string;
  setPaste: (v: string) => void;
  offer: (text: string) => void;
}) {
  const [call, setCall] = useState("");
  function addCalls() {
    const next = addGatewayCalls(net, call);
    if (next === net) return;
    setNet(next);
    setCall("");
  }
  return (
    <div className="mt-4">
      <h3 className="mb-1 text-sm font-semibold">Checked in via Winlink</h3>
      <p className="mb-2 text-xs text-muted">These go after the second ZKE: WL2K ZKE CALL/WL2K CALL/WL2K QRU K.</p>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <input
          className="field mono w-48 uppercase"
          value={call}
          placeholder="WD8NDS N8SDF"
          onChange={(e) => setCall(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") addCalls(); }}
        />
        <button className="btn btn-xs" type="button" onClick={addCalls}>Add</button>
      </div>
      {net.gateway.length === 0 && <p className="mb-3 text-xs text-muted">No Winlink check-ins yet.</p>}
      <ul className="mb-3">
        {net.gateway.map((item) => (
          <li key={item} className="flex items-center gap-2 border-b border-line py-0.5">
            <span className="mono text-xs">{item}/WL2K</span>
            <button className="btn btn-xs" type="button" onClick={() => setNet(removeGatewayCall(net, item))}>Remove</button>
          </li>
        ))}
      </ul>
      <h3 className="mb-2 text-sm font-semibold">Pre-net Winlink</h3>
      <textarea className="field mono mb-2 h-24" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="N8TAG DE W8ABC/WL2K ZKE K" />
      <button className="btn mb-3" type="button" onClick={() => { if (paste.trim()) { setNet(addInbox(net, paste)); setPaste(""); } }}>Save message</button>
      <ul className="space-y-2 text-sm">
        {net.inbox.length === 0 && <li className="text-muted">No gateway messages yet.</li>}
        {net.inbox.map((m) => (
          <li key={m.id} className="border-b border-line pb-2">
            <p className="mono">{m.from}{m.acked ? " · on roll" : ""}{m.bounce ? " · bounce" : ""}</p>
            <p className="text-muted">{m.text}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {!m.acked && <button className="btn" type="button" onClick={() => { const r = ackInbox(net, m.id); setNet(r.net); offer(r.suggestion); }}>Check in</button>}
              <button className="btn" type="button" onClick={() => setNet(setBounce(net, m.id, !m.bounce))}>{m.bounce ? "Clear bounce" : "Bounce"}</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IpBox({
  net, setNet, fileName, setFileName, folder, setFolder, prec, setPrec, dest, setDest, offer,
}: {
  net: Net;
  setNet: (n: Net) => void;
  fileName: string;
  setFileName: (v: string) => void;
  folder: string;
  setFolder: (v: string) => void;
  prec: string;
  setPrec: (v: string) => void;
  dest: string;
  setDest: (v: string) => void;
  offer: (text: string) => void;
}) {
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">Folders</h3>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <input className="field col-span-2" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="message.k2s" />
        <select className="field" value={folder} onChange={(e) => setFolder(e.target.value)}>
          {FOLDERS.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button className="btn" type="button" onClick={() => { if (!fileName.trim()) return; setNet(addFile(net, folder, fileName, prec, dest)); setFileName(""); }}>Drop file</button>
      </div>
      {FOLDERS.map((name) => {
        const files = net.files.filter((f) => f.folder === name);
        if (!files.length) return null;
        return (
          <div key={name} className="mb-2">
            <p className="text-sm font-medium">{name}</p>
            <ul>
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 border-b border-line py-1 text-sm">
                  <span className="mono">{f.name}</span>
                  <span className="text-muted">{f.precedence} {f.destination}</span>
                  <select className="field w-28" value={f.folder} onChange={(e) => setNet(moveFile(net, f.id, e.target.value))}>
                    {FOLDERS.map((folderName) => <option key={folderName}>{folderName}</option>)}
                  </select>
                  <button className="btn" type="button" onClick={() => { const r = listFile(net, f.id); setNet(r.net); offer(r.suggestion); setPrec(f.precedence); setDest(f.destination); }}>Prepare ZBO</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

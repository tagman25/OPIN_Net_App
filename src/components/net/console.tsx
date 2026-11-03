import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ClipboardCopy,
  Download,
  Radio,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { codesInText, CODES, lookupCode } from "@/lib/ncs/codes";
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
import {
  CHANNELS,
  FOLDERS,
  GROUPS,
  PRECEDENCE,
  acceptExempt,
  ackInbox,
  addFile,
  addInbox,
  addManualStation,
  addManualTraffic,
  awayStations,
  directTraffic,
  emptyNet,
  gatewayMessage,
  ingest,
  listFile,
  markComplete,
  moveFile,
  myPlace,
  onAir,
  operatorCheckin,
  operatorZbo,
  operatorZev,
  pendingCalls,
  recordManualZev,
  scriptAgency,
  scriptCheckin,
  scriptClose,
  scriptCloseOne,
  scriptImi,
  scriptOpen,
  scriptReturn,
  scriptTrafficCall,
  scriptZks,
  scriptZof,
  sessionK2s,
  sessionReport,
  setBounce,
  setQsy,
  setTurn,
  setVia,
  unanswered,
  wl2kStations,
  zksLine,
  type Method,
  type Net,
  type Role,
  type Traffic,
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
    return { ...emptyNet(), ...parsed };
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
  { id: "wl2k", label: "Winlink", hint: "Gateway and follow-up" },
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
  const [row, setRow] = useState("A");
  const [letter, setLetter] = useState("");
  const [verify, setVerify] = useState("");
  const [manualCall, setManualCall] = useState("");
  const [manualMethod, setManualMethod] = useState<Method>("RF");
  const [manualExempt, setManualExempt] = useState(false);
  const [qsyPick, setQsyPick] = useState("80F2");
  const [tQty, setTQty] = useState(1);
  const [tPrec, setTPrec] = useState("R");
  const [tDest, setTDest] = useState("OPIN");
  const [tFile, setTFile] = useState("");
  const [inboxPaste, setInboxPaste] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileFolder, setFileFolder] = useState("Incoming");
  const [flamp, setFlamp] = useState("");

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

  function readRx(block = rx) {
    const result = ingest(net, block, rows, net.role === "ncs");
    setNet(result.net);
    if (result.suggestion) setDraft(result.suggestion);
  }

  function practice() {
    const book = training.rows;
    const good = `${"C"}${book.C?.[3] ?? "D"}${authenticate(book, "C", book.C?.[3] ?? "D") ?? "A"}`;
    const ncs = net.ncs || "N8TAG";
    const lines = [
      `OPIN DE ${ncs} ZKA ZKB AS`,
      `${ncs} DE KE8YTX ZKE ZNB ${good} ZBO 1 R FIELDSITREP K`,
      `${ncs} DE KD8TTE ZUG ZNB QRU K`,
      `${ncs} DE W8ABC/WL2K ZKE K`,
      `KE8YTX DE ${ncs} ZOF 1 R OPIN FIELDSITREP.K2S K`,
      `DE KE8YTX FILE : FIELDSITREP.K2S NBLK : 8 CONFIRMED`,
      `${ncs} DE KD8TTE ZUG ZEV AR`,
      `${ncs} DE W8ABC ZUG ZEV AR`,
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

  function loadDryad() {
    const parsed = parseDryadText(dryadPaste);
    setDryadNotes(parsed.notes.length ? parsed.notes : [`Loaded ${parsed.days.length} day${parsed.days.length === 1 ? "" : "s"}. Kept in this browser only.`]);
    if (!parsed.days.length) return;
    setDays((prev) => {
      const map = new Map(prev.map((d) => [d.date, d]));
      for (const day of parsed.days) map.set(day.date, day);
      return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    });
    setActiveDate(parsed.days[0].date);
    setForceTraining(false);
    setDryadPaste("");
  }

  const found = codesInText(`${rx}\n${draft}`);
  const searchHits = query.trim()
    ? CODES.filter((c) => c.code.includes(query.toUpperCase()) || c.meaning.toUpperCase().includes(query.toUpperCase()))
    : CODES;
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
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-accent">
            <Radio size={16} aria-hidden /> OPIN digital net
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Net assistant</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Suggestions stay on this page until you copy them into fldigi. Nothing is transmitted from here.
          </p>
        </div>
        <p className="text-sm text-muted">
          {usingTraining ? "Training DRYAD — not for a real net" : table ? `DRYAD ${table.label}` : "No DRYAD for that day"}
          {net.netOpen ? " · net open" : " · net not open"}
        </p>
      </header>

      <section className="panel mb-3 flex flex-wrap gap-2 p-3">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={net.role === r.id ? "btn btn-accent" : "btn"}
            onClick={() => setNet({
            ...net,
            role: r.id,
            myCall: r.id === "ncs" ? net.ncs : net.myCall === net.ncs ? "" : net.myCall,
          })}
          >
            {r.label}
          </button>
        ))}
        <label className="min-w-28 flex-1 text-sm text-muted">
          My call
          <input className="field mono mt-1 uppercase" placeholder="Your call" value={net.myCall} onChange={(e) => setNet({ ...net, myCall: e.target.value.toUpperCase(), ncs: net.role === "ncs" ? e.target.value.toUpperCase() : net.ncs })} />
        </label>
        <label className="min-w-28 flex-1 text-sm text-muted">
          NCS
          <input className="field mono mt-1 uppercase" value={net.ncs} onChange={(e) => setNet({ ...net, ncs: e.target.value.toUpperCase() })} />
        </label>
        <label className="min-w-24 flex-1 text-sm text-muted">
          Band
          <input className="field mt-1" value={net.band} onChange={(e) => setNet({ ...net, band: e.target.value })} />
        </label>
        <label className="min-w-28 flex-1 text-sm text-muted">
          Channel
          <select className="field mt-1" value={net.channel} onChange={(e) => setNet({ ...net, channel: e.target.value })}>
            {CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <button className="btn self-end" type="button" onClick={() => { setNet(emptyNet(net.ncs)); setDraft(""); setRx(""); }}>
          <RotateCcw size={16} className="mr-1 inline" /> New session
        </button>
      </section>

      <nav className="mb-3 flex gap-2 overflow-x-auto">
        {([
          ["desk", "Desk"],
          ["auth", "DRYAD"],
          ["codes", "Codes"],
          ["log", "Log"],
          ["files", "Files"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={view === id ? "btn btn-on" : "btn"} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>

      {view === "desk" && (
        <div className="grid gap-3 lg:grid-cols-12">
          <section className="panel p-3 lg:col-span-3">
            <h2 className="mb-2 text-sm font-semibold">ZKS roll</h2>
            <p className="mono mb-3 text-sm text-muted">{zksLine(net)}</p>
            <h3 className="mb-1 text-sm font-medium">Pending</h3>
            <ul className="mb-3 max-h-40 overflow-auto text-sm">
              {pendingCalls(net).length === 0 && <li className="text-muted">No one waiting on a DRYAD.</li>}
              {pendingCalls(net).map((c) => (
                <li key={c} className="flex items-center justify-between gap-2 border-b border-line py-1">
                  <span className="mono">{c}</span>
                  <button className="btn px-2" type="button" onClick={() => setNet(acceptExempt(net, c))}>ZUG ZNB</button>
                </li>
              ))}
            </ul>
            <h3 className="mb-1 text-sm font-medium">On air</h3>
            <Roster net={net} onCall={(call) => setNet(setTurn(net, call))} onClose={(call) => offer(scriptCloseOne(net.ncs, call))} />
            <h3 className="mb-1 mt-3 text-sm font-medium">Winlink only</h3>
            <ul className="text-sm">
              {wl2kStations(net).length === 0 && <li className="text-muted">No /WL2K stations.</li>}
              {wl2kStations(net).map((s) => <li key={s.call} className="mono border-b border-line py-1">{s.call}/WL2K</li>)}
            </ul>
            <h3 className="mb-1 mt-3 text-sm font-medium">Out on QSY</h3>
            <ul className="text-sm">
              {awayStations(net).length === 0 && <li className="text-muted">Everyone is on the net channel.</li>}
              {awayStations(net).map((s) => (
                <li key={s.call} className="flex items-center justify-between gap-2 border-b border-line py-1">
                  <span className="mono">{s.call} {s.qsyChannel}</span>
                  <button className="btn px-2" type="button" onClick={() => { setNet(setQsy(net, s.call, null)); offer(scriptReturn(net.ncs, s.call)); }}>Back</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel p-3 lg:col-span-5">
            <RoleSteps net={net} rows={rows} offer={offer} />
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
            <textarea className="field mono mb-2 h-24" value={rx} onChange={(e) => setRx(e.target.value)} placeholder="N8TAG DE KE8YTX ZKE ZNB ABC K" />
            {found.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2">
                {found.slice(0, 4).map((c) => (
                  <li key={c.code} className="chip text-xs">{c.code} — {c.meaning}</li>
                ))}
                {found.length > 4 && <li className="self-center text-xs text-muted">+{found.length - 4} more under Codes</li>}
              </ul>
            )}
            <div className="mb-4 flex flex-wrap gap-2">
              <button className="btn btn-accent" type="button" onClick={() => readRx()}>Read this</button>
              <button className="btn" type="button" onClick={practice}>Practice net</button>
            </div>
            <h2 className="mb-2 text-sm font-semibold">Suggested reply — edit, then copy</h2>
            <textarea className="field mono mb-2 h-24" value={draft} onChange={(e) => setDraft(e.target.value)} />
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

          <section className="panel p-3 lg:col-span-4">
            <h2 className="mb-2 text-sm font-semibold">Traffic</h2>
            <TrafficList net={net} setNet={setNet} offer={offer} qsyPick={qsyPick} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="text-sm text-muted">Qty
                <input className="field mt-1" type="number" min={1} value={tQty} onChange={(e) => setTQty(Number(e.target.value) || 1)} />
              </label>
              <label className="text-sm text-muted">Precedence
                <select className="field mt-1" value={tPrec} onChange={(e) => setTPrec(e.target.value)}>
                  {PRECEDENCE.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="col-span-2 text-sm text-muted">To
                <input className="field mono mt-1 uppercase" list="groups" value={tDest} onChange={(e) => setTDest(e.target.value.toUpperCase())} />
              </label>
              <datalist id="groups">{GROUPS.map((g) => <option key={g} value={g} />)}</datalist>
              <label className="col-span-2 text-sm text-muted">File
                <input className="field mono mt-1" value={tFile} onChange={(e) => setTFile(e.target.value)} placeholder="FIELDSITREP.k2s" />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn" type="button" onClick={() => setNet(addManualTraffic(net, net.role === "ncs" ? manualCall || net.ncs : net.myCall, tQty, tPrec, tDest, tFile))}>List it</button>
              {net.role !== "ncs" && (
                <button className="btn btn-accent" type="button" onClick={() => offer(operatorZbo(net.ncs, net.myCall, tQty, tPrec, tDest))}>Prepare ZBO</button>
              )}
            </div>
            <h3 className="mb-1 mt-4 text-sm font-medium">Add a station</h3>
            <div className="flex flex-wrap gap-2">
              <input className="field mono w-28 uppercase" placeholder="CALL" value={manualCall} onChange={(e) => setManualCall(e.target.value.toUpperCase())} />
              <select className="field w-28" value={manualMethod} onChange={(e) => setManualMethod(e.target.value as Method)}>
                <option value="RF">RF</option>
                <option value="WL2K">WL2K</option>
                <option value="IP">IP</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={manualExempt} onChange={(e) => setManualExempt(e.target.checked)} /> No DRYAD
              </label>
              <button className="btn" type="button" onClick={() => { setNet(addManualStation(net, manualCall, manualMethod, manualExempt || manualMethod === "WL2K")); setManualCall(""); }}>Add</button>
            </div>
            {net.role === "ncs" && (
              <label className="mt-3 block text-sm text-muted">QSY channel
                <select className="field mt-1" value={qsyPick} onChange={(e) => setQsyPick(e.target.value)}>
                  {CHANNELS.filter((c) => c !== net.channel).map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            )}
            {net.done.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-medium">Follow-up</h3>
                <ul className="max-h-40 overflow-auto text-sm">
                  {net.done.map((t) => (
                    <li key={t.id} className="border-b border-line py-1">
                      <span className="mono">{t.file ?? t.destination}</span>
                      <span className="text-muted"> · Winlink {t.refused.join(" ") || "none"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {view === "auth" && (
        <section className="panel max-w-xl p-3">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} /> DRYAD / ZNB</h2>
          <p className="mb-3 text-sm text-muted">
            INT ZNB AB asks for the letter under B on row A. A check-in ZNB ABC already answers: the authentication of AB is C. A real table stays in this browser. It is not sent anywhere.
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
          <h3 className="mb-2 mt-6 text-sm font-semibold">Paste a daily page</h3>
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
          <input className="field mb-3 max-w-md" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ZKE, QSY, routine…" />
          <ul className="grid gap-2 sm:grid-cols-2">
            {searchHits.map((c) => (
              <li key={`${c.kind}-${c.code}-${c.meaning.slice(0, 12)}`} className="border-b border-line py-2">
                <p className="mono text-accent">{c.code} <span className="text-muted">{c.kind}</span></p>
                <p className="text-sm">{c.meaning}</p>
                {c.question && <p className="text-sm text-muted">{c.question}</p>}
                {c.example && <p className="mono text-sm text-muted">{c.example}</p>}
              </li>
            ))}
          </ul>
          {query && lookupCode(query).length === 0 && searchHits.length === 0 && <p className="text-sm text-muted">No match in the net set.</p>}
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
                    if (parsed?.zks && parsed?.traffic) setNet({ ...emptyNet(), ...parsed });
                  } catch {
                    setDryadNotes(["That file is not a session export."]);
                  }
                }} />
              </label>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Roster({ net, onCall, onClose }: { net: Net; onCall: (call: string) => void; onClose: (call: string) => void }) {
  const rows = onAir(net);
  if (!rows.length) return <p className="text-sm text-muted">Empty until someone authenticates or is accepted.</p>;
  return (
    <ul className="max-h-48 overflow-auto text-sm">
      {rows.map((s) => (
        <li key={s.call} className="flex items-center justify-between gap-2 border-b border-line py-1">
          <button type="button" className="mono text-left" onClick={() => onCall(s.call)}>
            {s.method === "IP" ? `${s.call}/IP` : s.call}
            {s.zug ? " · ZUG" : ""}
            {net.turn === s.call ? " · called" : ""}
          </button>
          <button className="btn px-2" type="button" onClick={() => onClose(s.call)}>ZKJ</button>
        </li>
      ))}
    </ul>
  );
}

function RoleSteps({ net, rows, offer }: { net: Net; rows: Rows | null; offer: (text: string) => void }) {
  if (net.role === "ncs") {
    const steps = [
      ["Open", scriptOpen(net.ncs)],
      ["Agency", scriptAgency(net.ncs)],
      ["Traffic", scriptTrafficCall(net.ncs)],
      ["Check-ins", scriptCheckin(net.ncs)],
      ["ZKS", scriptZks(net)],
      ["Close", scriptClose(net.ncs)],
    ];
    return (
      <div className="mb-3">
        <h2 className="mb-2 text-sm font-semibold">Net control</h2>
        <div className="flex flex-wrap gap-2">
          {steps.map(([label, text]) => (
            <button key={label} className="btn" type="button" onClick={() => offer(text)}>{label}</button>
          ))}
          <button className="btn" type="button" onClick={() => {
            const last = [...net.zks].reverse()[0];
            if (last) offer(scriptImi(net.ncs, last));
          }}>IMI</button>
        </div>
      </div>
    );
  }
  if (net.role === "operator") {
    return (
      <div className="mb-3">
        <h2 className="mb-2 text-sm font-semibold">General operator</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-accent" type="button" onClick={() => {
            if (!net.myCall.trim()) { offer("Enter your call first."); return; }
            let group: string | null = null;
            if (rows) {
              const chal = challengeFrom(rows);
              const ans = chal ? authenticate(rows, chal[0], chal[1]) : null;
              if (chal && ans) group = `${chal}${ans}`;
            }
            offer(operatorCheckin(net.ncs, net.myCall, "RF", group));
          }}>ZKE + ZNB</button>
          <button className="btn" type="button" onClick={() => offer(net.myCall.trim() ? operatorCheckin(net.ncs, net.myCall, "RF", null) : "Enter your call first.")}>ZKE only</button>
          <button className="btn" type="button" onClick={() => offer(net.myCall.trim() ? `${net.ncs} DE ${net.myCall} ZUG ZNB K` : "Enter your call first.")}>ZUG ZNB</button>
          <button className="btn" type="button" onClick={() => offer(net.myCall.trim() ? operatorZev(net.ncs, net.myCall, false) : "Enter your call first.")}>ZEV</button>
          <button className="btn" type="button" onClick={() => offer(net.myCall.trim() ? operatorZev(net.ncs, net.myCall, true) : "Enter your call first.")}>ZUG ZEV</button>
        </div>
      </div>
    );
  }
  if (net.role === "wl2k") {
    return (
      <div className="mb-3">
        <h2 className="mb-2 text-sm font-semibold">Winlink gateway</h2>
        <p className="mb-2 text-sm text-muted">Before the net, check OPIN@winlink.org for ZKE messages. Paste them below, acknowledge, and they join the roll as CALL/WL2K.</p>
        <button className="btn" type="button" onClick={() => offer(gatewayMessage(net))}>Prepare gateway message</button>
      </div>
    );
  }
  return (
    <div className="mb-3">
      <h2 className="mb-2 text-sm font-semibold">IP station</h2>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-accent" type="button" onClick={() => offer(net.myCall.trim() ? operatorCheckin(net.ncs, net.myCall, "IP", null) : "Enter your call first.")}>Check in as IP</button>
        <button className="btn" type="button" onClick={() => offer(net.myCall.trim() ? operatorZev(net.ncs, net.myCall, false) : "Enter your call first.")}>ZEV</button>
      </div>
    </div>
  );
}

function TrafficList({
  net, setNet, offer, qsyPick,
}: {
  net: Net;
  setNet: (n: Net) => void;
  offer: (text: string) => void;
  qsyPick: string;
}) {
  if (!net.traffic.length) {
    return <p className="text-sm text-muted">No open ZBO. A listing leaves this list after ZOF and a ZEV or ZUG ZEV from every station on the roll.</p>;
  }
  return (
    <ul className="max-h-80 space-y-3 overflow-auto">
      {net.traffic.map((t) => (
        <TrafficCard key={t.id} net={net} item={t} setNet={setNet} offer={offer} qsyPick={qsyPick} />
      ))}
    </ul>
  );
}

function TrafficCard({
  net, item, setNet, offer, qsyPick,
}: {
  net: Net;
  item: Traffic;
  setNet: (n: Net) => void;
  offer: (text: string) => void;
  qsyPick: string;
}) {
  const waiting = unanswered(net, item);
  return (
    <li className="border-b border-line pb-2">
      <p className="mono text-sm">{item.originator} ZBO {item.quantity} {item.precedence} {item.destination}</p>
      <p className="text-sm text-muted">
        {item.file ?? "no file"} · {item.zof ? "directed" : "listed"} · {item.via}
        {item.blocks ? ` · ${item.blocks} blocks` : ""}
      </p>
      <p className="text-sm">Waiting {waiting.join(" ") || "none"}</p>
      {Object.entries(item.missingBy).map(([call, blocks]) => (
        <p key={call} className="text-sm text-danger"> {call} missing {blocks.join(" ")}</p>
      ))}
      {net.role === "ncs" && (
        <div className="mt-1 flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={() => { setNet(directTraffic(net, item.id, item.originator)); offer(scriptZof(net.ncs, item.originator, item)); }}>ZOF</button>
          <button className="btn" type="button" onClick={() => { setNet(setQsy(directTraffic(net, item.id, item.originator), item.originator, qsyPick)); offer(`${item.originator} DE ${net.ncs} QSY ${qsyPick} ZOF ${item.quantity} ${item.precedence} ${item.destination}${item.file ? ` ${item.file}` : ""} K`); }}>QSY + ZOF</button>
          <button className="btn" type="button" onClick={() => setNet(setVia(net, item.id, "wl2k"))}>Via Winlink</button>
          <button className="btn" type="button" onClick={() => setNet(markComplete(net, item.id))}>Follow-up</button>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        {net.zks.slice(0, 4).map((c) => (
          <button key={c} className="btn px-2" type="button" onClick={() => setNet(recordManualZev(net, item.id, c, "zev", []))}>{c} ZEV</button>
        ))}
      </div>
    </li>
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
  return (
    <div className="mt-4">
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
                  <button className="btn" type="button" onClick={() => { const r = listFile(net, f.id); setNet(r.net); offer(r.suggestion); setPrec(f.precedence); setDest(f.destination); }}>List ZBO</button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

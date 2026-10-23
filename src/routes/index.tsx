import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Radio, RotateCcw } from "lucide-react";
import days from "@/lib/ncs/dryads.json";
import {
  authenticate,
  emptyNet,
  interpret,
  makeTriplet,
  markComplete,
  pendingCalls,
  scriptAgency,
  scriptCheckin,
  scriptClose,
  scriptCloseOne,
  scriptImi,
  scriptOpen,
  scriptTrafficCall,
  scriptZks,
  sessionReport,
  unanswered,
  type Net,
  type Rows,
} from "@/lib/ncs/protocol";

type Day = { date: string; rows: Rows };
const TABLES = days as Day[];

export const Route = createFileRoute("/")({ component: Desk });

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function loadNet(): Net {
  try {
    const raw = localStorage.getItem("opin-ncs-v1");
    if (!raw) return emptyNet();
    const parsed = JSON.parse(raw) as Net;
    if (!parsed.zks || !parsed.traffic) return emptyNet();
    return parsed;
  } catch {
    return emptyNet();
  }
}

function Desk() {
  const initialDate = TABLES.some((d) => d.date === todayKey()) ? todayKey() : "2026-10-23";
  const [net, setNet] = useState<Net>(emptyNet);
  const [ready, setReady] = useState(false);
  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<"NCS" | "Station">("NCS");
  const [tab, setTab] = useState<"net" | "follow" | "auth" | "log">("net");
  const [rx, setRx] = useState("");
  const [draft, setDraft] = useState("");
  const [row, setRow] = useState("A");
  const [letter, setLetter] = useState("");
  const [lookup, setLookup] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setNet(loadNet());
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("opin-ncs-v1", JSON.stringify(net));
  }, [net, ready]);

  const table = useMemo(() => TABLES.find((d) => d.date === date) ?? null, [date]);

  function offer(text: string) {
    setDraft(text);
    setNet((n) => ({ ...n, lastTx: text, log: [...n.log, { time: new Date().toISOString().slice(11, 16), source: "SYSTEM", message: `Prepared: ${text}` }].slice(-300) }));
  }

  function applyRx(block: string) {
    setNet((current) => {
      let next = { ...current, ncs: current.ncs.toUpperCase() };
      let last: string | null = null;
      for (const line of block.split("\n")) {
        const result = interpret(next, line, table?.rows ?? null, mode === "NCS");
        next = result.net;
        if (result.suggestion) last = result.suggestion;
      }
      if (last) {
        setDraft(last);
        next = { ...next, lastTx: last };
      }
      return next;
    });
  }

  function walkthrough() {
    if (!table) return;
    const good = makeTriplet(table.rows, true);
    const ncs = net.ncs || "N8TAG";
    const lines = [
      `${ncs} DE KE8YTX ZKE ZNB ${good} ZBO 1 R FIELDSITREP K`,
      `${ncs} DE KD8TTE ZUG ZNB QRU K`,
      `KE8YTX DE ${ncs} ZOF 1 R OPIN K`,
      `DE KE8YTX FILE : FIELDSITREP.K2S CONFIRMED`,
      `${ncs} DE KD8TTE ZUG ZEV AR`,
    ];
    setRx(lines.join("\n"));
    applyRx(lines.join("\n"));
    setTab("follow");
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function downloadReport() {
    const text = sessionReport(net);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "OPIN-session-report.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const pending = pendingCalls(net);
  const answer = table && letter ? authenticate(table.rows, row.toUpperCase(), letter.toUpperCase()) : null;

  return (
    <main className="desk mx-auto max-w-6xl px-3 py-4 sm:px-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-accent">OPIN digital net</p>
          <h1 className="text-2xl font-semibold tracking-tight">Net control desk</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Suggestions stay in the box until you copy them into FLDigi. Nothing is transmitted from here.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <a className="btn btn-accent" href="/OPIN-NCS-laptop.tar.gz" download="OPIN-NCS-laptop.tar.gz">
            Download laptop program
          </a>
          <div className="flex items-center gap-2 text-muted">
            <Radio size={18} aria-hidden />
            <span className="text-sm">{table ? `DRYAD ${table.date}` : "No DRYAD for that date"}</span>
          </div>
        </div>
      </header>

      <section className="panel mb-3 flex flex-wrap gap-2 p-3">
        <label className="text-sm text-muted">
          My call
          <input
            className="field mono ml-2 w-28 uppercase"
            value={net.ncs}
            onChange={(e) => setNet({ ...net, ncs: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="text-sm text-muted">
          Band
          <input
            className="field ml-2 w-36"
            placeholder="80m / 60m / 40m"
            value={net.band}
            onChange={(e) => setNet({ ...net, band: e.target.value })}
          />
        </label>
        <label className="text-sm text-muted">
          DRYAD day
          <input className="field ml-2" type="date" value={date} min="2026-10-01" max="2026-11-30" onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm text-muted">
          Mode
          <select className="field ml-2" value={mode} onChange={(e) => setMode(e.target.value as "NCS" | "Station")}>
            <option value="NCS">NCS</option>
            <option value="Station">Station</option>
          </select>
        </label>
        <button className="btn" type="button" onClick={() => { setNet(emptyNet(net.ncs)); setDraft(""); setRx(""); }}>
          <RotateCcw size={16} className="mr-1 inline" /> New session
        </button>
      </section>

      <section className="mb-3 flex flex-wrap gap-2">
        <button className="btn" type="button" onClick={() => offer(scriptOpen(net.ncs))}>Open net</button>
        <button className="btn" type="button" onClick={() => offer(scriptAgency(net.ncs))}>INT AGENCY</button>
        <button className="btn" type="button" onClick={() => offer(scriptTrafficCall(net.ncs))}>INT ZBO</button>
        <button className="btn" type="button" onClick={() => offer(scriptCheckin(net.ncs))}>INT ZKE</button>
        <button className="btn" type="button" onClick={() => offer(scriptZks(net.ncs, net.zks))}>ZKS roll</button>
        <button className="btn" type="button" onClick={() => {
          const last = [...net.stations].reverse().find((s) => s.call !== net.ncs);
          if (last) offer(scriptImi(net.ncs, last.call));
        }}>IMI</button>
        <button className="btn" type="button" onClick={() => offer(scriptClose(net.ncs))}>Close net</button>
        <button className="btn" type="button" onClick={walkthrough}>Walk a short net</button>
      </section>

      <nav className="mb-3 flex flex-wrap gap-2">
        {([
          ["net", "Net"],
          ["follow", `Follow-up (${net.done.length})`],
          ["auth", "Authentication"],
          ["log", "Log"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "btn btn-accent" : "btn"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "net" && (
        <div className="grid gap-3 lg:grid-cols-3">
          <section className="panel p-3">
            <h2 className="mb-2 text-sm font-semibold">Pending authentication</h2>
            <ul className="scroll-list mono text-sm">
              {pending.length === 0 && <li className="text-muted">Nobody waiting. A ZKE stays here until ZNB checks, unless they send ZUG ZNB.</li>}
              {pending.map((c) => <li key={c} className="border-b border-line py-1">{c}</li>)}
            </ul>
            <h2 className="mb-2 mt-4 text-sm font-semibold">ZKS roll</h2>
            <ul className="scroll-list mono text-sm">
              {net.zks.length === 0 && <li className="text-muted">Empty until someone authenticates.</li>}
              {net.zks.map((c) => {
                const st = net.stations.find((s) => s.call === c);
                return (
                  <li key={c} className="flex items-center justify-between border-b border-line py-1">
                    <span>{c}{st?.zug ? "  ZUG ZNB" : ""}</span>
                    <button className="btn px-2" type="button" onClick={() => offer(scriptCloseOne(net.ncs, c))}>ZKJ</button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="panel p-3 lg:col-span-1">
            <h2 className="mb-2 text-sm font-semibold">What FLDigi printed</h2>
            <textarea className="field mono mb-2 h-36 w-full" value={rx} onChange={(e) => setRx(e.target.value)} placeholder="N8TAG DE KE8YTX ZKE ZNB ... K" />
            <button className="btn btn-accent mb-4" type="button" onClick={() => applyRx(rx)}>Read this traffic</button>
            <h2 className="mb-2 text-sm font-semibold">Suggested reply — edit, then copy</h2>
            <textarea className="field mono mb-2 h-28 w-full" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn btn-accent" type="button" onClick={copyDraft}>
              <ClipboardCopy size={16} className="mr-1 inline" /> {copied ? "Copied" : "Copy for FLDigi"}
            </button>
          </section>

          <section className="panel p-3">
            <h2 className="mb-2 text-sm font-semibold">Active traffic</h2>
            <ul className="scroll-list text-sm">
              {net.traffic.length === 0 && <li className="text-muted">No open ZBO. A listing moves to Follow-up after ZOF and a ZEV or ZUG ZEV from every station on the roll.</li>}
              {net.traffic.map((t) => (
                <li key={t.id} className="mb-2 border-b border-line pb-2">
                  <p className="mono">{t.originator} ZBO {t.quantity} {t.precedence} {t.destination}</p>
                  <p className="text-muted">ZOF {t.zof ? "yes" : "no"} · waiting {unanswered(net, t).join(" ") || "none"}</p>
                  <button className="btn mt-1" type="button" onClick={() => setNet(markComplete(net, t.id))}>Move to follow-up</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {tab === "follow" && (
        <section className="panel p-3">
          <h2 className="mb-1 text-sm font-semibold">Who has the file, who still needs Winlink</h2>
          <p className="mb-3 text-sm text-muted">ZEV means they have it. ZUG ZEV means they do not acknowledge it, so it still has to go by Winlink. No report means they never answered.</p>
          {net.done.length === 0 && <p className="text-sm text-muted">Nothing finished yet. Use “Walk a short net” to see a listing land here.</p>}
          <ul className="space-y-3">
            {net.done.map((t) => {
              const silent = net.zks.filter((c) => !t.received.includes(c) && !t.refused.includes(c));
              return (
                <li key={t.id} className="border-b border-line pb-3">
                  <p className="mono font-medium">{t.file ?? t.destination} · {t.originator} {t.precedence}</p>
                  <p className="text-sm">Has it: {t.received.join(", ") || "none"}</p>
                  <p className="text-sm">Winlink: {t.refused.join(", ") || "none"}</p>
                  <p className="text-sm text-muted">No report: {silent.join(", ") || "none"}</p>
                </li>
              );
            })}
          </ul>
          <button className="btn mt-3" type="button" onClick={downloadReport}>Download session report</button>
        </section>
      )}

      {tab === "auth" && (
        <section className="panel max-w-lg p-3">
          <h2 className="mb-2 text-sm font-semibold">DRYAD lookup for {date}</h2>
          <p className="mb-3 text-sm text-muted">INT ZNB AB asks for the letter under B in row A. A check-in of ZNB ABC is already the answer: AB authenticates as C.</p>
          <div className="flex flex-wrap gap-2">
            <label className="text-sm text-muted">Row
              <input className="field mono ml-2 w-16 uppercase" maxLength={1} value={row} onChange={(e) => setRow(e.target.value.toUpperCase())} />
            </label>
            <label className="text-sm text-muted">Letter
              <input className="field mono ml-2 w-16 uppercase" maxLength={1} value={letter} onChange={(e) => setLetter(e.target.value.toUpperCase())} />
            </label>
            <button className="btn" type="button" onClick={() => setLookup(answer ? `ZNB ${answer}` : "Not in this table")}>Look up</button>
          </div>
          <p className="mono mt-4 text-lg">{lookup || (answer ? `Would authenticate ${answer}` : "Enter a row and a letter from that row.")}</p>
        </section>
      )}

      {tab === "log" && (
        <section className="panel p-3">
          <ul className="mono max-h-[28rem] overflow-auto text-sm">
            {net.log.length === 0 && <li className="text-muted">The log fills as traffic is read.</li>}
            {net.log.map((e, i) => (
              <li key={`${e.time}-${i}`} className="border-b border-line py-1">{e.time}  {e.source}  {e.message}</li>
            ))}
          </ul>
          <button className="btn mt-3" type="button" onClick={downloadReport}>Download session report</button>
        </section>
      )}
    </main>
  );
}

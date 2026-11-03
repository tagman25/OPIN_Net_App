export type Rows = Record<string, string>;

export type DryadDay = {
  date: string;
  label: string;
  from: string;
  until: string;
  rows: Rows;
  training: boolean;
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXY";
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** A fixed practice table. Not an operational DRYAD and not derived from one. */
export function trainingDay(date = todayKey()): DryadDay {
  const rows: Rows = {};
  for (let i = 0; i < 25; i++) {
    const rotated = LETTERS.slice(i) + LETTERS.slice(0, i);
    const row = i % 2 === 0 ? rotated : rotated.split("").reverse().join("");
    rows[LETTERS[i]] = row;
  }
  return {
    date,
    label: "TRAINING",
    from: "practice",
    until: "practice",
    rows,
    training: true,
  };
}

export function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function authenticate(rows: Rows, rowLetter: string, challengeLetter: string): string | null {
  const row = rows[rowLetter.toUpperCase()];
  if (!row) return null;
  const col = row.indexOf(challengeLetter.toUpperCase());
  if (col < 0) return null;
  const next = rowLetter.toUpperCase() === "Y" ? "A" : String.fromCharCode(rowLetter.toUpperCase().charCodeAt(0) + 1);
  const below = rows[next];
  if (!below || col >= below.length) return null;
  return below[col];
}

export function tripletValid(rows: Rows, group: string): boolean {
  if (group.length !== 3) return false;
  const expected = authenticate(rows, group[0], group[1]);
  return Boolean(expected) && expected === group[2];
}

export function challengeFrom(rows: Rows): string | null {
  const keys = Object.keys(rows).filter((r) => r !== "Y" && rows[r]?.length === 25);
  if (!keys.length) return null;
  const row = keys[Math.floor(Math.random() * keys.length)];
  const letters = rows[row];
  return `${row}${letters[Math.floor(Math.random() * letters.length)]}`;
}

export function makeTriplet(rows: Rows, good: boolean): string {
  const row = "C";
  const letter = rows[row]?.[3] ?? "A";
  const answer = authenticate(rows, row, letter) ?? "A";
  const bad = answer === "A" ? "B" : "A";
  return `${row}${letter}${good ? answer : bad}`;
}

function stampToIso(raw: string): { date: string; label: string } | null {
  const m = raw.match(/(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[4]];
  if (month === undefined) return null;
  const day = Number(m[1]);
  const year = Number(m[5]);
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, label: `${m[1]} ${m[4]} ${year}` };
}

function isHeaderRow(row: string): boolean {
  return (
    row.startsWith("ABCDEFGHIJKLMNOPQRSTUVWXYZ") ||
    row.startsWith("BCDEFGHIJKLMNOPQRSTUVWXYZ")
  );
}

/**
 * Parse one or more OPIN DRYAD pages pasted from the PDF text layer.
 * A day is kept only when all 25 rows A–Y are present. Nothing here is a key until the operator pastes one.
 */
export function parseDryadText(text: string): { days: DryadDay[]; notes: string[] } {
  const notes: string[] = [];
  const chunks = text.split(/(?=From:\s*\d{6}Z)/i).map((c) => c.trim()).filter(Boolean);
  const days: DryadDay[] = [];

  for (const chunk of chunks) {
    const fromMatch = chunk.match(/From:\s*(\d{6}Z\s+[A-Z]{3}\s+\d{4})/i);
    if (!fromMatch) {
      notes.push("Skipped a block with no From: date.");
      continue;
    }
    const untilMatch = chunk.match(/Until:\s*(\d{6}Z\s+[A-Z]{3}\s+\d{4})/i);
    const from = stampToIso(fromMatch[1].toUpperCase());
    const until = untilMatch ? stampToIso(untilMatch[1].toUpperCase()) : from;
    if (!from || !until) {
      notes.push(`Could not read the date on ${fromMatch[1]}.`);
      continue;
    }
    const rows: Rows = {};
    for (const line of chunk.split(/\r?\n/)) {
      const m = line.trim().toUpperCase().match(/^([A-Y])\s+([A-Z ]+)$/);
      if (!m) continue;
      const letter = m[1];
      const row = m[2].replace(/\s+/g, "");
      if (row.length === 25 && !rows[letter] && !isHeaderRow(row)) rows[letter] = row;
    }
    if (Object.keys(rows).length !== 25) {
      notes.push(`${from.label}: found ${Object.keys(rows).length} of 25 rows. Paste the whole page, including row Y.`);
      continue;
    }
    days.push({
      date: from.date,
      label: from.label,
      from: fromMatch[1].toUpperCase(),
      until: untilMatch ? untilMatch[1].toUpperCase() : fromMatch[1].toUpperCase(),
      rows,
      training: false,
    });
  }

  if (!days.length && !notes.length) notes.push("No DRYAD pages found. Paste the text of a daily page, starting at From:.");
  return { days, notes };
}

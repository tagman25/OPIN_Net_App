export type CodeEntry = {
  code: string;
  kind: "Z" | "Q" | "prosign" | "precedence";
  meaning: string;
  question?: string;
  example?: string;
};

/** Codes actually used on an OPIN / Black Swan digital net. Meanings follow the published SOI and ACP-131 usage on that net. */
export const CODES: CodeEntry[] = [
  {
    code: "ZKA",
    kind: "Z",
    meaning: "I am net control on this frequency.",
    question: "Who is net control?",
    example: "OPIN DE N8TAG ZKA ZKB AS",
  },
  {
    code: "ZKB",
    kind: "Z",
    meaning: "This net is directed. Get permission from net control before transmitting.",
    question: "Is this a directed net?",
    example: "ZUG ZKB — this net is free (not the same as closed).",
  },
  {
    code: "ZKD",
    kind: "Z",
    meaning: "Take control of the net.",
    question: "Shall I take control of the net?",
  },
  {
    code: "ZKE",
    kind: "Z",
    meaning: "I am reporting into the net.",
    question: "INT ZKE — are there any check-ins?",
    example: "N8TAG DE KE8YTX ZKE K",
  },
  {
    code: "ZKJ",
    kind: "Z",
    meaning: "Close down (leave this frequency, possibly off the air).",
    question: "May I close down?",
    example: "OPIN DE N8TAG ZKJ 73 AR",
  },
  {
    code: "ZKS",
    kind: "Z",
    meaning:
      "On OPIN, the ordered roll: on-air stations first, then /WL2K stations, net control last as CALL/NCS. ACP-131 also uses ZKS for stations in the net.",
    example: "OPIN DE N8TAG ZKS KE8YTX KD8TTE/IP W8ABC/WL2K N8TAG/NCS",
  },
  {
    code: "ZNB",
    kind: "Z",
    meaning: "Authentication. ZNB ABC means the authentication of AB is C. ZNB C answers a challenge.",
    question: "INT ZNB AB — what is the authentication of AB?",
    example: "INT ZNB AB  /  ZNB C  /  ZNB ABC",
  },
  {
    code: "ZND",
    kind: "Z",
    meaning: "Authenticator used incorrectly. 1 — verify the DRYAD key. 2 — check the authentication of your last transmission.",
    example: "KE8YTX DE N8TAG ZND 2 INT ZNB CF",
  },
  {
    code: "ZBO",
    kind: "Z",
    meaning: "I have this traffic: quantity, precedence, destination.",
    question: "Of what precedence, and for whom, is your traffic?",
    example: "ZBO 1 P WD8SAB",
  },
  {
    code: "ZOF",
    kind: "Z",
    meaning: "Relay (pass) this message now. On OPIN this is how net control directs a transmission.",
    example: "KE8YTX DE N8TAG ZOF 1 R OPIN K",
  },
  {
    code: "ZOK",
    kind: "Z",
    meaning: "Relay this message via the station or circuit named.",
  },
  {
    code: "ZBR",
    kind: "Z",
    meaning: "Send your traffic using R (direct, ZBRR) or F (broadcast, ZBRF).",
  },
  {
    code: "ZEV",
    kind: "Z",
    meaning: "I acknowledge the message — on this net, I have the file. ZUG ZEV means I do not have it.",
    question: "INT ZEV — do you acknowledge?",
  },
  {
    code: "ZUG",
    kind: "Z",
    meaning: "Negative. ZUG ZNB joins the roll with no DRYAD. ZUG ZEV means the file was not received. ZUG ZKB means the net is free.",
  },
  {
    code: "ZBZ",
    kind: "Z",
    meaning: "Printing quality 1–5. 1 totally corrupt, 3 partially corrupt, 4 occasionally corrupt, 5 clean.",
  },
  {
    code: "ZCJ",
    kind: "Z",
    meaning: "I am having equipment trouble.",
  },
  {
    code: "ZDD",
    kind: "Z",
    meaning: "Bring the named message or product to the circuit.",
    example: "ZDD ZFPCLE-OH-Stark",
  },
  {
    code: "ZUH",
    kind: "Z",
    meaning: "Unable to comply.",
  },
  {
    code: "ZUJ",
    kind: "Z",
    meaning: "Stand by.",
  },
  {
    code: "ZVR",
    kind: "Z",
    meaning: "Relay to subordinate stations or nets.",
  },
  {
    code: "ZWF",
    kind: "Z",
    meaning: "Incorrect.",
  },
  {
    code: "ZWG",
    kind: "Z",
    meaning: "Correct.",
  },
  {
    code: "QSY",
    kind: "Q",
    meaning: "Change frequency to the channel named, then return when finished.",
    example: "W8THV DE N8TAG QSY 80F1 K",
  },
  {
    code: "QSP",
    kind: "Q",
    meaning: "Relay this message.",
  },
  {
    code: "QRU",
    kind: "Q",
    meaning: "I have nothing for you.",
    question: "Have you anything for me?",
  },
  {
    code: "QRK",
    kind: "Q",
    meaning: "Readability of your signals, 1 bad through 5 excellent.",
  },
  { code: "DE", kind: "prosign", meaning: "This is. The station transmitting is the callsign after DE." },
  { code: "INT", kind: "prosign", meaning: "The following operating signal is a question." },
  { code: "K", kind: "prosign", meaning: "Go ahead. Invitation to transmit." },
  { code: "AR", kind: "prosign", meaning: "End of transmission. No reply expected." },
  { code: "AS", kind: "prosign", meaning: "Wait." },
  { code: "R", kind: "prosign", meaning: "Roger. Received. In a ZBO slot, R is also Routine precedence." },
  { code: "IMI", kind: "prosign", meaning: "Say again. Repeat the last transmission. Never sent as a bare IMI." },
  { code: "Z", kind: "precedence", meaning: "Flash. Highest precedence on this net." },
  { code: "O", kind: "precedence", meaning: "Immediate." },
  { code: "P", kind: "precedence", meaning: "Priority." },
  { code: "R", kind: "precedence", meaning: "Routine. Default when a listing does not name one." },
];

const BY_CODE = new Map<string, CodeEntry[]>();
for (const entry of CODES) {
  const list = BY_CODE.get(entry.code) ?? [];
  list.push(entry);
  BY_CODE.set(entry.code, list);
}

export function lookupCode(token: string): CodeEntry[] {
  return BY_CODE.get(token.toUpperCase().replace(/[^A-Z]/g, "")) ?? [];
}

export function codesInText(text: string): CodeEntry[] {
  const seen = new Set<string>();
  const found: CodeEntry[] = [];
  for (const raw of text.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (!raw || seen.has(raw)) continue;
    const hits = BY_CODE.get(raw);
    if (!hits) continue;
    seen.add(raw);
    found.push(hits[0]);
  }
  return found;
}

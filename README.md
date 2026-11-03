# OPIN Net Assistant

Local-first desk for an OPIN digital net (fldigi, flamp, flmsg, Winlink).

Nothing in this app transmits. It prepares the line, you copy it into fldigi.

## Roles

- **NCS** — open the net, take ZKE check-ins, check ZNB against the DRYAD, keep the ZKS roll, direct ZOF / QSY, track ZEV and ZUG ZEV.
- **Winlink** — paste pre-net messages from OPIN@winlink.org, put `/WL2K` stations on the roll, write the gateway summary, mark bounces.
- **IP** — check in as IP, drop files into folders, list them with ZBO when net control calls.
- **Operator** — check in, list traffic, stay silent until called, answer ZEV or ZUG ZEV.

The ZKS line is on-air stations, then `/WL2K`, with net control last as `CALL/NCS`.

## DRYAD

Paste a daily page from the OPIN DRYAD PDF on the DRYAD tab (the text that starts with `From:`). It stays in this browser only. The built-in table is marked training and is not an operational key.

## Session file

Log and Files can download a plain session report and a draft `.k2s` to attach or paste into the custom flmsg form. Export JSON if you want a copy of the whole session.

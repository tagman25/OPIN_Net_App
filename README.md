# OPIN Net Assistant

A local desk for an OPIN digital net run with fldigi, flamp, flmsg, and Winlink.

The app does not transmit. Paste what fldigi printed, and it keeps the roll, the traffic, and the files. When it is your turn, it puts the next line in Suggested reply. Copy that line into fldigi and send it yourself.

The session stays in this browser. Export JSON if you want a copy.

## How a net runs

1. Pick a role and enter your call.
2. Load today's DRYAD page.
3. Paste each block fldigi prints and choose Read.
4. Use the buttons for your role. The line lands in Suggested reply.

If you are not net control, the NCS call stays blank until the desk reads an authenticated ZKA. Changing roles after the net is open asks you to confirm first.

## Roles

- **Net control** opens with `ZKA ZNB` and a DRYAD triplet, so every station can check that this is the real NCS. Then take check-ins, keep the ZKS roll, call for traffic, send files, and close the net.
- **Operator** checks in, lists traffic, and stays silent until called. Answer ZEV or ZUG ZEV when a file is sent to you.
- **IP** checks in as `CALL/IP` and lists files with ZBO when net control calls for traffic.
- **Winlink** pastes the pre-net messages from OPIN@winlink.org, puts those stations on the roll as `CALL/WL2K`, and writes the gateway summary.

Net control's lines are small buttons. Every role also has **ZKJ** (this station is closing down) and **ZCJ** (equipment trouble).

## The roll

The ZKS line is the on-air stations, then `/WL2K`, with net control last as `CALL/NCS`. Add a station from the roll. A triplet next to a call is green when it matched the DRYAD and red when it did not.

Net control's opening line carries three DRYAD letters. A match authenticates that station as NCS. A triplet that does not match is rejected. A ZKA with no triplet is not confirmed.

When net control sends a ZKS list, every other role replaces its roll with that list. If the list is already the same, nothing changes. `INT ZKS` only asks for the roll. It does not replace it.

## Traffic and files

List what you need to send: who it is from, how many, the precedence, and who it is for. One station can have several pieces, such as `1 R OH AND 2 P OH`. Prepare ZBO turns that list into one line for net control.

Nothing goes on the net ZBO list until net control rogers it. When the file starts, the app takes the file name and the FLAMP hash from the send, drops one off that ZBO count (`3 R US` becomes `2 R US`), and moves the file to Files.

Under Files, each station is marked received, missing blocks, or not heard. A later report from the same station replaces the earlier one. INT ZEV is there for anyone who has not confirmed the file.

Stations who checked in `/WL2K` do not answer on the air. They are listed together as `ZOF ZOK WL2K`. Anyone else who will not copy the file can be moved onto that same line.

## Leaving the frequency

- **ZKJ**, or an **INT ZKJ** that net control answers with R or ZKJ, means that station is done. Files they have not already confirmed go on the ZOF ZOK WL2K line.
- **ZCJ** means equipment trouble. The station comes off the roll, and those same files go by Winlink.
- **ZUG ZCJ** means the equipment is back. The station returns to the same place on the roll.

QSY sends one station off with an IP station to pass a file. Both have to roger before they are marked gone. When the whole net changes channel, the band changes with it and the move is written in the log.

## Codes

The Codes tab is the ACP 131 Q-code and Z-code set used on this net. In what fldigi printed, and in Suggested reply, hover a code for the short meaning. If INT is in front of it, the tip is the question.

## DRYAD

Paste a daily page from the OPIN DRYAD PDF on the DRYAD tab. The text starts with `From:`. It stays in this browser only. The built-in table is marked training and is not an operational key.

## Session file

Log and Files can download a plain session report and a draft `.k2s` to attach or paste into the custom flmsg form. Export JSON if you want a copy of the whole session.

# HWT Client — everything that comes from, or goes to, the client

Kept separate from [`../hwt-core/`](../hwt-core/) on purpose. **This folder is the
conversation with Hope Welfare Trust. `hwt-core/` is the build.**

If you are looking for schema, phases or tasks, you are in the wrong folder.

---

## What goes where

| Folder | What belongs here |
|---|---|
| **[requirements/](requirements/)** | What the client asked for, **in their own words**, dated, never edited or tidied |
| **[forms/](forms/)** | Their paper forms and documents — the originals, plus a transcription we can build from |
| **[questions/](questions/)** | The questions we need answered, in a form you can print and take to a meeting |
| **[deliverables/](deliverables/)** | What we hand back: plans, demos, sign-offs, training material |
| **[meetings/](meetings/)** | Notes and decisions from each conversation, dated |

---

## Two rules

**1. Requirements are recorded verbatim.**
Do not tidy the client's wording, fix their spelling, or translate their phrasing into ours.
*"udhaar khata"*, *"all needs to seprate"* and *"full box price"* are the primary record.
Our interpretation goes in `hwt-core/`, where it can be checked against the original.

**2. A decision that only exists in a WhatsApp message does not exist.**
When the client answers a question or changes their mind, write it into
[`meetings/`](meetings/) the same day, and copy it into the decision log in
[`../hwt-core/STATUS.md`](../hwt-core/STATUS.md). That log is what stops the same
conversation happening twice.

---

## Current state

| | |
|---|---|
| **Product** | Pharmacy POS + full dialysis management system |
| **On hold** | Reception · Token & Queue · Consultation/EMR · Laboratory |
| **Site** | LAN only, no internet, load-shedding |
| **Open questions** | 10 of 13 unanswered — see [questions/](questions/questions-for-client.md) |
| **Plan** | 9 phases, ~19 developer-weeks — see [`../hwt-core/STATUS.md`](../hwt-core/STATUS.md) |

The three questions worth chasing first, because they block the most work:

1. **Q7** — which SKUs sit behind "Syringe 1cc/3cc/10cc" and the other combined rows on the
   dialysis demand form. Half a day with the unit in-charge.
2. **Q11** — is there any internet-connected machine? The Donor and Patient Portals cannot be
   built without an answer.
3. **Q12/Q13** — which departments exist, who signs for each, and at what rate they are
   invoiced.

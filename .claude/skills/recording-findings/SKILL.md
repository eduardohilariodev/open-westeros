---
name: recording-findings
description: Use when about to tell the user a task is done, after a fix, a diagnosis (even "no code change needed"), a new tool or script, a measurement, a limit, a surprise, or a technique the next session would otherwise have to rediscover. Also when the user is in a hurry.
---

# Recording findings

The repo is the memory. A fix, diagnosis or technique that lives only in the chat is lost at the next session.

## Before the final message

1. Name what the next session would have to rediscover: the cause, the command, the number, the dead end.
2. Append it to `docs/findings.md` (newest first), in the file's own format: date, area, What, Evidence, So.
3. Route the rest, each in the same turn:

| It is | It goes in |
|---|---|
| a tool, generated file, step or order changed | `docs/ARCHITECTURE.md` |
| a choice between options, with the reason | `docs/decisions/NNNN-title.md` |
| a book/wiki disagreement | `docs/lore-conflicts.md` |
| a trap when editing places or roads | `.claude/rules/lore.md` |
| a topic with its own pipeline | its own `docs/<topic>.md`, linked from ARCHITECTURE |

4. Say in the final message which file got the entry.

An entry is 3 to 6 lines. Time pressure shortens the entry; it does not remove it.

## Rationalizations

| Excuse | Reality |
|---|---|
| "No code or map data changed" | A diagnosis is the most expensive thing to redo. Log it. |
| "Only a lookup key / one line changed" | The cause is the finding, not the diff. |
| "The user is in a hurry" | Writing three lines takes less time than the next session's rediscovery. |
| "I'll offer to write it after" | An offer is not an entry. Write it, then mention it. |
| "It is obvious from the code" | If it were, the session would not have needed to find it. |

## Red flags

Saying "done" with no file named. Ending on "I can add a note if you want". Treating a no-change outcome as nothing to record.

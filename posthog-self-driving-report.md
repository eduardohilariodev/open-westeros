# PostHog Self-driving setup report

## Summary

Configured PostHog Self-driving for the Open Westeros web app: enabled Session Replay, Error Tracking, and Support; enabled their matching native signal sources; tuned the scout troop; and created two Replay Vision monitors that emit corroborated findings to the inbox. Findings will start appearing in the [Self-driving inbox](https://us.posthog.com/project/729363/inbox) within about 30 minutes as new activity arrives.

## AI data processing

Approved.

## GitHub

The PostHog GitHub App was already connected before this setup. GitHub Issues was not selected as an inbox source in this run.

## Products enabled

| Product | Result | Web integration check |
| --- | --- | --- |
| Session Replay | **enabled** | Removed the client-side `disable_session_recording` override from `src/main.ts`, so the server setting can record web sessions. |
| Error Tracking | **enabled** | The `posthog-js` initialization does not disable exception capture. |
| Support / Conversations | **enabled** | Connect an inbound email, inbox, or Slack channel in PostHog before support tickets can arrive. |

## Signal sources

| Source product / type | Action |
| --- | --- |
| `health_checks` / `health_issue` | Enabled (source id `01a1cce9-27c1-72f7-9ea0-bd791009e60a`). |
| `error_tracking` / `issue_created` | Enabled (source id `01a1cce9-27fb-71ca-8368-dd53e2d27687`). |
| `error_tracking` / `issue_reopened` | Enabled (source id `01a1cce9-2807-7401-882d-9e305422ec80`). |
| `error_tracking` / `issue_spiking` | Enabled (source id `01a1cce9-27f6-722f-8451-7297c389b67c`). |
| `conversations` / `ticket` | Enabled (source id `01a1cce9-27ee-7e4c-b3f9-a939ac129397`). |
| Scout gate | On by default; no opt-out row was created. |
| Logs | Skipped: no evidence that the Logs product is in use. |
| Endpoints | Skipped: endpoint usage could not be checked with the available MCP scope. |
| Session Replay responder | Not created: Replay Vision scanners provide this coverage. |

## Connected tools

No external tools were selected. GitHub Issues, Linear, Jira, Sentry, and Zendesk are therefore recorded as **not used** for this setup; no external-tool responders were enabled.

## Scout troop

- **Enabled:** `signals-scout-general` for cross-product patterns and `signals-scout-web-analytics` for traffic, acquisition, landing-page, and bounce changes.
- **Operational:** `signals-scout-inbox-validation` remains enabled. It runs report follow-up checks and sits outside the troop ceiling.
- **Disabled:** 26 other built-in specialists. Error Tracking is covered by its native signal sources; Session Replay is covered by the scanners below. The other specialists do not match evidenced product surfaces.
- **Budget and capacity:** 100 runs/day, 0 used today, 100 remaining; the enforced enabled-scout cap is 3. One operational scout plus the two enabled troop scouts consumes all 3 slots, leaving 0 free slots for custom scouts. Announcement: “Scouts are in early access. Each project gets up to 100 scout runs a day. Contact team-self-driving@posthog.com if you need more.”

## Custom scouts

No custom scout was created. The strongest candidate was an atlas-exploration completion monitor, which would distinguish a sustained drop in place-detail or 3D-view completion from normal traffic variation. It was proposed but dismissed, and the project currently has no free enabled-scout slots. Generic traffic behavior remains covered by the enabled web-analytics scout.

If a future custom scout becomes noisy, set its `emit` configuration to `false` in PostHog to switch it to dry-run.

## Replay Vision scanners

A scanner is an LLM that watches individual session recordings on a schedule and pushes what it finds to the inbox. These are the only setup components that spend Replay Vision quota. Findings arrive at half weight and need corroboration before promotion into a report.

| Monitor | Status | Scope and purpose | Sampling | Estimated monthly spend |
| --- | --- | --- | --- | --- |
| Open Westeros atlas exploration breakage | Created | Watches the root atlas and generated `/place/<slug>` pages, the core exploration flow where a visitor loads the map and opens a place. It flags visible globe, search, place-card, or 3D-view breakage. | 50%; free credits only | 0 observations / 0 credits at current traffic. |
| Open Westeros atlas interaction frustration | Created | Watches sessions containing a rage click for repeated, visible difficulty using the globe, search, cards, house details, or 3D views. | 100%; free credits only | 0 observations / 0 credits at current traffic. |

No recordings exist yet, so both monitors are armed and will begin observing once recordings arrive. They are limited to the organization’s free Replay Vision credits; they pause when those credits run out. Re-run setup after traffic arrives to size them from real session volume.

## Files changed

| File | Change |
| --- | --- |
| `src/main.ts` | Removed the `disable_session_recording` client override so enabled Session Replay can capture on all web devices. |
| `posthog-self-driving-report.md` | Created this setup report. |

## Verification

- `npm run typecheck` passed.

## Follow-ups

- [ ] Connect an inbound Support / Conversations channel (email, inbox, or Slack) in PostHog so the enabled ticket responder can receive tickets.
- [ ] Deploy the `src/main.ts` change so Session Replay starts recording production web sessions.
- [ ] After recordings and traffic arrive, revisit the two monitors to validate their volume and rate their observations in Replay Vision with a thumbs-up/down and a brief note.
- [ ] If custom coverage is needed, raise the `max_enabled_scouts` limit or disable a scout, then add the atlas-exploration completion scout.
- [ ] Enable `signals-scout-logs`, `signals-scout-endpoints`, or other disabled specialists later only when their corresponding product surface is in use.

## What happens next

The scout coordinator picks up fresh configurations within about 30 minutes. Scout runs draw from the project’s daily budget, findings cluster into reports in the [Self-driving inbox](https://us.posthog.com/project/729363/inbox), and immediately actionable findings can start coding tasks. This work is billed to the PostHog organization and subject to its [Self-driving billing limit](https://us.posthog.com/organization/billing).

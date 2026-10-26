# clawd-mods

Clawd, the crab from the Claude Code welcome screen, lives above your prompt
under his own sky and lives by your limits; `/clawd` has everything else. A
Claude Code mod grown from
[clawd-usage-winwidget](https://github.com/Enhed/clawd-usage-winwidget) by
Venger Sergey (MIT), which does much of this as a Windows desktop widget.

## Install

At the prompt of a terminal session:

```
/plugin install clawd-mods --marketplace Broo37/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

## Above the prompt

- **Clawd alone**, the full width of the band, no numbers beside him. He stands
  on top of whatever other mods draw there. With clean-view, list this mod
  before it in `CLAUDE_CODE_PLUGIN_DIRS`, or clean-view puts him in its Status tab.
- **His sky**, the row over him: the sun by the hour between sunrise and
  sunset, at night the moon in its real phase and a few twinkling stars, clouds
  that drift with the wind. Rain, drizzle or snow falls around him; a storm
  flashes and he hops at the thunder; he squints in the rain.
- **Clawd:** idles and wanders, runs while something works, lies belly-up at
  100%, jumps when a session finishes and celebrates with confetti when the
  5-hour window resets. Fewer hearts make him slower and sleepier; past 85% he
  sweats, and he sweats too while a red PC tip waits. Ten quiet minutes and he
  dozes. Click him for one of Claude Code's own animations and a heart; belly-up,
  a click lets his soul float out on a string.
- **Over his head**, one mark at a time: a bell while a reminder rings, a `?`
  while a session waits for you, a `!` during a Claude incident (red when major).

## `/clawd`

A pane of colored sections, each only when it has something to show:

- **TIPS:** what is wrong with this PC, red first, each with **Fix it** (sends it
  to Claude in this session, who proposes commands and asks before each one) and
  **Not now** (hidden for a day, a month for unused apps, in every session).
  Watched: memory at 90% or more twice in a row (Claude counted with its MCP
  servers), a process keeping the CPU busy, a restart due, something new at
  startup, apps not opened in 90 days. Windows only.
- **CLAUDE STATUS:** during an incident on status.claude.com: what, since when,
  which parts.
- **REMINDERS:** ringing ones with **Done**, **+15m** and **+1h**, then the next few.
- **WEATHER:** now, then sunrise, sunset and the moon.
- **LIMITS:** the 5-hour, week and Fable bars with exact reset times, three
  hearts for the 5-hour limit left, and a 7-day chart of both.
- **SESSIONS:** the other live sessions of this account and what each is doing.
- **PROJECTS:** this week's top projects by share of the tokens, estimated from
  this PC's logs. Windows only.
- **LAST 24 HOURS / LAST 7 DAYS:** the breakdown `/usage` prints.

## Commands

- `/clawd` opens the pane. `/clawd band on|off` shows or hides Clawd.
- `/clawd play` lists the animations, `/clawd play <name>` plays one,
  `/clawd demo` plays them all and every mood, `/clawd auto` makes him live again.
- `/remind <when> <what>`: `20m`, `2h`, `3d`, `18:30`, `9pm`, `tomorrow 10`,
  `mon 9:00`, `in a week`, `19.10 14:00`; start with `daily`, `weekly`, `monthly`
  or `yearly` to repeat. `/remind` alone lists the next ones. Or ask Claude
  ("remind me at four to call the dentist"): the mod gives Claude `remind`, `reminders`
  and `cancel_reminder` tools.

## `/config`

- `band` (on): Clawd above the prompt.
- `sky` (on): the row over him. Off, it stays an empty row.
- `city` (empty): where the sun and the weather are read for; empty, found from
  your internet address.

## Where it all comes from

Every open session loads its own copy of the mod. Each job below runs in one of
them at a time (a lock file decides which) and the rest read its result; a job
that fails keeps its last result, marked.

| What | From | How often | Shared by |
|---|---|---|---|
| Limits | this session's own figures after each reply; `claude -p /usage --safe-mode` (no tokens) | each reply; the probe each minute while something works, five while quiet | account |
| 7-day chart | every limits reading, one per 5 minutes at most | as read | account |
| Sessions | `<config dir>/sessions/*.json`, alive by `tasklist`/`ps` | 3 s, a minute | account |
| Top projects | the account's session logs, read a line at a time (`scripts/projects.ps1`) | hourly | account |
| PC checks | `scripts/pc-check.ps1`, read-only and offline | memory and CPU 2 min, the rest 30 min | PC |
| Weather | Open-Meteo, met.no as the fallback | 15 min | PC |
| Where you are | your `city`, else ipwho.is | daily | PC |
| Claude status | status.claude.com | 2 min | PC |
| Reminders | `/remind`, Claude's tool | checked every 15 s | PC |

Per account means `<config dir>/clawd-mods/` (`CLAUDE_CONFIG_DIR`, or `~/.claude`);
per PC means `%LOCALAPPDATA%\clawd-mods\`. Nothing here spends tokens except
what you send: Fix it, and asking Claude.

**Reminders ring only while a Claude Code session with this mod is open.** One
that fell due while none was open rings, marked late, when the next one starts;
a repeat missed several times rings once.

## Credit

Clawd's glyphs, eye shapes and animations, the `/usage` parsing and where the
PC checks look on Windows follow clawd-usage-winwidget by Venger Sergey (MIT).

## Not in this version

Skins and costumes.

## Developing

```
claude plugin validate <this folder>
claude plugin test <this folder>
bunx --package typescript tsc -p <this folder>
```

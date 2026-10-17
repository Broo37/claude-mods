# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins of function hooks that change how a session looks and behaves.

| Mod | What it does | Yours to set |
| --- | --- | --- |
| [`clean-view`](#clean-view) | Hides tool calls, diffs and command output while Claude works, and shows the plan as a checklist in a tab of the side pane | `/simple on`, `/simple off` |
| `status-band` | The Awesome Statusline layout as a band above the prompt: model, git, context, 5H/7D limits and Codex 7D, with a pet under the list of sessions | `size`, `animate`, `position`, `pet` |
| `transcript-makeover` | Ends every tool row with a check or a red cross and how long the call took, and every turn with a receipt: time, tools, failures, cost and share of the five-hour limit | |
| `tool-waterfall` | A pane that charts the tool calls of the turn as bars along its time, like a browser's network tab | `/waterfall` opens and closes it |
| `risky-hold` | Holds a destructive shell command (recursive delete, `git reset --hard`, force push, disk or database wipe) until you say run it | |
| `message-times` | Shows when each prompt you sent was sent, at the right of its row in the transcript | |
| `spinner` | Draws the line that moves while Claude works as an equalizer, a rainbow wave, a comet, a game of pong or a face eating a bar of blocks, with wording of your own | `style`, `format` |
| `rainbow-prompt` | Colors the prompt box as you type: ticket ids, paths, links, rainbow words, and a red warning on anything that looks like a secret | `words` |

## Install

At the prompt of a terminal session, with the name of a mod from the table:

```
/plugin install clean-view --marketplace Broo37/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

To run one from a copy of this folder instead, without installing:

```
claude --plugin-dir path/to/claude-mods/clean-view
```

### Several at once

To load several from folders, list them in `CLAUDE_CODE_PLUGIN_DIRS` (under `env` in `settings.json`, `;` between them on Windows) in the order of the table. The first folder is the outermost hook, and the order matters:

- `clean-view` comes first: it wraps the band `status-band` draws and the pane `tool-waterfall` draws, and its hidden rows have to win over the badges of `transcript-makeover`.
- `status-band`, `transcript-makeover` and `tool-waterfall` come before `risky-hold`: a command it refuses never reaches a mod listed after it, so the mods that count and time calls would miss it.

## Clean View

Makes a session calm to read. While Claude works, its tool calls, diffs and command output are hidden, and a checklist in a tab of the side pane shows the plan, the step it is on and how far along it is. Claude's written replies stay.

```
Build my landing page · 1m 12s                     [ ● Clean View: ON ]
✓ 📖 Read your brand notes            ██████████  Done
▶ 🔨 Build the pricing section        ██████░░░░  60%
○ 🔨 Add the contact form             ░░░░░░░░░░  Next
○ 🎨 Polish the footer                ░░░░░░░░░░  Up next
```

The header follows the job: working, **Needs you** (Claude waits for your reply), **Stuck** (you said no to a step, a step keeps failing, or an API error ended the turn), **Stopped** (you pressed Esc) and **All done**, which shrinks to one line after five seconds.

### Use

- It starts on. `/simple off` turns it off, `/simple on` turns it on, `/simple` alone flips it. So does a click on the `[ ● Clean View: ON ]` button. The choice is remembered.
- Off, every hidden row comes back, the tab closes and only the button stays above the prompt. `/simple on` opens the tab again, in front.
- In a fullscreen terminal the checklist is a tab of the side pane, beside `Waterfall` and `Sessions` where those mods are loaded: click a tab to bring it forward. The pane is narrow, so each step has a line of its own and the step at work its meter under it. The tab's title carries the job's state (`Checklist ▶`, `Checklist ✓`), so it reads from behind another tab.
- Over the `tool-waterfall` chart it draws two lines of status: the step at work with its count (`▶ 2/4 🔨 Build the pricing section`), then its meter and the time.
- Where the pane has no room for the tab, or you close it, the checklist goes back above the prompt. Where another mod draws there too, the two share the space as tabs, `[ Checklist ]  Status`.

### How it works

- Claude gets two tools, `plan_steps` and `report_progress`, and a section of the system prompt that has it lay out 2 to 8 plain-English steps first and report as it goes. Until a plan exists every other tool is refused; a to-do list (TodoWrite, TaskCreate) counts as a plan.
- Every step name passes through one cleaner: no code, paths or file names, 40 characters at most.
- Each step starts with an emoji that says what happens in it. Claude picks it from a set of 22 (🔍 look into, 🔨 build, 🧪 test, 🚀 ship, …). A step that comes without one, such as a to-do item, gets one guessed from its verb. The set holds only emoji every terminal draws two columns wide, so the rows stay lined up.
- Each prompt starts a job, named in 2 to 6 words by a small model in the background.
- In a session that draws nowhere (`claude -p`, a headless worker) it stands aside: nobody is watching a checklist there.

### State other mods can read

Declared in `clean-view/types/index.d.ts` under the plugin's name: `cleanViewEnabled`, `checklist` (title, phase, tasks with Claude's `icon`, reasons, times, `isCollapsed`), `tick` and `tab`.

`cleanview.txt` is the prompt the mod was built from.

## Develop

With the folder of a mod in place of `clean-view`:

```
claude plugin test clean-view
claude plugin validate clean-view
npx -y -p typescript@5 tsc -p clean-view
```

The type check needs the declarations Claude Code lays into `<mod>/.claude-plugin/types/` the first time it loads the mod from this folder. Built and tested on Claude Code 2.1.294 on Windows; the mod API is early access and may move between releases.

The scripts under `status-band/tools` and `rainbow-prompt/tools` start a real session in a Windows Terminal window, type into it and photograph it. They are PowerShell and Windows only, and their defaults (the terminal profile, the starting folder) are those of the machine they were written on.

## Credits

- The palette, gradients and wording of `status-band` are ported from [Awesome Statusline](https://github.com/AwesomeJun/CC-statusline) by AwesomeJun (MIT, see `status-band/LICENSE-awesome-statusline.txt`).
- The frames of the `smiley` animation of `spinner` are carried over from a spinner set up in [tweakcc](https://github.com/Piebald-AI/tweakcc).

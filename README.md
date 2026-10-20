# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins of function hooks that change how a session looks and behaves. There are ten, and each one installs on its own. Install the ones you want, then find each one's card in the [cheat sheet](#cheat-sheet).

| Mod | In one line |
| --- | --- |
| [`confetti`](#-confetti) | A burst of pixel confetti when a job ends as All done |
| [`clean-view`](#-clean-view) | Hides Claude's tool calls and shows its plan as a checklist |
| [`fold-view`](#-fold-view) | Folds every tool call to one line a click opens |
| [`status-band`](#-status-band) | Model, git, cost and your usage limits as bars, plus a pet |
| [`transcript-makeover`](#-transcript-makeover) | A check or a cross and a time on every tool row, a receipt after every turn |
| [`tool-waterfall`](#-tool-waterfall) | A chart of the turn's tool calls over time |
| [`risky-hold`](#-risky-hold) | Asks you before a destructive shell command runs |
| [`message-times`](#-message-times) | When you sent each prompt |
| [`spinner`](#-spinner) | The working line as an animation, with your own wording |
| [`rainbow-prompt`](#-rainbow-prompt) | Colors the prompt as you type, and secrets in red |

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

To load several from folders, list them in `CLAUDE_CODE_PLUGIN_DIRS` (under `env` in `settings.json`, `;` between them on Windows) in the order of the table above. The first folder is the outermost hook, and the order matters:

- `confetti` comes first, even before `clean-view`: its burst goes on top of the checklist Clean View draws above the prompt. Listed after it, Clean View would take the burst for another mod's band and make a tab of it.
- `clean-view` comes next: it wraps the band `status-band` draws and the pane `tool-waterfall` draws, and its hidden rows have to win over the badges of `transcript-makeover`.
- `fold-view` comes right after it: it folds the rows Clean View lets through while off, and its folded lines have to win over the badges of `transcript-makeover` too.
- `status-band`, `transcript-makeover` and `tool-waterfall` come before `risky-hold`: a command it refuses never reaches a mod listed after it, so the mods that count and time calls would miss it.

## Cheat sheet

Each card covers one mod: what it does, what to type and what you can set. Settings are rows in `/config`. To turn a mod off for good, disable or uninstall it in `/plugin`.

### 🎉 `confetti`

- **What:** a second and a half of colored pixel confetti right above the checklist, each time a Clean View job ends as **All done**. When a job is stopped, stuck or waiting for you, nothing plays.
- **Type:** `/confetti` plays it whenever you like.
- **Works with:** it needs `clean-view`, since it plays on Clean View's All done, so with Clean View off only `/confetti` plays it.

### 🧹 `clean-view`

- **What:** hides Claude's tool calls, diffs and command output, and shows the plan as a checklist above the prompt.
- **Type:** `/simple off` to see everything again, `/simple on` to hide it again, or `/simple` alone to flip it. The `[ ● Clean View: ON ]` button above the prompt does the same.
- **Click:** a step with a `▸` opens to what Claude did in it.
- **Good to know:** your choice is remembered for the next session. [More about Clean View](#clean-view).

### 📂 `fold-view`

- **What:** each tool call becomes one line in plain words, like `▸ ✓ Ran: List the files in the folder · 4s`.
- **Click:** a line opens to its full output or diff. A second click folds it again.
- **Works with:** it shows while Clean View is off. Without Clean View installed, it is always on. [More about Fold View](#fold-view).

### 📊 `status-band`

- **What:** a `Status` tab in the side pane, with your 5H, 7D, Codex and context bars standing side by side, plus model, git, cost and reset times. Where the tab can't show, it becomes a band by the prompt.
- **Type:** `/band` brings the Status tab to the front. `/sessions` shows your other Claude Code sessions in a pane, with a pet under the list.
- **The pet:** it sleeps while you're idle, walks while Claude works, hops when a turn ends, and stands under a `?` while Claude waits for you. The crab is Clawd.
- **Set:** `tab` (on), `size` (`xsmall` to `xlarge`), `animate` (on), `position` (`above` or `below` the prompt), `pet` (`crab`, `cat`, `ghost`, `smiley` or `off`).

### 🧾 `transcript-makeover`

- **What:** every tool row ends with how long it took, `✓ 2.2s`, or a red `✗` if it failed. Every turn ends with a receipt: `1m 4s · 6 tools · 1 failed · $ 0.42 · 5H +2.5% · done 14:09`.
- **Type:** nothing, it works by itself.

### 🌊 `tool-waterfall`

- **What:** a chart of the turn's tool calls as bars over time, like the network tab in a browser.
- **Type:** `/waterfall` opens it, and `/waterfall` again closes it. If you leave it open, it opens again in your next session.

### 🛑 `risky-hold`

- **What:** before Claude runs a destructive shell command (a recursive delete, `git reset --hard`, a force push, a disk or database wipe), it asks you: **Run it** or **Block it**.
- **Type:** nothing, just answer when it asks. Where nobody can answer (`claude -p`), such a command is refused.
- **Good to know:** deletes inside a temp folder or a build folder (`node_modules`, `dist`, `build` and the like) go through without a question. It reads shell commands only, so a script Claude writes and then runs is not checked.

### 🕒 `message-times`

- **What:** the time you sent each prompt, at the right of its row: `14:05`, or `6 Oct 23:59` for a prompt from another day.
- **Type:** nothing, it works by itself.

### 🌀 `spinner`

- **What:** the line that moves while Claude works becomes an animation, with your own wording.
- **Set:** `style`: `equalizer` (the default), `rainbow`, `comet`, `pong` or `smiley`. `format`: the wording, where `{}` stands for what Claude is doing. By default it is `{}...`, just the word (`Pondering...`). Set `Claude is {}...` and it says `Claude is Pondering...`.

### 🌈 `rainbow-prompt`

- **What:** colors the prompt box as you type: ticket ids, paths, links and your rainbow words. Anything that looks like a secret, such as a key or a token, turns red before you send it.
- **Set:** `words`: the words painted in rainbow, with commas between them (`ultrathink` by default).

## Clean View

Makes a session calm to read. While Claude works, its tool calls, diffs and command output are hidden, and a checklist above the prompt shows the plan, the step it is on and how far along it is. Claude's written replies stay.

```
Build my landing page · 1m 12s                         [ ● Clean View: ON ]
▸ ✓ 📖 Read your brand notes            ██████████  Done
▾ ▶ 🔨 Build the pricing section        ██████░░░░  60%
       Prices come from the menu file.
       ✓ Read pricing.md
       ✗ Ran: Run the tests · failed: missing script: test
  ○ 🔨 Add the contact form             ░░░░░░░░░░  Next
  ○ 🎨 Polish the footer                ░░░░░░░░░░  Up next
```

The header follows the job: working, **Needs you** (Claude waits for your reply), **Stuck** (you said no to a step, a step keeps failing, or an API error ended the turn), **Stopped** (you pressed Esc) and **All done**. A finished job keeps its steps on screen until your next prompt.

A step with a `▸` opens at a click to what Claude did in it: its one-line note on the step, then its five latest actions in plain words, each with `✓` or `✗`, how long a slow one took and why a failed one failed. A second click closes it. Every new prompt starts with the steps closed.

### Use

- It starts on. `/simple off` turns it off, `/simple on` turns it on, `/simple` alone flips it. So does a click on the `[ ● Clean View: ON ]` button. The choice is remembered.
- Off, every hidden row comes back, the tab closes and only the button stays above the prompt. `/simple on` opens the tab again, in front.
- In a fullscreen terminal the checklist is also a tab of the side pane, `Steps`, beside `Waterfall`, `Sessions` and `Status` where those mods are loaded: a plain list, no step opens there. The pane is narrow, so each step has a line of its own and the step at work its meter under it. The tab's title carries the job's state (`Steps ▶`, `Steps ✓`), so it reads from behind another tab. Its name is short so that all four tabs fit a side pane 47 columns wide: the terminal drops the tabs left of the one in front that do not fit.
- Over the `tool-waterfall` chart it draws two lines of status: the step at work with its count (`▶ 2/4 🔨 Build the pricing section`), then its meter and the time.
- Where another mod draws above the prompt too, the two share the space as tabs, `[ Checklist ]  Status`.

### How it works

- Claude gets two tools, `plan_steps` and `report_progress`, and a section of the system prompt that has it lay out 2 to 8 plain-English steps first and report as it goes, with a one-line `note` on each step it finishes. Until a plan exists every other tool is refused; a to-do list (TodoWrite, TaskCreate) counts as a plan.
- Every other tool call of the main conversation is filed under the step at work as it starts, in plain words (`Ran: <the description Claude gave>`, `Read index.html`, `Started a helper: …`), and marked when it ends. A helper's own calls are not.
- Every step name passes through one cleaner: no code, paths or file names, 40 characters at most.
- Each step starts with an emoji that says what happens in it. Claude picks it from a set of 22 (🔍 look into, 🔨 build, 🧪 test, 🚀 ship, …). A step that comes without one, such as a to-do item, gets one guessed from its verb. The set holds only emoji every terminal draws two columns wide, so the rows stay lined up.
- Each prompt starts a job, named in 2 to 6 words by a small model in the background.
- In a session that draws nowhere (`claude -p`, a headless worker) it stands aside: nobody is watching a checklist there.

### State other mods can read

Declared in `clean-view/types/index.d.ts` under the plugin's name: `cleanViewEnabled`, `checklist` (title, phase, tasks with Claude's `icon`, `note` and `actions`, reasons, times), `tick`, `tab` and `opened` (the steps opened above the prompt).

`cleanview.txt` is the prompt the mod was built from.

## Fold View

For when you want to see what Claude does without reading all of it. Every tool call in the transcript is one line in plain words, folded:

```
● I'll check the folder first.
▸ ✓ Ran: List the files in the folder
▾ ✗ Ran: Run the tests · failed · 4s

● Bash(npm test)
  ⎿  Error: missing script: test

▸ ✓ Read package.json
● The tests need a script: there is none in package.json.
```

- A click on a line opens it to the row Claude Code draws, the command, its output or the diff, exactly as it would without the mod. A second click folds it again. Each line opens on its own and stays open for the session.
- `✓` done, `✗` failed (in red, with `· failed`), `◌ … · running` while it runs, `■ … · stopped` when you pressed Esc. A call that took 3 seconds or more says how long.
- The transcript's count lines (`Read 3 files, ran 2 shell commands`) are unfolded, so every call is a line of its own.
- Claude's written replies are left as they are.
- Listed after `clean-view`, it shows while Clean View is off (`/simple off`): Clean View on draws no tool rows at all. Alone, it is always on.

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

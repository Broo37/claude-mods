# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins of function hooks that change how a session looks and behaves.

## Clean View

Makes a session calm to read. While Claude works, its tool calls, diffs and command output are hidden, and a checklist above the prompt shows the plan, the step it is on and how far along it is. Claude's written replies stay.

```
Build my landing page · 1m 12s                     [ ● Clean View: ON ]
✓ Read your brand notes            ██████████  Done
▶ Build the pricing section        ██████░░░░  60%
○ Add the contact form             ░░░░░░░░░░  Next
○ Polish the footer                ░░░░░░░░░░  Up next
```

The header follows the job: working, **Needs you** (Claude waits for your reply), **Stuck** (you said no to a step, a step keeps failing, or an API error ended the turn), **Stopped** (you pressed Esc) and **All done**, which shrinks to one line after five seconds.

### Install

At the prompt of a terminal session:

```
/plugin install clean-view --marketplace Broo37/claude-mods
```

Answer `y` to add the marketplace, then pick a scope. While this repository is private, the machine needs access to it on GitHub first (`gh auth login`).

To run it from a copy of this folder instead, without installing:

```
claude --plugin-dir path/to/claude-mods/clean-view
```

### Use

- It starts on. `/simple off` turns it off, `/simple on` turns it on, `/simple` alone flips it. So does a click on the `[ ● Clean View: ON ]` button. The choice is remembered.
- Off, every hidden row comes back and only the button stays.
- Where another mod draws above the prompt too, the two share the space as tabs, `[ Checklist ]  Status`: click one to bring it forward.

### How it works

- Claude gets two tools, `plan_steps` and `report_progress`, and a section of the system prompt that has it lay out 2 to 8 plain-English steps first and report as it goes. Until a plan exists every other tool is refused; a to-do list (TodoWrite, TaskCreate) counts as a plan.
- Every step name passes through one cleaner: no code, paths or file names, 40 characters at most.
- Each prompt starts a job, named in 2 to 6 words by a small model in the background.
- In a session that draws nowhere (`claude -p`, a headless worker) it stands aside: nobody is watching a checklist there.

### State other mods can read

Declared in `clean-view/types/index.d.ts` under the plugin's name: `cleanViewEnabled`, `checklist` (title, phase, tasks, reasons, times, `isCollapsed`), `tick` and `tab`.

### Develop

```
claude plugin test clean-view
claude plugin validate clean-view
npx -y -p typescript@5 tsc -p clean-view
```

The type check needs the declarations Claude Code lays into `clean-view/.claude-plugin/types/` the first time it loads the mod from this folder. Built and tested on Claude Code 2.1.294; the mod API is early access and may move between releases.

`cleanview.txt` is the prompt the mod was built from.

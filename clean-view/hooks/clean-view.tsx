import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import { actionOf, noteOf, whyOf } from './actions'
import {
  IDLE,
  REASONS,
  actionEnded,
  actionStarted,
  addTask,
  changeTask,
  endTurn,
  failTurn,
  fromTodos,
  hasPlan,
  isWaitingForReply,
  needsYou,
  percentOf,
  planSteps,
  rename,
  reportProgress,
  sentenceFor,
  startJob,
  stuck,
  toolStarted,
  toolSucceeded,
} from './checklist'
import type { TaskChange, Todo } from './checklist'
import { cleanName, cleanTitle } from './names'
import { BUTTON, DOCK_TAB, NO_JOB, TABS, TAB_MARKS, bandStepsOf, headerOf, paneLinesOf, planPanelOf, stripOf } from './rows'
import type { Run } from './rows'
import { NAMER, PLAN_FIRST, PLAN_STEPS, PLAN_TOOL, PROGRESS_TOOL, REPORT_PROGRESS, SECTION } from './words'
import type { CleanViewChecklist as Checklist, CleanViewHost, CleanViewPanel, CleanViewTab as Tab } from '../types'

// Clean View: while it is on, the transcript keeps Claude's written replies and
// loses its tool calls, and a checklist above the prompt says what the job is,
// which step it is on and how far along; a step opens there to what Claude did in it.

const enabled = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const checklist = atom({ plugin: 'clean-view', key: 'checklist' } as const, IDLE)
const tick = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)
const tab = atom({ plugin: 'clean-view', key: 'tab' } as const, 'checklist')
const opened = atom({ plugin: 'clean-view', key: 'opened' } as const, [] as string[])

// The mod that hosts the checklist (the Deck), if one does: then the Steps tab
// stands aside. Kept in the session's state, which outlasts a reload, and here,
// which outlasts a /clear that empties the state.
const hostAtom = atom({ plugin: 'clean-view', key: 'host' } as const, null as CleanViewHost | null)

// Under what names the setting and the tab in front are kept between sessions.
const KEPT = 'enabled'
const FRONT = 'tab'

// How often the frame counter advances while a job works or waits on the person.
const FRAME_MS = 250

// How long the model that names a job may take.
const NAMING_MS = 8000

// How much of a prompt that model is shown.
const SHOWN = 600

// How many tool calls must fail in a row for the job to be stuck.
const FAILURES = 3

// The cells the terminal's brackets add to a button's label, and the gap before it.
const BRACKETS = 4
const GAP = 1

// The Steps tab of the dock beside the transcript, as wide as its other tabs
// (Sessions, Waterfall), whose lines stand two columns off its edge as these
// do. It is the plain list; the band above the prompt keeps the checklist too.
const GUTTER = 2
const PANE = { id: 'checklist', title: DOCK_TAB, columns: 30 + GUTTER }

// Another mod's tab of the dock, which the job's status is put over.
const WATERFALL = 'waterfall'

const QUESTION = 'AskUserQuestion'

// What Claude may call before a plan exists: the ways to make one, or to ask.
const FREE = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', QUESTION])

// How Claude Code words a tool's result when the person turned the call down,
// and how an opened step says it.
const TURNED_DOWN = /doesn.t want to (?:proceed|take this action)|tool use was rejected/i
const SAID_NO = 'you said no'

const ANSWERS = {
  noSteps: 'Give the steps as a list of 2 to 8 short names.',
  noTask: 'Name the step the progress is for.',
  notYours: "Only the main conversation keeps the checklist: carry on without it.",
  off: 'Clean View is off: nobody is shown a checklist. Carry on without it.',
  unwatched: 'Nobody is watching this session: no checklist is kept. Carry on without it.',
  on: 'Clean View is on. Tool calls are hidden; the checklist shows the plan.',
  turnedOff: 'Clean View is off. Tool calls and their output show again.',
  usage: 'Use /simple on or /simple off; /simple alone flips it.',
} as const

let ticking: Timer | null = null

// The tool calls of the main conversation that failed in a row, those running
// now, and whether the person was asked something while one ran.
let failures = 0
let running = 0
let wasAsked = false

// The calls seen, to name one that came without an id.
let calls = 0

// The title the Steps tab was last given.
let shownTitle: string | null = null

let hosted: CleanViewHost | null = null

// The panel a lent method answers where no hook of this mod does: no rows, so a host hides it.
const UNLENT: CleanViewPanel = { id: 'plan', title: 'plan', right: '', label: [], rows: [] }

const lookOf = (run: Run) => ({
  wrap: 'truncate-end' as const,
  ...(run.color !== undefined && { color: run.color }),
  ...(run.isBold === true && { bold: true }),
  ...(run.isDim === true && { dimColor: true }),
  ...(run.isInverse === true && { inverse: true }),
})

const isTodo = (todo: unknown): todo is Todo =>
  typeof todo === 'object' && todo !== null && typeof (todo as Todo).content === 'string' && typeof (todo as Todo).status === 'string'

// What a call of one of the to-do tools makes of the checklist.
const followed = (list: Checklist, call: Record<string, unknown>, result: unknown, now: number): Checklist => {
  if (call.tool === 'TodoWrite' && Array.isArray(call.todos)) {
    return fromTodos(list, call.todos.filter(isTodo), now)
  }

  if (call.tool === 'TaskCreate') {
    const id = (result as { task?: { id?: unknown } } | undefined)?.task?.id

    return typeof id === 'string' ? addTask(list, id, String(call.subject ?? ''), now) : list
  }

  if (call.tool === 'TaskUpdate' && typeof call.taskId === 'string') {
    return changeTask(list, call.taskId, {
      ...(typeof call.status === 'string' && { status: call.status as TaskChange['status'] }),
      ...(typeof call.subject === 'string' && { subject: call.subject }),
    })
  }

  return list
}

// A checklist is for a person watching. A session that draws nowhere (a plain
// `claude -p` run, a headless worker) has nobody: there the mod stands aside,
// so that the job is not made to plan and report for no one.
async function isWatched($: EngineInterface) {
  return (await $.session.surfaces()).length > 0
}

async function isAtWork($: EngineInterface) {
  return (await read($, enabled)) && (await isWatched($))
}

// The clock runs only while there is something to animate: no timer is left
// running while nothing happens.
function keepTime($: EngineInterface, list: Checklist) {
  if (list.phase === 'working' || list.phase === 'needs-you') {
    ticking ??= $.clock.every(FRAME_MS, () => {
      update($, tick, frame => frame + 1).catch(() => {})
    })
  } else {
    ticking?.cancel()
    ticking = null
  }
}

// The tab's title carries the job's state, to be read while another tab is in front.
const titleOf = (list: Checklist) => `${PANE.title}${TAB_MARKS[list.phase]}`

async function hostOf($: EngineInterface) {
  hosted ??= await read($, hostAtom)

  return hosted
}

// The tab opens unless a host shows the checklist in its own pane.
async function openTab($: EngineInterface) {
  if ((await hostOf($)) !== null) {
    return
  }

  shownTitle = titleOf(await read($, checklist))
  await $.ui.open({ ...PANE, title: shownTitle })
}

async function closeTab($: EngineInterface) {
  if ((await $.ui.panes()).some(pane => pane.id === PANE.id)) {
    await $.ui.close({ id: PANE.id })
  }
}

// Gives the tab the title the job's state calls for. A tab the person closed
// is not opened again by it.
async function retitle($: EngineInterface, list: Checklist) {
  const title = titleOf(list)

  if (title !== shownTitle && (await $.ui.panes()).some(pane => pane.id === PANE.id)) {
    shownTitle = title
    await $.ui.open({ ...PANE, title })
  }
}

async function change($: EngineInterface, step: (list: Checklist) => Checklist) {
  const list = await update($, checklist, step)
  keepTime($, list)

  try {
    await retitle($, list)
  } catch {
    // The tab keeps the title it had; the checklist is right all the same.
  }

  return list
}

// Asks a small model for the job's name. The job is known by when it started:
// a name that comes back after a newer job began is that job's no more.
async function name($: EngineInterface, startedAt: number, request: string, earlier: string | null) {
  try {
    const shown = request.slice(0, SHOWN)
    const reply = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 30,
      timeoutMs: NAMING_MS,
      system: NAMER,
      prompt: earlier === null ? `The request:\n${shown}` : `The job so far: ${earlier}\nThe person's reply:\n${shown}`,
    })

    if (reply.isAnswered && reply.text.trim() !== '') {
      await change($, list => (list.startedAt === startedAt ? rename(list, cleanTitle(reply.text)) : list))
    }
  } catch {
    // The job keeps the name it started with.
  }
}

// A prompt the person typed starts a job; a slash command, or a turn nobody
// typed, does not.
async function begin($: EngineInterface, text: string) {
  const request = text.trim()

  if (request === '' || request.startsWith('/')) {
    return
  }

  const before = await read($, checklist)
  // A reply to a job that waits for one is named after that job.
  const earlier = isWaitingForReply(before) ? before.title : null
  const now = await $.clock.now()
  failures = 0
  running = 0
  wasAsked = false
  // A new job starts with every step closed.
  await update($, opened, () => [])
  await change($, () => startJob(earlier ?? cleanName(request), now))
  $.clock.after(0, () => {
    name($, now, request, earlier).catch(() => {})
  })
}

async function plan($: EngineInterface, steps: unknown) {
  const names = Array.isArray(steps) ? steps.filter((step): step is string => typeof step === 'string' && step.trim() !== '') : []

  if (names.length === 0) {
    return { result: ANSWERS.noSteps }
  }

  const now = await $.clock.now()
  failures = 0
  const { tasks } = await change($, list => toolSucceeded(planSteps(list, names, now)))

  return { result: `Planned ${tasks.length} ${tasks.length === 1 ? 'step' : 'steps'}. The first one has started.` }
}

async function progress($: EngineInterface, task: unknown, percent: unknown, note: unknown) {
  if (typeof task !== 'string' || task.trim() === '') {
    return { result: ANSWERS.noTask }
  }

  const now = await $.clock.now()
  failures = 0
  await change($, list => toolSucceeded(reportProgress(list, task, Number(percent), now, noteOf(note))))

  return { result: `Progress noted: ${percentOf(Number(percent))}%.` }
}

// A tool call failed: `ended` notes how, under the step it was filed in.
async function failed($: EngineInterface, hasSaidNo: boolean, ended: (list: Checklist) => Checklist) {
  failures += 1
  await change($, before => {
    const list = ended(before)

    if (hasSaidNo) {
      return stuck(list, REASONS.saidNo)
    }

    return failures >= FAILURES ? stuck(list, REASONS.failing) : toolStarted(list)
  })
}

// The job waits on the person: a permission prompt or a dialog is open.
async function ask($: EngineInterface, reason: string) {
  if (await isAtWork($)) {
    wasAsked = true
    await change($, list => needsYou(list, reason))
  }
}

async function setEnabled($: EngineInterface, isOn: boolean) {
  await update($, enabled, () => isOn)

  // Off, it keeps no job, runs no timer and has no tab; on, the tab is back.
  if (isOn) {
    if (await isWatched($)) {
      await openTab($)
    }
  } else {
    await closeTab($)
    failures = 0
    running = 0
    wasAsked = false
    await update($, opened, () => [])
    await change($, () => IDLE)
  }

  try {
    await $.store.set(KEPT, isOn)
  } catch {
    // The setting holds for this session all the same.
  }
}

// Brings one of the band's two tabs to the front, for this session and the next.
async function pick($: EngineInterface, front: Tab) {
  await update($, tab, () => front)

  try {
    await $.store.set(FRONT, front)
  } catch {
    // The tab is in front for this session all the same.
  }
}

// Opens a step of the band to what Claude did in it, or closes it again.
async function flipStep($: EngineInterface, id: string) {
  await update($, opened, ids => (ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id]))
}

async function flip($: EngineInterface) {
  const isOn = !(await read($, enabled))
  await setEnabled($, isOn)
  $.ui.toast(isOn ? 'Clean View is on' : 'Clean View is off')
}

export const registerCleanView = (on: On): void => {
  // What Clean View lends another mod, the Deck: the checklist as a panel, and
  // a way to host it. The methods here stand at the bottom of their events; the
  // hooks below answer them, holding `$` as a method cannot.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)

    return { ...built, cleanView: { panel: async () => UNLENT, host: async () => false } }
  })

  on('cleanView.panel', async ($, e) => {
    const list = (await read($, enabled)) ? await read($, checklist) : IDLE

    return { value: planPanelOf(list, await $.clock.now(), e.columns, await read($, tick)) }
  })

  // Hosted, the Steps tab closes and stays closed; the checklist above the
  // prompt stays as it is.
  on('cleanView.host', async ($, e) => {
    hosted = { by: e.by, isDocked: e.isDocked }
    await update($, hostAtom, () => hosted)
    await closeTab($)

    return { value: true }
  })

  on('session.start', async ($, e, next) => {
    // Its tools say "call me first": a session nobody watches is not offered them.
    if (await isWatched($)) {
      await $.tool.register(PLAN_TOOL)
      await $.tool.register(PROGRESS_TOOL)
    }

    await $.command.register({
      name: 'simple',
      description: 'Turn Clean View on or off: hide tool calls and show the plan as a checklist',
      argumentHint: '[on|off]',
    })

    try {
      const kept = await $.store.get(KEPT)

      if (typeof kept === 'boolean') {
        await update($, enabled, () => kept)
      }

      const front = await $.store.get(FRONT)

      if (front === 'checklist' || front === 'status') {
        await update($, tab, () => front)
      }
    } catch {
      // A session starts with Clean View on rather than not at all.
    }

    // After a reload the job is where it was, and its clock starts again.
    keepTime($, await read($, checklist))

    // The checklist is a tab of the dock, beside the other mods' tabs.
    if ((await read($, enabled)) && (await isWatched($))) {
      await openTab($)
    }

    return next(e)
  })

  // Closed by the person, the tab is retitled no more. Should that fail, the
  // tab closes all the same.
  on('ui.close', async ($, e, next) => {
    const answer = await next(e)

    if (e.id === PANE.id) {
      shownTitle = null
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'simple' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()

    if (wanted !== '' && wanted !== 'on' && wanted !== 'off') {
      return { text: ANSWERS.usage }
    }

    const isOn = wanted === '' ? !(await read($, enabled)) : wanted === 'on'
    await setEnabled($, isOn)

    return { text: isOn ? ANSWERS.on : ANSWERS.turnedOff }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    // The request says where the session draws: nowhere, nobody reads a checklist.
    return e.surfaces.length > 0 && (await read($, enabled)) ? { ...composed, sections: [...composed.sections, SECTION] } : composed
  })

  on('turn.start', async ($, e, next) => {
    if (await isAtWork($)) {
      await begin($, e.text)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && (await isAtWork($))) {
      const now = await $.clock.now()
      await change($, list => endTurn(list, { reason: e.reason, answer: e.answer }, now))
    }

    return next(e)
  })

  // Serves the two tools, holds every other tool of the main conversation until
  // a plan exists, and reads the checklist off what Claude does. Should it fail,
  // the call goes on, or its answer stands, as if the mod were not there.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as Record<string, unknown>
    const isOwn = e.tool === PLAN_STEPS || e.tool === REPORT_PROGRESS

    if (e.agentId !== undefined) {
      return isOwn ? { result: ANSWERS.notYours } : next(e)
    }

    if (!(await read($, enabled))) {
      return isOwn ? { result: ANSWERS.off } : next(e)
    }

    if (!(await isWatched($))) {
      return isOwn ? { result: ANSWERS.unwatched } : next(e)
    }

    if (e.tool === PLAN_STEPS) {
      return plan($, call.steps)
    }

    if (e.tool === REPORT_PROGRESS) {
      return progress($, call.task, call.percent, call.note)
    }

    if (!FREE.has(e.tool) && !hasPlan(await read($, checklist))) {
      return { deny: PLAN_FIRST }
    }

    // A question put while another call runs is a guard's, about that call.
    wasAsked = running > 0 && e.tool === QUESTION
    running += 1
    calls += 1
    // What the call is in plain words, kept under the step at work; a call that
    // only makes the plan is none.
    const id = typeof call.tool_use_id === 'string' ? call.tool_use_id : `call-${calls}`
    const action = actionOf(call)
    const begun = await $.clock.now()
    await change($, list => {
      const moved = e.tool === QUESTION ? needsYou(list, REASONS.question) : toolStarted(list)

      return action === null ? moved : actionStarted(moved, id, action, begun)
    })

    try {
      const answer = await next(e)
      const now = await $.clock.now()

      if (answer.deny !== undefined || answer.isError === true) {
        const hasSaidNo = wasAsked || TURNED_DOWN.test(answer.text ?? '') || TURNED_DOWN.test(answer.deny ?? '')
        const why = hasSaidNo ? SAID_NO : whyOf(answer.deny ?? answer.text ?? '')
        await failed($, hasSaidNo, list => actionEnded(list, id, { isOk: false, why }, now))
      } else {
        failures = 0
        await change($, list => toolSucceeded(actionEnded(followed(list, call, answer.result, now), id, { isOk: true }, now)))
      }

      return answer
    } finally {
      running = Math.max(0, running - 1)
    }
  }).catch(($, e, next) => next(e))

  // The turn's end says an API error ended it and no more; this event, raised
  // for the same error, names its kind.
  on('classic.StopFailure', async ($, e, next) => {
    if (e.agent_id === undefined && (await isAtWork($))) {
      const now = await $.clock.now()
      await change($, list => failTurn(list, sentenceFor(e.error, e.error_details ?? e.last_assistant_message ?? ''), now))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Noting that the person is asked must never stand in the way of the asking.
  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') {
      await ask($, REASONS.ok)
    } else if (e.notification_type === 'elicitation_dialog') {
      await ask($, REASONS.question)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Raised as a dialog opens, before any notification is due: a permission
  // prompt, or the question tool's own dialog.
  on('classic.PermissionRequest', async ($, e, next) => {
    await ask($, e.tool_name === QUESTION ? REASONS.question : REASONS.ok)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, enabled))) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await read($, enabled))) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await read($, enabled))) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, enabled)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const isOn = await read($, enabled)
    const list = isOn ? await read($, checklist) : IDLE
    const frame = await read($, tick)
    const now = await $.clock.now()
    const label = isOn ? BUTTON.on : BUTTON.off
    const rest = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const textsOf = (runs: Run[]) => runs.map(run => <Text {...lookOf(run)}>{run.text}</Text>)
    const lineOf = (runs: Run[]) => <Box>{textsOf(runs)}</Box>
    // A step with something to show is a button: a press opens it to what
    // Claude did in it, the next closes it.
    const rows = bandStepsOf(list, await read($, opened), frame, e.props.bodyColumns).flatMap(step => [
      step.canOpen ? (
        <Button key={`open-${step.id}`} plain onPress={() => flipStep($, step.id)}>
          {textsOf(step.row)}
        </Button>
      ) : (
        lineOf(step.row)
      ),
      ...step.details.map(lineOf),
    ])
    const toggle = <Button key="clean-view" label={label} onPress={() => flip($)} />

    // Alone in the band, or off, the mod draws one row of its own (the job and
    // its button) over the steps, and what the engine has there keeps its place.
    if (!isOn || rest.type === 'engine') {
      return (
        <Box flexDirection="column">
          <Box>
            {headerOf(list, now, e.props.bodyColumns - label.length - BRACKETS - GAP, frame).map(run => (
              <Text {...lookOf(run)}>{run.text}</Text>
            ))}
            <Box flexGrow={1} />
            {toggle}
          </Box>
          {rows}
          {rest}
        </Box>
      )
    }

    // Where another mod draws in the band too, the two are tabs: one at a time.
    const front = await read($, tab)
    const tabOf = (which: Tab, name: string) =>
      which === front ? (
        <Button key={`tab-${which}`} label={name} variant="primary" onPress={() => pick($, which)} />
      ) : (
        // As wide as the tab in front is with its brackets, so that neither moves.
        <Box paddingX={2}>
          <Button key={`tab-${which}`} label={name} plain dimColor onPress={() => pick($, which)} />
        </Box>
      )
    const job =
      list.phase === 'idle' ? (
        <Box>
          <Text dimColor>{NO_JOB}</Text>
        </Box>
      ) : (
        lineOf(headerOf(list, now, e.props.bodyColumns, frame))
      )

    return (
      <Box flexDirection="column">
        <Box>
          {tabOf('checklist', front === 'checklist' ? TABS.checklist : `${TABS.checklist}${TAB_MARKS[list.phase]}`)}
          {tabOf('status', TABS.status)}
          <Box flexGrow={1} />
          {toggle}
        </Box>
        {front === 'status' ? rest : [job, ...rows]}
      </Box>
    )
  })

  // The Steps tab: the job, what it is doing, its steps, and the switch.
  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const isOn = await read($, enabled)
    const list = isOn ? await read($, checklist) : IDLE
    const frame = await read($, tick)
    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" paddingLeft={GUTTER}>
        {paneLinesOf(list, now, e.props.bodyColumns - GUTTER, frame).map(runs => (
          <Box>
            {runs.map(run => (
              <Text {...lookOf(run)}>{run.text}</Text>
            ))}
          </Box>
        ))}
        <Box marginTop={1}>
          <Button key="clean-view" label={isOn ? BUTTON.on : BUTTON.off} onPress={() => flip($)} />
        </Box>
      </Box>
    )
  })

  // Over the waterfall, another mod's tab of the dock, the job's status: the
  // step it is on and how far, then a rule. With no job, or Clean View off,
  // the waterfall is drawn as that mod draws it; so it is should this fail.
  on('ui.render', { component: 'Pane', requestId: WATERFALL }, async ($, e, next) => {
    const list = (await read($, enabled)) ? await read($, checklist) : IDLE
    const theirs = await next(e)

    if (list.phase === 'idle') {
      return theirs
    }

    const frame = await read($, tick)
    const now = await $.clock.now()
    const columns = e.props.bodyColumns - GUTTER
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {stripOf(list, now, columns, frame).map(runs => (
          <Box paddingLeft={GUTTER}>
            {runs.map(run => (
              <Text {...lookOf(run)}>{run.text}</Text>
            ))}
          </Box>
        ))}
        <Box paddingLeft={GUTTER}>
          <Text dimColor>{'─'.repeat(Math.max(0, columns))}</Text>
        </Box>
        {theirs}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

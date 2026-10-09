import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'

import {
  IDLE,
  REASONS,
  addTask,
  changeTask,
  collapse,
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
import { BUTTON, NO_JOB, TABS, TAB_MARKS, headerOf, rowsOf } from './rows'
import type { Run } from './rows'
import { NAMER, PLAN_FIRST, PLAN_STEPS, PLAN_TOOL, PROGRESS_TOOL, REPORT_PROGRESS, SECTION } from './words'
import type { CleanViewChecklist as Checklist, CleanViewTab as Tab } from '../types'

// Clean View: while it is on, the transcript keeps Claude's written replies and
// loses its tool calls, and a checklist above the prompt says what the job is,
// which step it is on and how far along.

const enabled = atom({ plugin: 'clean-view', key: 'cleanViewEnabled' } as const, true)
const checklist = atom({ plugin: 'clean-view', key: 'checklist' } as const, IDLE)
const tick = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)
const tab = atom({ plugin: 'clean-view', key: 'tab' } as const, 'checklist')

// Under what names the setting and the tab in front are kept between sessions.
const KEPT = 'enabled'
const FRONT = 'tab'

// How often the frame counter advances while a job works or waits on the person.
const FRAME_MS = 250

// How long a finished job shows its steps before it shrinks to one line.
const SHRINK_MS = 5000

// How long the model that names a job may take.
const NAMING_MS = 8000

// How much of a prompt that model is shown.
const SHOWN = 600

// How many tool calls must fail in a row for the job to be stuck.
const FAILURES = 3

// The cells the terminal's brackets add to a button's label, and the gap before it.
const BRACKETS = 4
const GAP = 1

const QUESTION = 'AskUserQuestion'

// What Claude may call before a plan exists: the ways to make one, or to ask.
const FREE = new Set(['ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', QUESTION])

// How Claude Code words a tool's result when the person turned the call down.
const TURNED_DOWN = /doesn.t want to (?:proceed|take this action)|tool use was rejected/i

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
let shrinking: Timer | null = null

// The tool calls of the main conversation that failed in a row, those running
// now, and whether the person was asked something while one ran.
let failures = 0
let running = 0
let wasAsked = false

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

// The clock runs only while there is something to animate, and a finished job
// shrinks once: no timer is left running while nothing happens.
function keepTime($: EngineInterface, list: Checklist) {
  if (list.phase === 'working' || list.phase === 'needs-you') {
    ticking ??= $.clock.every(FRAME_MS, () => {
      update($, tick, frame => frame + 1).catch(() => {})
    })
  } else {
    ticking?.cancel()
    ticking = null
  }

  if (list.phase === 'done' && !list.isCollapsed) {
    shrinking ??= $.clock.after(SHRINK_MS, () => {
      shrinking = null
      change($, collapse).catch(() => {})
    })
  } else {
    shrinking?.cancel()
    shrinking = null
  }
}

async function change($: EngineInterface, step: (list: Checklist) => Checklist) {
  const list = await update($, checklist, step)
  keepTime($, list)

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

async function progress($: EngineInterface, task: unknown, percent: unknown) {
  if (typeof task !== 'string' || task.trim() === '') {
    return { result: ANSWERS.noTask }
  }

  const now = await $.clock.now()
  failures = 0
  await change($, list => toolSucceeded(reportProgress(list, task, Number(percent), now)))

  return { result: `Progress noted: ${percentOf(Number(percent))}%.` }
}

async function failed($: EngineInterface, hasSaidNo: boolean) {
  failures += 1
  await change($, list => {
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

  // Off, it keeps no job and runs no timer.
  if (!isOn) {
    failures = 0
    running = 0
    wasAsked = false
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

async function flip($: EngineInterface) {
  const isOn = !(await read($, enabled))
  await setEnabled($, isOn)
  $.ui.toast(isOn ? 'Clean View is on' : 'Clean View is off')
}

export const registerCleanView = (on: On): void => {
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

    return next(e)
  })

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
      return progress($, call.task, call.percent)
    }

    if (!FREE.has(e.tool) && !hasPlan(await read($, checklist))) {
      return { deny: PLAN_FIRST }
    }

    // A question put while another call runs is a guard's, about that call.
    wasAsked = running > 0 && e.tool === QUESTION
    running += 1
    await change($, list => (e.tool === QUESTION ? needsYou(list, REASONS.question) : toolStarted(list)))

    try {
      const answer = await next(e)

      if (answer.deny !== undefined || answer.isError === true) {
        await failed($, wasAsked || TURNED_DOWN.test(answer.text ?? ''))
      } else {
        const now = await $.clock.now()
        failures = 0
        await change($, list => toolSucceeded(followed(list, call, answer.result, now)))
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
    const lineOf = (runs: Run[]) => (
      <Box>
        {runs.map(run => (
          <Text {...lookOf(run)}>{run.text}</Text>
        ))}
      </Box>
    )
    const rows = rowsOf(list, frame, e.props.bodyColumns).map(lineOf)
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
}

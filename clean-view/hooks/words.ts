// What Clean View says to Claude: the two tools it offers, the section of the
// system prompt that has Claude use them, and its refusals.

export const PLUGIN = 'clean-view'

export const PLAN_STEPS = `mcp__${PLUGIN}__plan_steps`
export const REPORT_PROGRESS = `mcp__${PLUGIN}__report_progress`

export const PLAN_TOOL = {
  name: 'plan_steps',
  description:
    'Lay out every step of the job up front, for the checklist the person watches: 2 to 8 short names in order, each plain English that starts with a verb ("Build the pricing section"), under 40 characters, with no file names, paths, commands, code or tool names. Call it first for every request. The first step starts right away.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 8,
        description: 'The step names, in the order they will be done.',
      },
    },
    required: ['steps'],
  },
  // In the prompt's tool list from the start: Claude is to reach for it first.
  isDeferred: false,
}

export const PROGRESS_TOOL = {
  name: 'report_progress',
  description:
    'Report real progress on the current step of the checklist the person watches. Name the step exactly as it was planned and give how far it is, 0 to 100. Call it with 100 the moment a step finishes: that checks it off and starts the next one.',
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The name of the step, as planned.' },
      percent: { type: 'number', minimum: 0, maximum: 100, description: 'How far the step is, 0 to 100.' },
    },
    required: ['task', 'percent'],
  },
  isDeferred: false,
}

export const SECTION = {
  id: `${PLUGIN}:steps`,
  scope: 'session',
  text: [
    '# Clean View: a checklist in place of your tool calls',
    '',
    'The person watching this session does not see your tool calls, diffs or command output. They see a checklist of your steps above the prompt, and your written replies. Keep that checklist true:',
    '',
    `- For every request, even a quick question, call \`${PLAN_STEPS}\` first, with every step of the job: 2 to 8 of them, in order. Load it with ToolSearch if it is deferred. Other tools are refused until a plan exists.`,
    '- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".',
    '- Never put file paths, file names, commands, code or tool names in a step name.',
    `- Call \`${REPORT_PROGRESS}\` as real progress happens, naming the step exactly as you planned it, and call it with 100 the moment a step finishes.`,
    '- If this session has TodoWrite or TaskCreate, you can use your to-do list as the plan instead: its items become the checklist, so name them the same way.',
    '- Since your tool calls are hidden, say in your written reply what you did and what you found.',
  ].join('\n'),
} as const

export const PLAN_FIRST = `Clean View: lay out the plan first. Call ${PLAN_STEPS} with 2 to 8 short step names in plain English, then make this call again.`

// What the model that names a job is told.
export const NAMER =
  'You name jobs for a progress checklist. Answer with a name for what the person asks for: 2 to 6 plain words that start with a verb, like "Build my landing page". No file names, no code, no quotes, no full stop. Answer with the name alone.'

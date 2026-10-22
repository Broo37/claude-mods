// One run of a lent panel's row: its text and how it is drawn, its color a theme key.
export type ToolWaterfallRun = { text: string; color?: string; isBold?: boolean; isDim?: boolean }

// The chart as a panel another mod draws in a box of its own (the Deck): a
// title and what stands at its right, a label for that mod's header, rows,
// and whether it moves on its own (a turn that runs).
export type ToolWaterfallPanel = {
  id: 'timeline'
  title: string
  right: string
  label: ToolWaterfallRun[]
  rows: ToolWaterfallRun[][]
  isLive: boolean
  // The panel in one line, for a host's mini summary.
  summary?: ToolWaterfallRun[]
}

// The mod that hosts the chart, and whether its pane is in the dock now.
export type ToolWaterfallHost = { by: string; isDocked: boolean }

// What the Waterfall lends another mod: its chart as a panel, and a way to
// host it, so the Waterfall's own pane stands aside.
export type ToolWaterfall = {
  panel(args: { id: 'timeline'; columns: number; rows: number }): Promise<ToolWaterfallPanel>
  host(args: ToolWaterfallHost): Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    toolWaterfall: ToolWaterfall
  }

  interface PluginState {
    'tool-waterfall': { host: ToolWaterfallHost | null }
  }
}

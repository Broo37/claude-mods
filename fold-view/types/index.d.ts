// What Fold View keeps for the session: the tool calls, by their ids, whose
// rows the person opened. A row not in it is drawn folded to one line.

export type FoldViewOpened = string[]

declare module 'claude-code' {
  interface PluginState {
    'fold-view': { opened: FoldViewOpened }
  }
}

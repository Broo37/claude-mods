// What the Deck keeps for the session: the panel the person put on top with
// /deck <panel>, or none, for the panels' own order.
export type DeckTop = 'plan' | 'limits' | null

declare module 'claude-code' {
  interface PluginState {
    deck: { top: DeckTop }
  }
}

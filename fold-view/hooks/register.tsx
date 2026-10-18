import type { Register } from 'claude-code'

import { registerFoldView } from './fold-view'

// One mod a file: the next one is registered here beside this one.
export const register: Register = on => {
  registerFoldView(on)
}

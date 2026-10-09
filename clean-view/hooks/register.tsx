import type { Register } from 'claude-code'

import { registerCleanView } from './clean-view'

// One mod a file: the next one is registered here beside this one.
export const register: Register = on => {
  registerCleanView(on)
}

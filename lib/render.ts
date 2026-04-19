import 'server-only';

import { cache } from 'react';

// Keep one timestamp per server render so filtering and relative labels stay deterministic.
export const getRequestTime = cache(() => Date.now());

// ABOUTME: L0's adapter map: each provider name a role can declare, mapped to the module that
// holds every fact Rigger knows about that provider's agent CLI.

import * as claude from './claude.mjs';

/** Every provider adapter, by the provider name a role's `provider` key gives (ruling 1 Q1 on #467). */
export const ADAPTERS = Object.freeze({ claude });

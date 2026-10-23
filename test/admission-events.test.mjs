// ABOUTME: Tests the L3 events L3's admission module records for each change of admission: one per
// close, opening and closer `resume` removes, each after its write, and a refused one failing the call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  admissionOf, fsWith, moduleOver, namesIn, recordingSink, refusingSink, seed, stateOf,
} from './admission-world.mjs';
import { openSink, readEvents } from '../src/observation/sink.mjs';

// ABOUTME: Tests the writes of L3's admission module on real directories: a close links a closer of
// its own from a temporary file of its own, an opening removes one hold closer, and `resume`'s
// removal removes every closer it read, each leaving every other file byte-for-byte unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import {
  admissionOf, asRoot, closerText, fsWith, moduleOver, namesIn, picture, seed, stateOf,
} from './admission-world.mjs';

/** A closer name of `kind` and a temporary file's name, as the Terms state them. */
const CLOSER = { owner: /^owner-[0-9a-z]+\.json$/, hold: /^hold-[0-9a-z]+\.json$/ };
const TEMPORARY = /^\.tmp-[0-9a-z]+$/;

/** The names in `state`'s admission directory that `before` did not hold. */
const added = (state, before) => namesIn(state).filter((name) => !(name in before));

/** An error carrying `code`, as `node:fs` throws one. */
const failure = (code, syscall) => Object.assign(new Error(`${code}: injected, ${syscall}`), { code, syscall });

/** An id source yielding each of `ids` in turn. */
const idsFrom = (...ids) => () => ids.shift();

/** Every path the module hands to the `node:fs` call `name`, recorded into `into`. */
const watching = (name, into) => ({ [name]: (path, ...rest) => { into.push(path); return fsWith({})[name](path, ...rest); } });

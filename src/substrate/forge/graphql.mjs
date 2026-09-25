// ABOUTME: Reads a GraphQL document into its operations, each with its type, name and root
// fields, so the forge runners judge a request by what it asks rather than by its text.

/**
 * The executable part of the GraphQL grammar (the October 2021 specification, section 2), which
 * is every document `gh api graphql` sends. Type-system definitions are not read: a document
 * holding one is not a request, and is refused as unreadable. A document this cannot read
 * throws, and the runners treat that as a refusal, so a gap here fails closed.
 */

const PUNCTUATORS = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}']);
const NAME = /[_A-Za-z][_0-9A-Za-z]*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;
const IGNORED = /(?:[\s,﻿]|#[^\n\r]*)+/y;

/** The escapes a quoted string may carry, other than `\u`. */
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** Reads the quoted string opening at `at`, and returns its value and where it ends. */
function quoted(source, at) {
  let value = '';
  let i = at + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '"') return { value, end: i + 1 };
    if (char === '\n' || char === '\r') break;
    if (char !== '\\') {
      value += char;
      i += 1;
      continue;
    }
    const escaped = source[i + 1];
    if (Object.hasOwn(ESCAPES, escaped)) {
      value += ESCAPES[escaped];
      i += 2;
    } else if (escaped === 'u') {
      const code = source.slice(i + 2).match(/^(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{4}))/);
      if (!code) break;
      value += String.fromCodePoint(parseInt(code[1] ?? code[2], 16));
      i += 2 + code[0].length;
    } else {
      break;
    }
  }
  throw new Error(`a string opening at offset ${at} does not close`);
}

/** Reads the block string opening at `at`, returning its raw text: nothing here reads its value. */
function block(source, at) {
  let i = at + 3;
  while (i < source.length) {
    if (source.startsWith('\\"""', i)) i += 4;
    else if (source.startsWith('"""', i)) return { value: source.slice(at + 3, i), end: i + 3 };
    else i += 1;
  }
  throw new Error(`a block string opening at offset ${at} does not close`);
}

/** The document's tokens, each `{ kind, value }`, where kind is punct, name, number or string. */
function tokens(source) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    IGNORED.lastIndex = i;
    if (IGNORED.test(source)) {
      i = IGNORED.lastIndex;
      continue;
    }
    const char = source[i];
    if (source.startsWith('...', i)) {
      found.push({ kind: 'punct', value: '...' });
      i += 3;
    } else if (PUNCTUATORS.has(char)) {
      found.push({ kind: 'punct', value: char });
      i += 1;
    } else if (char === '"') {
      const string = source.startsWith('"""', i) ? block(source, i) : quoted(source, i);
      found.push({ kind: 'string', value: string.value });
      i = string.end;
    } else {
      NAME.lastIndex = i;
      NUMBER.lastIndex = i;
      const match = NAME.exec(source) ?? NUMBER.exec(source);
      if (!match) throw new Error(`\`${char}\` at offset ${i} is not GraphQL`);
      found.push({ kind: match[0].match(/^[_A-Za-z]/) ? 'name' : 'number', value: match[0] });
      i += match[0].length;
    }
  }
  return found;
}

/**
 * Reads `source` as an executable GraphQL document.
 *
 * Returns its `operations`, each `{ type, name, variables, directives, selections }`: `variables`
 * is whether it declares any, and a selection is a `field` with its `name`, `arguments`,
 * `directives` and `selections`, or a `fragment`, spread or inline. An argument's value is a
 * `variable`, a `string`, a `list` of `values`, an `object` of `fields`, or a `scalar` for every
 * other literal.
 */
export function parseDocument(source) {
  const list = tokens(source);
  let at = 0;
  const peek = (value) => list[at]?.value === value && list[at].kind !== 'string';
  const take = (value) => {
    if (!peek(value)) throw new Error(`expected \`${value}\` where the document has \`${list[at]?.value ?? 'its end'}\``);
    at += 1;
  };
  const name = () => {
    if (list[at]?.kind !== 'name') throw new Error(`expected a name where the document has \`${list[at]?.value ?? 'its end'}\``);
    return list[at++].value;
  };

  function value() {
    const token = list[at];
    if (peek('$')) {
      at += 1;
      return { kind: 'variable', name: name() };
    }
    if (peek('[')) {
      at += 1;
      const values = [];
      while (!peek(']')) values.push(value());
      at += 1;
      return { kind: 'list', values };
    }
    if (peek('{')) {
      at += 1;
      const fields = [];
      while (!peek('}')) {
        const key = name();
        take(':');
        fields.push({ name: key, value: value() });
      }
      at += 1;
      return { kind: 'object', fields };
    }
    if (token?.kind === 'string') {
      at += 1;
      return { kind: 'string', value: token.value };
    }
    if (token?.kind === 'name' || token?.kind === 'number') {
      at += 1;
      return { kind: 'scalar', value: token.value };
    }
    throw new Error(`expected a value where the document has \`${token?.value ?? 'its end'}\``);
  }

  function args() {
    const found = [];
    if (!peek('(')) return found;
    at += 1;
    do {
      const key = name();
      take(':');
      found.push({ name: key, value: value() });
    } while (!peek(')'));
    at += 1;
    return found;
  }

  function directives() {
    const found = [];
    while (peek('@')) {
      at += 1;
      found.push({ name: name(), arguments: args() });
    }
    return found;
  }

  function type() {
    if (peek('[')) {
      at += 1;
      type();
      take(']');
    } else {
      name();
    }
    if (peek('!')) at += 1;
  }

  function selections() {
    take('{');
    const found = [];
    do {
      if (peek('...')) {
        at += 1;
        if (list[at]?.kind === 'name' && list[at].value !== 'on') {
          found.push({ kind: 'fragment', name: name(), directives: directives() });
        } else {
          if (peek('on')) {
            at += 1;
            name();
          }
          found.push({ kind: 'fragment', name: null, directives: directives(), selections: selections() });
        }
        continue;
      }
      let field = name();
      if (peek(':')) {
        at += 1;
        field = name();
      }
      const inner = { kind: 'field', name: field, arguments: args(), directives: directives(), selections: [] };
      if (peek('{')) inner.selections = selections();
      found.push(inner);
    } while (!peek('}'));
    at += 1;
    return found;
  }

  const operations = [];
  while (at < list.length) {
    if (peek('{')) {
      operations.push({ type: 'query', name: null, variables: false, directives: [], selections: selections() });
    } else if (peek('fragment')) {
      at += 1;
      name();
      take('on');
      name();
      directives();
      selections();
    } else if (peek('query') || peek('mutation') || peek('subscription')) {
      const operation = { type: list[at++].value, name: null, variables: false };
      if (list[at]?.kind === 'name') operation.name = name();
      if (peek('(')) {
        at += 1;
        do {
          take('$');
          name();
          take(':');
          type();
          if (peek('=')) {
            at += 1;
            value();
          }
          directives();
        } while (!peek(')'));
        at += 1;
        operation.variables = true;
      }
      operation.directives = directives();
      operation.selections = selections();
      operations.push(operation);
    } else {
      throw new Error(`\`${list[at].value}\` begins no operation or fragment`);
    }
  }
  if (operations.length === 0) throw new Error('the document holds no operation');
  return { operations };
}

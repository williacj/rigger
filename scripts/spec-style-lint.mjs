// ABOUTME: Checks Rigger's binding documents against the two spec-style rules a machine can
// ABOUTME: read: the ruled-out terms, and the sentence ceiling. Both come from the skill.

/**
 * The words the skill's one-term rule rules out, read from the skill rather than typed here.
 *
 * The rule names them the one way it can: a sentence saying what the corpus uses, then `never`
 * and the spellings it does not. Only that rule's own section is read, because `never` carries
 * other work elsewhere in the skill. A prohibition of more than one word rules out an act rather
 * than a spelling — "never collapse them" — and this returns spellings, so those are dropped.
 */
export function ruledOutTerms(skill) {
  const section = skill.split(/^###\s+/m).find((part) => /^1\./.test(part));
  if (!section) throw new Error('the spec-style skill states no one-term rule to read terms from');
  const terms = new Set();
  for (const prohibition of section.matchAll(/\bnever\s+([^.;:\n]+)/g)) {
    for (const item of prohibition[1].split(/,|\bor\b|\band\b/)) {
      const term = item.trim().replace(/^\*+|\*+$/g, '').replace(/^(?:an?|the)\s+/i, '').trim();
      if (/^[A-Za-z][A-Za-z-]*$/.test(term)) terms.add(term.toLowerCase());
    }
  }
  return terms;
}

/** The sentence ceiling, read from the spec-style skill rather than typed here. */
export function sentenceCeiling(skill) {
  const stated = skill.match(/never past (\d+)/i);
  if (!stated) throw new Error('the spec-style skill states no sentence ceiling to check against');
  return Number(stated[1]);
}

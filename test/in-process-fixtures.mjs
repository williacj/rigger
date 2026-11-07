// ABOUTME: Supplies callable fixture answers without starting executable stand-ins.

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerFakeGh } from './fake-gh.mjs';
import { clonedFromOrigin, gitIn } from './git-repository.mjs';
import { fixedAnswer } from './stub-gh.mjs';

export function fixedCommand(options) {
  const answer = fixedAnswer(options);
  const calls = [];
  return {
    run: async (args) => {
      calls.push([...args]);
      return { ...answer };
    },
    calls: () => calls.map((args) => [...args]),
  };
}

/** The value at `path` in held state. */
export const valueAt = (held, path) => path.reduce((value, step) => value?.[step], held);

/** Asserts a frozen world case's request record and state, where `world` is the state it began from. */
export function assertForgeState(held, given, world) {
  assert.deepEqual(held.sent, [given.args], `${given.id} request record`);
  if (given.after === 'unchanged') assert.deepEqual(held, { ...world, sent: [given.args] }, `${given.id} state`);
  else if (given.after.writes) assert.deepEqual(held, { ...world, sent: [given.args], writes: given.after.writes }, `${given.id} state`);
  else for (const { path, equals, absent } of given.after.paths) {
    if (absent) assert.equal(valueAt(held, path), undefined, `${given.id} ${path.join('.')} absent`);
    else assert.deepEqual(valueAt(held, path), equals, `${given.id} ${path.join('.')}`);
  }
}

/** A repository with `request-topic` pushed to its origin, and the facts real git owns (D16). */
export function originFixture(directory) {
  const { origin, repository } = clonedFromOrigin(directory);
  gitIn(repository, 'switch', '--quiet', '-c', 'request-topic');
  writeFileSync(join(repository, 'README'), 'request content\n');
  gitIn(repository, 'commit', '--quiet', '-am', 'Request content');
  gitIn(repository, 'push', '--quiet', 'origin', 'request-topic');
  const read = (root, name) => gitIn(root, 'rev-parse', name).trim();
  return { repository, facts: { $ORIGIN: origin, $MAIN: read(origin, 'refs/heads/main'), $HEAD: read(repository, 'HEAD'), $TREE: read(origin, 'refs/heads/main^{tree}') } };
}

/** `value` with each `$` fact written in. */
export const withFacts = (value, facts) => JSON.parse(Object.entries(facts).reduce((text, [name, fact]) => text.split(name).join(fact), JSON.stringify(value)));

/** Asserts a frozen origin case's request record and state, where `before` is the state just before it. */
export function assertOriginState(held, before, given) {
  assert.deepEqual(held.sent, [...before.sent, given.args], `${given.id} request record`);
  if (!given.pull) {
    assert.deepEqual(held, { ...before, sent: held.sent }, `${given.id} leaves the state as it found it`);
    return;
  }
  const pull = held.repository.pullRequests[0];
  assert.deepEqual(Object.fromEntries(Object.keys(given.pull).map((key) => [key, pull[key]])), given.pull, `${given.id} pull`);
}

/** One logical forge store: whole `answerFakeGh` transactions on `statePath` run one at a time, in arrival order. */
export function forgeStore(statePath) {
  let last = Promise.resolve();
  return {
    answer: (args, context) => {
      const answered = last.then(() => answerFakeGh(statePath, args, context));
      last = answered.then(() => {}, () => {});
      return answered;
    },
  };
}

export const FORGE_MANIFEST = {
 "world": {
  "repo": "example/widgets",
  "owner": "example",
  "project": 23,
  "writes": [],
  "sent": [],
  "model": {
   "columns": [
    "Todo",
    "Done"
   ],
   "fields": [
    {
     "name": "Priority",
     "options": [
      "High",
      "Low"
     ]
    },
    {
     "name": "Points",
     "type": "NUMBER"
    }
   ],
   "labels": [
    "bug",
    "ui",
    "docs"
   ],
   "items": [
    {
     "type": "issue",
     "repository": "example/widgets",
     "number": 12,
     "title": "Card twelve",
     "body": "Body twelve",
     "labels": [
      "bug",
      "ui"
     ],
     "column": "Todo",
     "fieldValues": {
      "Priority": "High"
     }
    },
    {
     "type": "issue",
     "repository": "example/widgets",
     "number": 13,
     "title": "Card thirteen",
     "body": "Body thirteen",
     "column": "Done"
    },
    {
     "type": "pullRequest",
     "repository": "example/widgets",
     "number": 14
    },
    {
     "type": "draftIssue"
    },
    {
     "type": "redacted"
    }
   ]
  },
  "repository": {
   "branches": [
    "main",
    "topic",
    "work"
   ],
   "pullRequests": [
    {
     "number": 301,
     "head": "topic",
     "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
     "base": "main",
     "title": "Topic",
     "body": "Topic body",
     "diff": "+added line\n-removed line\n",
     "mergeBase": "dddddddddddddddddddddddddddddddddddddddd",
     "comments": [
      {
       "body": "First note",
       "createdAt": "2026-01-02T03:04:05Z"
      },
      {
       "body": "Second note",
       "createdAt": "2026-01-02T03:04:06Z"
      }
     ]
    },
    {
     "number": 302,
     "head": "topic",
     "sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
     "merged": true
    },
    {
     "number": 303,
     "head": "gone",
     "sha": "cccccccccccccccccccccccccccccccccccccccc",
     "closed": true,
     "headRepositoryDeleted": true
    },
    {
     "number": 304,
     "head": "big",
     "sha": "ffffffffffffffffffffffffffffffffffffffff",
     "declined": "diff too large"
    }
   ],
   "issues": [
    {
     "number": 12,
     "title": "Card twelve",
     "body": "Body twelve",
     "labels": [
      "bug",
      "ui"
     ],
     "comments": [
      {
       "body": "Issue note",
       "createdAt": "2026-01-03T00:00:00Z"
      },
      {
       "body": "Issue reply",
       "createdAt": "2026-01-03T00:00:01Z"
      }
     ]
    },
    {
     "number": 40,
     "title": "Card forty",
     "body": "Body forty",
     "labels": [
      "bug"
     ]
    },
    {
     "number": 41,
     "title": "Card forty-one",
     "body": "Body forty-one",
     "labels": [
      "bug"
     ]
    },
    {
     "number": 42,
     "title": "Moved away",
     "body": "Elsewhere",
     "labels": [
      "bug"
     ],
     "repository": "other/place"
    }
   ],
   "issueStates": {
    "41": "closed"
   },
   "mergeable": {
    "301": "MERGEABLE"
   },
   "commentReplies": {
    "40": {
     "status": "422",
     "message": "Body cannot be blank"
    }
   },
   "labelReplies": {
    "40": {
     "status": "403",
     "message": "Label refused"
    }
   },
   "mergeReplies": {
    "304": {
     "status": "405",
     "message": "Pull Request is not mergeable"
    }
   },
   "permissions": {
    "octo": "maintain",
    "tri": "triage"
   },
   "permissionFailures": {
    "ghost": {
     "status": "403",
     "message": "Permission refused"
    }
   },
   "checks": {
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": [
     {
      "id": 1,
      "name": "one"
     },
     {
      "id": 2,
      "name": "two"
     }
    ]
   },
   "checkFailures": {
    "cccccccccccccccccccccccccccccccccccccccc": {
     "status": "500",
     "message": "Checks unavailable"
    }
   },
   "statuses": {
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": [
     {
      "state": "success",
      "context": "ci"
     }
    ]
   },
   "rules": {
    "main": [
     {
      "type": "pull_request",
      "enforcement": "active"
     },
     {
      "type": "deletion",
      "enforcement": "evaluate"
     },
     {
      "type": "creation"
     }
    ]
   },
   "ruleFailures": {
    "locked": {
     "status": "403",
     "message": "Rules hidden"
    }
   },
   "protections": {
    "main": {
     "required_status_checks": {
      "strict": true
     }
    }
   },
   "environments": {
    "prod": {
     "can_admins_bypass": false,
     "deployment_branch_policy": {
      "protected_branches": false,
      "custom_branch_policies": true
     },
     "branch_policies": [
      {
       "name": "main",
       "type": "branch"
      }
     ],
     "variables": {
      "RELEASE": "yes"
     },
     "secrets": [
      "TOKEN"
     ]
    }
   },
   "environmentFailures": {
    "environments/locked": {
     "status": "403",
     "message": "Environment hidden"
    }
   }
  }
 },
 "originWorld": {
  "repo": "example/widgets",
  "owner": "example",
  "project": 23,
  "model": {},
  "writes": [],
  "sent": [],
  "origin": "$ORIGIN"
 },
 "coverage": {
  "answeredKeys": 58,
  "agentSubcommands": [
   "create",
   "comment",
   "view",
   "diff"
  ]
 },
 "cases": [
  {
   "id": "F1-01",
   "key": 1,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"2\"},\"nodes\":[{\"id\":\"item-1\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"Todo\",\"field\":{\"name\":\"Status\"}},{\"name\":\"High\",\"field\":{\"name\":\"Priority\"}}]},\"content\":{\"__typename\":\"Issue\",\"number\":12,\"title\":\"Card twelve\",\"body\":\"Body twelve\",\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"bug\"},{\"name\":\"ui\"}]}}},{\"id\":\"item-2\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"Done\",\"field\":{\"name\":\"Status\"}}]},\"content\":{\"__typename\":\"Issue\",\"number\":13,\"title\":\"Card thirteen\",\"body\":\"Body thirteen\",\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[]}}}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-02",
   "key": 2,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2, after: \"2\") { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"4\"},\"nodes\":[{\"id\":\"item-3\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[]},\"content\":{\"__typename\":\"PullRequest\"}},{\"id\":\"item-4\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[]},\"content\":{\"__typename\":\"DraftIssue\"}}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-02b",
   "key": 2,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2, after: \"4\") { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"6\"},\"nodes\":[{\"id\":\"item-5\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[]},\"content\":null}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-03",
   "key": 3,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 5) { pageInfo { hasNextPage endCursor } nodes { id type content { ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"5\"},\"nodes\":[{\"id\":\"item-1\",\"type\":\"ISSUE\",\"content\":{\"repository\":{\"nameWithOwner\":\"example/widgets\"}}},{\"id\":\"item-2\",\"type\":\"ISSUE\",\"content\":{\"repository\":{\"nameWithOwner\":\"example/widgets\"}}},{\"id\":\"item-3\",\"type\":\"PULL_REQUEST\",\"content\":{\"repository\":{\"nameWithOwner\":\"example/widgets\"}}},{\"id\":\"item-4\",\"type\":\"DRAFT_ISSUE\",\"content\":{}},{\"id\":\"item-5\",\"type\":\"REDACTED\",\"content\":null}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-04",
   "key": 4,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2, after: \"3\") { pageInfo { hasNextPage endCursor } nodes { id type content { ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"5\"},\"nodes\":[{\"id\":\"item-4\",\"type\":\"DRAFT_ISSUE\",\"content\":{}},{\"id\":\"item-5\",\"type\":\"REDACTED\",\"content\":null}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-05",
   "key": 5,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { fields(first: 20) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2SingleSelectField { name options { name } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"fields\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"20\"},\"nodes\":[{\"name\":\"Status\",\"options\":[{\"name\":\"Todo\"},{\"name\":\"Done\"}]},{\"name\":\"Priority\",\"options\":[{\"name\":\"High\"},{\"name\":\"Low\"}]},{}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-06",
   "key": 6,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { fields(first: 2) { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"fields\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"2\"},\"nodes\":[{\"name\":\"Status\",\"dataType\":\"SINGLE_SELECT\",\"options\":[{\"name\":\"Todo\"},{\"name\":\"Done\"}]},{\"name\":\"Priority\",\"dataType\":\"SINGLE_SELECT\",\"options\":[{\"name\":\"High\"},{\"name\":\"Low\"}]}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-07",
   "key": 7,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { fields(first: 2, after: \"2\") { pageInfo { hasNextPage endCursor } nodes { ... on ProjectV2FieldCommon { name dataType } ... on ProjectV2SingleSelectField { options { name } } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"fields\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"4\"},\"nodes\":[{\"name\":\"Points\",\"dataType\":\"NUMBER\"}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-08",
   "key": 8,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { labels(first: 2) { pageInfo { hasNextPage endCursor } nodes { name } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"labels\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"2\"},\"nodes\":[{\"name\":\"bug\"},{\"name\":\"ui\"}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-09",
   "key": 9,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { labels(first: 2, after: \"2\") { pageInfo { hasNextPage endCursor } nodes { name } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"labels\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"4\"},\"nodes\":[{\"name\":\"docs\"}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-10",
   "key": 10,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { id } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"id\":\"R_fake\"}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-11",
   "key": 11,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { id field(name: \"Status\") { ... on ProjectV2SingleSelectField { id options { id name color description } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"id\":\"PVT_fake\",\"field\":{\"id\":\"PVTSSF_Status\",\"options\":[{\"id\":\"option-0\",\"name\":\"Todo\",\"color\":\"GRAY\",\"description\":\"\"},{\"id\":\"option-1\",\"name\":\"Done\",\"color\":\"GRAY\",\"description\":\"\"}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-11b",
   "key": 11,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { id field(name: \"Absent\") { ... on ProjectV2SingleSelectField { id options { id name color description } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"id\":\"PVT_fake\",\"field\":null}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-12",
   "key": 12,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { field: node(id: \"PVTSSF_Priority\") { ... on ProjectV2SingleSelectField { name options { id name color description } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"field\":{\"name\":\"Priority\",\"options\":[{\"id\":\"option-0\",\"name\":\"High\",\"color\":\"GRAY\",\"description\":\"\"},{\"id\":\"option-1\",\"name\":\"Low\",\"color\":\"GRAY\",\"description\":\"\"}]}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-12",
   "key": 12,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { field: node(id: \"PVTSSF_Absent\") { ... on ProjectV2SingleSelectField { name options { id name color description } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'PVTSSF_Absent'\n",
   "after": "unchanged"
  },
  {
   "id": "F1-13",
   "key": 13,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2Field(input: {fieldId: \"PVTSSF_Status\", singleSelectOptions: [{id: \"option-0\", name: \"Todo\", color: GRAY, description: \"\"}, {id: \"option-1\", name: \"Done\", color: GRAY, description: \"\"}, {name: \"Review\", color: GRAY, description: \"\"}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"updateProjectV2Field\":{\"projectV2Field\":{\"id\":\"PVTSSF_Status\"}}}}\n",
   "stderr": "",
   "after": {
    "writes": [
     {
      "operation": "createColumn",
      "args": [
       "Review"
      ]
     }
    ]
   }
  },
  {
   "id": "F3-13a",
   "key": 13,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2Field(input: {fieldId: \"PVTSSF_Priority\", singleSelectOptions: [{name: \"Review\", color: GRAY, description: \"\"}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'PVTSSF_Priority'\n",
   "after": "unchanged"
  },
  {
   "id": "F3-13b",
   "key": 13,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2Field(input: {fieldId: \"PVTSSF_Status\", singleSelectOptions: [{id: \"option-0\", name: \"Todo\", color: GRAY, description: \"\"}, {id: \"option-1\", name: \"Done\", color: GRAY, description: \"\"}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model an updateProjectV2Field that leaves out or changes a held option, or adds none\n",
   "after": "unchanged"
  },
  {
   "id": "F1-14",
   "key": 14,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { project: node(id: \"PVT_fake\") { ... on ProjectV2 { field(name: \"Status\") { ... on ProjectV2SingleSelectField { id } } } } target: node(id: \"PVTSSF_Priority\") { ... on ProjectV2FieldCommon { name } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"project\":{\"field\":{\"id\":\"PVTSSF_Status\"}},\"target\":{\"name\":\"Priority\"}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-14b",
   "key": 14,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { project: node(id: \"PVT_other\") { ... on ProjectV2 { field(name: \"Absent\") { ... on ProjectV2SingleSelectField { id } } } } target: node(id: \"PVTSSF_Absent\") { ... on ProjectV2FieldCommon { name } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"project\":null,\"target\":null}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-14c",
   "key": 14,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { project: node(id: \"PVT_fake\") { ... on ProjectV2 { field(name: \"Absent\") { ... on ProjectV2SingleSelectField { id } } } } target: node(id: \"PVTSSF_Status\") { ... on ProjectV2FieldCommon { name } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"project\":{\"field\":null},\"target\":{\"name\":\"Status\"}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-15",
   "key": 15,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-1\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-1\"}}) { projectV2Item { id } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"updateProjectV2ItemFieldValue\":{\"projectV2Item\":{\"id\":\"item-1\"}}}}\n",
   "stderr": "",
   "after": {
    "writes": [
     {
      "operation": "moveItem",
      "args": [
       "item-1",
       "Done"
      ]
     }
    ]
   }
  },
  {
   "id": "F3-15a",
   "key": 15,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_other\", itemId: \"item-1\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-1\"}}) { projectV2Item { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'PVT_other'\n",
   "after": "unchanged"
  },
  {
   "id": "F3-15b",
   "key": 15,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-99\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-1\"}}) { projectV2Item { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'item-99'\n",
   "after": "unchanged"
  },
  {
   "id": "F3-15c",
   "key": 15,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-1\", fieldId: \"PVTSSF_Priority\", value: {singleSelectOptionId: \"option-1\"}}) { projectV2Item { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'PVTSSF_Priority'\n",
   "after": "unchanged"
  },
  {
   "id": "F3-15d",
   "key": 15,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-1\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-9\"}}) { projectV2Item { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'option-9'\n",
   "after": "unchanged"
  },
  {
   "id": "F1-16",
   "key": 16,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { addProjectV2ItemById(input: {projectId: \"PVT_fake\", contentId: \"I_issue40\"}) { item { id } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"addProjectV2ItemById\":{\"item\":{\"id\":\"item-6\"}}}}\n",
   "stderr": "",
   "after": {
    "writes": [
     {
      "operation": "addIssue",
      "args": [
       40,
       "example/widgets"
      ]
     }
    ]
   }
  },
  {
   "id": "F3-16a",
   "key": 16,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { addProjectV2ItemById(input: {projectId: \"PVT_other\", contentId: \"I_issue40\"}) { item { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'PVT_other'\n",
   "after": "unchanged"
  },
  {
   "id": "F3-16b",
   "key": 16,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { addProjectV2ItemById(input: {projectId: \"PVT_fake\", contentId: \"I_issue99\"}) { item { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'I_issue99'\n",
   "after": "unchanged"
  },
  {
   "id": "F1-17",
   "key": 17,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { createProjectV2Field(input: {projectId: \"PVT_fake\", dataType: SINGLE_SELECT, name: \"Size\", singleSelectOptions: [{name: \"Small\", color: GRAY, description: \"\"}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"createProjectV2Field\":{\"projectV2Field\":{\"id\":\"PVTSSF_Size\"}}}}\n",
   "stderr": "",
   "after": {
    "writes": [
     {
      "operation": "createField",
      "args": [
       "Size",
       [
        "Small"
       ]
      ]
     }
    ]
   }
  },
  {
   "id": "F3-17",
   "key": 17,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { createProjectV2Field(input: {projectId: \"PVT_other\", dataType: SINGLE_SELECT, name: \"Size\", singleSelectOptions: [{name: \"Small\", color: GRAY, description: \"\"}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'PVT_other'\n",
   "after": "unchanged"
  },
  {
   "id": "F1-18",
   "key": 18,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { createLabel(input: {repositoryId: \"R_fake\", name: \"fresh\", color: \"ededed\"}) { label { id } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"createLabel\":{\"label\":{\"id\":\"LA_fresh\"}}}}\n",
   "stderr": "",
   "after": {
    "writes": [
     {
      "operation": "createLabel",
      "args": [
       "fresh"
      ]
     }
    ]
   }
  },
  {
   "id": "F3-18",
   "key": 18,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=mutation { createLabel(input: {repositoryId: \"R_other\", name: \"fresh\", color: \"ededed\"}) { label { id } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a node with the global id of 'R_other'\n",
   "after": "unchanged"
  },
  {
   "id": "F1-19",
   "key": 19,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequests(headRefName: \"topic\", states: [OPEN, MERGED], first: 1) { pageInfo { hasNextPage endCursor } nodes { number state headRefOid baseRefName headRepository { nameWithOwner } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequests\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"number\":301,\"state\":\"OPEN\",\"headRefOid\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"baseRefName\":\"main\",\"headRepository\":{\"nameWithOwner\":\"example/widgets\"}}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-20",
   "key": 20,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequests(headRefName: \"topic\", states: [OPEN, MERGED], first: 1, after: \"1\") { pageInfo { hasNextPage endCursor } nodes { number state headRefOid baseRefName headRepository { nameWithOwner } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequests\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"2\"},\"nodes\":[{\"number\":302,\"state\":\"MERGED\",\"headRefOid\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"baseRefName\":\"main\",\"headRepository\":{\"nameWithOwner\":\"example/widgets\"}}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-19b",
   "key": 19,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequests(headRefName: \"gone\", states: [CLOSED], first: 5) { pageInfo { hasNextPage endCursor } nodes { number state headRefOid baseRefName headRepository { nameWithOwner } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequests\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"5\"},\"nodes\":[{\"number\":303,\"state\":\"CLOSED\",\"headRefOid\":\"cccccccccccccccccccccccccccccccccccccccc\",\"baseRefName\":\"main\",\"headRepository\":null}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-21",
   "key": 21,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { refs(refPrefix: \"refs/heads/\", first: 2) { pageInfo { hasNextPage endCursor } nodes { name } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"refs\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"2\"},\"nodes\":[{\"name\":\"main\"},{\"name\":\"topic\"}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-22",
   "key": 22,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { refs(refPrefix: \"refs/heads/\", first: 2, after: \"2\") { pageInfo { hasNextPage endCursor } nodes { name } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"refs\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"4\"},\"nodes\":[{\"name\":\"work\"}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-23",
   "key": 23,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 301) { comments(first: 1) { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"comments\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"body\":\"First note\",\"createdAt\":\"2026-01-02T03:04:05Z\",\"id\":\"IC_301_1\",\"author\":{\"login\":\"rigger-fake\"},\"lastEditedAt\":null,\"includesCreatedEdit\":false}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-24",
   "key": 24,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 301) { comments(first: 1, after: \"1\") { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"comments\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"2\"},\"nodes\":[{\"body\":\"Second note\",\"createdAt\":\"2026-01-02T03:04:06Z\",\"id\":\"IC_301_2\",\"author\":{\"login\":\"rigger-fake\"},\"lastEditedAt\":null,\"includesCreatedEdit\":false}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-23",
   "key": 23,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 999) { comments(first: 1) { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a PullRequest with the number of 999.\n",
   "after": "unchanged"
  },
  {
   "id": "F1-25",
   "key": 25,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { comments(first: 1) { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"comments\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"body\":\"Issue note\",\"createdAt\":\"2026-01-03T00:00:00Z\",\"id\":\"IC_12_1\",\"author\":{\"login\":\"rigger-fake\"},\"lastEditedAt\":null,\"includesCreatedEdit\":false}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-26",
   "key": 26,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { comments(first: 1, after: \"1\") { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"comments\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"2\"},\"nodes\":[{\"body\":\"Issue reply\",\"createdAt\":\"2026-01-03T00:00:01Z\",\"id\":\"IC_12_2\",\"author\":{\"login\":\"rigger-fake\"},\"lastEditedAt\":null,\"includesCreatedEdit\":false}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-25b",
   "key": 25,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 13) { comments(first: 1) { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"comments\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"1\"},\"nodes\":[]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-25",
   "key": 25,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 999) { comments(first: 1) { pageInfo { hasNextPage endCursor } nodes { body createdAt id author { login } lastEditedAt includesCreatedEdit } } } } }"
   ],
   "status": 1,
   "stdout": "{\"data\":{\"repository\":{\"issue\":null}},\"errors\":[{\"type\":\"NOT_FOUND\",\"path\":[\"repository\",\"issue\"],\"locations\":[{\"line\":1,\"column\":1}],\"message\":\"Could not resolve to an Issue with the number of 999.\"}]}",
   "stderr": "gh: Could not resolve to an Issue with the number of 999.\n",
   "after": "unchanged"
  },
  {
   "id": "F1-27",
   "key": 27,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 301) { baseRefName headRefOid } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"baseRefName\":\"main\",\"headRefOid\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-27",
   "key": 27,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 999) { baseRefName headRefOid } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a PullRequest with the number of 999.\n",
   "after": "unchanged"
  },
  {
   "id": "F1-28",
   "key": 28,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 301) { number state headRefOid headRefName baseRefName headRepository { nameWithOwner } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"number\":301,\"state\":\"OPEN\",\"headRefOid\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"headRefName\":\"topic\",\"baseRefName\":\"main\",\"headRepository\":{\"nameWithOwner\":\"example/widgets\"}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-28b",
   "key": 28,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 303) { number state headRefOid headRefName baseRefName headRepository { nameWithOwner } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"number\":303,\"state\":\"CLOSED\",\"headRefOid\":\"cccccccccccccccccccccccccccccccccccccccc\",\"headRefName\":\"gone\",\"baseRefName\":\"main\",\"headRepository\":null}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-29",
   "key": 29,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { number title body state author { login } repository { nameWithOwner } labels(first: 1) { pageInfo { hasNextPage endCursor } nodes { name } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"number\":12,\"title\":\"Card twelve\",\"body\":\"Body twelve\",\"state\":\"OPEN\",\"author\":{\"login\":\"rigger-fake\"},\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"name\":\"bug\"}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-29b",
   "key": 29,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 41) { number title body state author { login } repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage endCursor } nodes { name } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"number\":41,\"title\":\"Card forty-one\",\"body\":\"Body forty-one\",\"state\":\"CLOSED\",\"author\":{\"login\":\"rigger-fake\"},\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"5\"},\"nodes\":[{\"name\":\"bug\"}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-29",
   "key": 29,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 999) { number title body state author { login } repository { nameWithOwner } labels(first: 1) { pageInfo { hasNextPage endCursor } nodes { name } } } } }"
   ],
   "status": 1,
   "stdout": "{\"data\":{\"repository\":{\"issue\":null}},\"errors\":[{\"type\":\"NOT_FOUND\",\"path\":[\"repository\",\"issue\"],\"locations\":[{\"line\":1,\"column\":1}],\"message\":\"Could not resolve to an Issue with the number of 999.\"}]}",
   "stderr": "gh: Could not resolve to an Issue with the number of 999.\n",
   "after": "unchanged"
  },
  {
   "id": "F1-33",
   "key": 33,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { number title body state author { login } repository { nameWithOwner } labels(first: 1, after: \"1\") { pageInfo { hasNextPage endCursor } nodes { name } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"number\":12,\"title\":\"Card twelve\",\"body\":\"Body twelve\",\"state\":\"OPEN\",\"author\":{\"login\":\"rigger-fake\"},\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"2\"},\"nodes\":[{\"name\":\"ui\"}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-30",
   "key": 30,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { state repository { nameWithOwner } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"state\":\"OPEN\",\"repository\":{\"nameWithOwner\":\"example/widgets\"}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-30b",
   "key": 30,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 42) { state repository { nameWithOwner } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"state\":\"OPEN\",\"repository\":{\"nameWithOwner\":\"other/place\"}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-30",
   "key": 30,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 999) { state repository { nameWithOwner } } } }"
   ],
   "status": 1,
   "stdout": "{\"data\":{\"repository\":{\"issue\":null}},\"errors\":[{\"type\":\"NOT_FOUND\",\"path\":[\"repository\",\"issue\"],\"locations\":[{\"line\":1,\"column\":1}],\"message\":\"Could not resolve to an Issue with the number of 999.\"}]}",
   "stderr": "gh: Could not resolve to an Issue with the number of 999.\n",
   "after": "unchanged"
  },
  {
   "id": "F1-31",
   "key": 31,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { timelineItems(itemTypes: [ISSUE_COMMENT, LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT, REOPENED_EVENT], first: 2) { pageInfo { hasNextPage endCursor } nodes { __typename ... on IssueComment { body createdAt id author { login } lastEditedAt includesCreatedEdit } ... on LabeledEvent { createdAt actor { login } label { name } } ... on UnlabeledEvent { createdAt actor { login } label { name } } ... on ClosedEvent { createdAt actor { login } } ... on ReopenedEvent { createdAt actor { login } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"timelineItems\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"2\"},\"nodes\":[{\"__typename\":\"LabeledEvent\",\"createdAt\":\"2026-10-01T00:00:00Z\",\"actor\":{\"login\":\"rigger-fake\"},\"label\":{\"name\":\"bug\"}},{\"__typename\":\"LabeledEvent\",\"createdAt\":\"2026-10-01T00:00:00Z\",\"actor\":{\"login\":\"rigger-fake\"},\"label\":{\"name\":\"ui\"}}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-32",
   "key": 32,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issue(number: 12) { timelineItems(itemTypes: [ISSUE_COMMENT, LABELED_EVENT, UNLABELED_EVENT, CLOSED_EVENT, REOPENED_EVENT], first: 2, after: \"2\") { pageInfo { hasNextPage endCursor } nodes { __typename ... on IssueComment { body createdAt id author { login } lastEditedAt includesCreatedEdit } ... on LabeledEvent { createdAt actor { login } label { name } } ... on UnlabeledEvent { createdAt actor { login } label { name } } ... on ClosedEvent { createdAt actor { login } } ... on ReopenedEvent { createdAt actor { login } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issue\":{\"timelineItems\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"4\"},\"nodes\":[{\"__typename\":\"IssueComment\",\"body\":\"Issue note\",\"createdAt\":\"2026-01-03T00:00:00Z\",\"id\":\"IC_12_1\",\"author\":{\"login\":\"rigger-fake\"},\"lastEditedAt\":null,\"includesCreatedEdit\":false},{\"__typename\":\"IssueComment\",\"body\":\"Issue reply\",\"createdAt\":\"2026-01-03T00:00:01Z\",\"id\":\"IC_12_2\",\"author\":{\"login\":\"rigger-fake\"},\"lastEditedAt\":null,\"includesCreatedEdit\":false}]}}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-34",
   "key": 34,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issues(states: [OPEN], labels: [\"bug\"], first: 1) { pageInfo { hasNextPage endCursor } nodes { number } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issues\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"number\":12}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-35",
   "key": 35,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { issues(states: [OPEN], labels: [\"bug\"], first: 1, after: \"1\") { pageInfo { hasNextPage endCursor } nodes { number } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"issues\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"2\"},\"nodes\":[{\"number\":40}]}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-36",
   "key": 36,
   "args": [
    "api",
    "repos/example/widgets/issues?state=all&sort=created&direction=desc&per_page=1",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "[{\"number\":304}]",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-37",
   "key": 37,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { defaultBranchRef { name target { oid } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"defaultBranchRef\":null}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-38",
   "key": 38,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { object(oid: \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\") { ... on Commit { oid file(path: \"README\") { mode type object { ... on Blob { text isBinary isTruncated byteSize } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"object\":null}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-39",
   "key": 39,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 301) { mergeable } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"mergeable\":\"MERGEABLE\"}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-39b",
   "key": 39,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { pullRequest(number: 302) { mergeable } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"pullRequest\":{\"mergeable\":\"UNKNOWN\"}}}}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-40",
   "key": 40,
   "args": [
    "api",
    "repos/example/widgets/pulls/301",
    "-X",
    "GET",
    "-H",
    "Accept: application/vnd.github.diff"
   ],
   "status": 0,
   "stdout": "+added line\n-removed line\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-40a",
   "key": 40,
   "args": [
    "api",
    "repos/example/widgets/pulls/304",
    "-X",
    "GET",
    "-H",
    "Accept: application/vnd.github.diff"
   ],
   "status": 1,
   "stdout": "{\"message\":\"diff too large\",\"errors\":[{\"resource\":\"PullRequest\",\"field\":\"diff\",\"code\":\"too_large\"}],\"status\":\"406\"}",
   "stderr": "gh: diff too large (HTTP 406)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-40b",
   "key": 40,
   "args": [
    "api",
    "repos/example/widgets/pulls/999",
    "-X",
    "GET",
    "-H",
    "Accept: application/vnd.github.diff"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/pulls/pulls#get-a-pull-request\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-41",
   "key": 41,
   "args": [
    "api",
    "repos/example/widgets/compare/main...aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"merge_base_commit\":{\"sha\":\"dddddddddddddddddddddddddddddddddddddddd\"}}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-41",
   "key": 41,
   "args": [
    "api",
    "repos/example/widgets/compare/main...bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/commits/commits#compare-two-commits\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-42",
   "key": 42,
   "args": [
    "api",
    "repos/example/widgets/collaborators/octo/permission",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"permission\":\"write\",\"role_name\":\"maintain\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-42b",
   "key": 42,
   "args": [
    "api",
    "repos/example/widgets/collaborators/tri/permission",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"permission\":\"read\",\"role_name\":\"triage\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-42a",
   "key": 42,
   "args": [
    "api",
    "repos/example/widgets/collaborators/ghost/permission",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"status\":\"403\",\"message\":\"Permission refused\"}",
   "stderr": "gh: Permission refused (HTTP 403)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-42b",
   "key": 42,
   "args": [
    "api",
    "repos/example/widgets/collaborators/nobody/permission",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/collaborators/collaborators#get-repository-permissions-for-a-user\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-43",
   "key": 43,
   "args": [
    "api",
    "repos/example/widgets/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"total_count\":2,\"check_runs\":[{\"id\":1,\"name\":\"one\"},{\"id\":2,\"name\":\"two\"}]}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-43b",
   "key": 43,
   "args": [
    "api",
    "repos/example/widgets/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?per_page=100&page=2",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"total_count\":2,\"check_runs\":[]}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-43",
   "key": 43,
   "args": [
    "api",
    "repos/example/widgets/commits/cccccccccccccccccccccccccccccccccccccccc/check-runs?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"status\":\"500\",\"message\":\"Checks unavailable\"}",
   "stderr": "gh: Checks unavailable (HTTP 500)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-44",
   "key": 44,
   "args": [
    "api",
    "repos/example/widgets/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/statuses?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "[{\"state\":\"success\",\"context\":\"ci\"}]",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-44b",
   "key": 44,
   "args": [
    "api",
    "repos/example/widgets/commits/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/statuses?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "[]",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-45",
   "key": 45,
   "args": [
    "api",
    "repos/example/widgets/rules/branches/main?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "[{\"type\":\"pull_request\"},{\"type\":\"creation\"}]",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-45",
   "key": 45,
   "args": [
    "api",
    "repos/example/widgets/rules/branches/locked?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"status\":\"403\",\"message\":\"Rules hidden\"}",
   "stderr": "gh: Rules hidden (HTTP 403)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-46",
   "key": 46,
   "args": [
    "api",
    "repos/example/widgets/branches/main/protection",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"required_status_checks\":{\"strict\":true}}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-46",
   "key": 46,
   "args": [
    "api",
    "repos/example/widgets/branches/topic/protection",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Branch not protected\",\"status\":\"404\"}",
   "stderr": "gh: Branch not protected (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-47",
   "key": 47,
   "args": [
    "api",
    "repos/example/widgets/environments/prod",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"can_admins_bypass\":false,\"deployment_branch_policy\":{\"protected_branches\":false,\"custom_branch_policies\":true}}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-47a",
   "key": 47,
   "args": [
    "api",
    "repos/example/widgets/environments/locked",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"status\":\"403\",\"message\":\"Environment hidden\"}",
   "stderr": "gh: Environment hidden (HTTP 403)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-47b",
   "key": 47,
   "args": [
    "api",
    "repos/example/widgets/environments/absent",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/deployments/environments\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-48",
   "key": 48,
   "args": [
    "api",
    "repos/example/widgets/environments/prod/deployment-branch-policies?per_page=100&page=1",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"total_count\":1,\"branch_policies\":[{\"name\":\"main\",\"type\":\"branch\"}]}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-49",
   "key": 49,
   "args": [
    "api",
    "repos/example/widgets/environments/prod/variables/RELEASE",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"name\":\"RELEASE\",\"value\":\"yes\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-49",
   "key": 49,
   "args": [
    "api",
    "repos/example/widgets/environments/prod/variables/ABSENT",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/actions/variables\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-50",
   "key": 50,
   "args": [
    "api",
    "repos/example/widgets/environments/prod/secrets/TOKEN",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"name\":\"TOKEN\",\"created_at\":\"2026-10-13T12:00:00Z\",\"updated_at\":\"2026-10-13T12:00:00Z\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-50",
   "key": 50,
   "args": [
    "api",
    "repos/example/widgets/environments/prod/secrets/ABSENT",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/actions/secrets\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-51",
   "key": 51,
   "args": [
    "api",
    "repos/example/widgets/pulls/301",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"state\":\"open\",\"merged\":false,\"mergeable\":\"MERGEABLE\",\"head\":{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},\"merge_commit_sha\":null}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F1-51b",
   "key": 51,
   "args": [
    "api",
    "repos/example/widgets/pulls/302",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"state\":\"closed\",\"merged\":true,\"mergeable\":true,\"head\":{\"sha\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"},\"merge_commit_sha\":null}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-51",
   "key": 51,
   "args": [
    "api",
    "repos/example/widgets/pulls/999",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/pulls/pulls#get-a-pull-request\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-52",
   "key": 52,
   "args": [
    "api",
    "repos/example/widgets/issues/12",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"number\":12,\"node_id\":\"I_issue12\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-52",
   "key": 52,
   "args": [
    "api",
    "repos/example/widgets/issues/999",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/issues/issues#get-an-issue\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-53",
   "key": 53,
   "args": [
    "api",
    "repos/example/widgets/issues",
    "-X",
    "POST",
    "-f",
    "title=New card",
    "-f",
    "body=New body",
    "-f",
    "labels[]=bug",
    "-f",
    "labels[]=ui"
   ],
   "status": 0,
   "stdout": "{\"number\":305,\"title\":\"New card\",\"body\":\"New body\",\"labels\":[{\"name\":\"bug\"},{\"name\":\"ui\"}],\"node_id\":\"I_issue305\"}",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "issues",
       4
      ],
      "equals": {
       "number": 305,
       "title": "New card",
       "body": "New body",
       "labels": [
        "bug",
        "ui"
       ]
      }
     }
    ]
   }
  },
  {
   "id": "F1-54",
   "key": 54,
   "args": [
    "api",
    "repos/example/widgets/issues/40",
    "-X",
    "PATCH",
    "-f",
    "state=closed"
   ],
   "status": 0,
   "stdout": "{\"number\":40,\"state\":\"closed\"}",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "issueStates",
       "40"
      ],
      "equals": "closed"
     },
     {
      "path": [
       "repository",
       "issues",
       1,
       "events"
      ],
      "equals": [
       {
        "kind": "closed",
        "after": 0
       }
      ]
     },
     {
      "path": [
       "repository",
       "issues",
       1,
       "opened"
      ],
      "equals": [
       "bug"
      ]
     }
    ]
   }
  },
  {
   "id": "F1-54b",
   "key": 54,
   "args": [
    "api",
    "repos/example/widgets/issues/41",
    "-X",
    "PATCH",
    "-f",
    "state=closed"
   ],
   "status": 0,
   "stdout": "{\"number\":41,\"state\":\"closed\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-54",
   "key": 54,
   "args": [
    "api",
    "repos/example/widgets/issues/999",
    "-X",
    "PATCH",
    "-f",
    "state=closed"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/issues/issues#update-an-issue\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-55",
   "key": 55,
   "args": [
    "api",
    "repos/example/widgets/issues/12/labels/ui",
    "-X",
    "DELETE"
   ],
   "status": 0,
   "stdout": "[{\"name\":\"bug\"}]",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "issues",
       0,
       "labels"
      ],
      "equals": [
       "bug"
      ]
     },
     {
      "path": [
       "repository",
       "issues",
       0,
       "events"
      ],
      "equals": [
       {
        "kind": "unlabeled",
        "label": "ui",
        "after": 2
       }
      ]
     },
     {
      "path": [
       "repository",
       "issues",
       0,
       "opened"
      ],
      "equals": [
       "bug",
       "ui"
      ]
     }
    ]
   }
  },
  {
   "id": "F3-55a",
   "key": 55,
   "args": [
    "api",
    "repos/example/widgets/issues/999/labels/ui",
    "-X",
    "DELETE"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/issues/labels#remove-a-label-from-an-issue\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-55b",
   "key": 55,
   "args": [
    "api",
    "repos/example/widgets/issues/40/labels/ui",
    "-X",
    "DELETE"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/issues/labels#remove-a-label-from-an-issue\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-56",
   "key": 56,
   "args": [
    "api",
    "repos/example/widgets/pulls/301/merge",
    "-X",
    "PUT",
    "-f",
    "sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "-f",
    "merge_method=merge"
   ],
   "status": 0,
   "stdout": "{\"sha\":\"mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm\",\"merged\":true,\"message\":\"Pull Request successfully merged\"}",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "pullRequests",
       0,
       "merged"
      ],
      "equals": true
     },
     {
      "path": [
       "repository",
       "mainSha"
      ],
      "equals": "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"
     }
    ]
   }
  },
  {
   "id": "F1-56b",
   "key": 56,
   "args": [
    "api",
    "repos/example/widgets/pulls/302/merge",
    "-X",
    "PUT",
    "-f",
    "sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "-f",
    "merge_method=merge"
   ],
   "status": 0,
   "stdout": "{\"merged\":true,\"message\":\"Pull Request successfully merged\"}",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-56a",
   "key": 56,
   "args": [
    "api",
    "repos/example/widgets/pulls/999/merge",
    "-X",
    "PUT",
    "-f",
    "sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "-f",
    "merge_method=merge"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/pulls/pulls#merge-a-pull-request\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-56b",
   "key": 56,
   "args": [
    "api",
    "repos/example/widgets/pulls/301/merge",
    "-X",
    "PUT",
    "-f",
    "sha=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "-f",
    "merge_method=merge"
   ],
   "status": 1,
   "stdout": "{\"status\":\"409\",\"message\":\"Head branch was modified. Review and try the merge again.\"}",
   "stderr": "gh: Conflict (HTTP 409)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-56c",
   "key": 56,
   "args": [
    "api",
    "repos/example/widgets/pulls/304/merge",
    "-X",
    "PUT",
    "-f",
    "sha=ffffffffffffffffffffffffffffffffffffffff",
    "-f",
    "merge_method=merge"
   ],
   "status": 1,
   "stdout": "{\"status\":\"405\",\"message\":\"Pull Request is not mergeable\"}",
   "stderr": "gh: Method Not Allowed (HTTP 405)\n",
   "after": "unchanged"
  },
  {
   "id": "F1-57",
   "key": 57,
   "args": [
    "api",
    "repos/example/widgets/issues/12/comments",
    "-X",
    "POST",
    "-f",
    "body=Rest note"
   ],
   "status": 0,
   "stdout": "{\"id\":3,\"body\":\"Rest note\"}",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "issues",
       0,
       "comments",
       2
      ],
      "equals": {
       "body": "Rest note",
       "createdAt": "2000-01-02T03:04:05Z"
      }
     }
    ]
   },
   "context": {
    "now": "2000-01-02T03:04:05Z"
   },
   "wallClock": [
    [
     "repository",
     "issues",
     0,
     "comments",
     2,
     "createdAt"
    ]
   ]
  },
  {
   "id": "F3-57a",
   "key": 57,
   "args": [
    "api",
    "repos/example/widgets/issues/999/comments",
    "-X",
    "POST",
    "-f",
    "body=x"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/issues/comments#create-an-issue-comment\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged",
   "context": {
    "now": "2000-01-02T03:04:05Z"
   }
  },
  {
   "id": "F3-57b",
   "key": 57,
   "args": [
    "api",
    "repos/example/widgets/issues/40/comments",
    "-X",
    "POST",
    "-f",
    "body="
   ],
   "status": 1,
   "stdout": "{\"status\":\"422\",\"message\":\"Body cannot be blank\"}",
   "stderr": "gh: Body cannot be blank (HTTP 422)\n",
   "after": "unchanged",
   "context": {
    "now": "2000-01-02T03:04:05Z"
   }
  },
  {
   "id": "F1-58",
   "key": 58,
   "args": [
    "api",
    "repos/example/widgets/issues/12/labels",
    "-X",
    "POST",
    "-f",
    "labels[]=docs"
   ],
   "status": 0,
   "stdout": "[{\"name\":\"bug\"},{\"name\":\"ui\"},{\"name\":\"docs\"}]",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "issues",
       0,
       "labels"
      ],
      "equals": [
       "bug",
       "ui",
       "docs"
      ]
     },
     {
      "path": [
       "repository",
       "issues",
       0,
       "events"
      ],
      "equals": [
       {
        "kind": "labeled",
        "label": "docs",
        "after": 2
       }
      ]
     }
    ]
   }
  },
  {
   "id": "F1-58b",
   "key": 58,
   "args": [
    "api",
    "repos/example/widgets/issues/12/labels",
    "-X",
    "POST",
    "-f",
    "labels[]=bug"
   ],
   "status": 0,
   "stdout": "[{\"name\":\"bug\"},{\"name\":\"ui\"}]",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F3-58a",
   "key": 58,
   "args": [
    "api",
    "repos/example/widgets/issues/999/labels",
    "-X",
    "POST",
    "-f",
    "labels[]=docs"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest/issues/labels#add-labels-to-an-issue\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-58b",
   "key": 58,
   "args": [
    "api",
    "repos/example/widgets/issues/40/labels",
    "-X",
    "POST",
    "-f",
    "labels[]=docs"
   ],
   "status": 1,
   "stdout": "{\"status\":\"403\",\"message\":\"Label refused\"}",
   "stderr": "gh: Label refused (HTTP 403)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-W1",
   "key": 1,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"stranger\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a ProjectV2 with the number 23.\n",
   "after": "unchanged"
  },
  {
   "id": "F3-W2",
   "key": 1,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 99) { items(first: 2) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a ProjectV2 with the number 99.\n",
   "after": "unchanged"
  },
  {
   "id": "F3-W3",
   "key": 10,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"stranger\", name: \"widgets\") { id } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "gh: Could not resolve to a Repository with the name 'stranger/widgets'.\n",
   "after": "unchanged"
  },
  {
   "id": "F3-W4",
   "key": 52,
   "args": [
    "api",
    "repos/stranger/widgets/issues/12",
    "-X",
    "GET"
   ],
   "status": 1,
   "stdout": "{\"message\":\"Not Found\",\"documentation_url\":\"https://docs.github.com/rest\",\"status\":\"404\"}",
   "stderr": "gh: Not Found (HTTP 404)\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U1",
   "key": null,
   "args": [
    "auth",
    "status"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh auth status`\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U2",
   "key": null,
   "args": [
    "pr",
    "merge",
    "301"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr merge 301`\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U3",
   "key": null,
   "args": [
    "pr",
    "constructor"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr constructor`\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U4",
   "key": null,
   "args": [],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh`\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U5",
   "key": null,
   "args": [
    "api",
    "repos/example/widgets/issues/12",
    "-X",
    "DELETE"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh api repos/example/widgets/issues/12 -X DELETE`\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U6",
   "key": null,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { viewer { login } }"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh api graphql -f query=query { viewer { login } }`\n",
   "after": "unchanged"
  },
  {
   "id": "F3-U7",
   "key": null,
   "args": [
    "api",
    "repos/example/widgets/issues",
    "-X",
    "POST",
    "-f",
    "title=a",
    "-f",
    "body=b"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh api repos/example/widgets/issues -X POST -f title=a -f body=b`\n",
   "after": "unchanged"
  },
  {
   "id": "F2-V1",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301"
   ],
   "status": 0,
   "stdout": "title:\tTopic\nstate:\tOPEN\nauthor:\trigger-fake\nlabels:\t\nassignees:\t\nreviewers:\t\nprojects:\t\nmilestone:\t\nnumber:\t301\nurl:\thttps://github.com/example/widgets/pull/301\nadditions:\t1\ndeletions:\t1\nauto-merge:\tdisabled\n--\nTopic body\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V2",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301",
    "--json",
    "number,comments"
   ],
   "status": 0,
   "stdout": "{\"comments\":[{\"body\":\"First note\",\"createdAt\":\"2026-01-02T03:04:05Z\"},{\"body\":\"Second note\",\"createdAt\":\"2026-01-02T03:04:06Z\"}],\"number\":301}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V3",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301",
    "--json",
    "title,body,state,url,headRefName,headRefOid,baseRefName"
   ],
   "status": 0,
   "stdout": "{\"baseRefName\":\"main\",\"body\":\"Topic body\",\"headRefName\":\"topic\",\"headRefOid\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"state\":\"OPEN\",\"title\":\"Topic\",\"url\":\"https://github.com/example/widgets/pull/301\"}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V4",
   "key": "view",
   "args": [
    "pr",
    "view",
    "https://github.com/example/widgets/pull/302",
    "--json",
    "number,state"
   ],
   "status": 0,
   "stdout": "{\"number\":302,\"state\":\"MERGED\"}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V5",
   "key": "view",
   "args": [
    "pr",
    "view",
    "topic",
    "--json",
    "number"
   ],
   "status": 0,
   "stdout": "{\"number\":301}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V6",
   "key": "view",
   "args": [
    "pr",
    "view",
    "gone",
    "--json",
    "number"
   ],
   "status": 0,
   "stdout": "{\"number\":303}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V7",
   "key": "view",
   "args": [
    "pr",
    "view",
    "--json",
    "number",
    "-R",
    "EXAMPLE/widgets",
    "topic"
   ],
   "status": 0,
   "stdout": "{\"number\":301}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-V8",
   "key": "view",
   "args": [
    "pr",
    "view",
    "--json=number",
    "--repo=example/widgets",
    "301"
   ],
   "status": 0,
   "stdout": "{\"number\":301}\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-X1",
   "key": "view",
   "args": [
    "pr",
    "view",
    "999",
    "--json",
    "number"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n",
   "after": "unchanged"
  },
  {
   "id": "F2-X2",
   "key": "view",
   "args": [
    "pr",
    "view",
    "absent",
    "--json",
    "number"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "no pull requests found for branch \"absent\"\n",
   "after": "unchanged"
  },
  {
   "id": "F2-X3",
   "key": "view",
   "args": [
    "pr",
    "view",
    "--json",
    "number"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "could not determine current branch: not on any branch\n",
   "after": "unchanged",
   "context": {
    "cwd": "$EMPTY"
   },
   "gitStderr": true
  },
  {
   "id": "F2-X4",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301",
    "--json",
    "nonsense"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr view 301 --json nonsense`\n",
   "after": "unchanged"
  },
  {
   "id": "F2-X5",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301",
    "--web"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr view 301 --web`\n",
   "after": "unchanged"
  },
  {
   "id": "F2-X6",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301",
    "--json"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr view 301 --json`\n",
   "after": "unchanged"
  },
  {
   "id": "F2-X7",
   "key": "view",
   "args": [
    "pr",
    "view",
    "301",
    "--repo",
    "other/place"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr view 301 --repo other/place`\n",
   "after": "unchanged"
  },
  {
   "id": "F2-D1",
   "key": "diff",
   "args": [
    "pr",
    "diff",
    "301"
   ],
   "status": 0,
   "stdout": "+added line\n-removed line\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-D2",
   "key": "diff",
   "args": [
    "pr",
    "diff",
    "301",
    "--color",
    "never"
   ],
   "status": 0,
   "stdout": "+added line\n-removed line\n",
   "stderr": "",
   "after": "unchanged"
  },
  {
   "id": "F2-D3",
   "key": "diff",
   "args": [
    "pr",
    "diff",
    "304"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "could not find pull request diff: HTTP 406: diff too large (https://api.github.com/repos/example/widgets/pulls/304)\n",
   "after": "unchanged"
  },
  {
   "id": "F2-D4",
   "key": "diff",
   "args": [
    "pr",
    "diff",
    "999"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n",
   "after": "unchanged"
  },
  {
   "id": "F2-C1",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "301",
    "--body",
    "Agent note"
   ],
   "status": 0,
   "stdout": "https://github.com/example/widgets/pull/301#issuecomment-3\n",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "pullRequests",
       0,
       "comments",
       2
      ],
      "equals": {
       "body": "Agent note",
       "createdAt": "2000-01-02T03:04:05Z"
      }
     },
     {
      "path": [
       "repository",
       "mergeable"
      ],
      "absent": true
     }
    ]
   },
   "context": {
    "now": "2000-01-02T03:04:05Z"
   },
   "wallClock": [
    [
     "repository",
     "pullRequests",
     0,
     "comments",
     2,
     "createdAt"
    ]
   ]
  },
  {
   "id": "F2-C2",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "301",
    "-b",
    "Short flag"
   ],
   "status": 0,
   "stdout": "https://github.com/example/widgets/pull/301#issuecomment-3\n",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "pullRequests",
       0,
       "comments",
       2
      ],
      "equals": {
       "body": "Short flag",
       "createdAt": "2000-01-02T03:04:05Z"
      }
     }
    ]
   },
   "context": {
    "now": "2000-01-02T03:04:05Z"
   },
   "wallClock": [
    [
     "repository",
     "pullRequests",
     0,
     "comments",
     2,
     "createdAt"
    ]
   ]
  },
  {
   "id": "F2-C3",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "301",
    "--body-file",
    "-"
   ],
   "status": 0,
   "stdout": "https://github.com/example/widgets/pull/301#issuecomment-3\n",
   "stderr": "",
   "after": {
    "paths": [
     {
      "path": [
       "repository",
       "pullRequests",
       0,
       "comments",
       2
      ],
      "equals": {
       "body": "Input bytes.\n",
       "createdAt": "2000-01-02T03:04:05Z"
      }
     }
    ]
   },
   "context": {
    "now": "2000-01-02T03:04:05Z",
    "input": "Input bytes.\n"
   },
   "wallClock": [
    [
     "repository",
     "pullRequests",
     0,
     "comments",
     2,
     "createdAt"
    ]
   ]
  },
  {
   "id": "F2-X8",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "999",
    "--body",
    "x"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n",
   "after": "unchanged",
   "context": {
    "now": "2000-01-02T03:04:05Z"
   }
  },
  {
   "id": "F2-X9",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "301"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr comment 301`\n",
   "after": "unchanged",
   "context": {
    "now": "2000-01-02T03:04:05Z"
   }
  },
  {
   "id": "F2-X10",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "301",
    "--nope"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr comment 301 --nope`\n",
   "after": "unchanged",
   "context": {
    "now": "2000-01-02T03:04:05Z"
   }
  },
  {
   "id": "F2-X11",
   "key": "comment",
   "args": [
    "pr",
    "comment",
    "301",
    "--body"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr comment 301 --body`\n",
   "after": "unchanged",
   "context": {
    "now": "2000-01-02T03:04:05Z"
   }
  },
  {
   "id": "F2-X12",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--title",
    "T"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "the fake gh does not model `gh pr create --title T`\n",
   "after": "unchanged"
  }
 ],
 "originCases": [
  {
   "id": "F2-G1",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--title",
    "Request title",
    "--body",
    "Request body."
   ],
   "status": 0,
   "stdout": "https://github.com/example/widgets/pull/1\n",
   "stderr": "",
   "pull": {
    "number": 1,
    "head": "request-topic",
    "sha": "$HEAD",
    "base": "main",
    "title": "Request title",
    "body": "Request body."
   }
  },
  {
   "id": "F2-G2",
   "key": "create",
   "args": [
    "pr",
    "create",
    "-H",
    "request-topic",
    "-B",
    "main",
    "-t",
    "Input title",
    "-F",
    "-"
   ],
   "status": 0,
   "stdout": "https://github.com/example/widgets/pull/1\n",
   "stderr": "",
   "input": "Input body.\n",
   "pull": {
    "number": 1,
    "head": "request-topic",
    "sha": "$HEAD",
    "base": "main",
    "title": "Input title",
    "body": "Input body.\n"
   }
  },
  {
   "id": "F2-G3",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--head",
    "request-topic",
    "--fill",
    "--draft"
   ],
   "status": 0,
   "stdout": "https://github.com/example/widgets/pull/1\n",
   "stderr": "",
   "pull": {
    "number": 1,
    "head": "request-topic",
    "sha": "$HEAD",
    "base": "main",
    "title": "",
    "body": ""
   }
  },
  {
   "id": "F2-G4",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--head",
    "request-topic",
    "--title",
    "Again"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "a pull request for branch \"request-topic\" into branch \"main\" already exists:\nhttps://github.com/example/widgets/pull/1\n",
   "priorCase": "F2-G3"
  },
  {
   "id": "F2-G5",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--head",
    "unpushed",
    "--title",
    "T"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "aborted: you must first push the current branch to a remote, or use the --head flag\n"
  },
  {
   "id": "F2-G6",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--head",
    "request-topic",
    "--base",
    "absent",
    "--title",
    "T"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "pull request create failed: GraphQL: Base ref must be a branch (createPullRequest)\n"
  },
  {
   "id": "F2-G7",
   "key": "create",
   "args": [
    "pr",
    "create",
    "--head",
    "request-topic"
   ],
   "status": 1,
   "stdout": "",
   "stderr": "must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively\n"
  },
  {
   "id": "F1-37o",
   "key": 37,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { defaultBranchRef { name target { oid } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"defaultBranchRef\":{\"name\":\"main\",\"target\":{\"oid\":\"$MAIN\"}}}}}\n",
   "stderr": ""
  },
  {
   "id": "F1-38o",
   "key": 38,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { object(oid: \"$MAIN\") { ... on Commit { oid file(path: \"README\") { mode type object { ... on Blob { text isBinary isTruncated byteSize } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"object\":{\"oid\":\"$MAIN\",\"file\":{\"mode\":33188,\"type\":\"blob\",\"object\":{\"text\":\"one\\n\",\"isBinary\":false,\"isTruncated\":false,\"byteSize\":4}}}}}}\n",
   "stderr": ""
  },
  {
   "id": "F3-38a",
   "key": 38,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { object(oid: \"$MAIN\") { ... on Commit { oid file(path: \"absent\") { mode type object { ... on Blob { text isBinary isTruncated byteSize } } } } } } }"
   ],
   "status": 1,
   "stdout": "{\"data\":{\"repository\":{\"object\":{\"oid\":\"$MAIN\",\"file\":null}}},\"errors\":[{\"type\":\"NOT_FOUND\",\"path\":[\"repository\",\"object\",\"file\"],\"locations\":[{\"line\":1,\"column\":1}],\"message\":\"Could not resolve file for path 'absent'.\"}]}",
   "stderr": "gh: Could not resolve file for path 'absent'.\n"
  },
  {
   "id": "F1-38t",
   "key": 38,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { object(oid: \"$TREE\") { ... on Commit { oid file(path: \"README\") { mode type object { ... on Blob { text isBinary isTruncated byteSize } } } } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"object\":{}}}}\n",
   "stderr": ""
  },
  {
   "id": "F1-41o",
   "key": 41,
   "args": [
    "api",
    "repos/example/widgets/compare/main...$HEAD",
    "-X",
    "GET"
   ],
   "status": 0,
   "stdout": "{\"merge_base_commit\":{\"sha\":\"$MAIN\"}}",
   "stderr": ""
  },
  {
   "id": "F1-21o",
   "key": 21,
   "args": [
    "api",
    "graphql",
    "-f",
    "query=query { repository(owner: \"example\", name: \"widgets\") { refs(refPrefix: \"refs/heads/\", first: 5) { pageInfo { hasNextPage endCursor } nodes { name } } } }"
   ],
   "status": 0,
   "stdout": "{\"data\":{\"repository\":{\"refs\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"5\"},\"nodes\":[{\"name\":\"main\"},{\"name\":\"request-topic\"}]}}}}\n",
   "stderr": ""
  }
 ],
 "sequences": [
  {
   "id": "F4-Q1",
   "title": "a move is visible to the next item read",
   "steps": [
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-1\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-1\"}}) { projectV2Item { id } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"updateProjectV2ItemFieldValue\":{\"projectV2Item\":{\"id\":\"item-1\"}}}}\n",
     "stderr": ""
    },
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 1) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"id\":\"item-1\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"Done\",\"field\":{\"name\":\"Status\"}},{\"name\":\"High\",\"field\":{\"name\":\"Priority\"}}]},\"content\":{\"__typename\":\"Issue\",\"number\":12,\"title\":\"Card twelve\",\"body\":\"Body twelve\",\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"bug\"},{\"name\":\"ui\"}]}}}]}}}}}\n",
     "stderr": ""
    }
   ],
   "writes": [
    {
     "operation": "moveItem",
     "args": [
      "item-1",
      "Done"
     ]
    }
   ]
  },
  {
   "id": "F4-Q2",
   "title": "two board writes keep request order and both replay",
   "steps": [
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-1\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-1\"}}) { projectV2Item { id } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"updateProjectV2ItemFieldValue\":{\"projectV2Item\":{\"id\":\"item-1\"}}}}\n",
     "stderr": ""
    },
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=mutation { updateProjectV2ItemFieldValue(input: {projectId: \"PVT_fake\", itemId: \"item-2\", fieldId: \"PVTSSF_Status\", value: {singleSelectOptionId: \"option-0\"}}) { projectV2Item { id } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"updateProjectV2ItemFieldValue\":{\"projectV2Item\":{\"id\":\"item-2\"}}}}\n",
     "stderr": ""
    }
   ],
   "writes": [
    {
     "operation": "moveItem",
     "args": [
      "item-1",
      "Done"
     ]
    },
    {
     "operation": "moveItem",
     "args": [
      "item-2",
      "Todo"
     ]
    }
   ]
  },
  {
   "id": "F4-Q3",
   "title": "an added column is visible to the next field read",
   "steps": [
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=mutation { updateProjectV2Field(input: {fieldId: \"PVTSSF_Status\", singleSelectOptions: [{id: \"option-0\", name: \"Todo\", color: GRAY, description: \"\"}, {id: \"option-1\", name: \"Done\", color: GRAY, description: \"\"}, {name: \"Review\", color: GRAY, description: \"\"}]}) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"updateProjectV2Field\":{\"projectV2Field\":{\"id\":\"PVTSSF_Status\"}}}}\n",
     "stderr": ""
    },
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { id field(name: \"Status\") { ... on ProjectV2SingleSelectField { id options { id name color description } } } } } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"id\":\"PVT_fake\",\"field\":{\"id\":\"PVTSSF_Status\",\"options\":[{\"id\":\"option-0\",\"name\":\"Todo\",\"color\":\"GRAY\",\"description\":\"\"},{\"id\":\"option-1\",\"name\":\"Done\",\"color\":\"GRAY\",\"description\":\"\"},{\"id\":\"option-2\",\"name\":\"Review\",\"color\":\"GRAY\",\"description\":\"\"}]}}}}}\n",
     "stderr": ""
    }
   ],
   "writes": [
    {
     "operation": "createColumn",
     "args": [
      "Review"
     ]
    }
   ]
  },
  {
   "id": "F4-Q4",
   "title": "a created label is visible to the next label read",
   "steps": [
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=mutation { createLabel(input: {repositoryId: \"R_fake\", name: \"fresh\", color: \"ededed\"}) { label { id } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"createLabel\":{\"label\":{\"id\":\"LA_fresh\"}}}}\n",
     "stderr": ""
    },
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=query { repository(owner: \"example\", name: \"widgets\") { labels(first: 5) { pageInfo { hasNextPage endCursor } nodes { name } } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"repository\":{\"labels\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"5\"},\"nodes\":[{\"name\":\"bug\"},{\"name\":\"ui\"},{\"name\":\"docs\"},{\"name\":\"fresh\"}]}}}}\n",
     "stderr": ""
    }
   ],
   "writes": [
    {
     "operation": "createLabel",
     "args": [
      "fresh"
     ]
    }
   ]
  },
  {
   "id": "F4-Q5",
   "title": "an agent comment is visible to the next view",
   "steps": [
    {
     "args": [
      "pr",
      "comment",
      "301",
      "--body",
      "Agent note"
     ],
     "status": 0,
     "stdout": "https://github.com/example/widgets/pull/301#issuecomment-3\n",
     "stderr": "",
     "context": {
      "now": "2000-01-02T03:04:05Z"
     }
    },
    {
     "args": [
      "pr",
      "view",
      "301",
      "--json",
      "comments"
     ],
     "status": 0,
     "stdout": "{\"comments\":[{\"body\":\"First note\",\"createdAt\":\"2026-01-02T03:04:05Z\"},{\"body\":\"Second note\",\"createdAt\":\"2026-01-02T03:04:06Z\"},{\"body\":\"Agent note\",\"createdAt\":\"2000-01-02T03:04:05Z\"}]}\n",
     "stderr": ""
    }
   ],
   "writes": []
  },
  {
   "id": "F4-Q6",
   "title": "a REST label is visible to the next board read",
   "steps": [
    {
     "args": [
      "api",
      "repos/example/widgets/issues/12/labels",
      "-X",
      "POST",
      "-f",
      "labels[]=docs"
     ],
     "status": 0,
     "stdout": "[{\"name\":\"bug\"},{\"name\":\"ui\"},{\"name\":\"docs\"}]",
     "stderr": ""
    },
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 1) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"1\"},\"nodes\":[{\"id\":\"item-1\",\"fieldValues\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"Todo\",\"field\":{\"name\":\"Status\"}},{\"name\":\"High\",\"field\":{\"name\":\"Priority\"}}]},\"content\":{\"__typename\":\"Issue\",\"number\":12,\"title\":\"Card twelve\",\"body\":\"Body twelve\",\"repository\":{\"nameWithOwner\":\"example/widgets\"},\"labels\":{\"pageInfo\":{\"hasNextPage\":false},\"nodes\":[{\"name\":\"bug\"},{\"name\":\"ui\"},{\"name\":\"docs\"}]}}}]}}}}}\n",
     "stderr": ""
    }
   ],
   "writes": []
  },
  {
   "id": "F4-Q7",
   "title": "a created issue is the next newest number",
   "steps": [
    {
     "args": [
      "api",
      "repos/example/widgets/issues",
      "-X",
      "POST",
      "-f",
      "title=New card",
      "-f",
      "body=New body",
      "-f",
      "labels[]=bug"
     ],
     "status": 0,
     "stdout": "{\"number\":305,\"title\":\"New card\",\"body\":\"New body\",\"labels\":[{\"name\":\"bug\"}],\"node_id\":\"I_issue305\"}",
     "stderr": ""
    },
    {
     "args": [
      "api",
      "repos/example/widgets/issues?state=all&sort=created&direction=desc&per_page=1",
      "-X",
      "GET"
     ],
     "status": 0,
     "stdout": "[{\"number\":305}]",
     "stderr": ""
    }
   ],
   "writes": []
  },
  {
   "id": "F4-Q8",
   "title": "an agent comment keeps only the repository facts the model holds",
   "steps": [
    {
     "args": [
      "pr",
      "comment",
      "301",
      "--body",
      "Agent note"
     ],
     "status": 0,
     "stdout": "https://github.com/example/widgets/pull/301#issuecomment-3\n",
     "stderr": "",
     "context": {
      "now": "2000-01-02T03:04:05Z"
     }
    },
    {
     "args": [
      "api",
      "repos/example/widgets/pulls/301",
      "-X",
      "GET"
     ],
     "status": 0,
     "stdout": "{\"state\":\"open\",\"merged\":false,\"mergeable\":true,\"head\":{\"sha\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},\"merge_commit_sha\":null}",
     "stderr": ""
    }
   ],
   "writes": []
  },
  {
   "id": "F4-Q9",
   "title": "an empty store answers its empty page and its absent pull",
   "seed": {
    "repo": "example/widgets",
    "owner": "example",
    "project": 23,
    "model": {},
    "writes": [],
    "sent": []
   },
   "steps": [
    {
     "args": [
      "api",
      "graphql",
      "-f",
      "query=query { repositoryOwner(login: \"example\") { ... on ProjectV2Owner { projectV2(number: 23) { items(first: 2) { pageInfo { hasNextPage endCursor } nodes { id fieldValues(first: 5) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } content { __typename ... on Issue { number title body repository { nameWithOwner } labels(first: 5) { pageInfo { hasNextPage } nodes { name } } } } } } } } } }"
     ],
     "status": 0,
     "stdout": "{\"data\":{\"repositoryOwner\":{\"projectV2\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"2\"},\"nodes\":[]}}}}}\n",
     "stderr": ""
    },
    {
     "args": [
      "pr",
      "view",
      "301",
      "--json",
      "number"
     ],
     "status": 1,
     "stdout": "",
     "stderr": "GraphQL: Could not resolve to a PullRequest with the number of 301. (repository.pullRequest)\n"
    }
   ],
   "writes": []
  },
  {
   "id": "F4-Q10",
   "title": "a failed mutation leaves the next read on the seed",
   "steps": [
    {
     "args": [
      "pr",
      "comment",
      "999",
      "--body",
      "x"
     ],
     "status": 1,
     "stdout": "",
     "stderr": "GraphQL: Could not resolve to a PullRequest with the number of 999. (repository.pullRequest)\n",
     "context": {
      "now": "2000-01-02T03:04:05Z"
     }
    },
    {
     "args": [
      "pr",
      "view",
      "301",
      "--json",
      "number"
     ],
     "status": 0,
     "stdout": "{\"number\":301}\n",
     "stderr": ""
    }
   ],
   "writes": []
  }
 ]
}
;

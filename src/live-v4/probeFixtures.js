import { DEFAULT_EDITOR_DOC } from '../bootstrap/createEditor.js';

export const LIVE_PROBE_FIXTURES = Object.freeze({
  'default-welcome': DEFAULT_EDITOR_DOC,
  'lists-and-tasks': `# Sprint Checklist

- [ ] Ship live preview parity
- [x] Remove legacy rendering paths
  - [ ] Stabilize line numbers
  - [ ] Keep syntax hidden while cursor is in content

1. Validate pointer mapping
2. Validate cursor navigation

> This blockquote should stay visually stable.

| Item | Status |
| --- | --- |
| Lists | Needs tuning |
| Tables | Baseline pass |
`,
  'mixed-inline': `# Mixed Inline

Paragraph with **bold**, *emphasis*, ~~strike~~, \`inline code\`, [link](https://example.com), and [[wikilink]].

- Bullet one
- Bullet two with [ ] text and a task below
- [ ] Real task item
`,
  'empty-markers': `# Empty Marker Depth

-
  -
- [ ]
  - [ ]
1.
  1.
`
});

export function readProbeFixture(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return null;
  }

  return LIVE_PROBE_FIXTURES[name] ?? null;
}

# V2 Fixture Expectations

## core_live_preview_fixture.md

1. Frontmatter is recognized as a `frontmatter` block and preserved in source of active block mode.
2. `[[Wiki Target]]` and `[[Nested Wiki|Alias]]` are recognized as wikilink inline spans.
3. `![[diagram.png]]` is recognized as embed inline span.
4. Task list lines classify as `task` block entries with checked state attrs.
5. In live mode, inactive blocks render as widgets and active block remains editable source.
6. Click on inactive rendered content should move cursor to mapped source range.

## cursor_mapping_fixture.md

1. Vertical cursor movement across rendered/source boundaries remains deterministic.
2. Pointer clicks in rendered widgets map to source positions without jump anomalies.
3. Fenced code and table blocks keep stable mapping behavior.
4. Task list lines remain directly editable in active source block.

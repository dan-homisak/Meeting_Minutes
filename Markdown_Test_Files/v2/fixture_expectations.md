# V2 Fixture Expectations

## core_live_preview_fixture.md

1. Frontmatter is recognized as a `frontmatter` block and renders as a metadata container when inactive.
2. Active-line editing keeps markdown source visible while surrounding inactive lines render as fragments.
3. `[[Wiki Target]]` and `[[Nested Wiki|Alias]]` are recognized as wikilink inline spans.
4. `![[diagram.png]]` is recognized as embed inline span.
5. Task list lines classify as `task` block entries with checked state attrs.
6. Click on inactive rendered content should move cursor to mapped source range.
7. Modifier-click on links in live mode opens the link target.

## cursor_mapping_fixture.md

1. Vertical cursor movement across rendered/source boundaries remains deterministic.
2. Pointer clicks in rendered widgets map to source positions without jump anomalies.
3. Fenced code and table blocks keep stable mapping behavior.
4. Task list lines remain directly editable in active source block.

## frontmatter_live_parity_fixture.md

1. Leading YAML frontmatter renders as `.frontmatter-block` and does not degrade into `<hr>` output.
2. Key/value rows are preserved with semantic spans (`frontmatter-key`, `frontmatter-value`).
3. Markdown body after frontmatter retains normal core rendering parity.

## inline_click_precision_fixture.md

1. Inline syntax spans (strong, emphasis, inline code, markdown links, wikilinks, embeds) remain represented in fragment source maps.
2. Pointer resolution prefers inline-fragment hit, then line-fragment, then block fallback.
3. Links inside list and quote contexts preserve deterministic source mapping.

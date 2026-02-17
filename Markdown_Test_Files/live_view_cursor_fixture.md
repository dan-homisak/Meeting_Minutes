# Live View Cursor Fixture

Use this note for repeatable live-view cursor tests.

## 1) Heading + paragraph block

Click inside this rendered paragraph and confirm the cursor maps near the clicked word.

## 2) List block

- Item one
- Item two
- Item three

Click each item in rendered mode and confirm the active line becomes raw markdown for that list item.

## 3) Nested list block

- Parent
  - Child A
  - Child B

## 4) Blockquote block

> A quoted line
> Another quoted line

## 5) Code fence block

```js
function add(a, b) {
  return a + b;
}
```

## 6) Table block

| Column | Value |
| --- | --- |
| One | Alpha |
| Two | Beta |

## 7) Mixed paragraph block

First paragraph line.
Second paragraph line.
Third paragraph line.

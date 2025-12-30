---
theme: tufte
---

# Cross-References

This document demonstrates mdforge's cross-reference syntax. See @see(Syntax) for usage details.

## Syntax

Two directives are available:

| Directive | Purpose |
|-----------|---------|
| `@see(Name)` | Link to a heading or anchor |
| `@anchor(Name)` | Create an invisible link target |

### Linking to Headings

Any heading automatically gets an ID based on its text. Use `@see` to link to it:

```
See @see(Syntax) for details.
```

The name must match the heading text exactly.

### Custom Anchors

@anchor(Custom Anchors)

Sometimes you need to link to a specific paragraph that isn't a heading. Place `@anchor(Name)` on its own line, then reference it with `@see(Name)`.

This paragraph has an anchor above it. Link to it with @see(Custom Anchors).

## How It Works

The `@see` directive transforms into a markdown link:

- `@see(Syntax)` becomes `[Syntax](#syntax)`

Slugs are generated like heading IDs: lowercase, spaces to hyphens, special characters removed, unicode/diacritics transliterated to ASCII.

## Summary

- @see(Syntax) - the two directives
- @see(Custom Anchors) - linking to non-headings
- @see(How It Works) - the transformation

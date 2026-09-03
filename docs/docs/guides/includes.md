# Includes and Templates

Include markdown files directly in your documents with `@include`.

## File Paths

```markdown
@include ./shared/header.md
@include /absolute/path/to/disclaimer.md
@include "path with spaces/file.md"
```

Paths can be relative, absolute, or quoted (for spaces). Includes can be nested up to 10 levels deep.

## Named Templates

Define template names in config for commonly used includes:

```yaml
templates:
  legal: "templates/legal-footer.md"
  header: "templates/company-header.md"
```

Then use the name instead of the path:

```markdown
@include header

Content here...

@include legal
```

If the argument matches a template name, it uses the template path. Otherwise it's treated as a file path.

## Icons

Use icons from [Iconify](https://iconify.design/) (200,000+ icons from 150+ icon sets).

### Basic Usage

```markdown
Home: :icon[mdi:home]
Settings: :icon[mdi:cog]
Star: :icon[ph:star-fill]
```

Format: `:icon[prefix:name]` where `prefix` is the icon set (e.g., `mdi`, `ph`, `lucide`).

### With Size

```markdown
Small: :icon[mdi:star]{size=16}
Medium: :icon[mdi:star]{size=24}
Large: :icon[mdi:star]{size=48}
```

Browse available icons at [icon-sets.iconify.design](https://icon-sets.iconify.design/).

## Cross-References

Link to headings by name with `@see`:

```markdown
See @see(Installation) for setup instructions.
For details, refer to @see(Configuration Options).
```

### Custom Anchors

Create invisible link targets:

```markdown
@anchor(Important Note)

This paragraph can now be linked to with @see(Important Note).
```

### Page Numbers

`@pageof` prints the page a heading landed on, which is useful for a hand-built
table of contents or a printed reference that has to name a page:

```markdown
| 1. Introduction | Page @pageof(Introduction) |
| 2. Installation | Page @pageof(Installation) |
```

The number is only known once the document has been laid out, so mdforge
renders the PDF, reads the heading positions back from it, and renders again
with the real numbers filled in. A reference that names a heading which does
not exist is left as `??` rather than failing the build.

This works for PDF output only. In HTML there are no pages, so the placeholder
is left as-is. Because the extra pass costs another render, it only happens for
documents that actually use `@pageof`.

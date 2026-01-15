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

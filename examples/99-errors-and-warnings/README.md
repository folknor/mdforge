# Error and Warning Examples

Test files demonstrating mdforge's error handling.

## Warnings (conversion continues)

| File | Trigger | Expected Output |
|------|---------|-----------------|
| `01-missing-stylesheet.md` | Non-existent stylesheet path | `Stylesheet not found: .../does-not-exist.css` |
| `02-invalid-config.md` | Invalid config options | `Configuration errors:` with each invalid option listed |
| `05-unknown-font.md` | Fonts not on system or Google | `Failed to fetch fonts "..." from Google Fonts: 400 Bad Request` |

## Errors (conversion fails)

| File | Trigger | Expected Error |
|------|---------|----------------|
| `03-missing-include.md` | `@include` with missing file | `Include error: Include file not found: ...` |
| `04-unknown-theme.md` | Invalid theme name | `Unknown theme "...". Available themes: beryl, tufte, buttondown, pandoc` |

## Running Tests

```bash
cd examples/99-errors-and-warnings

# Warnings - these complete with warnings shown
mdforge 01-missing-stylesheet.md -o /tmp/test.pdf
mdforge 02-invalid-config.md -o /tmp/test.pdf
mdforge 05-unknown-font.md -o /tmp/test.pdf

# Errors - these fail with clear error messages
mdforge 03-missing-include.md -o /tmp/test.pdf
mdforge 04-unknown-theme.md -o /tmp/test.pdf
```

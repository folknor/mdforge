---
header:
  left: "{date:nb-NO}"
  right: Page {page}
---

# Localized Dates

This example shows how to format dates for different locales.

## Date Format Syntax

Use `{date:locale}` to specify a locale:

```yaml
header:
  left: "{date:nb-NO}"    # Norwegian: "30. desember 2024"
  right: "{date:en-US}"   # US English: "December 30, 2024"
```

## Common Locales

| Locale | Example Output |
|--------|----------------|
| `en-US` | December 30, 2024 |
| `en-GB` | 30 December 2024 |
| `nb-NO` | 30. desember 2024 |
| `de-DE` | 30. Dezember 2024 |
| `fr-FR` | 30 décembre 2024 |
| `ja-JP` | 2024年12月30日 |

## Sample Content

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

# Constants

Declare a value once and reference it throughout the document. Figures that
appear in many places — a rate, a threshold, a version — stay consistent because
they are only written down once.

## Declaring

Constants go in front-matter or a config file:

```yaml
---
constants:
  hourly_rate: 290
  daily_rate: 3000
  currency: NOK
---
```

Names must start with a letter or underscore and contain only letters, digits
and underscores. Values are numbers or strings.

## Referencing

Use `{{ name }}` anywhere in the document:

```markdown
The hourly rate is {{ hourly_rate }} {{ currency }}.
```

## Arithmetic

Numeric constants can be combined, so derived figures never have to be written
down literally:

```markdown
| Overtime | Total |
|----------|-------|
| 50%  | {{ hourly_rate * 1.5 }} |
| 100% | {{ hourly_rate * 2 }}   |

A five-day trip: {{ 5 * (daily_rate + per_diem) }}
```

Supported operators are `+`, `-`, `*`, `/`, `%`, parentheses and unary minus,
over numbers and constant names. That is the entire language — there is no
function calling and no access to anything beyond the declared constants.

## Formatting

Results are rounded to two decimals and rendered bare by default (`15000`). Set
a locale to group digits:

```yaml
constants_locale: nb-NO      # 15 000, and 428,57 for decimals
constants_precision: 0       # optional; default 2
```

## Escaping

Placeholders inside inline code and fenced code blocks are left untouched, so
documentation about constants renders as written. Elsewhere, escape the opening
braces with a backslash:

```markdown
`{{ hourly_rate }}` stays literal, and so does \{{ hourly_rate }}.
```

## When something is wrong

An unresolvable placeholder — an unknown name, a syntax error, text used in
arithmetic — is left in the output exactly as written and reported as a warning:

```
Constant: {{ missing }}: unknown constant "missing"
```

A visible `{{ missing }}` in the PDF is a better failure than a silently blank
or wrong figure in a rate table.

## Options

| Option | Description |
|--------|-------------|
| `constants` | Map of name → number or string |
| `constants_locale` | BCP 47 locale for grouping numeric results (default: unformatted) |
| `constants_precision` | Maximum fraction digits (default: 2) |

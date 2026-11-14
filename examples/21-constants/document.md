---
document_title: Constants and Arithmetic
constants:
  hourly_rate: 290
  hourly_rate_reduced: 275
  daily_rate: 3000
  per_diem: 400
  currency: NOK
constants_locale: nb-NO
footer:
  right: "{page}/{pages}"
---

# Constants and Arithmetic

Declare a value once in front-matter, reference it anywhere with `{{ name }}`,
and derive the rest with arithmetic. Change the rate in one place and every
figure below follows.

## Rates

| Component | Rate | Note |
|-----------|------|------|
| Day rate | {{ daily_rate }} {{ currency }} | Per 24-hour period |
| Hourly | {{ hourly_rate }} {{ currency }} | Full qualification |
| Hourly | {{ hourly_rate_reduced }} {{ currency }} | Reduced |
| Per diem | {{ per_diem }} {{ currency }} | Per night |

## Derived figures

Overtime is a multiplier on the hourly rate, so it is never written down
literally:

| Overtime | Supplement | Total |
|----------|-----------|-------|
| 50% | +{{ hourly_rate * 0.5 }} | {{ hourly_rate * 1.5 }} {{ currency }}/h |
| 100% | +{{ hourly_rate }} | {{ hourly_rate * 2 }} {{ currency }}/h |

Worked examples compute from the same source:

| Case | Calculation | Amount |
|------|-------------|--------|
| 14 hours | 14 × {{ hourly_rate }} | {{ 14 * hourly_rate }} {{ currency }} |
| 5 days | 5 × {{ daily_rate }} | {{ 5 * daily_rate }} {{ currency }} |
| A week away | 5 × ({{ daily_rate }} + {{ per_diem }}) | {{ 5 * (daily_rate + per_diem) }} {{ currency }} |

The `constants_locale: nb-NO` setting is what groups those digits — without it
they render bare.

## Expressions

Supported: `+`, `-`, `*`, `/`, `%`, parentheses and unary minus, over numbers
and constant names.

- Half of a day rate: {{ daily_rate / 2 }}
- Rounded to two decimals by default: {{ daily_rate / 7 }}
- Precedence works as expected: {{ (hourly_rate + per_diem) * 2 }}

## Escaping

Placeholders inside code are left alone — `{{ hourly_rate }}` renders literally,
as does this block:

```yaml
constants:
  hourly_rate: 290
```

Outside code, escape the opening braces with a backslash: \{{ hourly_rate }}.

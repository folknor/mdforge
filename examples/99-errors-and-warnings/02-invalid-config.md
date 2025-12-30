---
theme: tufte
unknown_option: "this doesn't exist"
another_fake: 123
page_numbers:
  format: "invalid-format"
---

# Invalid Config Warning

This document has invalid configuration options:

- `unknown_option` - not a recognized config key
- `another_fake` - also not recognized
- `page_numbers.format` - not a valid format type (should be arabic, roman, etc.)

**Expected:** Validation warnings listing each issue, but PDF still generates.

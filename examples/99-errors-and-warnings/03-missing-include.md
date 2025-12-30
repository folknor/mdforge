---
theme: beryl
---

# Missing Include Error

This document tries to include a file that doesn't exist:

@include ./this-file-does-not-exist.md

**Expected:** Error - conversion fails with "Include file not found" message.

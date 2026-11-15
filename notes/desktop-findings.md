# Desktop findings

## Batch outputs with the same file name overwrite each other

`getOutputPath` in packages/desktop/src/main/conversion.ts names each PDF by
the input's basename only, in the one output folder. Two inputs such as
`a/notes.md` and `b/notes.md` in one batch both write `notes.pdf`; the later
silently replaces the earlier, and both entries show done. Unverified at
runtime (reasoned from the code).

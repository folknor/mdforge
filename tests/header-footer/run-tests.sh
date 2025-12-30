#!/bin/bash
# Generate all header/footer test PDFs
# Run from md-to-pdf root: ./tests/header-footer/run-tests.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$SCRIPT_DIR/output"

# Build first
echo "Building md-to-pdf..."
cd "$ROOT_DIR"
pnpm build

# Create output directory
mkdir -p "$OUT_DIR"

# Run each test
echo ""
echo "Generating test PDFs..."
echo ""

for config in "$SCRIPT_DIR"/*.yaml; do
    name=$(basename "$config" .yaml)
    echo "  $name"
    node "$ROOT_DIR/dist/cli.js" \
        --config-file "$config" \
        "$SCRIPT_DIR/content.md" \
        -o "$OUT_DIR/$name.pdf"
done

echo ""
echo "Done! PDFs generated in: $OUT_DIR"
echo ""
ls -la "$OUT_DIR"

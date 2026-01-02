#!/bin/bash
# Test paged.js integration
# Run from mdforge root: ./tests/paged-js/run-test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$SCRIPT_DIR/output"

cd "$ROOT_DIR"

# Build first
echo "Building mdforge..."
pnpm build

# Create output directory
mkdir -p "$OUT_DIR"

# Base config for paged.js tests
BASE_CONFIG="theme: false
script:
  - url: https://unpkg.com/pagedjs/dist/paged.polyfill.js
pdf_options:
  format: A4
  margin: 0mm
  printBackground: true"

echo ""
echo "Generating paged.js test PDFs..."
echo ""

# Run each CSS test
for css in "$SCRIPT_DIR"/*.css; do
    name=$(basename "$css" .css)
    echo "  $name"

    # Create temp config with this CSS
    echo "$BASE_CONFIG" > "$OUT_DIR/temp-config.yaml"
    echo "stylesheet:" >> "$OUT_DIR/temp-config.yaml"
    echo "  - \"@$css\"" >> "$OUT_DIR/temp-config.yaml"

    node "$ROOT_DIR/dist/cli.js" \
        --config-file "$OUT_DIR/temp-config.yaml" \
        "$SCRIPT_DIR/content.md" \
        -o "$OUT_DIR/$name.pdf" 2>&1 | grep -v "generating"
done

rm -f "$OUT_DIR/temp-config.yaml"

echo ""
echo "Done! PDFs generated in: $OUT_DIR"
echo ""
ls -la "$OUT_DIR"/*.pdf

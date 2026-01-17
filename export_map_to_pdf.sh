#!/bin/bash

# Export map visualization to PDF using Chrome headless
# Requires: Google Chrome installed

# Configuration
HTML_FILE="hazard_map_visualization.html"
OUTPUT_PDF="hazard_map_visualization.pdf"
OUTPUT_PNG="hazard_map_visualization.png"

# Get absolute path
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HTML_PATH="file://${SCRIPT_DIR}/${HTML_FILE}"

echo "Exporting map visualization..."
echo "HTML: ${HTML_PATH}"

# Check if Chrome is installed
if command -v "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" &> /dev/null; then
    CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome &> /dev/null; then
    CHROME="google-chrome"
elif command -v chromium &> /dev/null; then
    CHROME="chromium"
else
    echo "Error: Google Chrome not found. Please install Google Chrome."
    exit 1
fi

echo "Using Chrome: ${CHROME}"

# Export to PDF
echo "Generating PDF..."
"${CHROME}" \
    --headless \
    --disable-gpu \
    --print-to-pdf="${SCRIPT_DIR}/${OUTPUT_PDF}" \
    --print-to-pdf-no-header \
    --no-margins \
    --virtual-time-budget=10000 \
    "${HTML_PATH}"

if [ -f "${SCRIPT_DIR}/${OUTPUT_PDF}" ]; then
    echo "✓ PDF saved: ${OUTPUT_PDF}"
else
    echo "✗ PDF generation failed"
fi

# Export to PNG (high resolution)
echo "Generating high-resolution PNG..."
"${CHROME}" \
    --headless \
    --disable-gpu \
    --screenshot="${SCRIPT_DIR}/${OUTPUT_PNG}" \
    --window-size=1920,1080 \
    --virtual-time-budget=10000 \
    "${HTML_PATH}"

if [ -f "${SCRIPT_DIR}/${OUTPUT_PNG}" ]; then
    echo "✓ PNG saved: ${OUTPUT_PNG}"
else
    echo "✗ PNG generation failed"
fi

echo ""
echo "Export complete!"
echo "Files created:"
ls -lh "${SCRIPT_DIR}/${OUTPUT_PDF}" 2>/dev/null
ls -lh "${SCRIPT_DIR}/${OUTPUT_PNG}" 2>/dev/null

# tools/ — local AI-fix drivers

Dev-only drivers that pair the **adapt-a11y-scanner** renderer (real ADAPT auth +
post-MathJax DOM capture) with **@libretexts/remedy-core**'s local fix pipeline
(scan → LLM-backed strategies → re-scan). They were moved here from the scanner
repo, which is detect-only and ships for production; the AI-fix step lives with
the engine that owns it.

## Prereqs
- The `adapt-a11y-scanner` repo checked out and **built** (`npm run build`).
  Expected at `../adapt-a11y-scanner`; override with `ADAPT_SCANNER_DIR`.
- ADAPT creds in the scanner's `.env` (`ADAPT_BASE_URL`, `ADAPT_TOKEN`).
- OpenRouter key + `REMEDY_TEXT_MODELS` / `REMEDY_VISION_MODELS` in this repo's `.env`.
- Run from within this workspace so `@libretexts/remedy-core` resolves.

## Usage
```bash
# Render a question and run the AI-fix pipeline (text + vision strategies):
node tools/fix-question.mjs <questionId> [assignmentId]

# Image/chart longdesc demo (needs a local static mirror of the chart asset):
python3 -m http.server 8899 --bind 127.0.0.1   # serve the dir with the PNG
node tools/demo-chart-fix.mjs <questionId>
```

Outputs (before/after HTML, diff, result JSON) are written to `REMEDY_DEMO_OUT`
(default: the OS temp dir). These drivers make **live** LLM calls and do **not**
write back to CXone/ADAPT.

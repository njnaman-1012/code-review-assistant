// Detects AI answers that are NOT a complete source file, even when the JSON
// itself is valid: patches, "replace lines 10-15 with ...", snippets that only
// contain the changed lines, placeholders such as "// ... rest of the code",
// or an explanation instead of code.
//
// A line that also appears in the user's original code is never treated as a
// placeholder (Python's "..." or a comment the user wrote are legitimate).
import { splitLines } from '../../utils/textUtils.js';

const COMMENT_LINE = /^\s*(\/\/|#|\/\*|\*|<!--)/;

// Placeholders that stand in for code that was left out.
const PLACEHOLDERS = [
  /^\s*(\.{3}|…)\s*$/, //                                  a line that is only "..."
  /^\s*(\/\/|#|\/\*+|\*)\s*(\.{3}|…)/, //                     "// ...", "# ... existing code"
  /\[\s*(rest|remaining|existing|unchanged|same|other|previous)\b[^\]]*\]/i, // "[rest of code]"
];

// Phrases that only make sense in a comment that replaces real code.
const PLACEHOLDER_COMMENT = new RegExp([
  'rest of (the )?(code|file|program|class|function|method|implementation)',
  'remaining (code|methods|functions|implementation|lines)',
  '(existing|previous|original|other) (code|methods|functions|implementation) (here|goes here|as before|remains?|unchanged|stays?)',
  'unchanged (code|lines|methods|functions)',
  '(code|methods|functions|implementation|everything else|the rest) (remains?|stays?|is|are) (unchanged|the same|as before)',
  'omitted for brevity',
  'code omitted',
  'same as (before|above|the original)',
].join('|'), 'i');

// Patch / diff formats instead of a source file.
const PATCH_LINES = [
  /^@@ .* @@/, //               unified diff hunk header
  /^(\+\+\+|---) [ab]?\/?\S/, // diff file headers
  /^\s*replace (lines?|line) \d+/i,
];

// An explanation in front of the code ("Here is the corrected portion ...").
const PROSE_START = /^(here('s| is| are)|below is|sure\b|certainly\b|i('ve| have)\b|this is the (corrected|improved|fixed)|the (corrected|improved|fixed) (code|version|portion|part))/i;

// A correction keeps almost every line; an improvement may legitimately
// remove duplication, so it may be shorter - but never a small fragment.
const MIN_LINE_RATIO = { correct: 0.6, improve: 0.35 };
const MIN_LINES_FOR_RATIO = 12;

const codeLineCount = (lines) => lines.filter((line) => line.trim()).length;

// Returns null when the code looks like a complete file, otherwise the reason.
export function findIncompleteCode({ original, generated, action }) {
  const originalLines = splitLines(original ?? '');
  const generatedLines = splitLines(generated ?? '');
  const userLines = new Set(originalLines.map((line) => line.trim()));
  const firstLine = generatedLines.find((line) => line.trim())?.trim();
  if (!firstLine) return 'the code is empty';
  if (PROSE_START.test(firstLine) && !userLines.has(firstLine)) {
    return 'the answer starts with an explanation instead of the source code';
  }

  for (const [index, line] of generatedLines.entries()) {
    if (!line.trim() || userLines.has(line.trim())) continue;
    const where = `line ${index + 1} ("${line.trim().slice(0, 50)}")`;
    if (PATCH_LINES.some((pattern) => pattern.test(line))) return `${where} is a patch instruction, not source code`;
    if (PLACEHOLDERS.some((pattern) => pattern.test(line))
      || (COMMENT_LINE.test(line) && PLACEHOLDER_COMMENT.test(line))) {
      return `${where} is a placeholder for code that was left out`;
    }
  }

  const originalCount = codeLineCount(originalLines);
  const generatedCount = codeLineCount(generatedLines);
  const minimum = Math.floor(originalCount * (MIN_LINE_RATIO[action] ?? MIN_LINE_RATIO.improve));
  if (originalCount >= MIN_LINES_FOR_RATIO && generatedCount < minimum) {
    return `only ${generatedCount} of the original ${originalCount} code lines were returned - this is a fragment, not the complete file`;
  }
  return null;
}

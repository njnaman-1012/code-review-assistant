// Prompt templates for the AI Review Engine. Keeping prompts in one file
// makes them easy to read, explain and improve.
import { SUPPORTED_LANGUAGES } from '../../utils/constants.js';
import { withLineNumbers } from '../../utils/textUtils.js';

export const SYSTEM_PROMPT = `You are a senior software engineer performing a code review for a student or junior developer.

Analyze the submitted source code for: correctness, logic, readability, maintainability, performance, security, code smells, best practices and complexity.

Rules you must follow:
- Do not invent errors. Only report problems you can point to in the submitted code.
- For every issue, copy the exact problematic line(s) from the listing into "code" and use that line number. If you cannot quote the code, do not report the issue.
- Before saying that a function, variable or import is undefined or unused, check the whole listing for its definition and every use of it.
- The code has NOT been executed. Never claim that you ran it or observed its output.
- Clearly distinguish confirmed problems from possible ones with the "confidence" field:
  "confirmed" = certain from the code itself (syntax errors, definite bugs),
  "likely" = strong evidence, "possible" = depends on inputs or context you cannot see.
  When you are unsure, say so in the explanation.
- A static-analysis tool has already checked the code. Its findings are confirmed and are shown to the user separately, so do NOT repeat them in "issues". Report only additional problems (logic errors, edge cases, runtime risks, performance, security, design). Your improved code MUST fix every static-analysis finding in the list, as well as your own issues.
- Preserve the intended functionality when generating improved code: same language, same inputs and outputs, same behaviour for valid inputs. Do not add unnecessary complexity, frameworks or features.
- "improvedCode" must be the complete program (not a diff or a fragment) and must not be wrapped in markdown code fences.
- Use the line numbers shown in the numbered listing.
- Give time and space complexity in Big-O notation. If complexity cannot be reliably determined, write "Not determinable" and explain why. Never invent a value.
- Write explanations in simple but technically correct language that a second-year engineering student can follow.
- Return valid JSON that matches the required schema exactly.`;

const FIELD_GUIDE = `Fill every field of the JSON object:
- summary: 2-4 sentences on what the code does and its overall quality.
- logicExplanation: explain the overall purpose, control flow, inputs/outputs, important variables, algorithms, data structures and dependencies.
- logicSteps: an ordered step-by-step walkthrough of the program ("First, ...", "Then, ...", "Finally, ...").
- keyComponents: the important functions, classes, loops, conditions and data structures, each with name, kind and description.
- issues: problems NOT already reported by static analysis. Each has title, type, severity, line, code, explanation, impact, suggestion and confidence.
  Severity meaning: CRITICAL = will not compile/run, crashes, or a severe security hole; HIGH = wrong results or a likely runtime failure;
  MEDIUM = quality or performance problem worth fixing; LOW = minor readability/style issue; INFO = a tip or note.
- qualityScore: an integer from 0 to 100 for the quality of the ORIGINAL code.
- suggestions: prioritized improvement suggestions (title, description, priority high/medium/low).
- improvedCode: the complete improved program.
- improvementExplanation: one entry per major change: change (what), original (old approach), improved (new approach), reason (why), benefit (what problem it solves).
- improvementSummary: one or two sentences each answering: did performance improve? did readability improve? did complexity change? were any security issues fixed? Say "No change" where nothing changed.
- complexity: originalTime, originalSpace, improvedTime, improvedSpace (Big-O or "Not determinable") and an explanation of how they were derived.
- finalSummary: a short concluding paragraph for the review report.`;

// A compact description of the static-analysis results for the AI.
function describeStaticAnalysis(staticResult) {
  const { metrics, issues, syntaxValid } = staticResult;
  const functionLines = metrics.functions.length
    ? metrics.functions
      .map((fn) => `  - ${fn.name} (lines ${fn.startLine}-${fn.endLine}, cyclomatic complexity ${fn.cyclomatic}, nesting depth ${fn.maxNesting})`)
      .join('\n')
    : '  (no functions detected)';
  const issueLines = issues.length
    ? issues.map((issue) => `  - line ${issue.line}: [${issue.severity}] ${issue.type}: ${issue.title}`).join('\n')
    : '  (none)';

  return `Syntax valid according to the parser: ${syntaxValid ? 'yes' : 'NO - fix the syntax errors in improvedCode'}
Lines: ${metrics.totalLines} total, ${metrics.codeLines} code, ${metrics.commentLines} comment
Functions:
${functionLines}
Findings already reported by static analysis (do not repeat these):
${issueLines}`;
}

export function buildReviewPrompt({ language, code, staticResult }) {
  const label = SUPPORTED_LANGUAGES[language].label;
  return `Review the following ${label} code.

=== SOURCE CODE (${label}, with line numbers) ===
${withLineNumbers(code)}
=== END OF SOURCE CODE ===

=== STATIC ANALYSIS RESULTS ===
${describeStaticAnalysis(staticResult)}
=== END OF STATIC ANALYSIS RESULTS ===

${FIELD_GUIDE}`;
}

// Used when the provider has no native JSON-schema support: we show the shape.
export const JSON_SHAPE_HINT = `Respond with a single JSON object of this shape (no markdown, no extra text):
{
  "summary": "", "logicExplanation": "", "logicSteps": [""],
  "keyComponents": [{ "name": "", "kind": "", "description": "" }],
  "issues": [{ "title": "", "type": "Logical Error", "severity": "HIGH", "line": 1, "code": "", "explanation": "", "impact": "", "suggestion": "", "confidence": "likely" }],
  "qualityScore": 70,
  "suggestions": [{ "title": "", "description": "", "priority": "high" }],
  "improvedCode": "",
  "improvementExplanation": [{ "change": "", "original": "", "improved": "", "reason": "", "benefit": "" }],
  "improvementSummary": { "performance": "", "readability": "", "complexity": "", "security": "" },
  "complexity": { "originalTime": "", "originalSpace": "", "improvedTime": "", "improvedSpace": "", "explanation": "" },
  "finalSummary": ""
}
Allowed "type" values: Syntax Error, Logical Error, Runtime Risk, Security Issue, Code Smell, Performance Issue, Maintainability Issue, Readability Issue, Coding Standard Issue.
Allowed "severity" values: CRITICAL, HIGH, MEDIUM, LOW, INFO. Allowed "confidence" values: confirmed, likely, possible.`;

export function buildRetryNote(reason) {
  return `\n\nIMPORTANT: your previous answer could not be used (${reason}). Return the complete JSON object again, following the schema exactly.`;
}

// ---------------------------------------------------------------------------
// "Fix / Correct Code" and "Improve Code"
// ---------------------------------------------------------------------------

// The complete-code rules are the most important part of these prompts.
export const CODE_ACTION_SYSTEM_PROMPT = `You are a senior software engineer who edits a student's or junior developer's program after a code review.

You must return the COMPLETE source code.

Do not return a patch.
Do not return only modified lines.
Do not use placeholders such as:
[rest of code]
...
// unchanged code
/* existing code */

Return the entire source file from the first line to the last line.

Preserve the programming language.

Preserve the intended functionality unless correcting an identified functional error.

Do not invent requirements that were not requested.

Do not claim that code was executed or tested unless the system actually executed it. The system has NOT executed this code.

Further rules:
- Put the code in the JSON string as plain source text: no markdown code fences and no line numbers.
- List every important change in "changes": what changed (title), why it changed (explanation) and what problem it solves (problemSolved), with the affected line numbers of the original code in "lines".
- Return valid JSON that matches the required schema exactly.`;

const CODE_ACTION_TASKS = {
  correct: (label) => `TASK: FIX / CORRECT THE CODE.
Fix the problems found in the code while preserving the original implementation and intended behaviour:
- fix syntax errors;
- fix logical errors identified by the review;
- fix clear runtime problems that can be determined statically (for example division by zero, missing null/None checks, index out of range, resources that are never closed);
- fix coding mistakes;
- address the review issues listed below. Fix every "confirmed" and "likely" issue; fix a "possible" issue only when the fix is safe and does not change valid behaviour.
This is a correction, not a rewrite: keep the original structure, names, algorithm and style wherever they are not part of a problem. Keep the code in ${label}.`,
  improve: (label) => `TASK: IMPROVE THE CODE.
Improve the quality, structure, readability and efficiency of the code while preserving its intended behaviour. Focus on:
readability; maintainability; code structure; naming; performance and efficiency; best practices; duplicated code; code smells;
appropriate data structures; appropriate algorithms; error handling; security where applicable; ${label} conventions.
Also resolve the review issues listed below. You may restructure the solution (for example replace a nested loop with a set or a dictionary) when the behaviour for valid inputs stays the same.
Keep the same inputs, outputs and features - do not add new features. Change the functionality only where it is clearly incorrect. Keep the code in ${label}.`,
};

const CODE_FIELDS = { correct: 'correctedCode', improve: 'improvedCode' };

function shorten(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// Everything the review found, in a compact form for the AI.
function describeReview(review) {
  const issues = review.issues ?? [];
  const issueLines = issues.length
    ? issues.slice(0, 40).map((issue) => {
      const origin = issue.source === 'static' ? 'automated check' : 'AI review';
      const fix = issue.suggestion ? ` Suggested fix: ${shorten(issue.suggestion, 200)}` : '';
      return `- line ${issue.line ?? '-'} [${issue.severity}, ${issue.confidence}, ${origin}] ${issue.type}: ${shorten(issue.title, 120)}. `
        + `${shorten(issue.explanation, 260)}${fix}`;
    }).join('\n')
    : '- (no issues were found)';

  const metrics = review.staticAnalysis?.metrics;
  const functions = metrics?.functions?.length
    ? metrics.functions.map((fn) => `  - ${fn.name} (lines ${fn.startLine}-${fn.endLine}, cyclomatic complexity ${fn.cyclomatic}, nesting depth ${fn.maxNesting})`).join('\n')
    : '  (no functions detected)';
  const syntaxValid = review.staticAnalysis?.syntaxValid;

  const intent = [review.summary, review.logic?.explanation].filter(Boolean).map((part) => shorten(part, 1200)).join('\n');

  return `=== WHAT THE CODE IS INTENDED TO DO (from the review) ===
${intent || '(no description available - infer it from the code)'}

=== REVIEW ISSUES (${issues.length}) ===
${issueLines}

=== STATIC ANALYSIS RESULTS ===
Syntax valid according to the parser: ${syntaxValid === false ? 'NO - the syntax errors must be fixed' : 'yes'}
Functions:
${functions}`;
}

export function buildCodeActionPrompt({ action, language, code, review }) {
  const label = SUPPORTED_LANGUAGES[language].label;
  const lineCount = code.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length;
  const field = CODE_FIELDS[action];
  return `${CODE_ACTION_TASKS[action](label)}

=== ORIGINAL SOURCE CODE (${label}, ${lineCount} lines; the line numbers are for reference only - do NOT copy them) ===
${withLineNumbers(code)}
=== END OF ORIGINAL SOURCE CODE ===

${describeReview(review)}
=== END OF REVIEW ===

"${field}" must be the COMPLETE ${label} program: every part of the original ${lineCount}-line file from the first line to the last line, with your changes applied. Never shorten it, never leave anything out and never replace code with a placeholder or a comment.`;
}

// Used when the provider has no native JSON-schema support: we show the shape.
export function codeActionShapeHint(action, language) {
  const field = CODE_FIELDS[action];
  return `Respond with a single JSON object of this shape (no markdown, no extra text):
{
  "action": "${action}",
  "language": "${language}",
  "${field}": "THE FULL COMPLETE SOURCE CODE, FIRST LINE TO LAST LINE",
  "changes": [{ "title": "What changed", "explanation": "Why it changed", "problemSolved": "What problem it solves", "lines": "12-15" }],
  "summary": "One or two sentences about the ${action === 'correct' ? 'corrections' : 'improvements'}."
}`;
}

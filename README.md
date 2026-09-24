# Code Review Assistant (CodeReview AI)

An **AI-assisted Code Review Assistant** that analyzes source code, identifies errors and code-quality issues, explains the program's logic, gives actionable review suggestions, and generates an improved version of the code with a detailed explanation of every change.

It is an undergraduate **Software Engineering project**. It combines two kinds of analysis:

| Static analysis (deterministic) | AI analysis (reasoning) |
|---|---|
| Tree-sitter parser (all 4 languages) and ESLint (JavaScript) | Free large language models (OVHcloud Qwen3-Coder / LLM7 with no key; Gemini, Groq, OpenRouter with a free key) |
| Syntax errors, rule violations, code smells, metrics | Logic explanation, deeper bugs, improved code |
| Same input → same output, every time | Can be wrong, so every AI issue has a confidence level |
| The code is parsed, never executed | The code is read by the model, never executed |

> The detailed architecture, the request/response flow and viva notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Features

- **Code input:** paste or type code in a VS Code-style editor (syntax highlighting, line numbers, indentation), upload a file, or drag and drop one.
- **Languages:** Python, Java, C++ and JavaScript. Unsupported languages get a clear message. New languages are added in one config file plus one rule file.
- **Validation:** rejects empty code, unsupported languages, files that are too large and binary files. It also warns when the code does not look like the selected language.
- **Static analysis:**
  - syntax errors with line numbers
  - language-specific rules (e.g. `String ==` in Java, mutable default arguments in Python, `gets()` in C++, ESLint rules in JavaScript)
  - code smells
  - McCabe cyclomatic complexity, nesting depth and function length
- **AI review:**
  - what the code does and a step-by-step logic walkthrough
  - key components
  - additional issues
  - suggestions
  - an improved version of the code
  - an explanation of every change
  - time and space complexity (Big-O)
- **Structured issues:** every issue has a title, type, severity (CRITICAL / HIGH / MEDIUM / LOW / INFO), line number, problematic code, explanation, why it matters, recommended fix, source (Static or AI) and confidence.
- **Original vs improved:** a side-by-side diff. The improved code is **re-checked by the same static analyzer**, showing before/after issue counts and complexity.
- **Quality score:** a deterministic score (formula shown in the UI), with the AI's own estimate alongside for comparison.
- **History:** every review is saved in SQLite. You can search, filter, view and delete reviews.
- **Reports:** download a printable HTML report (Ctrl+P → Save as PDF) or a Markdown report.
- **Free AI, no key needed:** a chain of free providers with automatic failover. Add a free Gemini/Groq/OpenRouter key for faster, better reviews. Every AI finding is checked automatically against the real code.
- **Graceful degradation:** if every AI provider fails, you still get a complete static-analysis review with a clear message.
- **Security:**
  - submitted code is never executed
  - API keys (if any) stay on the server
  - input validation and rate limiting
  - security headers (Helmet) and CORS
  - no stack traces in responses, no code or secrets in logs

## Architecture

```
            ┌──────────────────────────── React client (Vite, :5173) ─────────────────────────────┐
            │  Dashboard · New Review (Monaco editor, upload) · Review Details (10 tabs) · History │
            └───────────────────────────────────────┬──────────────────────────────────────────────┘
                                                    │ REST / JSON (axios, /api proxied to :5000)
            ┌───────────────────────────── Express server (:5000) ─────────────────────────────────┐
            │  middleware: helmet · cors · json limit · rate limit · validation · error handler     │
            │  routes ─► controllers ─► ReviewService (orchestrator)                                │
            │                              │                                                         │
            │   Code Input ─► Language Detector ─► Static Analyzer ─► AI Review Engine               │
            │                                        (Tree-sitter,      (prompt ─► provider ─►       │
            │                                         rules, ESLint,     JSON schema validation)      │
            │                                         metrics)                 │                      │
            │                                              └──── Review Aggregator ◄────┘             │
            │                                                    (merge, dedupe, score,               │
            │                                                     re-check improved code)             │
            │                                                          │                              │
            │                              Review Model (SQL) ─► SQLite database                      │
            │                              Report Service ─► HTML / Markdown report                   │
            └─────────────────────────────────────────────────────────┬───────────────────────────────┘
                                                                      │ HTTPS (server only)
                                                        Free AI providers (OVHcloud, LLM7, Gemini, Groq, OpenRouter) · optional paid Claude
```

## Technologies

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, React Router, Axios, Monaco Editor (`@monaco-editor/react`), plain CSS |
| Backend | Node.js (≥ 20), Express 5, Helmet, CORS, express-rate-limit, dotenv |
| Database | SQLite through the libSQL client (`@libsql/client`): a local file in development, free hosted Turso on Vercel (hand-written SQL schema) |
| Static analysis | Tree-sitter (`web-tree-sitter` + `tree-sitter-wasms`), ESLint `Linter` API |
| AI | Free OpenAI-compatible providers via the `openai` SDK (OVHcloud AI Endpoints, LLM7, Google Gemini, Groq, OpenRouter, Ollama); optional paid Anthropic Claude via `@anthropic-ai/sdk` |
| Validation | Zod (AI response schema) |
| Testing | Node.js built-in test runner (`node:test`) + Supertest |

## Folder structure

```
code-review-assistant/
├── package.json              # npm workspaces: runs client + server together
├── README.md
├── .gitignore
├── docs/
│   └── ARCHITECTURE.md       # architecture, request flow, viva notes
├── samples/                  # 5 sample programs for testing
├── server/
│   ├── server.js             # entry point (loads .env, DB, AI provider, starts HTTP)
│   ├── app.js                # builds the Express app (dependency injection)
│   ├── .env.example          # configuration template
│   ├── config/config.js      # all settings, read from environment variables
│   ├── routes/               # URL → controller mapping
│   ├── controllers/          # HTTP request/response handling
│   ├── middleware/           # validation, rate limiting, logging, error handling
│   ├── services/
│   │   ├── reviewService.js        # orchestrates the review pipeline
│   │   ├── languageDetector.js     # guesses the language of the code
│   │   ├── staticAnalysis/         # parser, syntax checker, metrics, rule sets
│   │   ├── aiReviewService.js      # AI Review Engine (prompt → provider → validation)
│   │   ├── ai/                     # prompt templates, JSON schema, validator, providers
│   │   ├── reviewAggregator.js     # merges static + AI results, scoring, comparison
│   │   └── reportService.js        # HTML / Markdown reports
│   ├── models/reviewModel.js # all SQL for the reviews table
│   ├── database/             # db.js (connection) + schema.sql
│   ├── utils/                # constants, errors, logger, text helpers
│   └── tests/                # automated tests
└── client/
    ├── index.html
    ├── vite.config.js        # dev server + /api proxy to the backend
    └── src/
        ├── main.jsx, App.jsx # entry point and routes
        ├── pages/            # Dashboard, NewReview, ReviewDetails, History, About
        ├── components/       # editor, badges, tabs, issue card, results/* tabs
        ├── services/api.js   # every call to the backend
        ├── hooks/            # useFetch, useSessionState, useMediaQuery
        ├── utils/            # languages, file reading, formatting, samples
        └── styles/index.css
```

## Prerequisites

- **Node.js 20 or newer** (tested with Node 24) and npm. Check with `node --version`.
- **No API key is needed.** The AI review uses free providers that work without a key (internet connection required). A free Google Gemini key is recommended for faster, better reviews; see [Free AI setup](#free-ai-setup).
- No Python, Java or C++ compiler is needed: all four languages are parsed with Tree-sitter compiled to WebAssembly.

## Installation

Open a terminal in the project folder. Installing from the root installs both the server and the client (npm workspaces).

```bash
cd code-review-assistant
```

```bash
npm install
```

## Environment variables

Create `server/.env` from the template.

Windows (PowerShell or cmd):

```bash
copy server\.env.example server\.env
```

macOS / Linux / Git Bash:

```bash
cp server/.env.example server/.env
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5000` | Port of the API server |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Front-end origin(s) allowed by CORS (comma-separated) |
| `DATABASE_URL` | `./database/code_review.db` | SQLite file (relative to `server/`), or `:memory:` |
| `AI_PROVIDER` | `auto` | `auto` = all usable **free** providers (see below); a list such as `gemini,ovh`; `anthropic` (paid); or `none` |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | *(empty)* | Optional **free** keys; each one adds a better provider to the front of the chain |
| `LLM7_API_KEY`, `OVH_AI_ENDPOINTS_ACCESS_TOKEN` | *(empty)* | Optional; these providers also work without a key |
| `GEMINI_MODEL`, `GROQ_MODEL`, `OVH_MODEL`, `LLM7_MODEL`, … | preset | Override the default model of a provider |
| `AI_API_KEY` / `AI_MODEL` / `AI_BASE_URL` | *(empty)* | Used when `AI_PROVIDER` names a single provider (e.g. paid `anthropic`, or a custom `openai`-compatible URL) |
| `AI_TIMEOUT_MS` | `120000` | Timeout per AI request (slow free providers have their own longer timeout) |
| `AI_MAX_OUTPUT_TOKENS` | `32000` | Maximum length of the AI answer (Anthropic) |
| `AI_REFUSAL_FALLBACK` | `true` | Anthropic only: if the model declines a request for safety reasons, Anthropic re-runs it on a fallback model |
| `MAX_CODE_CHARS` / `MAX_CODE_LINES` | `20000` / `800` | Size limits for submitted code |
| `RATE_LIMIT_MAX_REVIEWS` | `20` | Reviews allowed per IP per 15 minutes |
| `RATE_LIMIT_MAX_CODE_ACTIONS` | `20` | "Fix / Correct Code" and "Improve Code" requests allowed per IP per 15 minutes |

Keys are read **only by the server**. They never reach the browser, and `.env` is excluded from git by `.gitignore`.

### Free AI setup

**The AI review is free and works out of the box: no API key, no account, no payment.**

With the default `AI_PROVIDER=auto`, the server builds a chain of free providers and tries them in order. If one is rate-limited, slow, down, or returns an unusable answer, it moves on to the next. Every review records which provider answered.

| Order | Provider | Default model | Key | Notes |
|---|---|---|---|---|
| 1 | Google Gemini | `gemini-3.8-flash` | free key (optional) | Best free quality; fast |
| 2 | Groq | `openai/gpt-oss-120b` | free key (optional) | Very fast; free tier allows ~8,000 tokens/minute, so very long programs may not fit |
| 3 | OpenRouter | `openrouter/free` | free key (optional) | Picks an available free model |
| 4 | OVHcloud AI Endpoints | `Qwen3-Coder-30B-A3B-Instruct` | **none needed** | Good code model; anonymous tier is slow (about 1–4 minutes) and allows about 2 requests/minute |
| 5 | LLM7 | `codestral-latest` | **none needed** | Fast; anonymous answers are capped at about 3,000 tokens and quality is lower |

Rows 1–3 are used only when their free key is set. Rows 4–5 are always available.

**Recommended (2 minutes, free, no credit card): add a Google Gemini key** for faster and better reviews:
1. Open <https://aistudio.google.com/app/apikey> and sign in with a Google account.
2. Click **Create API key** and copy it.
3. In `server/.env` set `GEMINI_API_KEY=your-key`.
4. Restart the backend. The server log lists **Google Gemini (free tier)** first in the AI provider chain. The public UI deliberately does not show provider names.

The optional Groq key (<https://console.groq.com/keys>) and OpenRouter key (<https://openrouter.ai/keys>) work the same way: paste them into `GROQ_API_KEY` and `OPENROUTER_API_KEY`. More keys mean more fallbacks when a free tier hits its daily limit.

**How free models are kept honest.** Small free models sometimes invent problems. The Review Aggregator checks every AI issue against the real code: does the line exist, does the quoted code exist, does the parser confirm or contradict the claim (e.g. "function is undefined" when it is defined). Failing issues are shown as *Possible*, with an "Automatic check" note. Static-analysis results never depend on the AI.

**Other options:**
- **Local and offline:** install [Ollama](https://ollama.com/download), run `ollama pull qwen2.5-coder:7b`, then set `AI_PROVIDER=ollama`.
- **Paid Claude:** set `AI_PROVIDER=anthropic`, `AI_API_KEY=<key>` and `AI_MODEL=claude-opus-5`. This costs money per review.
- **Custom OpenAI-compatible API:** set `AI_PROVIDER=openai` with `AI_API_KEY`, `AI_MODEL` and `AI_BASE_URL`.
- **No AI:** set `AI_PROVIDER=none` to use static analysis only.

**Privacy note:** with any AI provider, the submitted code is sent to that provider's servers. Free tiers may use submitted data to improve their services (Google states this for the Gemini free tier). Do not submit confidential code. For fully private reviews, use Ollama (local) or `AI_PROVIDER=none`.

## Database setup

No setup is needed. On first start the server creates `server/database/code_review.db` and runs `server/database/schema.sql`, which creates the `reviews` table if it does not exist.

- To start with an empty history, stop the server and delete `server/database/code_review.db*`.
- To use a different file, set `DATABASE_URL`.

## Running the application

Start **both** backend and frontend with one command:

```bash
npm run dev
```

Then open **<http://localhost:5173>**.

Or run them separately, in two terminals.

Backend only (http://localhost:5000; restarts automatically when files change):

```bash
npm run dev:server
```

Frontend only (http://localhost:5173; `/api` requests are forwarded to port 5000):

```bash
npm run dev:client
```

Production build of the frontend:

```bash
npm run build
```

To serve the built frontend (with the `/api` proxy) on http://localhost:4173, while the backend runs:

```bash
npm run preview -w client
```

### Production mode (one server)

With `NODE_ENV=production`, the Express server also serves the built React app, so the whole application runs on one port.

```powershell
npm run build
$env:NODE_ENV="production"; npm start
```

Then open **<http://localhost:5000>**. On macOS/Linux the second line is `NODE_ENV=production npm start`.

## Deployment (free: Vercel + Turso)

The app is deployed for free:
- **Vercel** (Hobby plan) serves the React app and runs the Express API as one serverless function (`api/index.mjs`, configured in `vercel.json`).
- The reviews are stored in **Turso**, a free hosted SQLite database, because serverless functions cannot keep a local database file.

1. **Turso:** sign up at <https://turso.tech> with GitHub, create a database, and copy its **URL** (`libsql://…`) and an **auth token**.
2. **Vercel:** sign up at <https://vercel.com> with GitHub, then choose **Add New → Project** and import this repository. The build settings come from `vercel.json`.
3. Add the **environment variables** below, then click **Deploy**:

   | Variable | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the `libsql://…` URL from Turso |
   | `TURSO_AUTH_TOKEN` | the token from Turso |
   | `NODEJS_HELPERS` | `0` (Express parses the requests itself) |
   | `AI_PROVIDER` | `auto` |
   | `GEMINI_API_KEY` | optional free key: faster reviews |

4. Open `https://<project>.vercel.app`. Every `git push` deploys again automatically.

**Things to know**
- **Time limit:** a Vercel function on the free plan is stopped after 300 s.
  - The server therefore gives the AI at most 240 s per review or code action (`AI_TIME_BUDGET_MS`).
  - If the free AI providers are slower than that, the review is completed with the automated checks only.
- **Database:** the tables are created automatically on the first request. Locally, the app keeps using the file `server/database/code_review.db`.
- **Other hosts:** the app can also run as one normal Node.js server. Run `npm run build`, then `npm start` with `NODE_ENV=production` (see *Production mode* above).

## How to use

1. Open **New Review**.
2. Choose the **programming language**.
3. Paste or type code, click **Upload Code**, drag a file onto the editor, or pick a program from **Load a sample**.
4. Click **Analyze Code**. Static analysis takes under a second; the free AI review usually takes 1–4 minutes without a key, and much less with a free Gemini or Groq key.
5. Read the results in the 10 tabs:
   1. Overview
   2. Code Logic
   3. Issues Found (filter by severity, source or type)
   4. Code Quality
   5. Suggestions
   6. Improved Code (**Copy Improved Code** / Download)
   7. Explanation of Improvements
   8. Complexity
   9. Original vs Improved (side-by-side diff plus re-check metrics)
   10. Final Report
6. Click **Download Review Report** (HTML) or **Print / PDF**.
7. Open **History** to find, reopen or delete earlier reviews.

## Sample code for testing

The [`samples/`](samples/) folder has 5 programs, which are also available in the **Load a sample** menu:

| File | What to expect |
|---|---|
| `1_correct_python.py` | Clean code with 0 static issues and a score of 100 |
| `2_python_logical_issues.py` | Mutable defaults, bare except, shadowed `list`, unused imports; the AI adds division by zero, the grade-boundary bug and the wrong initial maximum |
| `3_JavaQualityIssues.java` | `String ==`, off-by-one loop, string concatenation in a loop, empty catch, naming problems |
| `4_cpp_inefficient.cpp` | Vectors passed by value, off-by-one loop, `new` without `delete`, `endl` in a loop; the AI adds the O(n²) → O(n) improvement |
| `5_javascript_poor_practices.js` | `var`, `==`, `eval`, duplicate key, undeclared variable, empty catch, hard-coded key |

## REST API

All responses are JSON: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service status, whether the AI review is available, supported languages and limits (no internal details) |
| `POST` | `/api/reviews` | Create a review. Body: `{ "language": "python", "code": "..." }` → `201` with the complete review |
| `GET` | `/api/reviews?limit=50&offset=0` | List saved reviews (newest first) → `{ reviews: [...], total }` |
| `GET` | `/api/reviews/:id` | Get one complete review (includes `codeActions.correct` / `codeActions.improve` once generated) |
| `DELETE` | `/api/reviews/:id` | Delete a review (and its generated code) |
| `GET` | `/api/reviews/:id/report?format=html\|md` | Download the review report |
| `POST` | `/api/reviews/:id/correct` | **Fix / Correct Code**: the complete corrected source file for a saved review → `{ action, language, code, changes[], summary, checks, generatedAt }`, saved with the review |
| `POST` | `/api/reviews/:id/improve` | **Improve Code**: the same for a complete improved version |

Example:

```bash
curl -X POST http://localhost:5000/api/reviews -H "Content-Type: application/json" -d "{\"language\":\"python\",\"code\":\"def f(x=[]):\n    return x\"}"
```

Error codes you may see:

| Code | Meaning |
|---|---|
| `EMPTY_CODE` | No code was submitted |
| `LANGUAGE_REQUIRED` | No language was selected |
| `UNSUPPORTED_LANGUAGE` | The language is not one of the four supported |
| `CODE_TOO_LARGE` (413) | The code exceeds the size limits |
| `INVALID_INPUT` | The content looks like a binary file |
| `INVALID_JSON` | The request body is not valid JSON |
| `INVALID_ID` | The review ID is not a positive whole number |
| `REVIEW_NOT_FOUND` (404) | No review has that ID |
| `RATE_LIMITED` (429) | Too many requests from this IP |
| `DATABASE_ERROR` / `INTERNAL_ERROR` (500) | A server-side failure |

AI failures do **not** fail the request. The review is still created from static analysis, and `ai.status` is `"failed"` or `"unavailable"` with a message.

## Testing

Run the automated backend tests (67 tests, about 10 seconds, no API key or internet needed):

```bash
npm test
```

The tests use an in-memory database and a **test-double AI provider**, so they never call a real AI service. They cover:

- **API:** health endpoint; review creation; empty, whitespace-only, missing-language, unsupported-language, oversized, binary and malformed-JSON input; retrieval; listing; deletion; 404s; HTML/Markdown reports; HTML escaping of user code.
- **AI handling:** AI unavailable, AI failure fallback, retry after invalid JSON, failure after repeated invalid JSON.
- **AI response validation:** JSON extraction, normalization of severity/type/line/confidence, required fields, score clamping.
- **Database:** create, JSON round-trip, newest-first paging, delete.
- **Static analysis:** syntax errors in each language, language rules, off-by-one loops, McCabe complexity, else-if nesting, line counting.
- **Language detector and review aggregator:** detection and mismatch warnings; scoring formula, de-duplication, AI syntax-error guard, original-vs-improved comparison.

Manual test: run `npm run dev`, load each sample from **Load a sample**, and check the tabs.

## Limitations

- The code is **analysed, not executed**. Runtime behaviour is predicted, not observed, and the improved code must be tested before it is used.
- AI findings, explanations and Big-O values can be wrong. They are labelled *AI analysis* with a confidence level, obviously ungrounded claims are downgraded automatically, and the improved code is re-checked only statically (syntax, rules, complexity), not for identical behaviour.
- The free AI providers are shared public services. They have rate limits (e.g. about 2 requests/minute for OVHcloud without a key), can be slow or temporarily unavailable, and may change their free tiers. Without a key, reviews of long programs can be cut short; add a free Gemini key for reliable results. The submitted code is sent to the provider (see the privacy note above).
- Static rules cover common problems only. They cannot prove a program correct, and C++ macros can occasionally confuse the parser.
- Reviews are limited to 20,000 characters / 800 lines per submission. Single files only; no multi-file projects.
- There are no user accounts: the history is shared by everyone using the same server.
- Dependency note: `npm audit` reports a moderate advisory for the DOMPurify copy bundled inside Monaco Editor. It concerns sanitizing untrusted HTML; this app only shows the user's own code in the editor. Update `monaco-editor` when a patched release is available.

## Future scope

- Sandboxed code execution with generated unit tests, to confirm that the improved code behaves the same
- User accounts with per-user history
- More languages (C, C#, Go) via additional Tree-sitter grammars and rule files
- "Not useful" feedback on issues, to tune rules and prompts
- IDE / GitHub pull-request integration
- Multi-file project review
- Streaming progress updates while the AI review is running

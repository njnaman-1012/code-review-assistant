# Architecture and Viva Guide: Code Review Assistant

This document explains how the system is built, how a request flows through it, and why the main design decisions were made. It is written to support the Software Engineering viva and to keep all SE diagrams (use case, class, sequence, state, component, DFD) consistent with the real implementation.

---

## 1. Architecture style

- **Client–server, three tiers.**
  - Presentation: React SPA
  - Application logic: Express REST API
  - Data: SQLite
- **Layered backend.** Each layer only calls the layer below it:

  `routes → controllers → services → model → database`

- **Hybrid analysis pipeline.** A deterministic **Static Analysis Engine** runs first. An **AI Review Engine** reasons on top of it. A **Review Aggregator** merges both results.
- **Dependency injection.** `createApp({ db, aiReviewService, config })` receives its dependencies. The same app runs with the real SQLite file and AI provider in production, and with an in-memory database and a test-double provider in tests.

### Design patterns used (with where to find them)

| Pattern | Where | Why |
|---|---|---|
| Layered architecture / MVC-style separation | `routes/`, `controllers/`, `services/`, `models/` | Separation of concerns |
| Facade | `services/staticAnalysis/index.js` → `analyzeCode()` | One simple entry point hides the parser, metrics and rules |
| Strategy | `services/ai/providers/*` (same `generateJson()` interface) | Swap AI providers without changing the rest of the code |
| Factory | `createAiProviders()`, `createReviewModel()`, `createApp()` | Objects are created in one place from configuration |
| Chain of Responsibility (failover) | `services/aiReviewService.js` + `resolveProviderChain.js` | Try free AI providers in order until one succeeds |
| Repository / Data Access Object | `models/reviewModel.js` | All SQL lives in one module |
| Pipeline / Orchestrator | `services/reviewService.js` | Runs the review steps in order |

---

## 2. Modules

| Module | Files | Responsibility |
|---|---|---|
| **Web Frontend** | `client/src/**` | Editor, upload, results tabs, history, report download |
| **API client** | `client/src/services/api.js` | The only place the frontend talks to the backend |
| **REST API** | `server/app.js`, `routes/*`, `controllers/*` | HTTP endpoints; translates HTTP ↔ service calls |
| **Middleware** | `middleware/*` | Login check (`requireAuth`), same-origin guard, validation, rate limiting, request logging, error handling |
| **Auth Service** | `services/authService.js`, `utils/password.js` | Register, login, logout, sessions, password hashing |
| **Usage Service** | `services/usageService.js` | AI token allowance: reserve before an AI request, charge after it, stop at the limit |
| **User / Session / Usage Models** | `models/userModel.js`, `sessionModel.js`, `usageModel.js` | SQL for `users`, `sessions`, `user_ai_usage`, `ai_usage_logs` |
| **Review Service** | `services/reviewService.js` | Orchestrates the whole review pipeline |
| **Language Detector** | `services/languageDetector.js` | Warns when the code does not match the selected language |
| **Static Analysis Engine** | `services/staticAnalysis/*` | Parser, syntax checker, metrics, rule sets |
| **AI Review Engine** | `services/aiReviewService.js`, `services/ai/*` | Prompt, AI provider call, JSON validation, retry |
| **Review Aggregator** | `services/reviewAggregator.js` | Merge, de-duplicate, rank, score, compare original vs improved |
| **Report Service** | `services/reportService.js` | HTML and Markdown reports |
| **Review Model** | `models/reviewModel.js` | CRUD on the `reviews` table, always limited to the owner (`user_id`) |
| **Database** | `database/db.js`, `database/schema.sql` | SQLite connection and schema |

---

## 3. Complete request/response flow: `POST /api/reviews`

1. **User** types or uploads code on the *New Review* page and clicks **Analyze Code**.
   - Uploaded files are read in the browser (extension, size and binary checks) and are never stored as files.
2. **Frontend** (`api.createReview`) sends `POST /api/reviews` with `{ language, code }`. In development, Vite forwards `/api` to `localhost:5000`.
3. **Express middleware** runs in order:
   1. `helmet` security headers
   2. CORS check
   3. JSON body parser (200 KB limit)
   4. request logger (method, path, status and time only; never the code)
   5. rate limiters
4. **`validateReviewRequest`** rejects bad input with a clear error code:
   - empty code
   - missing or unsupported language (aliases like `C++` or `js` are normalized)
   - too many characters or lines
   - binary content
5. **`reviewController.create`** calls `reviewService.createReview({ language, code })`.
6. **Language Detector** scores characteristic patterns (e.g. `System.out.println` → Java) and records whether there is a mismatch.
7. **Static Analysis Engine** (`analyzeCode`):
   1. Tree-sitter parses the code into a syntax tree. The code is never executed.
   2. The **syntax checker** reports `ERROR` and `MISSING` nodes. For JavaScript, ESLint reports syntax errors instead.
   3. **Metrics:** line counts, functions, McCabe cyclomatic complexity, nesting depth and parameters per function.
   4. **Rules:** common rules (complexity, long functions, deep nesting, unreachable code, off-by-one loops, division by zero, hard-coded secrets, …) plus language rules (Python/Java/C++ tree rules, or ESLint for JavaScript).
8. **AI Review Engine** (free providers by default; no key needed):
   1. `buildReviewPrompt` creates the prompt: the code **with line numbers**, the static metrics, and the static findings with an instruction not to repeat them.
   2. The engine tries the provider chain in order (e.g. OVHcloud → LLM7, or Gemini first if a free key is set). Each provider receives the system prompt plus the user prompt and must answer in JSON (JSON mode, or a JSON schema for Claude).
   3. `validateAiReview` parses the JSON, normalizes small variations (e.g. `"major"` → `HIGH`) and validates it against the Zod schema.
   4. If the answer is invalid, it **retries once** with a note explaining what was wrong.
   5. If a provider fails (timeout, rate limit, invalid JSON, refusal, …), the **next provider** is tried. Only if all of them fail does the pipeline **continue with static results only**.
9. **Re-check:** if the AI produced improved code, the **same static analyzer** runs on it (original vs improved).
10. **Review Aggregator:**
    - merges static and AI issues and drops AI duplicates of static findings
    - **verifies every AI claim** (line exists, quoted code exists, parser does not contradict it) and downgrades unverified claims to *possible*
    - sorts by severity, confidence and line, and assigns IDs
    - calculates the quality score
    - builds the comparison
    - fills fallbacks when the AI is unavailable
11. **Review Model** inserts the review (JSON columns are serialized) and reads it back with its `id` and `createdAt`.
12. **Controller** responds with `201 { success: true, data: review }`.
13. **Frontend** navigates to `/reviews/:id`. The review arrives in navigation state, so no second request is needed. The 10 result tabs are rendered from the review object.
14. Later, **History** calls `GET /api/reviews`, **Review Details** calls `GET /api/reviews/:id`, **Download** calls `GET /api/reviews/:id/report`, and **Delete** calls `DELETE /api/reviews/:id`.

Errors anywhere in the pipeline go to the **central error handler**. It returns `{ success: false, error: { code, message } }` with a user-friendly message; stack traces stay in the server log.

---

## 4. Static Analysis Engine

**Parser.** Tree-sitter grammars for Python, Java, C++ and JavaScript, compiled to WebAssembly (`web-tree-sitter`). This gives real syntax trees without installing any compiler. Adding a language = add its grammar, its node names in `languageConfig.js`, and a rule file.

**Syntax errors.** Tree-sitter is error-tolerant. It marks unparseable code with `ERROR` nodes and inserts `MISSING` nodes (e.g. a missing `;`). We report up to 5, because later errors are usually side effects of the first.

**Cyclomatic complexity (McCabe, 1976).** `V(G) = decision points + 1`, measured per function. Decision points are `if`, `elif`, loops, `case`, `catch`/`except`, ternary operators, and `&&` / `||` / `and` / `or`. Nested functions are measured separately. The threshold is 10 (MEDIUM) or 20 (HIGH).

**Nesting depth.** The deepest level of nested control statements. `else if` chains are not counted as deeper nesting.

**Rules (examples).**

| Language | Rules |
|---|---|
| Common | high complexity, long function (>50 lines), deep nesting (≥4), too many parameters (>5), unreachable code, `i <= arr.length` off-by-one, division by zero constant, hard-coded secrets, mixed tabs/spaces, long lines, TODO comments |
| Python | mutable default argument, bare `except`, `except: pass`, `== None`, `== True`, `is` with a literal, `eval`/`exec`, wildcard import, unused import, unused variable, shadowed built-in, `range(len(...))` |
| Java | `String ==`, empty catch, catching `Exception`, public field, naming conventions, unused local/import, unclosed `Scanner`/streams, `+=` on String in a loop, missing braces |
| C++ | `gets`/`strcpy`/`strcat`/`sprintf`, `scanf("%s")`, `new` without `delete`, `malloc` without `free`, containers passed by value, `endl` in a loop, C-style casts, `<bits/stdc++.h>`, `using namespace std`, unused variable |
| JavaScript | ESLint: `no-undef`, `no-unused-vars`, `eqeqeq`, `no-var`, `prefer-const`, `no-eval`, `no-empty`, `no-unreachable`, `no-dupe-keys`, `no-cond-assign`, `use-isnan`, … (30 rules) |

Every rule produces the same issue shape as the AI. `source: "static"` and a `ruleId` show where the issue came from.

---

## 5. AI Review Engine

- **Prompt** (`services/ai/promptTemplates.js`): a senior-engineer role. It tells the model:
  - do not invent errors
  - never claim the code was executed
  - use `confidence` (`confirmed` / `likely` / `possible`) and explain uncertainty
  - do not repeat static findings, but fix them in the improved code
  - preserve functionality
  - return valid JSON
- **Structured output:** the Zod schema in `services/ai/reviewSchema.js` is converted to JSON Schema and sent with the request, so the model answers in the required shape.
- **Validation** (`services/ai/aiResponseValidator.js`): the answer is never trusted blindly. The validator extracts the JSON, normalizes it, validates it with Zod, and checks the required fields.
- **Retry:** one retry with an explanation of what was wrong.
- **Free-first provider chain (Chain of Responsibility with failover):** `AI_PROVIDER=auto` (the default) builds an ordered list of **free** providers.
  - Order: Google Gemini → Groq → OpenRouter, each only if its free key is set, then **OVHcloud AI Endpoints** (Qwen3-Coder) → **LLM7** (Codestral), which need **no key**.
  - Keyless OVHcloud requires that no `Authorization` header is sent. The adapter removes it (preset flag `omitAuthWithoutKey`).
  - The engine tries each provider in turn. A rate limit, timeout, truncated answer or invalid JSON moves it on to the next provider.
  - The review records which provider actually answered, and which ones failed before it.
  - The chain is built in `providers/resolveProviderChain.js` from the presets in `providers/providerPresets.js`.
- **Providers** (Strategy pattern, one interface `generateJson()`):
  - `openaiCompatibleProvider.js`: one adapter for every OpenAI-compatible API (Gemini, Groq, OpenRouter, LLM7, Pollinations, Ollama, OpenAI). It uses JSON mode; if a model does not support JSON mode, it retries without it.
  - `anthropicProvider.js`: paid Claude via the official SDK, used only when `AI_PROVIDER=anthropic`. It streams the response, uses typed error classes, handles `refusal` / `max_tokens`, and optionally uses server-side refusal fallback.
- **Why free models need extra checking:** small free models sometimes invent problems. The Review Aggregator verifies every AI claim against the code and the parser's results (section 6).
- **API keys** are read from `server/.env` by the server only. The keyless provider needs none.

### 5a. Code actions: "Fix / Correct Code" and "Improve Code"

After a review, the user can ask the system to work on the code itself. Both actions return the **complete source file**, never a patch or snippet.

| | Fix / Correct Code | Improve Code |
|---|---|---|
| Endpoint | `POST /api/reviews/:id/correct` | `POST /api/reviews/:id/improve` |
| Purpose | Fix the problems found while keeping the original implementation and behaviour | Improve quality, structure, readability and efficiency while keeping the behaviour |
| AI operation | `correctCode()` | `improveCode()` |

- **Separate AI operations:** the AI Review Engine has three operations, `reviewCode()`, `correctCode()` and `improveCode()`. They share one failover/retry mechanism (`runOnChain`) but have their own prompts and schemas: `CODE_ACTION_SYSTEM_PROMPT`, `buildCodeActionPrompt()`, `aiCorrectionSchema` and `aiImprovementSchema`.
- **Input:** the saved review, meaning the original code (numbered), all detected issues, the static-analysis results and the AI review's description of what the code is meant to do. The review is not generated again.
- **Complete-code rules in the prompt:**
  - return the complete source code
  - no patch, and no modified lines only
  - no placeholders such as `[rest of code]`, `...`, `// unchanged code` or `/* existing code */`
  - preserve the language and the intended functionality
  - invent no requirements
  - never claim the code was executed
- **Every answer is checked before it is shown** (`codeActionService.js`). A failed check means the AI is asked again with the reason; after that, the next provider is tried.
  1. The JSON is valid, and `correctedCode` / `improvedCode` is a non-empty string (`validateCodeAction`).
  2. It is a complete file (`codeCompleteness.js`), with:
     - no placeholder comments, lone `...` lines, patch or diff lines, or an explanation instead of code
     - not a fragment: a correction keeps at least 60 % of the code lines, and an improvement at least 35 %
  3. It is the same language (the language detector, plus the answer's `language` field).
  4. It has no syntax errors when checked by the same static analyzer. This also catches cut-off answers. The re-check (issue count and line count) is shown to the user.
- **Storage:** table `code_actions`, one row per review and action (see section 7). Generating again replaces the previous version. The review and its original code are never changed.
- **Safety:** one generation per review and action at a time (409 `ACTION_IN_PROGRESS`); a separate rate limit of 20 per 15 minutes; a 5-minute time budget for starting new AI attempts; public error messages only.
- **UI:**
  - A "What do you want to do?" card on the review page, and a **Fix & Improve** tab.
  - The complete code is shown in Monaco, with Copy Code and Download Code.
  - The views are Original / New / diff (Monaco diff editor), followed by "What was changed?" (what, why, problem solved, lines).

---

## 6. Review Aggregator and quality score

- **De-duplication:** an AI issue is dropped if a static issue has the same type (or a similar title) within ±1 line.
- **AI claim verification** (`verifyAiIssue`): deterministic checks of every AI issue. A failing issue is kept but downgraded to `possible`, with an "Automatic check" note. The checks are:
  1. The parser found no syntax error, but the AI reports one.
  2. The line number does not exist.
  3. The quoted code does not appear in the submission.
  4. The AI says a function is undefined, but the parser found its definition.
- **Ordering:** severity, then confidence, then line number. IDs are `ISSUE-1`, `ISSUE-2`, …
- **Quality score (deterministic):** `100 − (20·CRITICAL + 10·HIGH + 5·MEDIUM + 2·LOW)`, where `possible` issues count half. The minimum is 0.
  - Grades: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, otherwise F.
  - The AI's own score is shown separately, for comparison only.
- **Comparison:** the static metrics of the original and improved code (syntax validity, issue count, complexity, nesting, lines, functions), with notes. It includes an explicit reminder that the improved code has not been executed.

---

## 7. Data model

Table `reviews` (see `server/database/schema.sql`):

| Column | Type | Content |
|---|---|---|
| `id` | INTEGER PK | Review ID |
| `user_id` | INTEGER FK → `users.id` | Owner of the review; every query filters on it |
| `language` | TEXT | `python` / `java` / `cpp` / `javascript` |
| `original_code` | TEXT | Submitted code |
| `summary` | TEXT | Code summary |
| `logic` | JSON | `{ explanation, steps[], keyComponents[] }` |
| `issues` | JSON | Merged issue list |
| `issue_count` | INTEGER | For the history list |
| `quality_score` | INTEGER | Deterministic score |
| `quality` | JSON | `{ score, grade, aiScore, formula, counts }` |
| `suggestions` | JSON | `[{ title, description, priority }]` |
| `improved_code` | TEXT | AI improved code |
| `improvement_explanation` | JSON | `{ changes[], summary{ performance, readability, complexity, security } }` |
| `complexity` | JSON | Big-O for original and improved code, with explanation |
| `static_analysis` | JSON | Metrics, tools used, language check |
| `comparison` | JSON (nullable) | Original vs improved metrics |
| `final_summary` | TEXT | Conclusion |
| `ai_status`, `ai_message`, `ai_provider`, `ai_model` | TEXT | How the AI step went |
| `created_at` | TEXT | ISO timestamp |

JSON columns are serialized with `JSON.stringify` when written and parsed when read, only inside the model files.

Table `code_actions` (the complete corrected / improved code, see section 5a):

| Column | Type | Content |
|---|---|---|
| `id` | INTEGER PK | Row ID |
| `review_id` | INTEGER FK → `reviews.id` | `ON DELETE CASCADE`: deleting a review deletes its generated code |
| `action` | TEXT | `correct` or `improve` (`UNIQUE (review_id, action)`) |
| `code` | TEXT | The complete source file |
| `changes` | JSON | `[{ title, explanation, problemSolved, lines }]` |
| `summary` | TEXT | Short summary of the changes |
| `checks` | JSON | Static re-check: `{ syntaxValid, staticIssueCount, originalStaticIssueCount, totalLines, originalTotalLines }` |
| `ai_provider`, `ai_model` | TEXT | For the developer only (never sent to the public API) |
| `generated_at` | TEXT | ISO timestamp (updated when generated again) |

Tables for user accounts and the AI token allowance (see section 7a):

| Table | Columns | Content |
|---|---|---|
| `users` | `id`, `email` (UNIQUE), `password_hash`, `email_verified`, `disabled`, `created_at`, `updated_at` | One row per account; the password only as a salted Argon2id hash |
| `sessions` | `id`, `user_id` FK, `token_hash` (UNIQUE), `expires_at`, `created_at` | One row per login; the SHA-256 hash of the session token |
| `email_verification_codes` | `id`, `user_id` FK, `email`, `purpose` (verify / reset), `otp_hash`, `token_hash` (UNIQUE), `expires_at`, `attempts`, `created_at`, `used_at` | One-time codes (hashes only) |
| `rate_limits` | `key` PK, `hits`, `reset_at` | Counters for rate limits and login failures |
| `security_events` | `id`, `user_id` FK, `event`, `detail`, `created_at` | Audit log |
| `user_ai_usage` | `id`, `user_id` FK (UNIQUE), `tokens_allocated`, `tokens_used`, `tokens_remaining`, `created_at`, `updated_at` | The token balance of each user |
| `ai_usage_logs` | `id`, `user_id` FK, `request_id`, `feature`, `tokens_used`, `created_at` | One row per AI request (`review` / `correct` / `improve`) |

Relationships: User 1 — * Review, User 1 — 1 AI Usage, User 1 — * Usage Log, User 1 — * Session, Review 1 — 0..2 Code Action.

---

## 7a. User accounts, data isolation and AI tokens

**Registration, e-mail verification and login**

```
Register:  validate e-mail / password / confirmation ─► hash password (Argon2id + salt)
           ─► save pending account + one-time code (one transaction)
           ─► e-mail the 6-digit code ─► verification cookie ─► "Verify email" page
Verify:    verification cookie + code ─► attempts left? not expired? hash matches?
           ─► account verified ─► token allowance (DEFAULT_USER_TOKENS) ─► session ─► Dashboard
Login:     too many failures for this address? ─► verify password ─► verified and not disabled?
           ─► new session ─► cookie ─► Dashboard (only this user's data)
Reset:     e-mail a code ─► verification cookie + code + new password ─► all sessions of the account end
Request:   cookie ─► requireAuth: SHA-256(token) in sessions and not expired? ─► req.user ─► controller
Logout:    delete the session row ─► clear the cookie
```

- **One-time code (OTP):** 6 digits from a cryptographically secure generator; valid 10 minutes; works once; 5 wrong entries; a new code replaces the old one; one code per address per minute and 5 per hour. The database stores only a keyed hash (HMAC-SHA256 with `SESSION_SECRET`); the code is never logged or returned by the API.
- **Bound to the browser:** registering sets a second secret in an httpOnly cookie (`cra_verify`). A code is accepted only together with that cookie, so a code that leaks cannot be used elsewhere, and a password always belongs to the registration that received the code.
- **No account enumeration:** registering an address that already has an account, and asking a reset for an address without one, give the same answer as the normal case (the real owner gets an e-mail notice instead of a code). Wrong e-mail and wrong password give the same answer too.
- **Brute force:** after 10 wrong passwords for an address its login is paused for 15 minutes (also for unknown addresses, so nothing is revealed).
- The session token is a random 32-byte value in an **httpOnly, SameSite=Lax** cookie (HTTPS-only when deployed). JavaScript cannot read it, and nothing about the login is kept in local storage. Every login gets a new session.
- Sessions, codes and rate-limit counters are stored in the database, so they also work on Vercel (serverless functions keep no memory between requests).
- **E-mail** (`services/emailService.js`): Brevo or Resend over HTTPS, chosen by `EMAIL_PROVIDER`; the key stays on the server. During development without a provider the message is printed in the server terminal; a deployed server refuses registration instead.

**Data isolation**

- The server takes the user **only from the session** (`req.user`). There is no URL such as `/users/101/...`, and a `userId` in the body, query or headers is ignored.
- Every SQL query on `reviews` contains `AND user_id = ?`. A review of another user therefore behaves exactly like a missing review: `404 REVIEW_NOT_FOUND` for open, report, delete, fix and improve.
- The frontend guard (`RequireAuth`) only redirects to the login page; the real check is always on the server.

**AI tokens** (`services/usageService.js`)

```
AI request ─► requireAuth ─► estimate = code length / 4 + 1,500
           ─► reserve(estimate): one UPDATE ... WHERE tokens_remaining >= estimate
                 not enough left ─► TOKEN_LIMIT_REACHED, the AI is NOT called
           ─► call the AI (all attempts are counted, also rejected answers)
           ─► settle: replace the reservation by the tokens really used (never below 0),
              write ai_usage_logs ─► response contains the new balance (usage)
```

- Tokens used = the number reported by the AI service (`usage.total_tokens`); if a service reports nothing, an estimate of about 4 characters per token.
- Example: 100,000 allocated, a request uses 2,500 → 2,500 used, 97,500 remaining (97.5 %).
- At the limit: a new review is completed with the automated checks only; "Fix" and "Improve" return `429 TOKEN_LIMIT_REACHED`. The message is: "You have reached your AI usage limit. Please wait for your allowance to reset or contact the administrator."
- The balance exists only in `user_ai_usage`. There is no API that writes it, so values in local storage, cookies, request bodies or headers have no effect; refreshing or logging in again shows the same balance.
- The default allowance is defined once: `DEFAULT_USER_TOKENS` in `server/config/config.js` (environment variable `DEFAULT_USER_TOKEN_LIMIT`). It is given when the e-mail address is verified. The administrator resets a user with `npm run admin -w server -- tokens <email> [tokens]`.
- AI requests are also limited per user (20 per 15 minutes), counted in the database.

---

## 8. Security measures

The public UI and API never reveal internal details: no AI provider or model names, no tool names, no configuration hints, and no database information. `/api/health` returns only service status and whether the AI review is available. Users see only generic AI error messages. Those details are written to the server log for the developer.


| Threat | Measure |
|---|---|
| Running malicious code | Submitted code is **never executed**. Tree-sitter and ESLint only parse it. |
| Leaking the API key | Key only in `server/.env` (git-ignored); the frontend calls our API, never the AI provider |
| Oversized / binary input | JSON body limit of 200 KB; 20,000-character and 800-line limits; NUL-byte check; client-side file type and size checks |
| Abuse / cost attacks | `express-rate-limit`: 300 requests per IP; login, code and AI limits counted in the database (per IP / per user); per-user AI token allowance enforced on the server |
| Password theft | Passwords stored only as salted Argon2id hashes; never logged or returned; login paused after repeated wrong passwords |
| Fake addresses / bots | E-mail verification with a one-time code (expiry, single use, attempt limit, resend limits) |
| Account enumeration | Same answers for known and unknown addresses at registration, login and password reset |
| Session theft / CSRF | Random session token in an httpOnly, SameSite=Lax (HTTPS-only) cookie; only its hash is stored; state-changing requests from other websites are refused |
| Reading other users' data (IDOR) | The user comes from the session only; every query filters on `user_id`; foreign reviews answer 404 |
| Token manipulation | Balance stored and updated only on the server (atomic SQL update); the browser can only read it |
| Cross-origin misuse | CORS limited to `CLIENT_ORIGIN`; only GET, POST and DELETE |
| Common web attacks | Helmet security headers (CSP, HSTS, no framing, no sniffing, no referrer) for the API and, in `vercel.json`, for the pages; `x-powered-by` disabled |
| XSS in reports | Every value is HTML-escaped in the report (covered by a test) |
| Information leakage | Central error handler returns friendly messages only; logs contain no request bodies |
| SQL injection | Prepared statements with parameters in all model files |

---

## 9. Error handling matrix

| Situation | What the user sees |
|---|---|
| Empty code | "Please enter or upload some code to review." (400 `EMPTY_CODE`), also checked in the UI |
| Unsupported language | "…is not supported yet. Supported languages: Python, Java, C++, JavaScript." (400) |
| Invalid file | Upload rejected in the browser with the reason (type, size, empty, binary) |
| Very large code | 413 `CODE_TOO_LARGE` with the actual and maximum size; the editor counter turns red |
| AI not configured | Review created from static analysis only; yellow banner explains how to enable AI |
| AI API failure / timeout / rate limit | Review created from static analysis only; banner with the reason |
| Invalid AI response | One automatic retry; if it fails again, static analysis only |
| Database failure | 500 `DATABASE_ERROR` "…could not be saved" |
| Backend down / network failure | "Cannot reach the backend server…" with a **Try again** button |
| Unknown review ID, or a review of another user | 404 "Review #N was not found." |
| Not logged in / session expired | 401 `UNAUTHENTICATED`; the browser goes to the login page |
| Wrong e-mail or password | 401 "Invalid email or password." |
| Registration: invalid e-mail, weak password, passwords differ | 400 `INVALID_EMAIL` / `WEAK_PASSWORD` / `PASSWORD_MISMATCH`, shown under the form |
| Wrong, expired or used code; too many attempts; code requested too soon | 400 `OTP_INCORRECT` / `OTP_EXPIRED` / `OTP_INVALID`, 429 `OTP_TOO_MANY_ATTEMPTS` / `OTP_COOLDOWN`; "Resend code" with a countdown |
| Login to an unverified account | 403 `EMAIL_NOT_VERIFIED`; a new code is sent and the "Verify email" page opens |
| Too many wrong passwords | 429 `TOO_MANY_ATTEMPTS` "try again in N minutes" |
| The code cannot be e-mailed | 503 `EMAIL_UNAVAILABLE` "try again in a few minutes" |
| AI token allowance used up | Review created from static analysis only, with the limit message; Fix / Improve answer 429 `TOKEN_LIMIT_REACHED`; the token bar is red |
| Fix / Improve: AI unavailable, busy or timed out | 503 / 504 with a friendly message; the original code and the review are unchanged |
| Fix / Improve: empty, invalid, incomplete (snippet, placeholder, syntax errors) or wrong-language answer | Asked again with the reason, then the next provider. Nothing is shown or saved if all fail (502 `AI_INCOMPLETE_CODE`, `AI_EMPTY_CODE`, `AI_INVALID_RESPONSE`, `AI_WRONG_LANGUAGE`) |
| Fix / Improve clicked again while running | Buttons are disabled in the UI; the server answers 409 `ACTION_IN_PROGRESS` |

---

## 10. Mapping to the SE deliverables (keep diagrams consistent)

**Actors**
- **User (Student/Developer)**: primary actor.
- **AI Service (free LLM APIs: OVHcloud, LLM7, Gemini, Groq, OpenRouter)**: secondary, external.

**Use cases**
- Enter Code
- Upload Code File
- Select Language
- Analyze Code, which *includes* Validate Code, Run Static Analysis and Run AI Review
- View Review Results
- View Improved Code
- Compare Original vs Improved
- Download Report
- View History
- View Review Details
- Delete Review

The AI Service participates in *Run AI Review*.

**Main classes / modules (class diagram)**

| Name | Operations |
|---|---|
| `ReviewController` | `create`, `list`, `getById`, `remove`, `report` |
| `ReviewService` | `createReview`, `listReviews`, `getReview`, `deleteReview` |
| `LanguageDetector` | `detectLanguage`, `checkLanguageMatch` |
| `StaticAnalyzer` | `analyzeCode`; uses `Parser`, `SyntaxChecker`, `MetricsCalculator`, `RuleSet` (Common / Python / Java / C++ / ESLint) |
| `AIReviewEngine` | `reviewCode`; uses `PromptTemplate`, `AIProvider` («interface»: `generateJson`, implemented by `AnthropicProvider` and `OpenAICompatibleProvider`) and `AIResponseValidator` |
| `ReviewAggregator` | `aggregateReview`, `mergeIssues`, `calculateQualityScore`, `buildComparison` |
| `ReportService` | `generateHtmlReport`, `generateMarkdownReport` |
| `ReviewModel` | `create`, `findById`, `findAll`, `count`, `deleteById` |
| `Review` | entity; contains many `Issue` and `Suggestion` |

**States of a review (state diagram)**

```
Submitted → Validating → (Rejected: invalid input)
          → Static Analysis → AI Review → (AI Failed → static-only)
          → Re-checking Improved Code → Aggregating → Saved → Completed
```

A database failure moves the review to *Error*.

**Sequence diagram participants**

`User → React UI → API Client → Express (Middleware/Controller) → ReviewService → LanguageDetector → StaticAnalyzer → AIReviewEngine → AI Provider API → ReviewAggregator → ReviewModel → SQLite`

**Components**
- React Frontend
- REST API (Express)
- Static Analysis Engine
- AI Review Engine
- Review Aggregator
- Report Service
- SQLite Database
- External AI API

There is **no authentication module**: it is out of scope, and the history is shared.

**DFD**

- Level 0: User → *Code Review Assistant* → User. The system also exchanges data with the *AI Service*.
- Level 1 processes:
  1. Validate Input
  2. Static Analysis
  3. AI Review
  4. Aggregate Review
  5. Store/Retrieve Reviews
  6. Generate Report
- Data store: **D1 Reviews**.

---

## 11. Link to the literature review

The design follows the gaps identified in `Research/Literature_Review.md`:

| Decision | What it does | Evidence |
|---|---|---|
| D1: hybrid static + AI | Static analysis runs first, then the AI reviews on top of it | static tools miss most bugs [5]; AI alone is noisy [16] |
| D2: grounded prompt | The prompt contains the numbered code and the static findings | AI failures come from missing context/location [15]; CORE grounds the model on static findings [18] |
| D3: what / why / how for every issue | Each issue has an explanation, why it matters and a fix | [4], [6] |
| D4: severity ordering | Issues are ranked by severity | [6], [10] |
| D5: re-check of improved code | The static analyzer runs again on the improved code | [18], [19], [21] |
| D6: logic explanation | The AI explains the program step by step | [2], [20], [22] |
| D7: cyclomatic complexity | Measured per function | [8] |
| D8: fixed issue taxonomy and JSON schema | Fixed categories and output shape | [17] |
| D9: "does not replace human review" disclaimer | Shown in the report | [16], [19] |

---

## 12. Viva questions (short answers)

**Why not just use ChatGPT?**
Our system adds four things:
- deterministic static analysis the AI is grounded on
- a fixed, validated JSON structure
- a severity, line and confidence for every issue
- a re-check of the improved code

It also stores history and produces reports.

**Why Tree-sitter instead of each language's compiler?**
One uniform, safe way to parse four languages without installing compilers or executing code. It is also error-tolerant, so it can still analyse code that contains syntax errors.

**Is the improved code guaranteed correct?**
No. It is re-checked statically (syntax, rules, complexity) but not executed. It must be tested. The UI and report say this.

**Why is the AI free, and what are the trade-offs?**
The default chain uses free providers: two need no key at all (OVHcloud, LLM7), and three become available with a free key (Gemini, Groq, OpenRouter). The trade-offs are rate limits, speed and lower quality from small models. Failover and automatic claim verification compensate for this.

**What happens if the AI is down?**
The review is still produced from static analysis, with a message. The AI step is optional by design (graceful degradation).

**How do you prevent the AI from inventing errors?**
- The prompt forbids it and requires a confidence level.
- The static findings give it context.
- The aggregator downgrades AI syntax errors the parser did not confirm.
- The UI labels every issue as Static or AI.

**How is the quality score calculated?**
`100 − (20·Critical + 10·High + 5·Medium + 2·Low)`, with *possible* issues counting half. It is deterministic, so the same code gets the same score.

**What is cyclomatic complexity?**
The number of independent paths through a function: decision points + 1 (McCabe). Above 10 is flagged.

**How is the API key protected?**
- It lives only in `server/.env`, which is git-ignored.
- The browser only talks to our backend.
- No key appears in client code or logs.

**How is it tested?**
67 automated tests with Node's test runner and Supertest. They use an in-memory database and a test-double AI provider, and cover the API, validation, AI failure handling, the free provider chain and failover, AI claim verification, the JSON validator, database operations, static rules, metrics and the aggregator.

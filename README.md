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
- **User accounts:** register with e-mail and password, verify the address with a 6-digit code sent by e-mail, log in, log out and reset a forgotten password. Every review, report and generated code belongs to the account that created it; nobody else can open it.
- **AI token allowance:** every verified user gets 100,000 AI tokens (`DEFAULT_USER_TOKEN_LIMIT`). A token bar shows allocated / used / remaining; the server counts every AI request and stops calling the AI when the allowance is used up.
- **History:** every review is saved in SQLite. You can search, filter, view and delete your own reviews.
- **Reports:** download a printable HTML report (Ctrl+P → Save as PDF) or a Markdown report.
- **Free AI, no key needed:** a chain of free providers with automatic failover. Add a free Gemini/Groq/OpenRouter key for faster, better reviews. Every AI finding is checked automatically against the real code.
- **Graceful degradation:** if every AI provider fails, you still get a complete static-analysis review with a clear message.
- **Security:**
  - submitted code is never executed
  - API keys (if any) stay on the server
  - passwords are stored only as salted Argon2id hashes; one-time codes only as keyed hashes; the login session is an httpOnly cookie
  - rate limits and brute-force protection counted in the database; protection against cross-site requests (CSRF), SQL injection and XSS (see [Security](#security))
  - every API request is checked on the server (login + ownership); token balances exist only in the database
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
│   ├── middleware/           # login check (auth.js), validation, rate limiting, logging, error handling
│   ├── services/
│   │   ├── authService.js          # register, verify e-mail, login, logout, password reset, sessions
│   │   ├── emailService.js         # sends the one-time codes (Brevo / Resend)
│   │   ├── usageService.js         # AI token allowance: reserve, charge, limit
│   │   ├── reviewService.js        # orchestrates the review pipeline
│   │   ├── languageDetector.js     # guesses the language of the code
│   │   ├── staticAnalysis/         # parser, syntax checker, metrics, rule sets
│   │   ├── aiReviewService.js      # AI Review Engine (prompt → provider → validation)
│   │   ├── ai/                     # prompt templates, JSON schema, validator, providers
│   │   ├── reviewAggregator.js     # merges static + AI results, scoring, comparison
│   │   └── reportService.js        # HTML / Markdown reports
│   ├── models/               # all SQL: reviews, code actions, users, sessions, token usage
│   ├── scripts/admin.js      # administrator: users, token allowance, disable account, security events
│   ├── database/             # db.js (connection) + schema.sql
│   ├── utils/                # constants, errors, logger, text helpers
│   └── tests/                # automated tests
└── client/
    ├── index.html
    ├── vite.config.js        # dev server + /api proxy to the backend
    └── src/
        ├── main.jsx, App.jsx # entry point and routes
        ├── context/AuthContext.jsx   # logged-in user + token balance
        ├── pages/            # Login, Register, VerifyEmail, Forgot/ResetPassword, Dashboard, NewReview, ReviewDetails, History, About
        ├── components/       # editor, badges, tabs, issue card, token bar, RequireAuth, results/* tabs
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
| `EMAIL_PROVIDER` | *(empty)* | Who sends the one-time codes: `brevo`, `resend` or `console` (development: print in the terminal). Empty = `console` on your computer; on a deployed server registration is closed until it is set |
| `EMAIL_API_KEY` / `EMAIL_FROM` / `EMAIL_FROM_NAME` | *(empty)* | API key of the e-mail provider, the verified sender address, and the sender name |
| `SESSION_SECRET` | *(empty)* | Any long random text; keys the hashes of the one-time codes |
| `DEFAULT_USER_TOKEN_LIMIT` | `100000` | AI tokens every newly verified user receives (the default is `DEFAULT_USER_TOKENS` in `server/config/config.js`) |
| `AI_RATE_LIMIT` | `20` | AI requests per user per 15 minutes (reviews, and Fix/Improve) |
| `OTP_EXPIRY_MINUTES` / `OTP_MAX_ATTEMPTS` / `OTP_RESEND_COOLDOWN` / `OTP_MAX_PER_HOUR` | `10` / `5` / `60` / `5` | Code lifetime (minutes), wrong entries per code, seconds between codes, codes per address per hour |
| `LOGIN_MAX_FAILURES` / `LOGIN_LOCK_MINUTES` | `10` / `15` | Wrong passwords for one address before its login is paused, and for how long |
| `LOGIN_RATE_LIMIT` / `OTP_RATE_LIMIT` | `30` / `30` | Register / login / forgot-password requests, and code entries, per IP per 15 minutes |
| `SESSION_TTL_HOURS` | `168` | How long a login stays valid (7 days) |
| `MAX_REQUEST_SIZE` | `200kb` | Largest request body |
| `FRONTEND_URL` | *(empty)* | Front-end origin(s) if it is not served by the same host as the API (same as `CLIENT_ORIGIN`) |
| `COOKIE_SECURE` | automatic | The cookies are HTTPS-only when `NODE_ENV=production` or on Vercel |

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

Google sometimes answers "this model is experiencing high demand" (HTTP 503) for one Gemini model while its other models work. The server then tries the other Gemini models with the same key (`gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`; change the list with `GEMINI_FALLBACK_MODELS`) before it moves on to the slower keyless providers. An overloaded model sometimes hangs instead of failing, so each Gemini model also has a time limit (`AI_MODEL_TIMEOUT_MS`, 45 s plus extra time for long code) after which the next one is tried. For faster but less detailed reviews, set `GEMINI_MODEL=gemini-3.5-flash-lite`.

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

No setup is needed. On first start the server creates `server/database/code_review.db` and runs `server/database/schema.sql`, which creates the tables if they do not exist:

| Table | Content |
|---|---|
| `users` | e-mail (unique) and password hash |
| `sessions` | who is logged in (hash of the session token, expiry) |
| `email_verification_codes` | one-time codes for e-mail verification and password reset (hashes, expiry, attempts) |
| `rate_limits` | counters for the rate limits (shared by all server instances) |
| `security_events` | audit log: registration, verification, login, failed login, logout, password reset |
| `user_ai_usage` | tokens allocated / used / remaining per user |
| `ai_usage_logs` | one row per AI request (user, request ID, feature, tokens) |
| `reviews` | the reviews, each with its owner (`user_id`) |
| `code_actions` | corrected / improved code of a review |

A database from an earlier version is upgraded automatically; no row is deleted. Reviews saved before accounts existed have no owner and are no longer shown. Accounts created before e-mail verification existed are kept as verified.

**Administrator commands** (run on the server; there is no page or API for them):

```bash
npm run admin -w server -- users
```

```bash
npm run admin -w server -- tokens student@example.com 100000
```

```bash
npm run admin -w server -- disable student@example.com
```

```bash
npm run admin -w server -- events
```

`users` lists the accounts with their AI usage, `tokens` gives a new allowance, `disable` / `enable` blocks or unblocks an account, and `events` shows the newest security events.

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
- **Database:** the tables are created (and upgraded) automatically on the first request. Locally, the app keeps using the file `server/database/code_review.db`.
- **Accounts need e-mail:** without the e-mail variables below nobody can register on the deployed site.

### E-mail for the one-time codes (free)

1. Sign up at <https://www.brevo.com> (free plan: 300 e-mails a day, no credit card, no own domain needed).
2. In Brevo, open **Senders, Domains & Dedicated IPs → Senders**, add your e-mail address and confirm it with the code Brevo sends you.
3. Open **SMTP & API → API Keys** and create an API key.
4. In Vercel, open the project → **Settings → Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `EMAIL_PROVIDER` | `brevo` |
   | `EMAIL_API_KEY` | the Brevo API key |
   | `EMAIL_FROM` | the sender address you confirmed in Brevo |
   | `SESSION_SECRET` | a long random text (see `server/.env.example`) |
   | `DEFAULT_USER_TOKEN_LIMIT` | optional: AI tokens per user (default 100000) |

5. **Redeploy** (Deployments → ⋯ → Redeploy), then register once yourself to check that the code arrives (also look in the spam folder).

Resend (`EMAIL_PROVIDER=resend`) works too, but its free plan only sends to other people after you verify a domain you own.
- **Other hosts:** the app can also run as one normal Node.js server. Run `npm run build`, then `npm start` with `NODE_ENV=production` (see *Production mode* above).

## Security

No software is impossible to attack; these are the protections that are implemented and tested (`server/tests/auth.test.js`, `security.test.js`, `tokenUsage.test.js`).

| Risk | Protection |
|---|---|
| Stolen passwords | Stored only as salted **Argon2id** hashes (scrypt on Node.js versions without Argon2); never logged or returned |
| Fake e-mail addresses, bots | The account is active only after a 6-digit code sent to the address; codes expire after 10 minutes, work once, allow 5 wrong entries, and are stored as keyed hashes |
| Guessing passwords or codes | Login is paused after 10 wrong passwords for an address; request limits per IP address, counted in the database |
| Finding out who has an account | Registration, login and "forgot password" answer the same for known and unknown addresses |
| Session theft | Random session token in an **httpOnly, Secure, SameSite=Lax** cookie; only its hash is stored; a new session for every login; logout and password reset end sessions |
| Reading other users' data (IDOR / BOLA) | The user comes from the session only; every query filters on `user_id`; foreign records answer 404 |
| SQL injection | Every query uses parameters; IDs must be plain digits |
| XSS | React escapes all output; reports escape user and AI text; Content-Security-Policy allows only the app's own scripts |
| CSRF | SameSite cookies and an origin check for every request that changes data |
| CORS | Only the configured front-end origin, never `*` |
| Leaking API keys | AI and e-mail keys exist only in server environment variables; the browser calls only this server |
| Using up the AI quota | Per-user token allowance and per-user request limit, enforced on the server with atomic database updates |
| Information in errors | Friendly messages only; details go to the server log; audit log without passwords or codes |
| Other | Security headers (Helmet: CSP, HSTS, no framing, no sniffing, no referrer), request size limit, HTTPS on the host |

## How to use

1. **Create an account** (e-mail and password), enter the 6-digit code that arrives by e-mail, or **log in**. A verified account starts on the dashboard with its AI token allowance. (On your own computer without an e-mail provider, the code is printed in the terminal where the server runs.)
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
8. The **AI tokens** bar (header and dashboard) shows how much of your allowance is left. **Log out** ends the session.

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

Every `/api/reviews` endpoint needs a logged-in user (session cookie) and works only on that user's own reviews. The user is taken from the session, never from an ID in the request.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Start an account. Body: `{ "email", "password", "confirmPassword" }` → `201` with `{ verification }`; a 6-digit code is e-mailed and the browser gets a verification cookie |
| `GET` | `/api/auth/verification` | The pending code of this browser: masked address, seconds until expiry and until "resend" |
| `POST` | `/api/auth/verify-email` | Body: `{ "otp" }` → the account is active and logged in: `{ user, usage }` and the session cookie |
| `POST` | `/api/auth/resend-otp` | A new code (the previous one stops working) |
| `POST` | `/api/auth/login` | Log in. Body: `{ "email", "password" }` → `{ user, usage }` and the session cookie; `403 EMAIL_NOT_VERIFIED` (with a new code) for an unverified account |
| `POST` | `/api/auth/forgot-password` | Body: `{ "email" }` → e-mails a reset code if the address has an account (same answer either way) |
| `POST` | `/api/auth/reset-password` | Body: `{ "otp", "password", "confirmPassword" }` → new password; every login of the account ends |
| `POST` | `/api/auth/logout` | End the session and remove the cookie |
| `GET` | `/api/auth/me` | The logged-in user and the token balance `{ allocated, used, remaining, percentRemaining }` |
| `GET` | `/api/health` | Service status, whether the AI review is available, supported languages and limits (no internal details) |
| `POST` | `/api/reviews` | Create a review. Body: `{ "language": "python", "code": "..." }` → `201` with the complete review |
| `GET` | `/api/reviews?limit=50&offset=0` | List saved reviews (newest first) → `{ reviews: [...], total }` |
| `GET` | `/api/reviews/:id` | Get one complete review (includes `codeActions.correct` / `codeActions.improve` once generated) |
| `DELETE` | `/api/reviews/:id` | Delete a review (and its generated code) |
| `GET` | `/api/reviews/:id/report?format=html\|md` | Download the review report |
| `POST` | `/api/reviews/:id/correct` | **Fix / Correct Code**: the complete corrected source file for a saved review → `{ action, language, code, changes[], summary, checks, generatedAt }`, saved with the review |
| `POST` | `/api/reviews/:id/improve` | **Improve Code**: the same for a complete improved version |

Responses of AI requests (`POST /api/reviews`, `/correct`, `/improve`) also contain `"usage"`, the new token balance.

Example (log in, keep the cookie in `cookies.txt`, then create a review):

```bash
curl -c cookies.txt -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"you@example.com\",\"password\":\"your-password\"}"
```

```bash
curl -b cookies.txt -X POST http://localhost:5000/api/reviews -H "Content-Type: application/json" -d "{\"language\":\"python\",\"code\":\"def f(x=[]):\n    return x\"}"
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
| `REVIEW_NOT_FOUND` (404) | No review of this user has that ID (also returned for a review of another user) |
| `UNAUTHENTICATED` (401) | Not logged in, or the session expired |
| `INVALID_CREDENTIALS` (401) | Wrong e-mail or password |
| `INVALID_EMAIL`, `WEAK_PASSWORD`, `PASSWORD_MISMATCH` (400) | Registration input is not valid |
| `EMAIL_NOT_VERIFIED` (403) | Right password, but the e-mail address is not verified yet |
| `OTP_INCORRECT`, `OTP_EXPIRED`, `OTP_INVALID` (400) | The code is wrong, too old, or no longer valid (used, replaced, other browser) |
| `OTP_TOO_MANY_ATTEMPTS`, `OTP_COOLDOWN`, `OTP_LIMIT_REACHED` (429) | Too many wrong entries, or codes requested too quickly / too often |
| `TOO_MANY_ATTEMPTS` (429) | Too many wrong passwords for this address; login is paused for a while |
| `ACCOUNT_DISABLED` (403) | The administrator disabled the account |
| `EMAIL_UNAVAILABLE` (503) | The code could not be e-mailed (provider not configured or down) |
| `TOKEN_LIMIT_REACHED` (429) | The AI token allowance is used up ("Fix" / "Improve") |
| `FORBIDDEN_ORIGIN` (403) | A request that changes data came from another website |
| `RATE_LIMITED` (429) | Too many requests from this IP |
| `DATABASE_ERROR` / `INTERNAL_ERROR` (500) | A server-side failure |

AI failures do **not** fail the request. The review is still created from static analysis, and `ai.status` is `"failed"` or `"unavailable"` with a message. The same happens when the token allowance is used up: the AI is not called and the review contains the automated checks only.

## Testing

Run the automated backend tests (174 tests, about 15 seconds, no API key, e-mail account or internet needed):

```bash
npm test
```

The tests use an in-memory database and a **test-double AI provider**, so they never call a real AI service. They cover:

- **API:** health endpoint; review creation; empty, whitespace-only, missing-language, unsupported-language, oversized, binary and malformed-JSON input; retrieval; listing; deletion; 404s; HTML/Markdown reports; HTML escaping of user code.
- **AI handling:** AI unavailable, AI failure fallback, retry after invalid JSON, failure after repeated invalid JSON.
- **AI response validation:** JSON extraction, normalization of severity/type/line/confidence, required fields, score clamping.
- **Accounts:** registration, e-mail and password validation, an address that is already registered, password hashing (and upgrade of older hashes), login, wrong password, unverified account, brute-force pause, session cookie, new session per login, expired session, disabled account, logout, requests from another website.
- **One-time codes:** correct, wrong, expired, reused and malformed codes; attempt limit (also for parallel guesses); a code only works in the browser that asked for it; resend cooldown and hourly limit; password reset; e-mail provider down or not configured.
- **Security:** SQL injection text in every input (login, registration, IDs, paging, code); script text in code and AI answers (escaped in reports, JSON elsewhere); security headers; CORS; rate limits shared by server instances; per-user AI limit; oversized requests; error messages without internal details; audit log.
- **Data isolation:** two accounts see only their own reviews; opening, downloading, deleting or fixing another user's review is refused; user IDs sent by the browser are ignored.
- **AI tokens:** 100,000 − 2,500 = 97,500; usage log; fake token numbers in body, query, headers and cookies; no change after re-login; no AI call with an empty allowance; parallel requests cannot overspend.
- **Database:** create, JSON round-trip, newest-first paging, delete, owner filter, upgrade of an older database.
- **Static analysis:** syntax errors in each language, language rules, off-by-one loops, McCabe complexity, else-if nesting, line counting.
- **Language detector and review aggregator:** detection and mismatch warnings; scoring formula, de-duplication, AI syntax-error guard, original-vs-improved comparison.

Manual test: run `npm run dev`, load each sample from **Load a sample**, and check the tabs.

## Limitations

- The code is **analysed, not executed**. Runtime behaviour is predicted, not observed, and the improved code must be tested before it is used.
- AI findings, explanations and Big-O values can be wrong. They are labelled *AI analysis* with a confidence level, obviously ungrounded claims are downgraded automatically, and the improved code is re-checked only statically (syntax, rules, complexity), not for identical behaviour.
- The free AI providers are shared public services. They have rate limits (e.g. about 2 requests/minute for OVHcloud without a key), can be slow or temporarily unavailable, and may change their free tiers. Without a key, reviews of long programs can be cut short; add a free Gemini key for reliable results. The submitted code is sent to the provider (see the privacy note above).
- Static rules cover common problems only. They cannot prove a program correct, and C++ macros can occasionally confuse the parser.
- Reviews are limited to 20,000 characters / 800 lines per submission. Single files only; no multi-file projects.
- The token allowance does not reset by itself; the administrator resets it with `npm run admin -- tokens`. There is no administrator page, only the command-line tool.
- Everything runs on free tiers, which are limited: the e-mail provider (300 codes a day with Brevo), the AI provider (requests per minute and per day on one free key, shared by all users), the hosted database and the hosting itself. When a limit is reached, registration or the AI review pauses until the next day.
- There is no CAPTCHA. Bots are slowed down by the e-mail code, the rate limits and the token allowance, but not stopped completely.
- Tokens are counted as reported by the AI service; when a service reports nothing, they are estimated (about 4 characters per token).
- Dependency note: `npm audit` reports a moderate advisory for the DOMPurify copy bundled inside Monaco Editor. It concerns sanitizing untrusted HTML; this app only shows the user's own code in the editor. Update `monaco-editor` when a patched release is available.

## Future scope

- Sandboxed code execution with generated unit tests, to confirm that the improved code behaves the same
- Automatic monthly reset of the token allowance; an administrator page; CAPTCHA on registration; login with Google
- More languages (C, C#, Go) via additional Tree-sitter grammars and rule files
- "Not useful" feedback on issues, to tune rules and prompts
- IDE / GitHub pull-request integration
- Multi-file project review
- Streaming progress updates while the AI review is running

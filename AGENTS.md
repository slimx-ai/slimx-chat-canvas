# AGENTS.md

Repository-wide instructions for coding agents working on **SlimX Chat Canvas**.

These instructions apply to the entire repository unless a more specific `AGENTS.md` exists in a subdirectory. Follow them before making code, documentation, deployment, or CI/CD changes.

---

## 1. Project identity

SlimX Chat Canvas is a FastAPI + vanilla JavaScript web application for non-linear LLM conversations. The product goal is a chat canvas where the user can keep a main thread while opening focused deep-dive lanes from assistant answers and isolated selected-text comment threads anchored to specific spans of an assistant response.

The backend serves the static UI and exposes chat/inference endpoints. The recommended architecture is model-agnostic:

- FastAPI application entrypoint through `server.py`.
- Main API code in `app/main.py`.
- Structured request/response schemas in `app/schemas.py`.
- Backend dispatch through `app/slimx_gateway.py`.
- Model providers in `app/providers/`.
- Local Toaster/PyTorch inference runtime in `app/runtime/toaster_runtime.py`.
- Frontend UI in `static/index.html`, `static/styles.css`, and `static/app.js`.
- Docker and Contabo deployment files in `Dockerfile` and `deploy/`.
- GitHub Actions pipeline in `.github/workflows/`.

The current lightweight/local model path is `MODEL_BACKEND=slimx` with `LLM_PROVIDER=toaster`. The project is also expected to support a more capable Gemma-class model, potentially referred to as `Gemma4`, through the same backend abstraction. Do not hardcode a specific future model name, endpoint, tokenizer, or serving framework until the exact deployment target has been selected.

The application must remain usable in lightweight `echo` mode for UI/API testing, in `slimx` + `toaster` mode for local PyTorch inference, and in a future external or provider-based mode for larger models.

---

## 2. Non-negotiable product and architecture rules

### 2.1 Do not use Gradio

Do **not** add Gradio, `gradio_client`, a Gradio UI, a Gradio server, or a Gradio dependency.

This project intentionally serves the SlimX Chat Canvas UI without Gradio. Keep the architecture FastAPI + SlimX provider + model runtime or external inference service. If a future Gemma-class backend is needed, use one of these paths:

- `MODEL_BACKEND=http` for an external inference service;
- a new SlimX provider such as `app/providers/gemma_provider.py`;
- a clean adapter behind `app/slimx_gateway.py`.

Do not reintroduce Gradio as a shortcut.

### 2.2 Keep the structured messages API

The preferred chat request format is:

```json
{
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "max_new_tokens": 128
}
```

Keep `/api/chat` compatible with structured `messages`. Legacy `prompt` support may remain for simple clients, but new frontend code should send `messages`.

### 2.3 Preserve context isolation between main, deep-dive, and comment modes

The main thread, deep-dive lanes, and selected-text comments have different context boundaries:

- Main thread context must include only the main lane.
- Deep-dive context must include the parent history up to the origin assistant message plus the current detour lane.
- Comment context must include only the selected excerpt and that comment’s own Q&A thread.

A comment is **not** a lane. A deep dive is a lane. A comment is an isolated anchored side discussion.

Do not leak comments into main/deep context. Do not leak unrelated detours into the active lane context. Do not make the backend reconstruct comment context from global history unless explicitly designed and tested.

### 2.4 Treat the comment feature as first-class product behavior

The comment feature allows the user to select text inside an assistant message, create a margin-note style comment, and ask follow-up questions about that selected excerpt.

Agents must preserve these invariants:

- Comments are anchored to an assistant message through `messageId` and a character range.
- Comments must remain visible as highlights/chips attached to the original assistant message.
- A collapsed comment must remain recoverable.
- Comment Q&A must stay in `comment.thread`, not in the main `messages` array.
- `mode: "comment"` requests must send a self-contained context: selected excerpt plus this comment’s own Q&A.
- The optional `anchor` payload is metadata; it should not replace the explicit `messages` payload.
- Comment context preview must show the isolated comment context, not the full lane context.
- Comment rendering must use safe DOM operations such as `textContent`, not unsanitized HTML.

### 2.5 Never send pending UI placeholders to the model

Pending assistant placeholders such as `…` are UI-only state. They must never be included in the backend prompt or `messages` payload.

When changing frontend send logic, build the backend context before adding the pending assistant placeholder, or explicitly filter messages with `pending === true`.

This rule applies to:

- main thread sends;
- deep-dive sends;
- comment sends.

### 2.6 Keep the frontend model-agnostic

Frontend code must not know whether the backend uses Toaster, Gemma, OpenAI, Ollama, vLLM, TGI, llama.cpp, or another serving path.

The frontend sends structured chat/context payloads. Backend/provider code chooses how to format prompts for the active model.

### 2.7 Do not commit large checkpoints, model weights, secrets, or local artifacts

Do not commit:

- `model/babyGPT/babyGPT_152M` or other large checkpoint files.
- Gemma/Gemma4 weights or any other large model weights.
- Private `.env` files.
- SSH keys, API keys, GHCR tokens, OpenAI keys, Hugging Face tokens, or deployment secrets.
- Python caches, Node caches, browser build artifacts, logs, or temporary files.

Model configs can stay in the repository only when small and intentionally tracked. Large checkpoints should be mounted in production or fetched by the deployment environment according to a documented secure process.

---

## 3. Backend architecture rules

### 3.1 FastAPI app

`app/main.py` owns:

- `/health`
- `/api/chat`
- `/generate`
- `/api/chat/stream`
- static UI mounting
- backend dispatch based on `MODEL_BACKEND`

Keep API routes above the static file mount. The static mount must remain last so it does not shadow API routes.

### 3.2 Backend modes

Supported or intended backend modes:

```text
MODEL_BACKEND=echo            # UI/API testing without model dependencies
MODEL_BACKEND=http            # external model service through HTTP
MODEL_BACKEND=slimx           # recommended provider architecture through SlimX
MODEL_BACKEND=direct_toaster  # direct runtime fallback/debug path
```

Use `MODEL_BACKEND=echo` for fast smoke tests and UI testing.

Use `MODEL_BACKEND=slimx` when the active model is implemented as a SlimX provider.

Use `MODEL_BACKEND=http` when the active model is served out-of-process, for example by a dedicated GPU service. This is the preferred first integration path for a larger Gemma-class model because it keeps the chat app small and avoids coupling the web app image to large GPU inference dependencies.

### 3.3 SlimX gateway

`app/slimx_gateway.py` registers custom providers and builds SlimX chat requests.

When adding providers:

- Register them through SlimX provider mechanisms.
- Keep environment-variable configuration explicit.
- Avoid provider-specific code inside the frontend.
- Keep `SYSTEM_PROMPT` configurable.
- Keep timeouts and retries configurable.
- Keep provider initialization lazy or explicitly documented.
- Make model name configurable through `LLM_MODEL`.

### 3.4 Toaster provider

`app/providers/toaster_provider.py` adapts the Toaster runtime to SlimX.

Important: `babyGPT` is currently treated as a raw prompt-completion model, not a fully instruction-tuned chat model. The provider currently extracts the latest user message as the prompt. Do not assume the model can correctly consume full multi-turn chat templates unless you test that behavior.

If you improve prompt formatting, make it configurable and test it in both echo and toaster paths.

### 3.5 Gemma-class model provider / serving path

The project may serve a more capable Gemma-class model in the future. Until the exact model and serving framework are confirmed, treat this as a pluggable target, not a hardcoded dependency.

Acceptable implementation patterns:

1. **External HTTP model service**
   - Keep SlimX Chat Canvas as the UI/API gateway.
   - Serve the large model separately, ideally on a GPU-capable host.
   - Use `MODEL_BACKEND=http`.
   - Configure:
     ```text
     MODEL_HTTP_URL=http://model-service:port/path
     MODEL_HTTP_TIMEOUT=...
     LLM_MODEL=...
     ```
   - The HTTP backend should accept structured messages or a clear prompt format.

2. **SlimX provider**
   - Add a provider such as `app/providers/gemma_provider.py`.
   - Configure it using:
     ```text
     MODEL_BACKEND=slimx
     LLM_PROVIDER=gemma
     LLM_MODEL=...
     ```
   - Keep model-specific dependencies separate when possible.

3. **Ollama/OpenAI-compatible endpoint**
   - If using an OpenAI-compatible API, prefer an adapter/provider that maps SlimX messages to that API.
   - Do not put OpenAI-compatible formatting logic in `static/app.js`.

For Gemma-class models, always consider:

- context window size;
- max input tokens;
- max output tokens;
- tokenizer-specific truncation;
- whether system messages are supported;
- stop sequences;
- streaming support;
- GPU memory and quantization;
- concurrency limits;
- request timeout and cancellation behavior.

Do not assume `Gemma4` is the exact package/model identifier. Use environment variables and README documentation so it can be changed without editing code.

### 3.6 Toaster runtime

`app/runtime/toaster_runtime.py` is responsible for:

- loading the model config;
- loading the checkpoint;
- selecting CPU/CUDA/MPS;
- initializing tokenization;
- generating text;
- cleaning model output.

When modifying runtime code:

- Preserve lazy loading unless startup loading is explicitly required.
- Keep generation thread-safe with the runtime lock.
- Keep inference under `torch.inference_mode()`.
- Avoid logging full user prompts.
- Keep CPU settings configurable through environment variables.
- Do not hardcode local developer paths.

---

## 4. Frontend architecture rules

The frontend is intentionally lightweight vanilla JavaScript. Do not introduce React, Vue, Svelte, Gradio, or a bundler unless the project owner explicitly asks for a frontend migration.

### 4.1 State model

`static/app.js` maintains:

- `messages`: main/deep-dive message objects;
- `lanes`: main and deep-dive lanes;
- `detoursByOriginId`: mapping from assistant message to detour lane;
- `comments`: selected-text comment threads;
- `commentsByMessageId`: mapping from assistant message to comments;
- `activeLaneId` and `activeCommentId`.

Keep these concepts separate. A comment is not a lane. A detour is a lane. Pending assistant messages are display-only until completed.

### 4.2 Context construction

`buildMessagesForBackend()` is critical. Changes to it must preserve these properties:

- pending messages are excluded;
- empty content is removed;
- only valid roles are sent: `system`, `user`, `assistant`;
- deep-dive lanes include the correct origin history;
- main-lane requests do not include detour messages;
- comments are not included;
- context preview matches the payload sent to the backend.

`buildMessagesForComment()` is equally critical. It must remain isolated from main and deep-dive context. It should include:

- a system instruction explaining the selected excerpt task;
- a user message containing the selected excerpt;
- this comment’s own non-pending Q&A thread.

### 4.3 Comment selection and anchors

When modifying selection/comment code:

- Only allow comments on assistant message content, not arbitrary page text.
- Store stable offsets against the assistant message’s canonical `content` string.
- Preserve highlights across re-rendering.
- Handle collapsed comments gracefully.
- Avoid overlapping highlight bugs where practical.
- Keep the selected quote in the comment object for robustness.
- Use the optional `anchor` payload for observability, analytics, or future persistence, not as the only source of context.

### 4.4 UI rendering

Assistant messages should remain branchable in the main lane unless they are pending. Deep-dive lanes should show their origin and allow returning to the main thread. Existing deep dives and comments should remain visible as chips/tags attached to the relevant assistant answer.

Use `textContent` for user/model content unless sanitized Markdown rendering is intentionally introduced. Do not inject raw HTML from model responses.

### 4.5 Send flow

The safe send order for main and deep-dive messages is:

1. Read and trim the user input.
2. Add the user message to the active lane.
3. Build the backend context from non-pending messages.
4. Add a pending assistant placeholder for UI feedback.
5. Send the API request.
6. Replace the pending placeholder with the final assistant response or an error message.
7. Re-render and update status/context preview.

The safe send order for comments is:

1. Read and trim the comment input.
2. Add the user comment message to the comment thread.
3. Build isolated comment context from non-pending comment messages.
4. Add a pending assistant placeholder inside that comment thread.
5. Send `mode: "comment"` to `/api/chat` with explicit `messages` and optional `anchor`.
6. Replace the pending placeholder with the final assistant response or an error message.
7. Re-render the comment panel and keep the anchor/highlight visible.

Disable duplicate sends while a request is in flight if that behavior is implemented. Do not allow multiple Enter presses to create inconsistent pending states.

---

## 5. API contract

### 5.1 Request

Preferred request body:

```json
{
  "messages": [
    {"role": "system", "content": "optional system context"},
    {"role": "user", "content": "question"}
  ],
  "conversation_id": "session-id",
  "lane_id": "main-or-detour-or-comment-id",
  "mode": "main",
  "max_new_tokens": 128,
  "temperature": 0.8
}
```

Valid `mode` values are:

```text
main
deep
comment
```

Comment requests may include an optional anchor:

```json
{
  "mode": "comment",
  "lane_id": "comment:cmt_123",
  "anchor": {
    "message_id": "msg_5",
    "quote": "selected excerpt",
    "start": 10,
    "end": 27
  },
  "messages": [
    {"role": "system", "content": "The user selected..."},
    {"role": "user", "content": "Excerpt: ..."},
    {"role": "user", "content": "Question about the excerpt"}
  ]
}
```

The backend must treat `messages` as the actual model context. The `anchor` is supplemental metadata.

### 5.2 Response

Expected response shape:

```json
{
  "reply": "assistant response",
  "text": "assistant response",
  "backend": "slimx",
  "model": "babygpt-152m",
  "elapsed_ms": 123,
  "prompt_chars": 456
}
```

Keep both `reply` and `text` unless all clients have been migrated to one field.

### 5.3 Validation

Server-side validation should reject:

- missing `messages` and missing/blank `prompt`;
- empty message content;
- unsupported roles;
- unsupported mode values;
- unreasonable prompt sizes if a max length is added;
- invalid comment anchors where `end <= start`, when anchor validation is enforced.

Do not rely only on frontend validation.

---

## 6. Configuration

Use environment variables for runtime configuration. Do not hardcode production values in Python or JavaScript.

Important variables:

```text
MODEL_BACKEND=echo|http|slimx|direct_toaster
MODEL_HTTP_URL=http://model-service/generate
MODEL_HTTP_TIMEOUT=120

LLM_PROVIDER=toaster|gemma|openai|ollama|...
LLM_MODEL=babygpt-152m
LLM_TIMEOUT=120
LLM_RETRIES=1
LLM_MAX_TOKENS=128
LLM_TEMPERATURE=0.8
MAX_HISTORY_MESSAGES=8
SYSTEM_PROMPT="..."

# Optional future larger-model controls
LLM_CONTEXT_WINDOW=8192
LLM_MAX_INPUT_TOKENS=6144
LLM_STOP_SEQUENCES=""
LLM_ENABLE_STREAMING=0

TOASTER_CONFIG_PATH=/app/model/babyGPT/babyGPT_152M_config
TOASTER_CHECKPOINT_PATH=/models/babyGPT_152M
TOASTER_DEVICE=auto|cpu|cuda|mps
TOASTER_TOP_K=35
TOASTER_TEMPERATURE=0.8
TOASTER_MAX_NEW_TOKENS=128
TOASTER_DO_SAMPLE=1
TOASTER_RETURN_FULL_TEXT=0
TOASTER_STOP_ON_EOT=1
TOASTER_STRICT_LOAD=1

TORCH_NUM_THREADS=2
OMP_NUM_THREADS=2
MKL_NUM_THREADS=2
STATIC_DIR=static
LOG_LEVEL=INFO
```

The optional `LLM_CONTEXT_WINDOW`, `LLM_MAX_INPUT_TOKENS`, `LLM_STOP_SEQUENCES`, and `LLM_ENABLE_STREAMING` variables are proposed future configuration names. Do not rely on them until implemented.

When adding new configuration, document it in README and keep `.env.example` updated if present.

---

## 7. Docker and deployment rules

### 7.1 Docker image

The Docker image should:

- install only required runtime dependencies;
- avoid shipping large model checkpoints;
- copy app, config, model code, tokenizer helpers, static UI, and entrypoints;
- run Uvicorn on `PORT`, default `8080`;
- expose only the intended port;
- avoid unnecessary build cache and package manager leftovers.

Prefer pinned or compatible dependency versions for production reproducibility.

If serving a larger Gemma-class model externally, keep the chat app image separate from the model-serving image. Do not add large GPU dependencies to the chat app image unless this is an explicit architectural decision.

### 7.2 Production Compose

The production Compose file should:

- use the GHCR image;
- mount local model files read-only only when using local model runtime;
- set `MODEL_BACKEND` and `LLM_PROVIDER` according to the chosen deployment mode;
- keep model paths/configuration configurable;
- define restart behavior;
- add health checks if possible;
- bind to localhost if a reverse proxy terminates TLS.

For an external Gemma-class service, Compose may include a separate service or point to an existing model server. Keep the app-to-model URL in `MODEL_HTTP_URL` or provider-specific environment variables.

### 7.3 Deployment script

`deploy/deploy.sh` should be safe, explicit, and fail loudly.

Preferred behavior:

- require `GHCR_OWNER`;
- prefer an immutable `IMAGE_TAG` instead of mutable `latest`;
- optionally log in to GHCR when credentials are provided;
- pull the target image;
- start the updated container;
- poll `/health` or `/healthz` before declaring success;
- print container logs if startup fails;
- avoid deleting useful debug information before health verification.

### 7.4 GitHub Actions

The CI/CD workflow should:

- build on `main` and manual dispatch;
- tag images with immutable commit SHA tags;
- optionally also tag `latest`, but not depend on it for deployment;
- copy deployment files to the server before running the remote deploy script;
- pass the exact image tag to the server;
- use concurrency to prevent overlapping deployments;
- avoid printing secrets;
- fail if deployment health checks fail.

---

## 8. Security and privacy rules

- Never log full prompts, full conversations, selected comment excerpts, API keys, SSH keys, or tokens.
- Log metadata such as message count, prompt length, backend, elapsed time, and lane/mode only when useful.
- Do not expose stack traces to users in production responses.
- Use `textContent` for model/user text in the browser.
- Validate request shape and size server-side.
- Keep secrets in GitHub Actions secrets or server-side environment files, never in the repository.
- Do not make model checkpoints public unless the owner explicitly decides to publish them.
- Treat selected comments as potentially sensitive because users may highlight specific private fragments.

---

## 9. Dependency policy

Before adding a dependency, ask whether it is necessary.

Avoid adding:

- Gradio;
- frontend frameworks;
- large UI libraries;
- unused ML libraries;
- packages that duplicate standard-library functionality.

When dependencies are added:

- update the appropriate requirements file;
- prefer pinned or compatible versions;
- document why the dependency is needed;
- test a clean install.

For a larger Gemma-class backend, avoid adding heavyweight serving dependencies to the chat app unless the chosen design is an in-process provider. Prefer external service integration first.

---

## 10. Required checks before committing

Run the checks that are relevant to the changed files.

### 10.1 Always run for Python changes

```bash
python -m py_compile server.py app/main.py app/schemas.py app/slimx_gateway.py app/providers/toaster_provider.py app/runtime/toaster_runtime.py
```

If tests exist:

```bash
python -m pytest
```

### 10.2 Always run for frontend JavaScript changes

```bash
node --check static/app.js
```

If browser tests are added:

```bash
npm test
# or the documented Playwright/Vitest command
```

### 10.3 Always run for shell changes

```bash
bash -n deploy/deploy.sh
```

### 10.4 Always run before final commit

```bash
git diff --check
git status --short
```

### 10.5 Recommended smoke test

Echo mode:

```bash
MODEL_BACKEND=echo uvicorn server:app --host 127.0.0.1 --port 8080
```

Then in another terminal:

```bash
curl --fail http://127.0.0.1:8080/health
curl --fail -X POST http://127.0.0.1:8080/api/chat   -H 'Content-Type: application/json'   -d '{"messages":[{"role":"user","content":"Hello"}],"max_new_tokens":16}'
```

### 10.6 Comment-feature smoke test

In the browser:

1. Send a main-thread message and wait for an assistant response.
2. Select part of the assistant response.
3. Click **Ask about this**.
4. Ask a question in the comment panel.
5. Open the context panel and confirm it shows isolated comment context only.
6. Collapse the comment.
7. Confirm the highlight/chip remains attached to the original assistant answer.
8. Reopen the comment and confirm the comment thread is still available.

### 10.7 Model-switching smoke test

When adding or changing a model backend:

```bash
MODEL_BACKEND=echo uvicorn server:app --host 127.0.0.1 --port 8080
```

Then test the same `/api/chat` payload with:

```text
mode=main
mode=deep
mode=comment
```

If using an external Gemma-class model service, also test:

```bash
MODEL_BACKEND=http MODEL_HTTP_URL=http://127.0.0.1:PORT/PATH uvicorn server:app --host 127.0.0.1 --port 8080
```

Confirm the frontend does not need model-specific changes.

### 10.8 Docker checks when Docker is available

```bash
docker build -t slimx-chat-canvas:test .
docker run --rm -p 8080:8080 -e MODEL_BACKEND=echo slimx-chat-canvas:test
```

Then test `/health` and `/api/chat`.

---

## 11. Development workflow for agents

1. Inspect the current branch and repository status:

```bash
git status --short --branch
git remote -v
git branch --all --verbose --no-abbrev
```

2. Do not overwrite user work. If there are uncommitted changes, inspect them before editing.

3. Prefer small, focused commits. Do not mix unrelated frontend, backend, deployment, and documentation changes unless the task explicitly requires a broad hardening pass.

4. Keep changes consistent with the no-Gradio architecture.

5. Update README when commands, environment variables, deployment behavior, model backend behavior, or API contracts change.

6. Include test results in the final response or PR summary.

7. If a check cannot be run, state exactly why. Examples: Docker unavailable, package index unavailable, checkpoint missing, external model server unavailable.

8. Never claim a deployment or push succeeded unless it actually succeeded.

---

## 12. Branch and PR guidance

Use descriptive branches, for example:

```text
fix/pending-context-filter
feat/comment-anchors
feat/gemma-provider
feat/http-model-backend
feat/deep-dive-ui
chore/deploy-healthcheck
chore/add-agents-md
```

Commit messages should be direct:

```text
Fix pending assistant messages leaking into context
Preserve isolated context for selected-text comments
Add HTTP backend configuration for Gemma-class model serving
Add deployment health check
Document agent development rules
```

For PR summaries, include:

- what changed;
- why it changed;
- tests run;
- checks that could not be run;
- deployment notes if relevant;
- model-serving assumptions if relevant.

When resolving conflicts, do not switch branches mid-merge. Resolve or abort the merge first:

```bash
git status
git merge --abort  # only if abandoning the merge
git reset --hard HEAD  # only if local conflicted changes can be discarded
```

---

## 13. Guidance for the next major step: stronger model serving

The next major architecture step is to keep SlimX Chat Canvas as the interaction/canvas layer and connect it to a stronger model behind a stable provider or HTTP boundary.

Preferred staged plan:

1. Keep current Toaster path working.
2. Add a mock external model endpoint test using `MODEL_BACKEND=http`.
3. Define the exact request/response contract expected from the external model server.
4. Add a Gemma-class provider or HTTP adapter without changing frontend code.
5. Add prompt/context budgeting for long main/deep/comment histories.
6. Add streaming only after non-streaming behavior is stable.
7. Add deployment documentation for the selected model-serving stack.
8. Add tests that prove `main`, `deep`, and `comment` modes all work with the new backend.

Do not start by rewriting the frontend or replacing the app architecture. The frontend already sends the right high-level concepts: structured messages, lane metadata, mode, and comment anchors. The model-serving layer should adapt to those concepts.

## 14. SlimX stack first policy

When implementing new capabilities, agents should prefer the SlimX stack whenever it is technically appropriate, maintainable, and consistent with the task.

Before introducing a new LLM wrapper, provider abstraction, RAG framework, tool-calling layer, or agent runtime, check whether the existing SlimX stack already provides the needed primitive.

Prefer `slimx` for LLM calls, provider registry, clients, messages, retries, middleware, streaming, tools, and structured output.

Prefer `SlimX-RAG` for ingestion, deterministic chunking, embeddings, indexing, retrieval, citation, evaluation, and reproducible RAGOps artifacts.

Do not add LangChain, LlamaIndex, Gradio, heavy agent frameworks, or new model wrappers by default. Add them only when there is a clear technical reason, the SlimX stack cannot reasonably cover the use case, and the trade-off is documented in the PR.


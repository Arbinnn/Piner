# Migrate Pine Script Execution to Backend

## Goal

Refactor the application so that **all Pine Script compilation and execution happen on the backend (Node.js)** instead of the frontend.

The frontend should become a thin client responsible only for displaying charts and interacting with the user.

---

## Current Architecture

Currently:

* Pine Script is entered in the frontend.
* The frontend transpiles/executes the script.
* The frontend generates indicator data points.
* Those points are plotted on Lightweight Charts.

This exposes the execution engine and indicator logic to the browser.

---

## Desired Architecture

```
Frontend
    │
    │ POST /api/pine/execute
    ▼
Node.js Backend
    │
    ├── Validate Pine Script
    ├── Compile/Transpile Pine Script
    ├── Execute against OHLCV data
    ├── Generate indicator outputs
    └── Return plot data
    ▼
Frontend
    └── Plot returned points on Lightweight Charts
```

The frontend must never execute Pine Script.

---

## Backend Responsibilities

Implement a Pine execution service that:

1. Accepts:

   * Pine Script
   * Symbol
   * Timeframe
   * Indicator inputs
   * Historical OHLCV candles

2. Compiles/transpiles the Pine Script.

3. Executes the indicator over the supplied candle history.

4. Produces exactly the same output currently produced by the frontend.

5. Returns only serializable JSON.

Example response:

```json
{
  "plots": [
    {
      "id": "EMA",
      "type": "line",
      "values": [
        {
          "time": 1700000000,
          "value": 201.53
        }
      ]
    }
  ]
}
```

---

## Frontend Responsibilities

Remove every piece of Pine execution logic.

The frontend should only:

* Send execution requests.
* Receive plot data.
* Render data on Lightweight Charts.
* Update indicators when settings change.

No indicator calculations should happen in the browser.

---

## API

Create:

```
POST /api/pine/execute
```

Request:

```json
{
  "script": "...pine code...",
  "symbol": "AAPL",
  "timeframe": "1D",
  "inputs": {},
  "bars": 5000
}
```

Response:

```json
{
  "plots": [
    ...
  ]
}
```

Include proper validation and error responses.

---

## Execution Engine

Reuse the existing Pine runtime and execution logic currently used by the frontend.

Do **not** rewrite indicator calculations.

Move the existing execution engine into a backend module with minimal changes so the output remains identical.

---

## Code Organization

Suggested structure:

```
backend/
    src/
        pine/
            compiler/
            runtime/
            executor/
            cache/
            types/

        routes/
            pine.ts

        services/
            pineExecutor.ts
```

---

## Compilation Cache

Avoid recompiling identical scripts.

Cache compiled scripts using a hash of:

* Pine Script
* Version
* Inputs (if applicable)

If the same script is executed again, reuse the compiled version.

---

## Performance

Design the execution engine so it can later support:

* Worker Threads
* Piscina
* BullMQ
* Redis caching

The API should remain compatible with future scaling.

---

## Security

* Never expose transpiled JavaScript to the frontend.
* Never expose runtime internals.
* Never expose helper libraries.
* Return only indicator outputs.

---

## Compatibility

The backend must produce identical values to the existing frontend implementation.

All existing indicators should continue working without modification.

---

## Deliverables

1. Backend Pine execution service.
2. REST API endpoint.
3. Refactored frontend using the API.
4. Removal of frontend execution logic.
5. Type-safe interfaces.
6. Error handling.
7. Caching support.
8. Clean, maintainable architecture.

The final behavior should be indistinguishable from the current application, except that all Pine Script execution occurs securely on the backend.

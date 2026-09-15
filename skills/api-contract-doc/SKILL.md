---
name: api-contract-doc
description: Writing API contract and change-summary documentation from source code, and publishing it to Confluence with `work doc`. Load when asked to document an API, write or update an API contract, produce a Confluence page for endpoints or a schema change, document what changed for another team, or hand a backend contract to frontend/mobile consumers.
---

# API contract docs

The purpose of one of these pages is that another team can build against the endpoint without reading your source or asking you questions. Everything below serves that.

## Read the code, always

Every fact in the page comes from source you have opened in this session. Not from the ticket description, not from an adjacent endpoint that looks similar, not from what the framework usually does.

Specifically, open and read:

| What | Where it usually lives |
|---|---|
| Method, path, router prefix | controller / route definition — and the module that mounts it |
| Auth requirement | guard, middleware, decorator; note the specific permission or role |
| Request shape | DTO / schema / validator — including which fields are optional and the validation rules |
| Response shape | serializer, response type, or the actual return statement |
| Error cases | thrown exceptions and the filter/handler that maps them to status codes |
| Gating | feature flags, API version prefixes, tenant restrictions |

The full path matters: a controller declaring `@Get(':id')` inside a module mounted at `/api/v2/students` is `GET /api/v2/students/:id`. Documenting the fragment is a common and expensive mistake — it's the kind of error a consumer only finds at integration time.

## Structure

Lead with what a consumer needs first:

1. **What it's for** — one or two sentences. Skip "This document describes".
2. **Endpoint** — method, full path, auth requirement.
3. **Request** — params, query, body. A table with field, type, required, notes. State the validation rules; "must be a positive integer" is worth more than "number".
4. **Responses** — success shape with a realistic example body, then each error case with its status code and when it fires.
5. **Behaviour worth knowing** — pagination defaults and caps, sorting, filtering, idempotency, rate limits, side effects. What isn't obvious from the shapes.
6. **Changes** — for an update to an existing contract: what changed, whether it breaks existing consumers, and what they need to do. Put this at the top instead of the bottom when the answer is "yes, it breaks".

Examples must be realistic. Real field names, plausible values, actual enum members from the code. A consumer copies your example into a test.

## Uncertainty

When the code is ambiguous, or you couldn't find something, write that in the page rather than filling the gap. "Sort order is unspecified in the handler — verify before relying on it" is useful. A confident invention is worse than a gap, because nobody checks it.

## Publishing

```
work doc api-contract <TICKET-KEY>          # preview, publishes nothing
work doc api-contract <TICKET-KEY> --yes    # publish, linked back to the ticket
work doc api-contract --file draft.md --title "..." --yes
```

Re-publishing the same title into the same space updates that page rather than creating a second one — so iterate freely, and prefer updating the canonical page over starting a new one.

No line anywhere in the page mentions how it was produced. It is the user's document.

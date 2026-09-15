# API contract — {{KEY}} {{SUMMARY}}

> Skeleton only. Replace every placeholder with what the source actually says.
> Ticket: {{URL}} · Branch: `{{BRANCH}}` · Repo: `{{REPO}}`

## What this is for

_One or two sentences: what a consumer uses this endpoint to do._

## Endpoint

| | |
|---|---|
| Method | `GET` |
| Path | `/api/v1/...` |
| Auth | _guard / permission / role, or "public"_ |

## Request

### Path parameters

| Name | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | |

### Query parameters

| Name | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | integer | no | 1 | |

### Body

| Field | Type | Required | Validation |
|---|---|---|---|
| | | | |

```json
{
}
```

## Responses

### Success — `200 OK`

```json
{
}
```

### Errors

| Status | When | Body |
|---|---|---|
| `400` | | |
| `401` | | |
| `404` | | |

## Behaviour worth knowing

- _Pagination defaults and caps, sorting, filtering, idempotency, side effects, rate limits._

## Changes in this release

- _What changed, whether it breaks existing consumers, and what they must do. Delete this section for a brand-new endpoint._

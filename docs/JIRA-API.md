# Jira API Reference

The `work` CLI uses the Jira REST API v3 with **Atlassian Document Format (ADF)** for all rich text content.

## ADF (Atlassian Document Format)

ADF is the primary format for writing comments, descriptions, and other rich text content to Jira. The CLI accepts:

1. **ADF objects** (preferred) — full control over formatting
2. **Markdown strings** — auto-converted to ADF for convenience

### ADF Structure

```javascript
{
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }
  ]
}
```

### ADF Helper Functions

Import from `lib/markup.mjs`:

```javascript
import {
  toAdf, // Normalize string or ADF to valid ADF
  validateAdf, // Throw if ADF structure is invalid
  isAdf, // Check if value is valid ADF
  adfText, // Create simple text paragraph
  adfParagraph, // Create paragraph with inline formatting
  adfDoc, // Create document from blocks
  adfCodeBlock, // Create code block
  adfHeading, // Create heading (level 1-6)
  adfBulletList, // Create bullet list
  adfOrderedList, // Create ordered list
  adfTable, // Create table
  adfPanel, // Create info/warning/error panel
  adfMention, // Create @mention
  adfEmoji, // Create emoji
  adfInlineCard, // Create smart link
  adfStatus, // Create status lozenge
  adfDate, // Create date node
  adfToText, // Convert ADF to plain text
} from "./lib/markup.mjs";
```

### Examples

**Simple text:**

```javascript
adfText("Hello world");
// → { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }] }
```

**Formatted paragraph:**

```javascript
adfParagraph([
  { text: "This is " },
  { text: "bold", marks: ["strong"] },
  { text: " and " },
  { text: "code", marks: ["code"] },
]);
// Creates: "This is **bold** and `code`"
```

**Code block:**

```javascript
adfCodeBlock("const x = 1;", "javascript");
```

**Bullet list:**

```javascript
adfBulletList(["First item", "Second item", "Third item"]);
```

**Table:**

```javascript
adfTable([
  ["Header 1", "Header 2"], // First row = headers
  ["Cell 1", "Cell 2"],
  ["Cell 3", "Cell 4"],
]);
```

**Panel (info box):**

```javascript
adfPanel("info", "This is an informational message");
adfPanel("warning", "This is a warning");
adfPanel("error", "This is an error");
adfPanel("success", "This is a success message");
adfPanel("note", "This is a note");
```

**Full document:**

```javascript
adfDoc([
  adfHeading(2, "Summary"),
  adfParagraph([{ text: "This PR adds new features." }]),
  adfHeading(3, "Changes"),
  adfBulletList([
    "Added new API endpoint",
    "Fixed bug in validation",
    "Updated documentation",
  ]),
  adfCodeBlock("npm install", "bash"),
]);
```

---

## Jira Operations

### Reading

| Function                          | Description                      |
| --------------------------------- | -------------------------------- |
| `getIssue(profile, key)`          | Get full issue details           |
| `search(profile, jql, opts)`      | Search issues with JQL           |
| `getComments(profile, key, opts)` | Get all comments on an issue     |
| `getTransitions(profile, key)`    | Get available status transitions |
| `getAttachments(profile, key)`    | Get issue attachments            |
| `getWatchers(profile, key)`       | Get issue watchers               |
| `getRemoteLinks(profile, key)`    | Get remote links on an issue     |

### Writing

| Function                                       | Description                     |
| ---------------------------------------------- | ------------------------------- |
| `createIssue(profile, opts)`                   | Create a new issue              |
| `updateIssue(profile, key, fields)`            | Update issue fields             |
| `deleteIssue(profile, key, opts)`              | Delete an issue                 |
| `addComment(profile, key, body)`               | Add a comment (ADF or Markdown) |
| `updateComment(profile, key, commentId, body)` | Update a comment                |
| `deleteComment(profile, key, commentId)`       | Delete a comment                |
| `transition(profile, key, target)`             | Move issue to new status        |
| `assignIssue(profile, key, accountId)`         | Assign issue to user            |
| `unassignIssue(profile, key)`                  | Remove assignee                 |
| `addWorklog(profile, key, time, comment)`      | Log time against issue          |

### Attachments

| Function                                                   | Description       |
| ---------------------------------------------------------- | ----------------- |
| `addAttachment(profile, key, file, filename, contentType)` | Upload attachment |
| `deleteAttachment(profile, attachmentId)`                  | Delete attachment |

### Links

| Function                                     | Description              |
| -------------------------------------------- | ------------------------ |
| `linkIssues(profile, inward, outward, type)` | Link two issues          |
| `deleteIssueLink(profile, linkId)`           | Remove issue link        |
| `getLinkTypes(profile)`                      | Get available link types |
| `addRemoteLink(profile, key, link)`          | Add external URL link    |
| `deleteRemoteLink(profile, key, linkId)`     | Remove remote link       |

### Bulk Operations

| Function                                | Description                   |
| --------------------------------------- | ----------------------------- |
| `bulkTransition(profile, keys, target)` | Transition multiple issues    |
| `bulkAddLabels(profile, keys, labels)`  | Add labels to multiple issues |
| `bulkAssign(profile, keys, accountId)`  | Assign multiple issues        |

### Metadata

| Function                             | Description                           |
| ------------------------------------ | ------------------------------------- |
| `getProjects(profile, opts)`         | List projects                         |
| `getIssueTypes(profile, projectKey)` | Get issue types for project           |
| `getPriorities(profile)`             | Get available priorities              |
| `getStatuses(profile, projectKey)`   | Get statuses for project              |
| `getComponents(profile, projectKey)` | Get project components                |
| `getVersions(profile, projectKey)`   | Get project versions                  |
| `getFields(profile)`                 | Get all Jira fields                   |
| `searchUsers(profile, query, opts)`  | Search for users                      |
| `getAssignableUsers(profile, opts)`  | Get users assignable to project/issue |

### Agile (Boards & Sprints)

| Function                                   | Description           |
| ------------------------------------------ | --------------------- |
| `getBoards(profile, opts)`                 | List boards           |
| `getSprints(profile, boardId, opts)`       | Get sprints for board |
| `getSprintIssues(profile, sprintId, opts)` | Get issues in sprint  |
| `getBoardBacklog(profile, boardId, opts)`  | Get backlog issues    |

---

## Error Handling

The HTTP client includes:

- **Automatic retries** for transient errors (429, 5xx, timeouts)
- **Exponential backoff** with jitter
- **Rate limiting** (respects `Retry-After` headers)
- **Detailed error messages** with hints

### Retryable Errors

- `429 Too Many Requests` — rate limited, auto-retried
- `500-504` — server errors, auto-retried
- `408 Request Timeout` — auto-retried
- Network errors (ECONNRESET, ETIMEDOUT) — auto-retried

### Configuration

Default settings in `lib/http.mjs`:

```javascript
{
  requestsPerSecond: 10,    // Max requests per second per host
  minDelayMs: 100,          // Minimum delay between requests
  maxRetries: 3,            // Max retry attempts
  retryDelayMs: 1000,       // Base delay for backoff
  timeout: 30000,           // Request timeout (30s)
}
```

---

## Usage from CLI Commands

### Comment with ADF

```javascript
import { addComment } from "./lib/jira.mjs";
import { adfDoc, adfHeading, adfBulletList } from "./lib/markup.mjs";

await addComment(
  profile,
  "STR-1234",
  adfDoc([
    adfHeading(3, "PR Ready"),
    adfBulletList([
      "All tests passing",
      "Documentation updated",
      "Ready for review",
    ]),
  ]),
);
```

### Comment with Markdown (auto-converted)

```javascript
await addComment(
  profile,
  "STR-1234",
  `
### PR Ready

- All tests passing
- Documentation updated
- Ready for review
`,
);
```

### Create Issue

```javascript
import { createIssue } from "./lib/jira.mjs";

await createIssue(profile, {
  project: "STR",
  type: "Task",
  summary: "Implement new feature",
  description: adfDoc([adfParagraph([{ text: "This task covers..." }])]),
  priority: "High",
  labels: ["backend", "api"],
  assignee: "557058:...", // accountId
});
```

### Bulk Transition

```javascript
import { bulkTransition } from "./lib/jira.mjs";

const result = await bulkTransition(
  profile,
  ["STR-1234", "STR-1235", "STR-1236"],
  "Done",
);
console.log(
  `Success: ${result.success.length}, Failed: ${result.failed.length}`,
);
```

---

## Supported Markdown (when auto-converting)

The Markdown → ADF converter supports:

- Headings (`#` through `######`)
- Paragraphs
- Bullet lists (`-`, `*`, `+`)
- Ordered lists (`1.`, `2.`)
- Fenced code blocks (` ``` `)
- Tables
- Blockquotes (`>`)
- Horizontal rules (`---`)
- Inline marks: **bold**, _italic_, `code`, [links](url), ~~strikethrough~~

**Not supported** (use ADF directly):

- Nested lists (flattened to one level)
- Images/media
- @mentions (use `adfMention()`)
- Panels/info boxes (use `adfPanel()`)
- Status lozenges (use `adfStatus()`)

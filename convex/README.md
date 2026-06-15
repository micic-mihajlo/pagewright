# Convex Backend Notes

## Access gate

Set these Convex environment variables before using the backend:

```text
APP_PASSCODE=your-demo-passcode
DEMO_SESSION_TTL_HOURS=24
```

`sessions.validatePasscode` compares the submitted passcode to `APP_PASSCODE`, creates an opaque random token, stores only its SHA-256 hash in `demoSessions`, and returns the token to the client. Write mutations call the mutation session helper and update `lastUsedAt`; read queries call the read-only helper.

## HTML snapshots

Every `documentVersions` row has an `htmlStorageId` pointing at Convex File Storage. The optional `htmlText` field is only a bounded demo copy for fast preview/source retrieval:

```text
HTML_TEXT_INLINE_LIMIT_BYTES=750000
```

If the submitted text exceeds that limit, the version keeps only the storage ID, hash, byte size, and `htmlTextStorageMode="omitted_too_large"`.

## MVP data flow

1. Validate passcode with `sessions.validatePasscode`.
2. Call `documents.generateUploadUrl` with the session token.
3. Upload the HTML blob to Convex File Storage.
4. Call `documents.createDocumentFromHtml` with the returned storage ID, hash/byte metadata, and optional small `htmlText` copy.
5. Use `documents.createEditRun`, `recordPatchOps`, `recordModelCall`, `recordValidationResult`, `createVersion`, and `replaceSectionIndex` as the AI/action pipeline advances.
6. Use `documents.revertToVersion` for deterministic reverts; it creates a new version and does not call a model.

The backend records route/status, patch operations, validation outcomes, model-call metadata, chat messages, and section-index rows so the UI can expose the workflow internals required by the MVP.

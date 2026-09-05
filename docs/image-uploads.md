# Profile pictures and team logos

Connect a **public** Vercel Blob store to the project's Production, Preview, and Development environments. Set the server-only `BLOB_READ_WRITE_TOKEN` locally and in deployments. Do not use a `NEXT_PUBLIC_` variable. Use a separate store/database for isolated previews when needed. Run migration `0032_profile_team_images.sql` before deploying this version; authentication reads its avatar override column. Controls show a configuration message when storage or the database is unavailable.

The browser sends a raw image body to `PUT /api/v1/profile/image` or `PUT /api/v1/teams/{teamId}/image`; `DELETE` removes it. Both require a session or a scoped bearer token (`write:profile` / `write:team`). Team access follows existing manager/commissioner permissions. URLs are public; the upload UI explains this. No file-list or arbitrary-upload endpoint is exposed.

- Input: JPG, PNG, or WebP, at most 4 MiB and 20 million pixels. Corrupt and animated files are rejected. The streamed body is bounded even without a trustworthy Content-Length header.
- Storage: auto-oriented, metadata-stripped WebP, at most 256 pixels on either side and 100 KiB. Original aspect ratio and transparency are retained. Originals are never uploaded to Blob.
- Unique URLs avoid stale replacement images. Replacements/removals attempt to delete the prior owned blob; login-provider URLs are never deleted. A failed cleanup or interrupted database write can leave an unreferenced blob; monitor logs and reconcile such blobs against database references before deleting them.
- Mutations are audited and limited to 10 per account per hour with the existing per-process limiter. This is an abuse brake, not a distributed billing quota; use Vercel spend controls for an account-wide budget.
- Custom avatars, including explicit removal, take precedence over login-provider image sync.

Local checks use real image decoding and mocked Blob operations, without uploading fixtures to a shared store.

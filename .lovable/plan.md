## Diagnosis

The current failure is not the earlier `Deal not found` path. The backend can see the file `DL-2026-0250`, and previous RE851D runs succeeded.

The current active RE851D template was replaced at `18:05` with `1778609126890_RE851D-V12.1.docx`, which is about `3.9 MB`. The prior successful RE851D template files were about `0.44 MB`. The latest run is stuck in `running` and the function logs show `CPU Time exceeded` while processing a very large `word/document.xml`.

## Plan

1. Mark the currently stale RE851D generation job as failed so the UI stops showing it as still running.
2. Restore the active RE851D template pointer to the last known-good uploaded template file (`1778608791266_Re851d_v1__1___2___19___5_.docx`) without changing schema or document-generation flow.
3. Keep the existing `generate-document` API and UI unchanged.
4. Re-test the deployed `generate-document` function against file `a4eefafb-cd04-4bf5-adb8-f432d79e0e65` and template `43492f94-60ad-44c3-a8c2-24dabf36eac7`.
5. Verify the new job reaches `success` and a fresh generated document row is created.

## Technical details

- No database schema changes.
- No new tables.
- No UI changes.
- No edge-function refactor unless the restored template still fails.
- This is a data/config recovery: update the `templates.file_path` for RE851D and clean up the stale `generation_jobs` row.

## Rollback

If needed, the template pointer can be returned to `1778609126890_RE851D-V12.1.docx`, but that file is the one currently triggering CPU timeout.
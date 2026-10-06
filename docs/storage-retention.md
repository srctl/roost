# Storage retention

Roost's updater takes a complete data snapshot before switching releases. Without retention, these snapshots, bundled releases, and Codex diagnostic databases accumulate independently of your conversations.

Enable the opt-in policy with `roost storage enable`. Inspect it with `roost storage plan`, and run it immediately with `roost storage apply`. While Roost is running, it attempts maintenance hourly in a separate process. Updates also run retention after the new release passes health checks. Maintenance skips active agent runs, resumable coding jobs, updates, and maintenance fences.

The supported defaults retain one verified rollback snapshot, the current release and its previous release, and seven days of diagnostic logs with a 256 MiB content budget per agent. SQLite indexes, free pages, and write-ahead logs can temporarily exceed the content budget. Incremental vacuum reclaims free pages in bounded passes. This is not a hard limit on total VM storage: conversations, memories, native thread history, sessions, files, workspaces, and test containers are preserved.

A backup becomes eligible to replace the retained rollback snapshot only after the updater completes its full copy and the successor passes health checks. A separate private receipt records its source version and database/WAL digest. If the newest backup lacks a valid receipt, retention leaves all backup directories and the releases needed to restore them. Unknown directories, failed-update data, future releases, symlinks, and manual rollback JSON files are preserved.

For snapshots created by older Roost versions, first confirm that the full updater copy completed, the successor is healthy, and the backup is the intended rollback baseline. Then run `roost storage register-backup <snapshot-directory-name> <healthy-successor-version>`. Registration checks the source/current releases and backup database integrity and creates a private receipt; database integrity alone cannot prove a legacy full copy completed. Run `roost storage plan` before applying.

Remove `ROOST_HOME/storage-policy.json` to disable automatic pruning. The installation defaults to `~/.local/share/roost`. Package caches and disposable test containers need separate operator cleanup; this policy does not delete them.

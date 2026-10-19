# Use Node's built-in SQLite integration on ARMv7

For the 50–100-song read-mostly catalog, use node:sqlite on Node >=22.13 instead of adding a native SQLite addon with no official ARMv7 prebuilt binary. This removes an extra source-build/toolchain dependency from image reproduction; accept that the Node 22 SQLite API remains in active development, isolate access behind a small module, and test against the pinned runtime. Keep prepared catalog queries bounded and run schema/manual maintenance outside active streaming sessions.

Sources: [Node 22 SQLite API](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html), [better-sqlite3 build matrix](https://github.com/WiseLibs/better-sqlite3/blob/master/.github/workflows/build.yml).

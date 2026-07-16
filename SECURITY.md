# Security policy

[← Project README](README.md) · [Architecture and privacy](docs/OPEN_SOURCE_READINESS.md)

## Reporting a vulnerability

Do not post credentials, Pi authentication files, private session transcripts, source code, or verbose RPC diagnostic bundles in a public issue.

For a security-sensitive report, contact the repository owner privately through GitHub. Include only the minimum redacted information needed to verify the problem:

- affected PiTTy version;
- operating system and terminal;
- Pi and Bun versions;
- clear reproduction steps;
- expected and observed behavior;
- sanitized logs or screenshots when essential.

## Sensitive data

PiTTy launches Pi and installed Pi extensions with the user's normal system permissions. Review third-party Pi packages before installing them.

Normal diagnostics omit full prompt, source, and tool-output contents, but paths and error snippets can remain. Always inspect a diagnostics archive before sharing it. Treat `--verbose-rpc-logs` as sensitive because it may contain prompts, tool output, or source code.

PiTTy does not need contributors to provide credentials or private session data to reproduce normal UI defects.

# @workitem3/agent-common

Dependency-free shared helpers used by the generation, review, and WPF SRE agents:

- deterministic JSON serialization and SHA-256 fingerprints;
- recursive redaction for credential-shaped values and structured logging;
- Kubernetes resource-name validation and environment-list parsing;
- atomic JSON-file persistence (sync and async variants).

Run the package tests with `node --test packages/agent-common/test/*.test.js` from the repository root.

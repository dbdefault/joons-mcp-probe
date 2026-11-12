# Contributing

## Development setup

Use Node.js 20, 22, or 24. Clone the repository and run `npm ci` to install the locked dependencies. No build step is required.

## Tests

Run `node scripts/test.js` for all top-level test files. Pass one or more filename substrings, such as `node scripts/test.js args`, to select matching files. The runner does not collect fixtures as tests. Run the relevant tests before submitting a change.

## File layout

- `bin/`: command-line entry point.
- `src/`: CLI, probe, transports, checks, reporting, and redaction.
- `test/`: module tests; `test/fixtures/` contains test servers and helpers.
- `scripts/`: development utilities.
- `examples/`: example servers and usage.

## Coding rules

Use JavaScript ES modules and the built-in Node test framework. Discuss new runtime dependencies before adding them. The read-only guarantee must never be weakened: inspection must not call tools or read resources or prompts. Add tests for every finding and failure kind, including changes to their behavior. Treat server data as untrusted, preserve redaction, and clean up processes.

Use simple, descriptive commit messages; conventional commit prefixes are not required. To propose a feature, open an issue describing the problem, intended behavior, and security implications before implementing a substantial change. Small fixes can be proposed in a pull request with an explanation and tests.

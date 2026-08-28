# claude-profiler investigation

## Scope

I checked out [`jhammant/claude-profiler`](https://github.com/jhammant/claude-profiler) into `/tmp/claude-profiler` and explored it without committing a full copy of the repository here.

## What it is

`claude-profiler` is a small Node.js command-line tool for mining local Claude Code transcript history. Its README describes the purpose as scanning `~/.claude/projects` for recurring habits and standing instructions, then proposing additions for `CLAUDE.md`, possible skill stubs, and visibility mechanisms for accepted rules.

The project is intentionally lightweight:

- Node.js ESM package with zero runtime dependencies.
- CLI binary named `claude-profiler`.
- Uses Node's built-in `node:test` runner.
- Reads Claude history locally and writes proposal reports, but does not automatically edit `~/.claude/CLAUDE.md` or install skills.

## How it works

The implementation is split into a few focused modules:

- `src/scan.mjs` walks a Claude projects root, reads `*.jsonl` transcript files, and extracts only likely human user messages. It skips malformed JSON, assistant/system/attachment records, sidechain messages, synthetic command/system prefixes, SDK/system prompt sources, and tool-result-only content.
- `src/patterns.mjs` performs dependency-free lexical mining. It normalizes text, strips conversational filler, clusters repeated directive openings such as `look in`, `don't`, `always`, `never`, `make sure`, and `commit only`, detects workflow-style asks such as `write tests`, and records correction/friction phrases such as `no, I meant`.
- `src/suggest.mjs` converts mined patterns into user-reviewable outputs: `CLAUDE.md` bullet candidates, proposed skill stubs, friction/correction summaries, and markdown reports.
- `src/rules.mjs` manages an accepted `learned-rules.json` file and formats active rules for display.
- `src/cli.mjs` wires those modules into `scan`, `suggest`, `rules`, and `--version` commands.
- `hooks/session-start.sh` is a Claude Code hook helper that prints accepted learned rules at session start.

## Commands I ran

From `/tmp/claude-profiler`:

```sh
npm test
node src/cli.mjs scan --root test/fixtures
node src/cli.mjs suggest --root test/fixtures --json
node src/cli.mjs suggest --root test/fixtures --out /tmp/claude-profiler-fixture-report.md
CLAUDE_PROFILER_RULES="$tmp/rules.json" node src/cli.mjs rules list
CLAUDE_PROFILER_RULES="$tmp/rules.json" node src/cli.mjs rules add "Look in ~/dev first"
CLAUDE_PROFILER_RULES="$tmp/rules.json" node src/cli.mjs rules list
```

## Test results

`npm test` passed all bundled tests: 20 subtests passed, 0 failed. npm printed a warning about an unknown `http-proxy` env config and an npm update notice, but neither affected the tests.

The tests cover:

- Transcript scanning and filtering.
- Text extraction from string and array message content.
- Defensive behavior on malformed JSON lines.
- Directive/workflow/correction mining.
- Suggestion rendering and report writing.
- Learned-rule load/add/remove/list behavior.

## Manual poking results

Using the bundled synthetic fixtures:

- `scan` reported 2 transcript files, 2 sessions, and 10 human messages.
- `suggest --json` produced:
  - two proposed `CLAUDE.md` additions:
    - default to looking in `~/dev` first;
    - do not apply changes without asking first;
  - one proposed skill named `write-tests`;
  - one friction pattern for `no, I meant...` corrections.
- `suggest --out` generated a coherent markdown report with sections for proposed `CLAUDE.md` additions, skills, friction/corrections, and learned-rule visibility.
- `rules list/add/list`, pointed at a temporary `CLAUDE_PROFILER_RULES` path, correctly started empty, added a rule, deduplicated through the module tests, and printed the active rule with the current date.

## Thoughts and assessment

Overall, this repository does what it claims: it is a local, deterministic profiler for Claude Code history that turns repeated user phrasing into reviewable configuration ideas. I like that it is read-only for history, avoids network calls in its own code, and separates "suggestions" from "accepted rules" so it does not silently rewrite user preferences.

Strengths:

- Simple architecture that is easy to audit.
- No runtime dependencies, which helps privacy and installability.
- Good defensive parsing around JSONL transcripts.
- Tests are meaningful and use fixtures rather than real user history.
- The output format is practical: copy-pasteable `CLAUDE.md` bullets plus evidence counts and example snippets.

Limitations / risks:

- Pattern mining is lexical and heuristic-based. That makes it understandable, but it will miss semantically equivalent phrasing that does not match the known openings/verbs.
- Confidence is based only on frequency thresholds, not on semantic certainty or whether examples might be context-specific rather than standing preferences.
- The generated report can include snippets from private prompts. The README warns about this, and users should treat output as sensitive.
- There is no fixture or test specifically for the `hooks/session-start.sh` script in the current suite.
- It assumes Claude Code transcript shape stays close to the current JSONL format; substantial upstream format changes would require updates to `scan.mjs`.

## Possible improvements

- Add tests for `hooks/session-start.sh` with temporary rules files.
- Add an option to redact or hash example snippets in generated reports for safer sharing.
- Add a `--min-count` CLI option so users can tune sensitivity without editing code.
- Include a dry-run summary for default `suggest` before writing, or add `--stdout` for users who do not want report files.
- Expand fixture coverage for more transcript shapes, especially newer Claude Code metadata fields if they appear.

## Conclusion

`claude-profiler` is a compact, useful utility for reflecting on repeated Claude Code interactions. In my testing, it passed its test suite and behaved as advertised against the included fixtures. I would be comfortable trying it on a private local history directory, with the caveat that generated reports may contain sensitive prompt excerpts and should be reviewed before sharing.

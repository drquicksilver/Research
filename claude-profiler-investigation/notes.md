# Notes

- Created investigation folder.
- Cloned https://github.com/jhammant/claude-profiler.git into /tmp/claude-profiler for exploration (outside final committed folder).
- Repository contains a small Node.js CLI under src/ plus node:test suites under test/.
- Read README/package/source. Purpose: mine Claude Code JSONL transcripts for recurring user directives, workflows, and corrections; output proposal report and manage learned rules.
- Ran npm test successfully: 20 node:test subtests passed. npm emitted only an env config warning and update notice.
- Exercised CLI against bundled fixtures: scan reported 2 files, 2 sessions, 10 human messages; suggest --json produced two CLAUDE.md suggestions, one write-tests skill, and one correction pattern.
- Exercised rules CLI using CLAUDE_PROFILER_RULES pointed at a temp file; list/add/list worked and stamped the rule with current date.
- Generated an example markdown suggestion report from fixtures to inspect final report formatting.

# Investigation notes

- 2026-08-27: Created the investigation folder before beginning repository exploration, per instructions.
- 2026-08-27: Located and read `/workspace/Research/AGENTS.md`; it matches the supplied investigation and deliverable requirements.
- 2026-08-27: Cloned `https://github.com/ChatPRD/lennys-podcast-transcripts` into `/tmp/lennys-podcast-transcripts.GoBv7p` at commit `be8ab89a890a833cbba2c892178f823fff178c65`; kept the fetched repository outside the deliverable.
- 2026-08-27: Read the upstream README and CLAUDE.md. Learned that every episode has a single Markdown transcript whose YAML frontmatter includes `guest`, `title`, `video_id`, and `publish_date`; these fields provide a direct interviewee-to-episode mapping.
- 2026-08-27: Counted 303 transcript files. PyYAML was not installed, so the first Python parsing attempt failed; switched to Ruby's standard-library YAML parser rather than installing a dependency.
- 2026-08-27: Exact duplicate guest strings found only Andy Raskin and Casey Winters, revealing that exact matching is insufficient because repeat appearances are frequently labeled `Name 2.0` (and, for Elena Verna, up to `4.0`).
- 2026-08-27: Audited numeric-suffix folders and video IDs. Found numerous duplicate records, including Andy Raskin and several `2.0` entries, so counting folders would create false repeats. Chose the YouTube `video_id` as the episode identity and treated blank IDs as unique by path.
- 2026-08-27: Normalized only trailing appearance suffixes matching ` N.0`; avoided speculative fuzzy matching. Checked the three explicit joint guest values and found that none of their constituent people also had a separate distinct episode in the snapshot.
- 2026-08-27: Wrote a dependency-free Ruby reproduction script and the final README report. The analysis yields 10 repeat interviewees and 21 distinct episodes.
- 2026-08-27: Initial script validation exposed at least one transcript without a `title` field. Added a fallback to the transcript's level-one Markdown heading; this does not affect the repeat results but makes the full-archive scan robust.

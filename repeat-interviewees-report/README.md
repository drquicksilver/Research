# Repeat interviewees in Lenny's Podcast transcripts

## Result

I found **10 repeat interviewees across 21 distinct episodes** in the repository snapshot. The episode names below reproduce the `title` values in the transcript frontmatter; dates are included to disambiguate the appearances.

### April Dunford — 2 episodes

- 2023-01-22 — **How to nail your product positioning | April Dunford (Obviously Awesome)**
- 2023-10-22 — **A step-by-step guide to crafting a sales pitch that wins | April Dunford (author of Sales Pitch)**

### Bob Moesta — 2 episodes

- 2023-08-24 — **The ultimate guide to JTBD | Bob Moesta (co-creator of the framework)**
- 2025-02-23 — **How to find work you love | Bob Moesta (Jobs-to-be-Done co-creator, author of "Job Moves”)**

### Casey Winters — 2 episodes

- 2022-07-21 — **How to sell your ideas and rise within your company | Casey Winters, Eventbrite**
- 2023-04-14 — **Why most product managers are unprepared for the demands of a real startup | Casey Winters**

### Dylan Field — 2 episodes

- 2024-06-30 — **Dylan Field live at Figma's Config: Intuition, simplicity, and the future of design**
- 2025-10-16 — **Figma’s CEO: Why AI makes design, craft, and quality the new moat for startups | Dylan Field**

### Elena Verna — 3 episodes

- 2023-04-23 — **The ultimate guide to product-led sales | Elena Verna**
- 2025-01-19 — **10 growth tactics that never work | Elena Verna (Amplitude, Miro, Dropbox, SurveyMonkey)**
- 2025-12-18 — **The new AI growth playbook for 2026 | How Lovable hit $200M ARR in one year**

### Jen Abel — 2 episodes

- 2024-11-24 — **The ultimate guide to founder-led sales | Jen Abel (co-founder of JJELLYFISH)**
- 2025-11-09 — **$1M to $10M: The enterprise sales playbook with Jen Abel**

### Julie Zhuo — 2 episodes

- 2024-12-12 — **How To Win Friends & Influence Decisions (Julie Zhuo) | Lenny & Friends Summit 2024**
- 2025-09-21 — **From managing people to managing AI: The leadership skills everyone needs now | Julie Zhuo**

### Madhavan Ramanujam — 2 episodes

- 2022-12-08 — **The art and science of pricing | Madhavan Ramanujam (Monetizing Innovation, Simon-Kucher)**
- 2025-07-27 — **Pricing your AI product: Lessons from 400+ companies and 50 unicorns | Madhavan Ramanujam**

### Marty Cagan — 2 episodes

- 2023-02-06 — **The disease of process people | Marty Cagan**
- 2024-03-10 — **Product management theater | Marty Cagan (Silicon Valley Product Group)**

### Sander Schulhoff — 2 episodes

- 2025-06-19 — **AI prompt engineering in 2025: What works and what doesn’t | Sander Schulhoff**
- 2025-12-21 — **Why securing AI is harder than anyone expected and guardrails are failing | HackAPrompt CEO**

## How to identify each episode's interviewee

Each `episodes/<slug>/transcript.md` starts with YAML frontmatter. Its `guest` field is the repository's explicit interviewee label, while `title`, `publish_date`, and `video_id` identify the appearance. This is more reliable than inferring a name from the directory slug or parsing speaker labels from the transcript. For multi-person interviews, the `guest` value contains the people together (for example, `Hamel Husain & Shreya Shankar`).

The supplied script reads these fields from all 303 transcript files, removes the repository's appearance suffixes such as ` 2.0`, groups records by the resulting guest label, and retains groups with more than one distinct episode. Run it from this report directory with:

```bash
ruby find_repeat_interviewees.rb /path/to/lennys-podcast-transcripts
```

## Data-quality decisions and limitations

- **Distinctness is based on `video_id`, not the number of folders.** The snapshot contains duplicate transcript records. For example, `andy-raskin` and `andy-raskin_` have the same video ID, so Andy Raskin is not reported as a repeat interviewee. Several `2.0` records likewise duplicate the original video and were not counted.
- **Appearance suffixes are labels, not names.** Values such as `April Dunford 2.0` and `Elena Verna 4.0` were normalized by removing the trailing version marker. No other fuzzy name matching was applied.
- **The report follows the structured `guest` metadata.** It does not count a host, a person merely mentioned, or a speaker appearing within an event transcript unless that person is named in `guest`.
- **Joint guest values are kept as the repository represents them.** None of the individuals in the three joint-interview guest values also has a separate, distinct appearance in this snapshot, so splitting those values would not change the repeat list.
- **Snapshot:** Git commit `be8ab89a890a833cbba2c892178f823fff178c65` (the checked-out `main` revision at investigation time, 2026-08-27). The source repository was cloned only into a temporary directory and was not modified or copied into this deliverable.

## Reproducibility summary

The investigation counted 303 `episodes/*/transcript.md` files, parsed their YAML, normalized only the documented numeric appearance suffix, and deduplicated records by nonblank YouTube video ID. The script's output exactly matches the 10 sections and 21 episode bullets above.

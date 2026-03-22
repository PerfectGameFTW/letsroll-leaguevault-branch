## gstack

### Setup (required for each teammate)
```bash
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```
> **Windows users:** Node.js is required. Install from https://nodejs.org/ before running setup.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
- `/office-hours` — structured Q&A / mentorship session
- `/plan-ceo-review` — review a plan from a CEO perspective
- `/plan-eng-review` — review a plan from an engineering perspective
- `/plan-design-review` — review a plan from a design perspective
- `/design-consultation` — consult on design decisions
- `/review` — code review
- `/ship` — ship a change end-to-end
- `/browse` — web browsing (use this for all web browsing)
- `/qa` — full QA pass
- `/qa-only` — QA without shipping
- `/design-review` — review UI/UX design
- `/setup-browser-cookies` — set up browser authentication cookies
- `/retro` — run a retrospective
- `/investigate` — investigate a bug or issue
- `/document-release` — document a release
- `/codex` — run a task in a sandboxed Codex environment
- `/careful` — extra-careful implementation mode
- `/freeze` — freeze a file from edits
- `/guard` — guard a file with review requirements
- `/unfreeze` — unfreeze a frozen file
- `/gstack-upgrade` — upgrade gstack to the latest version

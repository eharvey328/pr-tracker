# PR Tracker

A lightweight Node.js service that tracks GitHub PR lifecycle and posts smart notifications to Slack.

## What it does

- **Multi-channel support** — Run a single instance that serves multiple Slack channels, each tracking different repositories
- **Repo-to-channel mapping** — Use `/pr-tracker watch owner/repo` to route PR notifications to specific channels
- **Thread per PR** — Posts a parent message when a PR is opened. All updates appear as threaded replies
- **Status tracking** — Parent message updates with current status: Ready for Review → Changes Requested → Approved → Merged
- **Comment reply notifications** — Thread replies when someone responds to review comments
- **Per-channel team maps** — Each channel has its own team configuration for `@mentions`

## Architecture

```
GitHub Enterprise (webhooks)  →  Express server  →  Multiple Slack channels
                                      ↕
                              JSON file (state)

Repo mapping: owner/repo → Slack channel ID
```

- Single server instance handles webhooks from all repositories
- Repo-to-channel mapping routes PRs to the correct Slack channel
- State held in memory with periodic JSON file backup
- No database required

## Setup

### 4. Invite the bot to your Slack channel

Simply invite the bot to your desired channel:

```
/invite @PR Tracker
```

## Slash Commands

Use `/pr-tracker` in any channel to manage configuration:

### Repository Management

```
/pr-tracker watch owner/repo     — Start tracking a repository in this channel
/pr-tracker unwatch owner/repo   — Stop tracking a repository
/pr-tracker repos                — List all watched repositories
```

### Team Management

```
/pr-tracker add @SlackUser githubusername   — Add team member (for @mentions)
/pr-tracker remove githubusername           — Remove team member
/pr-tracker list                            — Show channel status and configuration
```

## PR Lifecycle

```
PR Opened (non-draft)
  → 🟢 Parent message posted: "Ready for Review"

Reviewer requests changes
  → 🔴 Parent updated: "Changes Requested"
  → Thread reply: "@reviewer requested changes"

Reviewer approves
  → ✅ Parent updated: "Approved"
  → Thread reply: "@reviewer approved this PR"

PR merged
  → 🟣 Parent updated: "Merged"
  → Thread reply: "PR merged!"
  → Thread deleted after 1 minute
```

## Notes

- **Draft PRs** are ignored until they're marked ready for review
- **Thread cleanup**: Parent messages are deleted 1 minute after merge/close to keep the channel clean
- **State recovery**: If the app restarts, it loads state from `data/store.json`, including the team configurations

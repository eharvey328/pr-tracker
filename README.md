# PR Tracker

A lightweight Node.js service that tracks GitHub PR lifecycle and posts smart notifications to Slack.

📦 **Deployment Guides:**

- **[Simple Kubernetes Deployment (Recommended)](SIMPLE_DEPLOYMENT.md)** - Quick 5-step deployment
- **[IBM One Pipeline](ONE_PIPELINE_DEPLOYMENT.md)** - Full CI/CD automation
- **[IBM Cloud Code Engine](DEPLOYMENT.md)** - Serverless deployment

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

### 2. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Add **Bot Token Scopes** under OAuth & Permissions:
   - `chat:write` (required - post messages)
   - `channels:read` (optional - only needed to display channel names in logs)
   - `im:write` (required - send DMs)
3. **Enable Event Subscriptions** under Event Subscriptions:
   - **Request URL:** `https://your-server:3000/slack/events`
   - **Subscribe to bot events:**
     - `member_joined_channel` (detects when bot is added to a channel)
4. Add a **Slash Command** under Slash Commands:
   - **Command:** `/pr-tracker`
   - **Request URL:** `https://your-server:3000/slack/commands`
   - **Short Description:** Manage PR tracker team members
5. **Install to workspace** (or request approval if required)
6. Copy the **Bot User OAuth Token** (`xoxb-...`)
7. Copy the **Signing Secret** from **Basic Information**

### 3. Configure the app

```bash
cp .env.example .env
```

Edit `.env`:

```env
# GitHub App Configuration
GITHUB_APP_ID=12345
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
GITHUB_WEBHOOK_SECRET=your-webhook-secret
GITHUB_ENTERPRISE_URL=https://github.yourcompany.com

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-signing-secret

# Server Configuration
PORT=3000
```

Place your GitHub App private key file as `private-key.pem` in the project root (or update the path in `.env`).

### 4. Invite the bot to your Slack channel

Simply invite the bot to your desired channel:

```
/invite @PR Tracker
```

### 5. Run

```bash
npm install
npm start
```

For development with auto-restart:

```bash
npm run dev
```

### 6. Configure repository watching

In each Slack channel, tell the bot which repositories to watch:

```
/pr-tracker watch facebook/react
/pr-tracker watch microsoft/typescript
```

### 7. Verify

1. Check the health endpoint: `curl http://localhost:3000/health`
2. Open a PR in a watched repository
3. You should see a notification in the corresponding Slack channel

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

**Per-channel configuration:** Each channel has its own:

- Watched repositories (PRs from these repos appear in this channel)
- Team map (GitHub username → Slack user for `@mentions`)

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

## Multi-Channel Architecture

### How it works

1. **One server, multiple channels:** A single PR Tracker instance can serve many Slack channels
2. **Repo-to-channel mapping:** Each repository can only be watched by one channel
3. **Independent teams:** Each channel maintains its own team map for `@mentions`
4. **Automatic routing:** When a PR webhook arrives, the server looks up which channel is watching that repo and posts there

### Example Setup

**#frontend-team channel:**

```
/pr-tracker watch mycompany/web-app
/pr-tracker watch mycompany/design-system
/pr-tracker add @alice alice-github
/pr-tracker add @bob bob-github
```

**#backend-team channel:**

```
/pr-tracker watch mycompany/api-server
/pr-tracker watch mycompany/database-migrations
/pr-tracker add @charlie charlie-github
/pr-tracker add @diana diana-github
```

Now:

- PRs from `mycompany/web-app` → posted to #frontend-team
- PRs from `mycompany/api-server` → posted to #backend-team
- Each channel only sees PRs from their watched repos
- `@mentions` use each channel's team map

## Project Structure

```
pr-tracker/
├── src/
│   ├── app.js              # Express server & webhook routing
│   ├── config.js            # Environment config & team mapping
│   ├── github/
│   │   ├── api.js           # GitHub API client (Octokit)
│   │   ├── verify.js        # Webhook signature verification
│   │   └── webhooks.js      # Event handlers (core logic)
│   ├── slack/
│   │   ├── client.js        # Slack Web API wrapper
│   │   └── messages.js      # Block Kit message formatting
│   └── tracker/
│       └── store.js         # In-memory state + JSON backup
├── data/                    # Auto-created, stores state.json
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Notes

- **Draft PRs** are ignored until they're marked ready for review
- **Thread cleanup**: Parent messages are deleted 1 minute after merge/close to keep the channel clean
- **State recovery**: If the app restarts, it loads state from `data/store.json`, including the team configurations

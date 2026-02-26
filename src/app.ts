import crypto from "node:crypto";
import express, { Request, Response } from "express";
import config from "./config.js";
import { webhookVerification } from "./github/verify.js";
import * as webhooks from "./github/webhooks.js";
import * as store from "./tracker/store.js";
import * as slackClient from "./slack/client.js";
import { RequestWithRawBody } from "./types.js";

const app = express();

// Parse JSON body but keep raw body for signature verification
app.use(
  express.json({
    verify: (req: RequestWithRawBody, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Parse URL-encoded bodies for Slack slash commands, keeping raw body for verification
app.use(
  "/slack/commands",
  express.urlencoded({
    extended: false,
    verify: (req: RequestWithRawBody, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    prsTracked: Object.keys(store.getAllOpenPRs()).length,
  });
});

// GitHub webhook endpoint
app.post(
  "/webhook",
  webhookVerification(config.github.webhookSecret),
  async (req, res) => {
    const event = req.headers["x-github-event"];
    const payload = req.body;

    // Respond immediately to GitHub
    res.status(200).json({ ok: true });

    try {
      switch (event) {
        case "pull_request":
          await webhooks.handlePullRequest(payload);
          break;

        case "pull_request_review":
          await webhooks.handlePullRequestReview(payload);
          break;

        case "pull_request_review_comment":
          await webhooks.handlePullRequestReviewComment(payload);
          break;

        case "issue_comment":
          await webhooks.handleIssueComment(payload);
          break;

        default:
          console.log(`Unhandled event: ${event}`);
      }
    } catch (err) {
      console.error(`Error handling ${event}:`, err);
    }
  },
);

// ─── Slack Events API ────────────────────────────────────────────────

app.post(
  "/slack/events",
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body;

    // Handle URL verification challenge
    if (body.type === "url_verification") {
      res.json({ challenge: body.challenge });
      return;
    }

    // Respond immediately to Slack
    res.status(200).send();

    try {
      const event = body.event;

      // Handle member_joined_channel event (bot added to channel)
      if (
        event.type === "member_joined_channel" &&
        event.user === body.authorizations?.[0]?.user_id
      ) {
        const channelId = event.channel;
        console.log(`Bot added to channel: ${channelId}`);

        // Get channel info
        const channelInfo = await slackClient.getChannelInfo(channelId);

        // Add channel to tracking
        store.addChannel(channelId, channelInfo.name);

        await slackClient.postMessage(
          channelId,
          [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "👋 *PR Tracker is now active!*\n\nUse `/pr-tracker watch owner/repo` to start tracking repositories in this channel.\n\nUse `/pr-tracker add @user githubusername` to add team members.",
              },
            },
          ],
          "PR Tracker is now active!",
        );
      }
    } catch (err) {
      console.error("Error handling Slack event:", err);
    }
  },
);

// ─── Slack slash commands ────────────────────────────────────────────

function verifySlackRequest(req: RequestWithRawBody): boolean {
  const secret = config.slack.signingSecret;
  if (!secret) return true; // skip verification if not configured

  const timestamp = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!timestamp || !sig) return false;

  // Reject requests older than 5 minutes (replay attack prevention)
  const timestampStr = Array.isArray(timestamp) ? timestamp[0] : timestamp;
  if (Math.abs(Date.now() / 1000 - Number(timestampStr)) > 300) return false;

  const base = `v0:${timestampStr}:${req.rawBody?.toString() || ""}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  const sigStr = Array.isArray(sig) ? sig[0] : sig;
  try {
    return crypto.timingSafeEqual(Buffer.from(sigStr), Buffer.from(expected));
  } catch {
    return false;
  }
}

app.post("/slack/commands", (req: Request, res: Response) => {
  if (!verifySlackRequest(req)) {
    return res.status(401).send("Unauthorized");
  }

  const channelId = req.body.channel_id;
  const text = (req.body.text || "").trim();
  const args = text.split(/\s+/);
  const sub = args[0]?.toLowerCase();

  // Ensure channel is registered
  const channel = store.getChannel(channelId);
  if (!channel) {
    store.addChannel(channelId);
  }

  if (sub === "add") {
    // Usage: /pr-tracker add @SlackUser githubusername
    const mentionMatch = text.match(/<@(U[A-Z0-9]+)/);
    const githubUsername = args.find(
      (a: string) => !a.startsWith("<") && a.toLowerCase() !== "add",
    );

    if (!mentionMatch || !githubUsername) {
      return res.json({
        text: "Usage: `/pr-tracker add @SlackUser githubusername`",
      });
    }

    const slackId = mentionMatch[1];
    store.setTeamMember(channelId, githubUsername, slackId);
    return res.json({ text: `Added: \`${githubUsername}\` → <@${slackId}>` });
  }

  if (sub === "remove") {
    const githubUsername = args[1];
    if (!githubUsername) {
      return res.json({ text: "Usage: `/pr-tracker remove githubusername`" });
    }
    const teamMap = store.getTeamMap(channelId);
    if (!teamMap[githubUsername.toLowerCase()]) {
      return res.json({
        text: `\`${githubUsername}\` is not in this channel's team map.`,
      });
    }
    store.removeTeamMember(channelId, githubUsername);
    return res.json({ text: `Removed: \`${githubUsername}\`` });
  }

  if (sub === "watch") {
    // Usage: /pr-tracker watch owner/repo
    const repo = args[1];
    if (!repo || !repo.includes("/")) {
      return res.json({
        text: "Usage: `/pr-tracker watch owner/repo`\nExample: `/pr-tracker watch facebook/react`",
      });
    }

    const success = store.watchRepo(channelId, repo);
    if (!success) {
      return res.json({
        text: `❌ Repository \`${repo}\` is already being watched by another channel.`,
      });
    }

    return res.json({
      text: `✅ Now watching \`${repo}\` in this channel. PRs from this repo will be posted here.`,
    });
  }

  if (sub === "unwatch") {
    // Usage: /pr-tracker unwatch owner/repo
    const repo = args[1];
    if (!repo) {
      return res.json({
        text: "Usage: `/pr-tracker unwatch owner/repo`",
      });
    }

    const success = store.unwatchRepo(channelId, repo);
    if (!success) {
      return res.json({
        text: `❌ Repository \`${repo}\` is not being watched in this channel.`,
      });
    }

    return res.json({
      text: `✅ Stopped watching \`${repo}\` in this channel.`,
    });
  }

  if (sub === "repos") {
    // List watched repos for this channel
    const repos = store.getWatchedRepos(channelId);
    if (repos.length === 0) {
      return res.json({
        text: "No repositories are being watched in this channel.\n\nUse `/pr-tracker watch owner/repo` to start tracking a repository.",
      });
    }

    const lines = repos.map((repo) => `• \`${repo}\``).join("\n");
    return res.json({
      text: `*Watched repositories in this channel:*\n${lines}`,
    });
  }

  if (sub === "list" || !sub) {
    const teamMap = store.getTeamMap(channelId);
    const watchedRepos = store.getWatchedRepos(channelId);

    let response = "*PR Tracker Status for this channel:*\n\n";

    // Team members
    const teamEntries = Object.entries(teamMap);
    if (teamEntries.length > 0) {
      response += "*Team Members:*\n";
      response += teamEntries
        .map(([gh, sl]) => `• \`${gh}\` → <@${sl}>`)
        .join("\n");
    } else {
      response += "*Team Members:* None configured";
    }

    response += "\n\n";

    // Watched repos
    if (watchedRepos.length > 0) {
      response += "*Watched Repositories:*\n";
      response += watchedRepos.map((repo) => `• \`${repo}\``).join("\n");
    } else {
      response += "*Watched Repositories:* None configured";
    }

    response += "\n\n*Available commands:*\n";
    response += "• `/pr-tracker watch owner/repo` - Watch a repository\n";
    response +=
      "• `/pr-tracker unwatch owner/repo` - Stop watching a repository\n";
    response += "• `/pr-tracker repos` - List watched repositories\n";
    response += "• `/pr-tracker add @user githubusername` - Add team member\n";
    response += "• `/pr-tracker remove githubusername` - Remove team member\n";
    response += "• `/pr-tracker list` - Show this status";

    return res.json({ text: response });
  }

  return res.json({
    text: "Unknown subcommand. Available: `watch`, `unwatch`, `repos`, `add`, `remove`, `list`",
  });
});

// Start server
store.load();
store.setupShutdownHooks();

app.listen(3000, () => {
  const channels = store.getAllChannels();
  const channelCount = Object.keys(channels).length;

  if (channelCount > 0) {
    console.log(`Active channels: ${channelCount}`);
    for (const channel of Object.values(channels)) {
      const teamCount = Object.keys(channel.teamMap).length;
      const repoCount = channel.watchedRepos.length;
      console.log(
        `  - ${channel.channelId} (${channel.channelName || "unknown"}): ${teamCount} team members, ${repoCount} watched repos`,
      );
    }
  } else {
    console.log(
      "No channels configured yet. Invite the bot to a Slack channel to get started.",
    );
  }
  console.log(
    `GitHub Enterprise: ${config.github.enterpriseUrl || "github.com"}`,
  );
});

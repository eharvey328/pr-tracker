import * as store from "../tracker/store.js";
import * as slackClient from "../slack/client.js";
import * as messages from "../slack/messages.js";
import * as githubApi from "./api.js";
import { PRData, PRStatus } from "../types.js";
import type {
  PullRequestEvent,
  PullRequestReviewEvent,
  PullRequestReviewCommentEvent,
  IssueCommentEvent,
} from "@octokit/webhooks-types";

/**
 * Build a consistent PR key from owner/repo and PR number.
 */
function prKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}

/**
 * Resolve a GitHub username to a Slack mention for a specific channel.
 * Returns <@SLACK_ID> if mapped, otherwise the GitHub username as plain text.
 */
function slackMention(githubUsername: string, channelId: string): string {
  const slackId = store.getSlackUserId(githubUsername, channelId);
  return slackId ? `<@${slackId}>` : githubUsername;
}

/**
 * Check if a GitHub user is on the team for a specific channel.
 */
function isTeamMember(githubUsername: string, channelId: string): boolean {
  return store.getSlackUserId(githubUsername, channelId) !== null;
}

/**
 * Get the channel ID for a given repository.
 * Returns null if the repo is not being watched.
 */
function getChannelForRepo(owner: string, repo: string): string | null {
  const repoKey = `${owner}/${repo}`;
  return store.getChannelForRepo(repoKey);
}

// ─── Pull Request Events ────────────────────────────────────────────

async function handlePullRequest(payload: PullRequestEvent): Promise<void> {
  const { action, pull_request: pr, repository } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const key = prKey(owner, repo, pr.number);
  const author = pr.user.login;

  switch (action) {
    case "opened":
    case "ready_for_review": {
      if (pr.draft && action === "opened") {
        // Don't post for drafts; we'll catch ready_for_review later
        return;
      }

      const status: PRStatus = "ready_for_review";
      const existing = store.getPR(key);

      const channelId = getChannelForRepo(owner, repo);
      if (!channelId) {
        console.log(
          `Repository ${owner}/${repo} is not being watched, skipping PR notification`,
        );
        return;
      }

      const prData: PRData = {
        title: pr.title,
        url: pr.html_url,
        number: pr.number,
        repo: `${owner}/${repo}`,
        author: slackMention(author, channelId),
        authorGithub: author,
      };

      if (existing?.slackTs) {
        // Update existing message
        const formatted = messages.formatPRParentUpdate(prData, status);
        await slackClient.updateMessage(
          existing.channelId,
          existing.slackTs,
          formatted.blocks,
          formatted.text,
        );
        store.setPR(key, {
          ...prData,
          status,
          slackTs: existing.slackTs,
          channelId: existing.channelId,
        });

        // Post thread reply
        const stateMsg = messages.formatStateChange("ready_for_review", {});
        await slackClient.postThreadReply(
          existing.channelId,
          existing.slackTs,
          stateMsg.blocks,
          stateMsg.text,
        );
      } else {
        // New parent message
        const formatted = messages.formatPRParent(prData, status);
        const ts = await slackClient.postMessage(
          channelId,
          formatted.blocks,
          formatted.text,
        );
        store.setPR(key, { ...prData, status, slackTs: ts, channelId });
      }
      break;
    }

    case "closed": {
      const existing = store.getPR(key);
      if (!existing?.slackTs) return;

      const status: PRStatus = pr.merged ? "merged" : "closed";
      const event: "merged" | "closed" = pr.merged ? "merged" : "closed";

      const prData: PRData = {
        title: pr.title,
        url: pr.html_url,
        number: pr.number,
        repo: `${owner}/${repo}`,
        author: existing.author,
      };

      // Update parent message with final status
      const formatted = messages.formatPRParentUpdate(prData, status);
      await slackClient.updateMessage(
        existing.channelId,
        existing.slackTs,
        formatted.blocks,
        formatted.text,
      );

      // Post closing thread reply
      const stateMsg = messages.formatStateChange(event, {});
      await slackClient.postThreadReply(
        existing.channelId,
        existing.slackTs,
        stateMsg.blocks,
        stateMsg.text,
      );

      // Remove from tracking after a short delay so the message is visible
      setTimeout(() => {
        const current = store.getPR(key);
        if (
          current &&
          (current.status === "merged" || current.status === "closed")
        ) {
          slackClient
            .deleteMessage(current.channelId, current.slackTs)
            .catch((err) => {
              console.error(
                `Failed to delete message for ${key}:`,
                err.message,
              );
            });
          store.deletePR(key);
        }
      }, 60 * 1000); // Delete after 1 minute

      store.setPR(key, {
        ...prData,
        status,
        slackTs: existing.slackTs,
        channelId: existing.channelId,
      });
      break;
    }

    case "reopened": {
      const channelId = getChannelForRepo(owner, repo);
      if (!channelId) {
        console.log(
          `Repository ${owner}/${repo} is not being watched, skipping PR notification`,
        );
        return;
      }

      const prData: PRData = {
        title: pr.title,
        url: pr.html_url,
        number: pr.number,
        repo: `${owner}/${repo}`,
        author: slackMention(author, channelId),
        authorGithub: author,
      };

      const status: PRStatus = pr.draft ? "open" : "ready_for_review";
      const formatted = messages.formatPRParent(prData, status);
      const ts = await slackClient.postMessage(
        channelId,
        formatted.blocks,
        formatted.text,
      );
      store.setPR(key, { ...prData, status, slackTs: ts, channelId });
      break;
    }

    default:
      break;
  }
}

// ─── Pull Request Review Events ─────────────────────────────────────

async function handlePullRequestReview(
  payload: PullRequestReviewEvent,
): Promise<void> {
  const { action, review, pull_request: pr, repository } = payload;
  if (action !== "submitted") return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const key = prKey(owner, repo, pr.number);
  const existing = store.getPR(key);

  if (!existing?.slackTs) return;

  const reviewer = review.user.login;
  const reviewState = review.state; // approved, changes_requested, commented

  if (reviewState === "commented") return; // We handle comments separately

  const prData: PRData = {
    title: pr.title,
    url: pr.html_url,
    number: pr.number,
    repo: `${owner}/${repo}`,
    author: existing.author,
  };

  let status: PRStatus;
  let event: "approved" | "changes_requested";

  if (reviewState === "approved") {
    status = "approved";
    event = "approved";
  } else if (reviewState === "changes_requested") {
    status = "changes_requested";
    event = "changes_requested";
  } else {
    return;
  }

  // Update parent message
  const formatted = messages.formatPRParentUpdate(prData, status);
  await slackClient.updateMessage(
    existing.channelId,
    existing.slackTs,
    formatted.blocks,
    formatted.text,
  );

  // Post thread reply
  const stateMsg = messages.formatStateChange(event, {
    reviewer: slackMention(reviewer, existing.channelId),
    state: reviewState,
  });
  await slackClient.postThreadReply(
    existing.channelId,
    existing.slackTs,
    stateMsg.blocks,
    stateMsg.text,
  );

  store.setPR(key, { ...existing, ...prData, status });
}

// ─── Review Comment Events (reply detection) ────────────────────────

async function handlePullRequestReviewComment(
  payload: PullRequestReviewCommentEvent,
): Promise<void> {
  const {
    action,
    comment,
    pull_request: pr,
    repository,
    installation,
  } = payload;
  if (action !== "created") return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const key = prKey(owner, repo, pr.number);
  const commenter = comment.user.login;
  const existing = store.getPR(key);

  // Only process if we're tracking this PR
  if (!existing) return;

  // Track this comment for future reply matching
  if (isTeamMember(commenter, existing.channelId)) {
    store.trackComment(comment.id, commenter, key);
  }

  // Check if this is a reply to someone's comment
  if (comment.in_reply_to_id) {
    let parentAuthor = store.getCommentAuthor(comment.in_reply_to_id);

    // If not in our store, fetch from GitHub API
    if (!parentAuthor && installation) {
      try {
        const octokit = githubApi.getOctokit(installation.id);
        const parentComment = await githubApi.getReviewComment(
          octokit,
          owner,
          repo,
          comment.in_reply_to_id,
        );
        parentAuthor = parentComment.user.login.toLowerCase();

        // Track it for future reference
        if (isTeamMember(parentAuthor, existing.channelId)) {
          store.trackComment(comment.in_reply_to_id, parentAuthor, key);
        }
      } catch (err) {
        console.error(
          `Failed to fetch parent comment ${comment.in_reply_to_id}:`,
          (err as Error).message,
        );
        return;
      }
    }

    // Don't notify if someone replies to their own comment or if parent author is unknown
    if (!parentAuthor || parentAuthor === commenter.toLowerCase()) return;

    // Post thread reply if the parent author is a team member and we're tracking this PR
    if (isTeamMember(parentAuthor, existing.channelId) && existing.slackTs) {
      const replyMsg = messages.formatCommentReply({
        replier: slackMention(commenter, existing.channelId),
        recipient: slackMention(parentAuthor, existing.channelId),
        body: comment.body,
        commentUrl: comment.html_url,
      });
      await slackClient.postThreadReply(
        existing.channelId,
        existing.slackTs,
        replyMsg.blocks,
        replyMsg.text,
      );
    }
  }
}

// ─── Issue Comment Events (general PR comments) ─────────────────────

async function handleIssueComment(payload: IssueCommentEvent): Promise<void> {
  const { action, comment, issue, repository } = payload;
  if (action !== "created") return;

  // Only care about PR comments (issues have no pull_request field)
  if (!issue.pull_request) return;

  const owner = repository.owner.login;
  const repo = repository.name;
  const key = prKey(owner, repo, issue.number);
  const commenter = comment.user.login;
  const existing = store.getPR(key);

  // Only process if we're tracking this PR
  if (!existing) return;

  // Track comment
  if (isTeamMember(commenter, existing.channelId)) {
    store.trackComment(comment.id, commenter, key);
  }

  // Post a thread notification if we're tracking this PR
  if (existing.slackTs) {
    const stateMsg = messages.formatStateChange("comment", {
      author: slackMention(commenter, existing.channelId),
    });
    await slackClient.postThreadReply(
      existing.channelId,
      existing.slackTs,
      stateMsg.blocks,
      stateMsg.text,
    );
  }

  // Note: General issue comments don't have in_reply_to_id,
  // so we can't detect replies here. GitHub's threading for
  // issue comments is limited. Review comments (inline) do support this.
}

export {
  handlePullRequest,
  handlePullRequestReview,
  handlePullRequestReviewComment,
  handleIssueComment,
};

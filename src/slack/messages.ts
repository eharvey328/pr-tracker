import {
  PRData,
  PRStatus,
  StateChangeEvent,
  StateChangeDetail,
  CommentReplyDetail,
} from "../types.js";
import type { KnownBlock } from "@slack/types";

export interface SlackMessage {
  blocks: KnownBlock[];
  text: string;
}

const STATUS_EMOJI: Record<PRStatus, string> = {
  open: "🟡",
  ready_for_review: "🟢",
  changes_requested: "🔴",
  approved: "✅",
  merged: "🟣",
  closed: "⚫",
};

/**
 * Format the parent message for a new PR thread.
 */
export function formatPRParent(pr: PRData, status: PRStatus): SlackMessage {
  const emoji = STATUS_EMOJI[status] || "⚪";

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *<${pr.url}|${pr.title}>*`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*Repo:* ${pr.repo} · *Author:* ${pr.author} · *#${pr.number}*`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*Status:* ${formatStatus(status)}`,
          },
        ],
      },
    ],
    text: `${emoji} ${pr.title} - ${pr.repo}#${pr.number}`, // fallback
  };
}

/**
 * Format an updated parent message (status change).
 */
export function formatPRParentUpdate(
  pr: PRData,
  status: PRStatus,
): SlackMessage {
  return formatPRParent(pr, status);
}

/**
 * Format a thread reply for a state transition.
 */
export function formatStateChange(
  event: StateChangeEvent,
  detail: StateChangeDetail,
): SlackMessage {
  const messages: Record<StateChangeEvent, string> = {
    ready_for_review: "📋 PR is ready for review",
    review_submitted: `👀 *${detail.reviewer}* submitted a review: *${detail.state}*`,
    changes_requested: `🔴 *${detail.reviewer}* requested changes`,
    approved: `✅ *${detail.reviewer}* approved this PR`,
    merged: "🟣 PR merged!",
    closed: "⚫ PR closed",
    comment: `💬 *${detail.author}* commented`,
  };

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: messages[event] || `📌 ${event}`,
        },
      },
    ],
    text: messages[event] || event,
  };
}

/**
 * Format a thread reply notification for a comment reply.
 */
export function formatCommentReply(detail: CommentReplyDetail): SlackMessage {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💬 *${detail.replier}* replied to *${detail.recipient}*'s comment`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `> ${truncate(detail.body, 300)}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View on GitHub" },
            url: detail.commentUrl,
          },
        ],
      },
    ],
    text: `${detail.replier} replied to ${detail.recipient}'s comment`,
  };
}

function formatStatus(status: PRStatus): string {
  const labels: Record<PRStatus, string> = {
    open: "Open",
    ready_for_review: "Ready for Review",
    changes_requested: "Changes Requested",
    approved: "Approved",
    merged: "Merged",
    closed: "Closed",
  };
  return labels[status] || status;
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

import { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/types";
import config from "../config.js";

const slack = new WebClient(config.slack.botToken);

/**
 * Post a new parent message to the specified channel.
 * Returns the message timestamp (ts) for threading.
 */
export async function postMessage(
  channelId: string,
  blocks: KnownBlock[],
  text: string,
): Promise<string> {
  const result = await slack!.chat.postMessage({
    channel: channelId,
    blocks,
    text,
    unfurl_links: false,
  });
  return result.ts!;
}

/**
 * Update an existing message (e.g., to change PR status).
 */
export async function updateMessage(
  channelId: string,
  ts: string,
  blocks: KnownBlock[],
  text: string,
): Promise<void> {
  await slack!.chat.update({
    channel: channelId,
    ts,
    blocks,
    text,
  });
}

/**
 * Post a reply in a thread.
 */
export async function postThreadReply(
  channelId: string,
  threadTs: string,
  blocks: KnownBlock[],
  text: string,
): Promise<void> {
  await slack!.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks,
    text,
    unfurl_links: false,
  });
}

/**
 * Delete a parent message (and its thread) from the channel.
 */
export async function deleteMessage(
  channelId: string,
  ts: string,
): Promise<void> {
  try {
    await slack!.chat.delete({
      channel: channelId,
      ts,
    });
  } catch (err: any) {
    // If message is already deleted, that's fine
    if (err.data?.error !== "message_not_found") {
      throw err;
    }
  }
}

/**
 * Send a direct message to a user.
 */
export async function sendDM(
  userId: string,
  blocks: KnownBlock[],
  text: string,
): Promise<void> {
  await slack!.chat.postMessage({
    channel: userId,
    blocks,
    text,
    unfurl_links: false,
  });
}

/**
 * Get channel info (name, etc.)
 */
export async function getChannelInfo(
  channelId: string,
): Promise<{ name?: string }> {
  try {
    const result = await slack!.conversations.info({
      channel: channelId,
    });
    return {
      name: result.channel?.name,
    };
  } catch (err) {
    console.error("Failed to get channel info:", err);
    return {};
  }
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StoreState, StoredPR, ChannelConfig } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.resolve(__dirname, "../../data/store.json");

// In-memory state
const state: StoreState = {
  // "owner/repo#123" -> { slackTs, channelId, status, title, url, author }
  prs: {},
  // "comment_id" -> { author (github username), prKey }
  comments: {},
  // All channels where app is installed
  channels: {},
  // Repo to channel mapping: "owner/repo" -> channelId
  repoToChannel: {},
};

// Load from disk on startup
export function load(): void {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      state.prs = { ...state.prs, ...(data.prs || {}) };
      state.comments = { ...state.comments, ...(data.comments || {}) };
      state.channels = { ...state.channels, ...(data.channels || {}) };
      state.repoToChannel = {
        ...state.repoToChannel,
        ...(data.repoToChannel || {}),
      };
      console.log(
        `Loaded state: ${Object.keys(state.prs).length} PRs, ${Object.keys(state.comments).length} comments, ${Object.keys(state.channels).length} channels, ${Object.keys(state.repoToChannel).length} watched repos`,
      );
    }
  } catch (err) {
    console.error("Failed to load state from disk:", (err as Error).message);
  }
}

// Save to disk
export function save(): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Failed to save state to disk:", (err as Error).message);
  }
}

// PR operations
export function setPR(prKey: string, data: Partial<StoredPR>): void {
  state.prs[prKey] = { ...state.prs[prKey], ...data } as StoredPR;
  save();
}

export function getPR(prKey: string): StoredPR | null {
  return state.prs[prKey] || null;
}

export function deletePR(prKey: string): void {
  // Also clean up comments associated with this PR
  for (const [commentId, comment] of Object.entries(state.comments)) {
    if (comment.prKey === prKey) {
      delete state.comments[commentId];
    }
  }
  delete state.prs[prKey];
  save();
}

export function getAllOpenPRs(): Record<string, StoredPR> {
  return { ...state.prs };
}

// Comment operations
export function trackComment(
  commentId: number,
  author: string,
  prKey: string,
): void {
  state.comments[String(commentId)] = {
    author: author.toLowerCase(),
    prKey,
  };
  save();
}

export function getCommentAuthor(commentId: number): string | null {
  const comment = state.comments[String(commentId)];
  return comment ? comment.author : null;
}

// Channel operations
export function getChannel(channelId: string): ChannelConfig | null {
  return state.channels[channelId] || null;
}

export function addChannel(channelId: string, channelName?: string): void {
  if (!state.channels[channelId]) {
    state.channels[channelId] = {
      channelId,
      channelName,
      teamMap: {},
      watchedRepos: [],
    };
    console.log(`Channel added: ${channelId} (${channelName || "unknown"})`);
    save();
  }
}

export function getAllChannels(): Record<string, ChannelConfig> {
  return { ...state.channels };
}

// Team map operations (per channel)
export function setTeamMember(
  channelId: string,
  githubUsername: string,
  slackId: string,
): void {
  const channel = state.channels[channelId];
  if (channel) {
    channel.teamMap[githubUsername.toLowerCase()] = slackId;
    save();
  }
}

export function removeTeamMember(
  channelId: string,
  githubUsername: string,
): void {
  const channel = state.channels[channelId];
  if (channel) {
    delete channel.teamMap[githubUsername.toLowerCase()];
    save();
  }
}

export function getTeamMap(channelId: string): Record<string, string> {
  const channel = state.channels[channelId];
  return channel ? { ...channel.teamMap } : {};
}

export function getSlackUserId(
  githubUsername: string,
  channelId?: string,
): string | null {
  // If channel specified, check that channel's team map
  if (channelId) {
    const channel = state.channels[channelId];
    if (channel) {
      const slackId = channel.teamMap[githubUsername.toLowerCase()];
      if (slackId) return slackId;
    }
  }

  // Otherwise check all channels
  for (const channel of Object.values(state.channels)) {
    const slackId = channel.teamMap[githubUsername.toLowerCase()];
    if (slackId) return slackId;
  }

  return null;
}

// Repo watching operations
export function watchRepo(channelId: string, repo: string): boolean {
  const channel = state.channels[channelId];
  if (!channel) return false;

  const repoKey = repo.toLowerCase();

  // Check if repo is already watched by another channel
  if (
    state.repoToChannel[repoKey] &&
    state.repoToChannel[repoKey] !== channelId
  ) {
    return false; // Repo already watched by another channel
  }

  if (!channel.watchedRepos.includes(repoKey)) {
    channel.watchedRepos.push(repoKey);
    state.repoToChannel[repoKey] = channelId;
    save();
  }

  return true;
}

export function unwatchRepo(channelId: string, repo: string): boolean {
  const channel = state.channels[channelId];
  if (!channel) return false;

  const repoKey = repo.toLowerCase();
  const index = channel.watchedRepos.indexOf(repoKey);

  if (index > -1) {
    channel.watchedRepos.splice(index, 1);
    delete state.repoToChannel[repoKey];
    save();
    return true;
  }

  return false;
}

export function getWatchedRepos(channelId: string): string[] {
  const channel = state.channels[channelId];
  return channel ? [...channel.watchedRepos] : [];
}

export function getChannelForRepo(repo: string): string | null {
  return state.repoToChannel[repo.toLowerCase()] || null;
}

// Graceful shutdown
export function setupShutdownHooks(): void {
  const shutdown = () => {
    console.log("Saving state before shutdown...");
    save();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

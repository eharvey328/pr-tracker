import { Request } from "express";

// Extend Express Request to include rawBody
export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

// PR data structure
export interface PRData {
  title: string;
  url: string;
  number: number;
  repo: string;
  author: string;
  authorGithub?: string;
}

// PR status types
export type PRStatus =
  | "open"
  | "ready_for_review"
  | "changes_requested"
  | "approved"
  | "merged"
  | "closed";

// Stored PR data
export interface StoredPR extends PRData {
  status: PRStatus;
  slackTs: string;
  channelId: string; // which channel this PR is tracked in
}

// Comment data
export interface CommentData {
  author: string;
  prKey: string;
}

// State change event types
export type StateChangeEvent =
  | "ready_for_review"
  | "review_submitted"
  | "changes_requested"
  | "approved"
  | "merged"
  | "closed"
  | "comment";

// State change detail
export interface StateChangeDetail {
  reviewer?: string;
  state?: string;
  author?: string;
}

// Comment reply detail
export interface CommentReplyDetail {
  replier: string;
  recipient: string;
  body: string;
  commentUrl: string;
}

// Config structure
export interface Config {
  github: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
    enterpriseUrl?: string;
  };
  slack: {
    botToken: string;
    signingSecret?: string;
  };
}

// Channel configuration
export interface ChannelConfig {
  channelId: string;
  channelName?: string;
  teamMap: Record<string, string>; // github username -> slack user id
  watchedRepos: string[]; // array of "owner/repo" strings
}

// Store state
export interface StoreState {
  prs: Record<string, StoredPR>;
  comments: Record<string, CommentData>;
  channels: Record<string, ChannelConfig>; // channelId -> config
  repoToChannel: Record<string, string>; // "owner/repo" -> channelId
}

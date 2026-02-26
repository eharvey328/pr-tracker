import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import config from "../config.js";

// Cache installation tokens per installation ID
const octokitCache = new Map<number, Octokit>();

/**
 * Get an authenticated Octokit instance for a given installation.
 */
export function getOctokit(installationId: number): Octokit {
  if (octokitCache.has(installationId)) {
    return octokitCache.get(installationId)!;
  }

  const octokit = new Octokit({
    baseUrl: config.github.enterpriseUrl
      ? `${config.github.enterpriseUrl}/api/v3`
      : undefined,
    authStrategy: createAppAuth,
    auth: {
      appId: config.github.appId,
      privateKey: config.github.privateKey,
      installationId,
    },
  });

  octokitCache.set(installationId, octokit);
  return octokit;
}

/**
 * Get a specific comment by ID to find parent comment author.
 */
export async function getReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  commentId: number,
) {
  const { data: comment } = await octokit.pulls.getReviewComment({
    owner,
    repo,
    comment_id: commentId,
  });
  return comment;
}

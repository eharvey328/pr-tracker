import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Config } from "./types.js";

// Load GitHub App private key
let privateKey: string;
if (process.env.GITHUB_PRIVATE_KEY) {
  // Use private key from environment variable (for Vercel, etc.)
  privateKey = process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, "\n");
} else {
  // Load from file (for local development)
  try {
    const keyPath = process.env.GITHUB_PRIVATE_KEY_PATH || "./private-key.pem";
    privateKey = fs.readFileSync(path.resolve(keyPath), "utf8");
  } catch (err) {
    console.error(
      "Failed to load GitHub App private key:",
      (err as Error).message,
    );
    process.exit(1);
  }
}

const config: Config = {
  github: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
    enterpriseUrl: process.env.GITHUB_ENTERPRISE_URL,
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  },
};

export default config;

import crypto from "node:crypto";
import { Response, NextFunction } from "express";
import { RequestWithRawBody } from "../types.js";

function verifySignature(
  secret: string,
  payload: Buffer | undefined,
  signature: string | string[] | undefined,
): boolean {
  if (!signature || !payload) return false;

  const sig = Buffer.from(Array.isArray(signature) ? signature[0] : signature);
  const hmac = crypto.createHmac("sha256", secret);
  const digest = Buffer.from("sha256=" + hmac.update(payload).digest("hex"));

  if (sig.length !== digest.length) return false;
  return crypto.timingSafeEqual(sig, digest);
}

/**
 * Express middleware to verify GitHub webhook signatures
 */
export function webhookVerification(secret: string) {
  return (req: RequestWithRawBody, res: Response, next: NextFunction): void => {
    const signature = req.headers["x-hub-signature-256"];

    if (!verifySignature(secret, req.rawBody, signature)) {
      console.warn("Webhook signature verification failed");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    next();
  };
}

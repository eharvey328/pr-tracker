# Security Guide for PR Tracker

This guide ensures your API keys, tokens, and private keys are properly secured when deploying to IBM Cloud.

## ✅ What's Already Secure

Your deployment is already configured to handle secrets securely:

### 1. Kubernetes Secrets (Encrypted at Rest)

All sensitive data is stored in Kubernetes Secrets, which are:

- **Encrypted at rest** in etcd (IBM Cloud encrypts by default)
- **Never exposed** in container images
- **Mounted as files** or environment variables at runtime only
- **Access-controlled** via Kubernetes RBAC

### 2. Git Repository Protection

Your [`.gitignore`](.gitignore:1) already prevents committing:

```
.env                    # Local environment variables
private-key.pem         # GitHub App private key
k8s/secrets.yaml        # Actual Kubernetes secrets
data/                   # State storage with potential sensitive data
```

### 3. Container Image Security

- Secrets are **NOT** copied into Docker images
- The [`Dockerfile`](Dockerfile:1) only copies source code
- Private key is mounted at runtime from Kubernetes Secret

## 🔒 Security Checklist

### Before Deployment

- [ ] **Never commit secrets to git**

  ```bash
  # Verify .gitignore is working
  git status
  # Should NOT show: .env, private-key.pem, k8s/secrets.yaml
  ```

- [ ] **Keep private-key.pem local only**

  ```bash
  # Set restrictive permissions
  chmod 600 private-key.pem

  # Verify it's not tracked
  git check-ignore private-key.pem
  # Should output: private-key.pem
  ```

- [ ] **Use strong secrets**

  ```bash
  # Generate strong webhook secret (32+ characters)
  openssl rand -hex 32

  # Generate strong Slack signing secret (use Slack's provided value)
  ```

### During Deployment

- [ ] **Create secrets via kubectl (not YAML files)**

  ```bash
  # This is SECURE - secrets go directly to Kubernetes
  kubectl create secret generic pr-tracker-secrets \
    --from-literal=github-app-id=YOUR_APP_ID \
    --from-literal=github-webhook-secret=YOUR_WEBHOOK_SECRET \
    --from-literal=slack-bot-token=xoxb-YOUR-TOKEN \
    --from-literal=slack-signing-secret=YOUR_SIGNING_SECRET \
    --from-file=github-private-key=./private-key.pem \
    -n pr-tracker
  ```

- [ ] **Verify secrets are created**

  ```bash
  kubectl get secrets -n pr-tracker

  # Should show:
  # pr-tracker-secrets
  # icr-secret
  ```

- [ ] **Never use `kubectl get secret -o yaml`** in shared terminals

  ```bash
  # ❌ DON'T DO THIS - exposes base64 encoded secrets
  kubectl get secret pr-tracker-secrets -o yaml

  # ✅ DO THIS - just verify it exists
  kubectl get secret pr-tracker-secrets -n pr-tracker
  ```

### After Deployment

- [ ] **Delete local secret files**

  ```bash
  # After secrets are in Kubernetes, remove local copies
  rm k8s/secrets.yaml  # If you created one

  # Keep private-key.pem for future updates, but secure it
  chmod 600 private-key.pem
  ```

- [ ] **Verify secrets are not in container**

  ```bash
  # Check that secrets aren't baked into the image
  kubectl exec -it deployment/pr-tracker -n pr-tracker -- env | grep -i secret
  # Should show environment variables, NOT the actual secret values
  ```

- [ ] **Enable audit logging** (IBM Cloud Kubernetes)
  ```bash
  # IBM Cloud automatically logs Kubernetes API access
  # Review logs in IBM Cloud Logging
  ```

## 🛡️ Best Practices

### 1. Rotate Secrets Regularly

**Every 90 days, rotate:**

- GitHub webhook secret
- Slack signing secret
- IBM Cloud API keys

```bash
# Update GitHub webhook secret
# 1. Generate new secret in GitHub App settings
# 2. Update Kubernetes secret
kubectl create secret generic pr-tracker-secrets \
  --from-literal=github-webhook-secret=NEW_SECRET \
  --dry-run=client -o yaml | kubectl apply -f -

# 3. Restart deployment
kubectl rollout restart deployment/pr-tracker -n pr-tracker
```

### 2. Use IBM Cloud Secrets Manager (Optional)

For enterprise deployments, use IBM Secrets Manager:

```bash
# Install Secrets Manager operator
# Then reference secrets from Secrets Manager instead of Kubernetes Secrets
```

### 3. Limit Access with RBAC

Create a service account with minimal permissions:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: pr-tracker-sa
  namespace: pr-tracker
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pr-tracker-role
  namespace: pr-tracker
rules:
  - apiGroups: [""]
    resources: ["secrets"]
    resourceNames: ["pr-tracker-secrets"]
    verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pr-tracker-binding
  namespace: pr-tracker
subjects:
  - kind: ServiceAccount
    name: pr-tracker-sa
roleRef:
  kind: Role
  name: pr-tracker-role
  apiGroup: rbac.authorization.k8s.io
```

### 4. Enable Network Policies

Restrict network access to your pods:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: pr-tracker-netpol
  namespace: pr-tracker
spec:
  podSelector:
    matchLabels:
      app: pr-tracker
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector: {}
      ports:
        - protocol: TCP
          port: 3000
  egress:
    - to:
        - namespaceSelector: {}
    - to: # Allow external API calls
        - podSelector: {}
      ports:
        - protocol: TCP
          port: 443
```

### 5. Use TLS/SSL for Webhooks

**Production deployments should use HTTPS:**

```yaml
# Use Ingress with TLS
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: pr-tracker-ingress
  namespace: pr-tracker
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
    - hosts:
        - pr-tracker.yourcompany.com
      secretName: pr-tracker-tls
  rules:
    - host: pr-tracker.yourcompany.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: pr-tracker
                port:
                  number: 80
```

Then update webhook URLs to use HTTPS:

- `https://pr-tracker.yourcompany.com/webhook`
- `https://pr-tracker.yourcompany.com/slack/events`

## 🚨 What NOT to Do

### ❌ Never Do These:

1. **Don't commit secrets to git**

   ```bash
   # BAD - secrets in code
   const token = "xoxb-1234567890-abcdefg"
   ```

2. **Don't put secrets in Dockerfile**

   ```dockerfile
   # BAD
   ENV SLACK_BOT_TOKEN=xoxb-1234567890
   ```

3. **Don't log secrets**

   ```javascript
   // BAD
   console.log("Token:", process.env.SLACK_BOT_TOKEN);

   // GOOD
   console.log("Token configured:", !!process.env.SLACK_BOT_TOKEN);
   ```

4. **Don't share secrets in chat/email**
   - Use secure password managers
   - Use IBM Secrets Manager
   - Share via encrypted channels only

5. **Don't use weak secrets**

   ```bash
   # BAD
   GITHUB_WEBHOOK_SECRET=password123

   # GOOD
   GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```

## 🔍 Security Monitoring

### Check for Exposed Secrets

```bash
# Scan git history for accidentally committed secrets
git log -p | grep -i "token\|secret\|key" | head -20

# Use git-secrets to prevent commits
brew install git-secrets
git secrets --install
git secrets --register-aws
```

### Monitor Access Logs

```bash
# View application logs for suspicious activity
kubectl logs -f deployment/pr-tracker -n pr-tracker | grep -i "unauthorized\|failed\|error"

# Check Kubernetes audit logs in IBM Cloud Logging
```

### Verify Webhook Signatures

The app already verifies webhook signatures:

- GitHub: [`src/github/verify.ts`](src/github/verify.ts:1)
- Slack: [`src/app.ts`](src/app.ts:133) (verifySlackRequest function)

## 📋 Security Incident Response

If a secret is compromised:

1. **Immediately rotate the secret**

   ```bash
   # Revoke old token in GitHub/Slack
   # Generate new token
   # Update Kubernetes secret
   kubectl create secret generic pr-tracker-secrets \
     --from-literal=slack-bot-token=NEW_TOKEN \
     --dry-run=client -o yaml | kubectl apply -f -

   # Restart deployment
   kubectl rollout restart deployment/pr-tracker -n pr-tracker
   ```

2. **Review access logs**

   ```bash
   # Check for unauthorized access
   kubectl logs deployment/pr-tracker -n pr-tracker --since=24h | grep -i "error\|unauthorized"
   ```

3. **Notify stakeholders**
   - Security team
   - GitHub/Slack administrators
   - Users if data was accessed

## ✅ Quick Security Verification

Run this checklist before going to production:

```bash
# 1. Verify no secrets in git
git log --all --full-history --source --pretty=format: -- .env private-key.pem k8s/secrets.yaml
# Should return nothing

# 2. Verify secrets exist in Kubernetes
kubectl get secrets -n pr-tracker
# Should show pr-tracker-secrets and icr-secret

# 3. Verify secrets are not in container image
docker history us.icr.io/pr-tracker/pr-tracker:latest | grep -i "secret\|token\|key"
# Should return nothing

# 4. Verify file permissions
ls -la private-key.pem
# Should show: -rw------- (600)

# 5. Test webhook signature verification
curl -X POST http://YOUR_IP/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
# Should return 401 Unauthorized (signature missing)
```

## 📚 Additional Resources

- [IBM Cloud Security Best Practices](https://cloud.ibm.com/docs/security)
- [Kubernetes Secrets Management](https://kubernetes.io/docs/concepts/configuration/secret/)
- [GitHub App Security](https://docs.github.com/en/developers/apps/building-github-apps/best-practices-for-creating-a-github-app)
- [Slack Security Best Practices](https://api.slack.com/authentication/best-practices)

## Summary

Your deployment is secure if you:

1. ✅ Never commit secrets to git (`.gitignore` protects you)
2. ✅ Store secrets in Kubernetes Secrets (encrypted at rest)
3. ✅ Mount secrets at runtime (not in container images)
4. ✅ Use HTTPS for webhooks (production)
5. ✅ Rotate secrets regularly (every 90 days)
6. ✅ Monitor access logs
7. ✅ Verify webhook signatures (already implemented)

The current setup follows security best practices. Just follow the deployment steps in [`SIMPLE_DEPLOYMENT.md`](SIMPLE_DEPLOYMENT.md:1) and your secrets will be properly protected!

# Simple Deployment to IBM Cloud Kubernetes

This is a streamlined guide for deploying PR Tracker to IBM Cloud Kubernetes Service without CI/CD automation. Perfect for quick deployments and testing.

🔒 **Security Note:** See [`SECURITY.md`](SECURITY.md) for how your API keys and private key are protected.

## Prerequisites

- IBM Cloud account
- IBM Cloud CLI installed
- Docker installed locally
- kubectl installed
- GitHub App configured (see main README.md)
- Slack App configured (see main README.md)

## Quick Start (5 Steps)

### Step 1: Login and Setup

```bash
# Login to IBM Cloud
ibmcloud login --sso

# Target your region
ibmcloud target -r us-south

# Login to Container Registry
ibmcloud cr login

# Create namespace (one-time)
ibmcloud cr namespace-add pr-tracker

# Configure kubectl for your cluster
ibmcloud ks cluster config --cluster YOUR_CLUSTER_NAME

# Create Kubernetes namespace
kubectl create namespace pr-tracker
```

### Step 2: Build and Push Docker Image

```bash
# Build the image
docker build -t us.icr.io/pr-tracker/pr-tracker:latest .

# Push to IBM Container Registry
docker push us.icr.io/pr-tracker/pr-tracker:latest
```

### Step 3: Create Secrets

```bash
# Create application secrets
kubectl create secret generic pr-tracker-secrets \
  --from-literal=github-app-id=YOUR_APP_ID \
  --from-literal=github-webhook-secret=YOUR_WEBHOOK_SECRET \
  --from-literal=slack-bot-token=xoxb-YOUR-TOKEN \
  --from-literal=slack-signing-secret=YOUR_SIGNING_SECRET \
  --from-file=github-private-key=./private-key.pem \
  -n pr-tracker

# Create image pull secret
kubectl create secret docker-registry icr-secret \
  --docker-server=us.icr.io \
  --docker-username=iamapikey \
  --docker-password=YOUR_IBM_CLOUD_API_KEY \
  -n pr-tracker
```

### Step 4: Deploy Application

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# Wait for deployment
kubectl rollout status deployment/pr-tracker -n pr-tracker
```

### Step 5: Get Service URL and Configure Webhooks

```bash
# Get the external IP/hostname
kubectl get service pr-tracker -n pr-tracker

# Example output:
# NAME         TYPE           EXTERNAL-IP                    PORT(S)
# pr-tracker   LoadBalancer   xxx.us-south.containers.cloud  80:xxxxx/TCP
```

Update your webhook URLs:

- **GitHub App Webhook:** `http://YOUR_EXTERNAL_IP/webhook`
- **Slack Events:** `http://YOUR_EXTERNAL_IP/slack/events`
- **Slack Commands:** `http://YOUR_EXTERNAL_IP/slack/commands`

## That's It!

Test your deployment:

```bash
curl http://YOUR_EXTERNAL_IP/health
```

Invite the bot to Slack and start tracking PRs:

```
/invite @PR Tracker
/pr-tracker watch owner/repo
```

## Updating the Application

When you make code changes:

```bash
# Rebuild and push
docker build -t us.icr.io/pr-tracker/pr-tracker:latest .
docker push us.icr.io/pr-tracker/pr-tracker:latest

# Restart deployment
kubectl rollout restart deployment/pr-tracker -n pr-tracker
```

## Useful Commands

```bash
# View logs
kubectl logs -f deployment/pr-tracker -n pr-tracker

# Check status
kubectl get pods -n pr-tracker

# Update secrets
kubectl delete secret pr-tracker-secrets -n pr-tracker
kubectl create secret generic pr-tracker-secrets \
  --from-literal=github-app-id=NEW_VALUE \
  # ... other values

# Restart after secret update
kubectl rollout restart deployment/pr-tracker -n pr-tracker
```

## Cleanup

```bash
kubectl delete namespace pr-tracker
ibmcloud cr image-rm us.icr.io/pr-tracker/pr-tracker
```

## Need More?

- For CI/CD automation: See [ONE_PIPELINE_DEPLOYMENT.md](ONE_PIPELINE_DEPLOYMENT.md)
- For serverless: See [DEPLOYMENT.md](DEPLOYMENT.md)

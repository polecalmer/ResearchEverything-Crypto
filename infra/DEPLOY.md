# Deploy walkthrough (no-terminal version)

This is the actually-step-by-step guide. You won't touch your local
terminal. Everything happens in either a browser tab or the AWS
CloudShell (also a browser tab).

## Time budget: ~30 min walltime

| Phase | What you do | Wait |
|---|---|---|
| 0 — push branch | Click in GitHub | 0 |
| 1 — open CloudShell | Click in AWS console | 30s |
| 2 — paste script | Paste, hit Enter | 0 |
| 3 — GitHub secrets | 3 clicks in GitHub | 1 min |
| 4 — RDS wait | (script handles, you wait) | 10-15 min |
| 5 — paste API keys | nano edit in CloudShell | 5 min |
| 6 — trigger build | Click in GitHub Actions | 5-7 min wait |
| 7 — ACM DNS validation | Add 1 CNAME at your DNS provider | 5-30 min wait |
| 8 — DNS cutover | Add 1 CNAME at your DNS provider | 1-15 min wait |
| 9 — Stripe webhook | Click in Stripe dashboard | 1 min |
| **Total** | | **~30 min hands-on, ~20 min waiting** |

---

## Step 0 — Push the deploy branch to GitHub (1 min)

The infrastructure files I just added need to be on `main` for the
CloudShell script to find them via `git clone`.

In your browser:
1. Open the **GitHub Desktop app** (or whatever you normally use)
2. Commit the new `infra/` directory + `.github/workflows/deploy-prod.yml`
3. Push to `main`

That's it — the rest happens in AWS CloudShell and GitHub Actions.

---

## Step 1 — Open AWS CloudShell (30s)

1. Go to https://console.aws.amazon.com
2. Sign in with your admin IAM user
3. **Top-right of the console:** click the CloudShell icon (looks like
   `>_` in a terminal box). It opens a black terminal pane at the
   bottom of the page. Wait ~10s for "Provisioning your environment".
4. Make sure the **region selector** (top-right, next to your name) is
   set to the region you want to deploy in (e.g. `us-east-1`).

CloudShell already has the AWS CLI installed and your admin credentials
loaded. You don't need to configure anything.

---

## Step 2 — Run the mega-script (1 paste)

In the CloudShell window, paste this:

```bash
curl -sL https://raw.githubusercontent.com/polecalmer/ResearchEverything-Crypto/main/infra/scripts/cloudshell-deploy.sh -o cloudshell-deploy.sh && bash cloudshell-deploy.sh
```

(Adjust the GitHub org/repo if yours is different.)

The script handles everything from here. It will pause at clearly-marked
checkpoints with `⏸ YOUR INPUT NEEDED` blocks. Each pause tells you exactly
what to do — go do it in a different browser tab, then come back and
hit Enter.

---

## Step 3 — Pause #1: GitHub repo secrets (1 min)

The script will print **three secrets** to add to your GitHub repo:
- `AWS_ROLE_TO_ASSUME` (it prints the ARN)
- `AWS_REGION`
- `AWS_ACCOUNT_ID`

Open:
```
https://github.com/<your-org>/<your-repo>/settings/secrets/actions
```

Click **"New repository secret"** three times. Paste each name + value,
save. Then return to CloudShell and hit Enter.

---

## Step 4 — Pause #2: API keys (5 min)

The script will run `nano ~/.sessions-secrets/prod-env.json` for you.
It pre-fills DATABASE_URL + JWT_SECRET; you fill in the rest:

- `OPENROUTER_API_KEY` (from openrouter.ai/keys)
- `DUNE_API_KEY` (from dune.com/settings/api)
- `COINGECKO_API_KEY` (free demo key at coingecko.com/en/developers/dashboard)
- `DEFILLAMA_PRO_API_KEY` (or delete the line if you don't have one)
- `VOYAGE_API_KEY` (from voyageai.com)
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `VITE_PRIVY_APP_ID` —
  **create a NEW Privy app for prod** at privy.io/dashboard.
  Don't reuse your dev app.
- `STRIPE_SECRET_KEY` — your LIVE key (`sk_live_…`)
  from dashboard.stripe.com/apikeys

Leave `STRIPE_WEBHOOK_SECRET` as the placeholder for now — Phase 12 fills it.

Save with **Ctrl-O**, Enter, **Ctrl-X**. Return to CloudShell and hit Enter.

---

## Step 5 — Pause #3: Trigger GitHub Actions (5-7 min)

The script prints a URL like:
```
https://github.com/<your-repo>/actions/workflows/deploy-prod.yml
```

In your browser:
1. Open that URL
2. Click **"Run workflow"** (top right corner)
3. Set **"Auto-roll the ECS service"** = **NO** (service doesn't exist yet)
4. Click the green **"Run workflow"** button
5. Wait for the run to turn green (~5-7 min)

Return to CloudShell, hit Enter. The script verifies the image landed
in ECR.

---

## Step 6 — Pause #4: ACM DNS validation (5-30 min)

The script prints a DNS CNAME (something like
`_abc123.example.com → _xyz.acm-validations.aws.`). Add it at your
DNS provider:
- **Cloudflare**: DNS → Records → Add record → Type CNAME → paste
  Name + Target → Save. **Turn proxy OFF (gray cloud) for this record**.
- **Route53**: Hosted Zone → Create record → Type CNAME.
- **Namecheap / GoDaddy / etc.**: similar Add Record flow.

Return to CloudShell, hit Enter. The script then waits for ACM to detect
the record and issue the cert (5-30 min).

---

## Step 7 — Pause #5: Domain CNAME cutover (1-15 min)

The script prints the ALB's DNS name (something like
`sessions-prod-1234.us-east-1.elb.amazonaws.com`). Add a CNAME at your
DNS provider:
- **Name:** your domain (e.g. `sessions.example.com`)
- **Type:** CNAME (or ALIAS in Route53)
- **Value:** the ALB DNS name

Return to CloudShell, hit Enter. The script runs smoke tests against your
new domain.

---

## Step 8 — Pause #6: Stripe webhook (1 min)

Open https://dashboard.stripe.com/webhooks (make sure you're in **live mode**
— top-right toggle).
1. Click **"Add endpoint"**
2. **URL:** `https://<your-domain>/api/webhooks/stripe`
3. **Events to send:** `checkout.session.completed`
4. Click **"Add endpoint"**
5. Copy the **"Signing secret"** (`whsec_…`)

Return to CloudShell. The script prompts for the secret — paste it
(input is hidden). It updates the Secrets Manager entry + rolls the
ECS service so the new env loads.

Done. You're live.

---

## Future deploys (after launch)

Every code change after launch:
1. Push to `main` on GitHub
2. Go to https://github.com/<your-repo>/actions/workflows/deploy-prod.yml
3. Click "Run workflow", set **auto-roll = yes**, run

The workflow builds + pushes + rolls the service in 5-7 min. Zero terminal.

---

## Rollback

In the AWS Console:
1. ECS → Clusters → sessions-prod → Services → app → Update
2. Pick a previous task definition revision from the dropdown
3. Click "Update"

ALB drains the bad pool gracefully (60s) and routes to the previous version.

---

## When something fails

The CloudShell script logs every step. If it errors:
1. Read the error message in CloudShell
2. Note which phase failed (the `━━━ Phase N / ...` banner just above)
3. Most phases are idempotent — fix the issue and re-run the whole
   script. It'll skip resources that already exist.

For ECS task boot issues:
```bash
aws logs tail /ecs/sessions-prod --follow
```

For specific phase debugging, the script's bash code is small and
linear — you can read what each phase does and fix manually.

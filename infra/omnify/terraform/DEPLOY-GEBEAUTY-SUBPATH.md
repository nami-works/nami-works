# Host Omnify | Custom at omnify.cpg-labs.io/full

The custom app (Omnify | Custom) can run on the **same domain and ALB** as the main app, under the path **/full**. No separate domain or ACM cert is needed.

---

## What’s in place

- **App:** `BASE_PATH` support so the app can be built and run under a subpath (`react-router.config.ts`, `vite.config.ts`, `app/shopify.server.ts`).
- **Terraform:** Optional “gebeauty” ECS service and ALB listener rule when `enable_gebeauty = true` (`gebeauty.tf`).
- **Shopify:** `shopify.app.omnify-custom.toml` uses `application_url = "https://omnify.cpg-labs.io/full"`.

---

## 1. Build the image for /full

The gebeauty service must use an image built **with** `BASE_PATH=/full`. From the **repo root**:

**PowerShell:**
```powershell
$env:BASE_PATH = "/full"; npm run build
docker build -t omnify-app:full-v3 .
```

**Bash:**
```bash
BASE_PATH=/full npm run build
docker build -t omnify-app:full-v3 .
```

Push this image to your **main** ECR repo with tag **full-v3** (same repo as the main app):

```powershell
docker tag omnify-app:full-v3 <ecr_repository_url>:full-v3
docker push <ecr_repository_url>:full-v3
```

---

## 2. Enable gebeauty in the main stack

In **`infra/terraform/terraform.tfvars`** (the main app’s tfvars), add or set:

```hcl
enable_gebeauty           = true
shopify_api_key_gebeauty  = "<Omnify | Custom Client ID>"
shopify_api_secret_gebeauty = "<Omnify | Custom Client secret>"
image_tag_gebeauty        = "full-v3"
```

Then apply the **main** stack (no separate state file):

```powershell
cd infra/terraform
terraform apply -var-file=terraform.tfvars
```

This adds a second ECS service and an ALB rule: requests to `omnify.cpg-labs.io/full` and `omnify.cpg-labs.io/full/*` go to the gebeauty service.

---

## 3. Sync Shopify and share the install link

From the **repo root**:

```powershell
shopify app config use omnify-custom
shopify app deploy
```

Then in **Partner Dashboard** → **Omnify | Custom** → **Distribution** (or **Get install link**), copy the custom install link and send it to your client. The app will load at **https://omnify.cpg-labs.io/full**.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Build with `BASE_PATH=/full`, build Docker image, tag as `full-v3`, push to main ECR repo. |
| 2 | Set `enable_gebeauty = true` and gebeauty credentials in main `terraform.tfvars`; run `terraform apply`. |
| 3 | Run `shopify app config use omnify-custom` and `shopify app deploy`; send client the install link. |

No separate domain, no second ACM cert, no second Terraform state. The main app stays at `omnify.cpg-labs.io/`, the custom app at `omnify.cpg-labs.io/full`.

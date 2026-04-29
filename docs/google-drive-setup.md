# Per-tenant Google Drive setup

The `shopify_replace_files_from_drive_folder` tool needs read-only access to
the tenant's Drive content. This is one-time setup per tenant. Once done, any
user in claude.ai with the tenant's connector enabled can ask Claude to swap
files in bulk.

## What the tool needs

- A Google service account (creates an identity that can authenticate to Drive
  without going through user OAuth).
- The Drive folder that contains the replacement files, *shared with that
  service account's email* (read-only).
- The service account's JSON key, stored as a SecureString SSM parameter at
  `/nami-works/tenants/<slug>/google_drive/service_account_json`.

`provision-tenant.ts` writes the SSM placeholder (`REPLACE_ME`) automatically
for new tenants. Existing tenants need the parameter created manually (one
`aws ssm put-parameter` command — see step 4).

## Setup, step by step

### 1. Create or pick a Google Cloud project

Each tenant gets its own project so credentials never co-mingle. Naming
suggestion: `nami-works-<tenant-slug>` (e.g. `nami-works-gebeauty`).

Console: https://console.cloud.google.com/projectcreate

### 2. Enable the Drive API for that project

In the project, go to **APIs & Services → Library**, search for
"Google Drive API", click **Enable**. Takes ~10 seconds to provision.

### 3. Create a service account + download its JSON key

In the same project: **IAM & Admin → Service accounts → Create service
account**.

- **Name**: `nami-works-drive` (or similar)
- **Description**: `NAMI Works gateway — Drive read access for <tenant>`
- Skip the "Grant access to project" step — Drive permissions are granted
  per-folder, not per-project.

After creation, click the new service account → **Keys** tab → **Add key →
Create new key → JSON**. A JSON file downloads to your computer. **Treat this
file like a password.** It contains the private key that authenticates as the
service account.

Note the service account's email address — it looks like
`nami-works-drive@nami-works-<slug>.iam.gserviceaccount.com`.

### 4. Share the Drive folder with the service account

In Google Drive, locate the folder you want the gateway to read from (for the
gebeauty hero-image refresh, that's
`Drives compartilhados / GEB_Marketing / MARKETING COMPARTILHADO / CRIAÇÃO /
SITE / refacao_stills / Stills finalizados`).

Right-click the folder → **Share** → paste the service account's email →
permission **Viewer** → uncheck "Notify people" → **Share**.

The service account now has read-only access to that folder *and everything
inside it*.

### 5. Get the folder ID

Open the folder in Drive. The URL looks like:

```
https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz_123456
                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                       this is the folder ID
```

Copy it. Claude users will reference this when asking for a file replacement.

### 6. Push the JSON key to SSM

PowerShell (recommended on Windows — avoids Git Bash path translation):

```powershell
$json = Get-Content -Raw .\path\to\downloaded-key.json
aws ssm put-parameter `
  --name "/nami-works/tenants/<slug>/google_drive/service_account_json" `
  --value $json `
  --type SecureString `
  --overwrite
```

For new tenants the parameter already exists with `REPLACE_ME`; `--overwrite`
replaces the placeholder. For existing tenants without the parameter, the
same command creates it (omit `--overwrite` if you want to fail loudly when
overwriting).

After this, **delete the local JSON file** so the private key only lives in
SSM. (`Remove-Item .\path\to\downloaded-key.json`)

### 7. Verify

Have a user in claude.ai (with the tenant's connector enabled) ask:

> Replace the file `<one filename>` in Shopify using the file from Drive
> folder `<folder ID from step 5>`. Show me the preview only.

Claude should call `shopify_replace_files_from_drive_folder` with the folder
ID and `filenameFilter` set, return a one-line preview, and stop. If you see
"Preview (no changes made yet)" and the file maps cleanly to a Shopify file
ID, setup is correct. Reply with "confirm" (or have Claude call again with
`confirm: true`) to execute the swap.

## What the tool can do

- Replace any file in Shopify's Files library by name (matches an exact
  filename in the Drive folder against an exact filename in Shopify).
- Process up to 100 files per tool call (default 50). For larger batches,
  Claude can invoke the tool multiple times with `filenameFilter` for
  individual files, or you can split the Drive folder.
- Skip cleanly if a Drive file has no Shopify counterpart, or if the
  Shopify side has multiple ambiguous matches — surfaces both in the preview
  so you can investigate.

## What the tool deliberately does NOT do

- **Does not upload new files** to Shopify. Only replaces bytes behind
  existing file IDs. If a Drive file doesn't have a Shopify counterpart
  with the same name, it's skipped (use Shopify Admin → Content → Files →
  Upload to add a new one first).
- **Does not change product → image associations**. Same Shopify file ID
  means same product references, same theme references, same CDN URL — only
  the bytes change.
- **Does not write to Drive**. Read-only scope. The service account literally
  cannot modify the folder.

## Removing access

To revoke the gateway's access (e.g. tenant offboarding):

1. In Drive, remove the service account email from the shared folder.
2. In Google Cloud, delete the service account (or the entire project).
3. Optionally null-out the SSM parameter:
   ```powershell
   aws ssm put-parameter `
     --name "/nami-works/tenants/<slug>/google_drive/service_account_json" `
     --value "REVOKED" --type SecureString --overwrite
   ```

The kill-switch on the tenant row (`status: suspended`) already cuts off
*all* access in one DB flip, including the Drive tool. This is the faster
revocation; the steps above are for permanent removal.

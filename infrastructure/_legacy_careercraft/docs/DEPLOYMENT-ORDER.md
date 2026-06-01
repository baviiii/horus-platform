# Deployment Order & Quick Start

## Quick Start (Easiest Way)

```powershell
# 1. Login to Azure (one time)
az login

# 2. Run master deployment script
cd infrastructure
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-dev" -EnableOpenAI
```

That's it! The script runs all steps automatically.

## Deployment Order

The master script runs these steps in order:

### Step 1: Core Infrastructure

- Creates Resource Group
- Deploys Blob Storage
- Deploys Document Intelligence
- Deploys AI Search
- Deploys Azure OpenAI (if enabled)

**Time:** ~5-10 minutes

### Step 2: Deploy OpenAI Model (if enabled)

- Deploys `text-embedding-3-large` model
- Makes embeddings available

**Time:** ~2-5 minutes

### Step 3: Create Search Index

- Creates `sa-gov-documents` index
- Sets up vector fields (3072 dimensions)
- Configures semantic search
- Adds all tagging fields

**Time:** ~1-2 minutes

### Step 4: Configure Web Scraping

- Creates 6 data sources (entry points)
- Creates 6 indexers (crawlers)
- Sets up automatic updates every 6 hours

**Time:** ~2-3 minutes

## Manual Step-by-Step (If Needed)

If you want to run steps manually:

```powershell
# Step 1: Deploy Infrastructure
.\deploy.ps1 -ResourceGroupName "rg-careercraft-dev" -EnableOpenAI

# Step 2: Deploy OpenAI Model (if enabled)
.\deploy-openai-model.ps1 -ResourceGroupName "rg-careercraft-dev"

# Step 3: Create Search Index
.\create-search-index.ps1 -ResourceGroupName "rg-careercraft-dev"

# Step 4: Configure Web Scraping
cd web-scraper
.\configure-web-scraping.ps1 -ResourceGroupName "rg-careercraft-dev"
```

## Post-Deployment Steps

### 1. Store API Keys

After Step 1, copy the API keys from the output and store them in:

- Supabase Environment Variables (for Edge Functions)
- `.env.local` file for local development (gitignored)

**⚠️ NEVER commit keys to Git!**

### 2. Upload PDFs (When Ready)

```powershell
# Get storage account name from Step 1 output
$storageAccount = "<storage-account-name>"
az storage blob upload-batch `
  --account-name $storageAccount `
  --source "<path-to-your-pdfs>" `
  --destination rag-documents `
  --auth-mode login
```

### 3. Process PDFs (When Ready)

```powershell
# Requires Supabase env vars to be set
$env:SUPABASE_URL = "your-supabase-url"
$env:SUPABASE_ANON_KEY = "your-supabase-key"

.\process-pdfs.ps1 -ResourceGroupName "rg-careercraft-dev"
```

## Dependencies

```
Resource Group
    ↓
┌───┴───┬──────────┬──────────┬─────────┐
│       │          │          │         │
Storage DocIntel  AISearch  OpenAI   (optional)
│       │          │          │
│       │          │          └─→ Step 2: Deploy Model
│       │          │
│       │          └─→ Step 3: Create Index
│       │                      │
│       │                      └─→ Step 4: Web Scraping
│       │
│       └─→ (Later) Upload PDFs
│                        │
│                        └─→ (Later) Process PDFs
```

## Options

### Skip Web Scraping

```powershell
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-dev" -EnableOpenAI -SkipWebScraping
```

### Different Environment

```powershell
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-staging" -Environment "staging" -EnableOpenAI
```

### Without OpenAI

```powershell
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-dev"
# (omits -EnableOpenAI flag)
```

## Troubleshooting

### "Not logged in" Error

```powershell
az login
```

### "Azure CLI not installed"

Install from: https://aka.ms/installazurecliwindows

### Deployment Fails

- Check you have permissions to create resources
- Verify subscription has credits available
- Check resource names don't conflict (storage accounts must be globally unique)

## Total Deployment Time

Using master script: **~10-20 minutes** (all steps)

Manual steps: **~10-20 minutes** (same, but you run each step)

## Cost

After deployment, you'll see estimated monthly costs in the output:

- With OpenAI: ~$275-360/month
- Without OpenAI: ~$255-310/month

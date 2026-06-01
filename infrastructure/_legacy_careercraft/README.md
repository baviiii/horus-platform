# CareerCraft RAG Infrastructure

Azure Bicep templates for deploying the RAG (Retrieval-Augmented Generation) infrastructure for CareerCraft's SA Government document intelligence system.

## Architecture

- **Azure Blob Storage**: Stores PDF documents (~$5-10/month)
- **Azure Document Intelligence**: Parses PDFs, extracts text/tables (~$50-100/month)
- **Azure AI Search**: Vector database for embeddings and semantic search (~$200/month)
  - Can also crawl websites via indexers (included, no extra cost)
- **Azure OpenAI** (enabled by default): High-quality embeddings (~$20-50/month)

**Total Estimated Cost: ~$295-360/month** (within $325 budget, with OpenAI enabled)

All resources deployed to **Australia East** region for optimal cost and latency.

## Prerequisites

1. Azure CLI installed and configured
2. Azure subscription with $1,000 startup credits
3. Appropriate permissions to create resources
4. PowerShell (for deployment script)

## Quick Start (Easiest Way)

```powershell
# 1. Login to Azure (one time)
az login

# 2. Run master deployment script (does everything automatically)
cd infrastructure
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-dev" -EnableOpenAI
```

The master script runs all 4 steps in the correct order automatically!

### Manual Step-by-Step (Optional)

If you prefer to run steps manually, see `DEPLOYMENT-ORDER.md` for details.

### 2. Deploy Without OpenAI (Optional)

To deploy without OpenAI (uses AI Search integrated vectorization instead):

```powershell
.\deploy.ps1 -ResourceGroupName "rg-careercraft-dev" -Environment "dev"
# Then manually edit dev.bicepparam to set enableOpenAI = false
```

### 3. Save Output Values

The deployment script will output all necessary environment variables. Save these for:

- Supabase Edge Functions (environment variables)
- Frontend configuration (`.env` file)
- Post-deployment configuration scripts

## Resource Details

### Storage Account

- **Tier**: Standard LRS (lowest cost)
- **Container**: `rag-documents` (for PDFs)
- **Access**: Private (no public access)

### Document Intelligence

- **Tier**: S0 (pay-as-you-go, $1.50 per 1,000 pages)
- **Capability**: PDF parsing, OCR, table extraction, structured data

### AI Search

- **Tier**: Basic (~$200/month)
- **Replicas**: 1 (can scale to 3)
- **Partitions**: 1 (can scale to 2)
- **Features**: Semantic search, vector search

### Azure OpenAI (enabled by default)

- **Tier**: S0 (pay-as-you-go)
- **Model**: text-embedding-3-large (deploy after infrastructure setup)
- **Cost**: ~$0.10 per 1M tokens for embeddings

## Post-Deployment Steps

1. **Deploy OpenAI Embedding Model**

   ```powershell
   .\deploy-openai-model.ps1 -ResourceGroupName "rg-careercraft-dev"
   ```

   This deploys `text-embedding-3-large` model for embeddings. If the model isn't available in Australia East, it will suggest alternatives.

2. **Upload PDFs to Blob Storage**

   ```powershell
   # Get storage account name from deployment outputs
   $storageAccount = "<storage-account-name-from-outputs>"
   az storage blob upload-batch --account-name $storageAccount --source "../RAG-training" --destination rag-documents --auth-mode login
   ```

   **Then process PDFs with embeddings:**

   ```powershell
   .\process-pdfs.ps1 -ResourceGroupName "rg-careercraft-dev" -GenerateEmbeddings
   ```

   ⚠️ **Important**: The `-GenerateEmbeddings` flag must be used to generate vector embeddings for better RAG performance!

3. **Create AI Search Index**

   ```powershell
   .\create-search-index.ps1 -ResourceGroupName "rg-careercraft-dev"
   ```

   This creates the search index with vector fields for embeddings, semantic search, and all necessary metadata fields.

4. **Configure Web Scraping (Highly Recommended)**

   ```powershell
   cd web-scraper
   .\configure-web-scraping.ps1 -ResourceGroupName "rg-careercraft-dev" -SearchIndexName "sa-gov-documents"
   ```

   **See `web-scraper/README.md` for detailed scraping options and recommendations.**
   This sets up indexers to crawl comprehensive SA Government websites including:
   - **Job Portals**: jobs.sa.gov.au, I Work for SA
   - **Career Guidance**: sa.gov.au (looking for work, finding a job, career info)
   - **Migrant Support**: migration.sa.gov.au (skilled migrant programs, resume/interview support)
   - **Training Programs**: skills.sa.gov.au, skilledworkers.business.sa.gov.au (fee-free TAFE, subsidised training)
   - **Public Sector Careers**: publicsector.sa.gov.au, SA Health, Shared Services SA
   - **Regional Support**: statedevelopment.sa.gov.au (regional career services)
   - **Federal Programs**: dewr.gov.au, jobactive.gov.au (national job readiness)

   Automatically crawls every 6 hours to capture new job postings, programs, and updates.

5. **Verify Data is in the Index**

   ```powershell
   cd web-scraper
   .\verify-scraper-data.ps1 -ResourceGroupName "rg-careercraft-dev"
   ```

   This checks:
   - If index exists
   - How many documents are indexed
   - Sample documents
   - Document type breakdown
   - If embeddings exist

6. **Check Indexer Status** (if using Azure indexers)

   ```powershell
   cd web-scraper
   .\check-indexer-status.ps1 -ResourceGroupName "rg-careercraft-dev"
   ```

   Shows status of all indexers, last run results, and errors.

7. **Configure Supabase Edge Function**
   - Add Azure credentials as environment variables
   - Deploy `rag-query` function
   - Test query endpoint

## Cost Optimization

- **Storage**: Using Standard LRS (lowest cost option)
- **Document Intelligence**: Pay-as-you-go (only pay for what you process)
- **AI Search**: Basic tier (sufficient for MVP, can scale later)
- **Azure OpenAI**: Optional (can use AI Search integrated vectorization instead)

## Scaling

When ready to scale (after grants/funding):

1. **AI Search**: Upgrade to Standard tier for more capacity
2. **Storage**: Change to GRS if redundancy needed
3. **OpenAI**: Deploy larger models if needed
4. **Replicas**: Scale AI Search replicas for higher query volume

## Cleanup

To delete all resources:

```powershell
az group delete --name rg-careercraft-dev --yes --no-wait
```

## Troubleshooting

### Deployment fails with naming conflict

- Storage account names must be globally unique
- The template uses `uniqueString()` to generate unique names
- If conflict persists, change `projectName` parameter

### Azure OpenAI deployment fails

- Azure OpenAI requires approval in some regions
- May need to request access via Azure portal
- Can deploy without OpenAI and add later

### Costs higher than expected

- Monitor usage in Azure Cost Management
- Document Intelligence is usage-based (check page count)
- AI Search Basic tier is fixed $200/month

### Scraper shows no data / Index is empty

**First, verify what's in the index:**

```powershell
cd web-scraper
.\verify-scraper-data.ps1 -ResourceGroupName "rg-careercraft-dev"
```

**If index is empty:**

- Check if scraper script ran successfully (look for errors)
- Check indexer status: `cd web-scraper; .\check-indexer-status.ps1 -ResourceGroupName "rg-careercraft-dev"`
- Try running smart scraper manually: `cd web-scraper; .\run-enterprise-scraper.ps1 -ResourceGroupName "rg-careercraft-dev"`
- See `web-scraper/README.md` for detailed scraping options
- Check Azure Portal → AI Search → Indexes → Documents count

**If index has data but no embeddings:**

- Run smart scraper with `-GenerateEmbeddings` flag
- Embeddings are needed for vector search (better RAG results)
- Consider using AI Search integrated vectorization instead of OpenAI

## Support

For issues or questions, check:

- Azure documentation
- Bicep documentation
- CareerCraft project repository

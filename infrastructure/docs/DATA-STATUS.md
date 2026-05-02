# Data Status & RAG Query Flow

## Current Architecture Overview

### ✅ What's Set Up (Code/Infrastructure)

1. **Azure Infrastructure Scripts** (Ready to deploy)
   - `deploy.ps1` - Deploys Azure resources (Storage, Document Intelligence, AI Search, OpenAI)
   - `create-search-index.ps1` - Creates the vector search index
   - `configure-web-scraping.ps1` - Sets up Azure AI Search indexers (automatic crawlers)

2. **Web Scraping Scripts** (Ready to run)
   - `enterprise-scraper (run-enterprise-scraper.ps1)` - Custom scraper that scrapes → chunks → generates embeddings → pushes to Azure AI Search
   - `configure-web-scraping.ps1` - Sets up Azure indexers that automatically crawl every 6 hours

3. **PDF Processing** (Ready to run)
   - `process-pdfs.ps1` - Processes PDFs → extracts text → chunks → tags → generates embeddings → indexes to Azure AI Search

4. **RAG Query System** (Code ready, needs data)
   - `supabase/functions/rag-query/index.ts` - Edge function that:
     - Takes user query
     - Generates embedding using Azure OpenAI
     - Searches Azure AI Search (vector + semantic + keyword hybrid search)
     - Retrieves relevant chunks
     - Sends to GPT-4 with context to generate answer
     - Returns answer with source citations (prevents hallucinations!)

---

## ❓ What You Need to Do (Deployment Steps)

### Step 1: Deploy Infrastructure
```powershell
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-dev" -EnableOpenAI
```
This creates all Azure resources but **NO DATA YET**.

### Step 2: Choose Your Data Ingestion Method

**Option A: Automatic Web Scraping (Recommended)**
```powershell
cd web-scraper
.\configure-web-scraping.ps1 -ResourceGroupName "rg-careercraft-dev"
```
- Sets up indexers that crawl SA government websites automatically
- Runs every 6 hours
- Data goes directly into Azure AI Search (vector database)
- **BUT**: Azure AI Search indexers don't generate embeddings automatically - they only store text

**Option B: Smart Custom Scraper (Better for embeddings)**
```powershell
cd web-scraper
.\run-enterprise-scraper.ps1 -ResourceGroupName "rg-careercraft-dev"
```
- Scrapes websites intelligently
- Generates embeddings using Azure OpenAI
- Pushes to Azure AI Search with vectors
- **This is better** because it creates the vector embeddings needed for RAG

**Option C: Process Your PDFs**
```powershell
.\process-pdfs.ps1 -ResourceGroupName "rg-careercraft-dev"
```
- Processes all PDFs in Blob Storage
- Extracts text using Document Intelligence
- Generates embeddings
- Tags and indexes everything

### Step 3: Verify Data is in Vector Database

Check if data exists:
```powershell
# Get search service name
$searchService = az search service list --resource-group rg-careercraft-dev --query "[0].name" -o tsv

# Get admin key
$searchKey = az search admin-key show --resource-group rg-careercraft-dev --service-name $searchService --query "primaryKey" -o tsv

# Check document count
az search index statistics --service-name $searchService --index-name sa-gov-documents --resource-group rg-careercraft-dev
```

---

## 🔄 How RAG Works (After Data is In)

1. **User asks question**: "What jobs are available in the health sector?"

2. **Edge Function (`rag-query`) does**:
   - Converts question to embedding vector using Azure OpenAI
   - Searches Azure AI Search using:
     - **Vector search** (semantic similarity)
     - **Keyword search** (exact matches)
     - **Semantic search** (meaning-based)
   - Retrieves top 8-10 relevant chunks

3. **GPT-4 generates answer**:
   - Receives ONLY the retrieved chunks as context
   - Generates answer using ONLY that information
   - Cites sources (e.g., "[Source 1]")
   - **Cannot hallucinate** because it only uses retrieved data

4. **Returns to user**:
   - Answer with citations
   - List of sources (URLs, document names, page numbers)
   - Suggested follow-up questions

---

## ⚠️ Important: Current Status

**Infrastructure**: ✅ Scripts ready
**Web Scraping Setup**: ✅ Scripts ready  
**PDF Processing**: ✅ Scripts ready
**RAG Query Code**: ✅ Code ready
**Data in Vector DB**: ❓ **Need to run scripts above**

**You need to:**
1. Deploy infrastructure (if not done)
2. Run web scraping OR process PDFs to get data into Azure AI Search
3. Verify data exists in the index
4. Then RAG queries will work!

---

## 🎯 Quick Answer to Your Question

> "alright but it was some how scrapped right and is it in the vector now to answer people with the gpt when asked"

**Answer**: The scraping **scripts are ready**, but you need to **run them** to get data into the vector database. Once you run:

```powershell
.\run-enterprise-scraper.ps1 -ResourceGroupName "rg-careercraft-dev"
```

OR

```powershell
.\configure-web-scraping.ps1 -ResourceGroupName "rg-careercraft-dev"
```

Then the data will be in Azure AI Search (your vector database), and when users ask questions, the `rag-query` Edge Function will:
1. Search the vector database
2. Find relevant chunks
3. Send them to GPT-4
4. Return answers with citations

**Right now, the code is ready but the database is likely empty until you run the scraping/processing scripts.**


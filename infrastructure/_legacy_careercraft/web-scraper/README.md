# Web Scraping for SA Government Data

This folder contains scripts for scraping SA Government websites and uploading content to Azure AI Search for the RAG system.

## 🚀 Enterprise Scraper (Recommended - Production Ready)

**For production use, use the Playwright-based Enterprise Scraper:**

- 📁 **`enterprise-scraper/`** - Playwright browser automation (Node.js)
- ✅ Handles JavaScript, dynamic content, anti-bot measures
- ✅ Scrolls and paginates to capture all content
- ✅ ~90%+ success rate on government sites
- ✅ Professional-grade solution with real browser rendering

**Setup & Usage:** See [`enterprise-scraper/README.md`](./enterprise-scraper/README.md)

**Quick Start:**

```powershell
cd enterprise-scraper
.\run-enterprise-scraper.ps1 -ResourceGroupName "rg-careercraft-dev"
```

This will scrape all websites, generate embeddings, and upload to Azure AI Search automatically.

---

## 📁 Files Overview

### Enterprise Scraper (Production - Azure)

- **`enterprise-scraper/scraper.js`** - Main Playwright scraper
- **`enterprise-scraper/run-enterprise-scraper.ps1`** - Complete workflow (scrape + upload)
- **`enterprise-scraper/upload-to-azure.ps1`** - Uploads scraped content to Azure AI Search

### Local Scraper (No Cloud Dependencies)

- **`local-scraper/local-scraper.js`** - Playwright scraper with local JSON output
- **`local-scraper/README.md`** - Setup & usage

### Utilities

- **`verify-scraper-data.ps1`** - Verifies scraped data in Azure AI Search index

---

## 🚀 Quick Start

### Enterprise Scraper (Recommended)

```powershell
cd enterprise-scraper

# Install dependencies (first time only)
npm install
npm run install-browsers

# Run complete scraper (scrapes + uploads to Azure)
.\run-enterprise-scraper.ps1 -ResourceGroupName "rg-careercraft-dev"
```

**This is the production-ready solution** - uses Playwright for real browser automation!

### Local Scraper (No Azure Required)

```bash
cd local-scraper
npm install && npm run install-browsers
npm run scrape        # Scrape all sites, output JSON to ./output
npm run scrape:jobs   # Jobs only
```

---

## Verify Data

After running the scraper, verify data is in the index:

```powershell
.\verify-scraper-data.ps1 -ResourceGroupName "rg-careercraft-dev"
```

---

## 🔍 What Gets Scraped

The enterprise scraper targets comprehensive SA Government career resources:

- **Job Portals**: jobs.sa.gov.au, I Work for SA, public sector jobs
- **Career Guidance**: sa.gov.au (looking for work, finding a job, career info)
- **Migrant Support**: migration.sa.gov.au (skilled migrant programs, resume/interview support)
- **Training Programs**: skills.sa.gov.au (fee-free TAFE, subsidised training)
- **Public Sector Careers**: publicsector.sa.gov.au (selection criteria, interview prep)
- **Regional Support**: statedevelopment.sa.gov.au (regional career services)
- **News & Updates**: premier.sa.gov.au/media-releases, skills.sa.gov.au/news

---

## ⚠️ Prerequisites

Before running the scraper:

1. ✅ Azure infrastructure deployed (Storage, Document Intelligence, AI Search, OpenAI)
2. ✅ Search index created (`sa-gov-documents`)
3. ✅ Azure CLI logged in (`az login`)
4. ✅ OpenAI embedding model deployed (required for embeddings)

If you haven't set up infrastructure yet:

```powershell
cd ..
.\deploy-all.ps1 -ResourceGroupName "rg-careercraft-dev" -EnableOpenAI
.\create-search-index.ps1 -ResourceGroupName "rg-careercraft-dev"
```

---

## 💡 Key Features

### Enterprise Scraper Includes:

- ✅ **Browser automation** (Playwright) - handles JavaScript and dynamic content
- ✅ **Intelligent scrolling** - loads lazy-loaded content
- ✅ **Multi-page pagination** - scrapes multiple pages per site
- ✅ **Vector embeddings** - always generated for optimal RAG
- ✅ **Automatic chunking** - with overlap for context
- ✅ **Tagging and categorization** - jobs, skills, news, general
- ✅ **Retry logic** - with exponential backoff
- ✅ **Error handling** - graceful failures with detailed logging

---

## 🐛 Troubleshooting

### Scraper hangs or doesn't complete

- Check console output for detailed progress logs
- Scraping multiple pages takes time - be patient
- Large sites may take several minutes

### No embeddings generated

- Verify OpenAI is deployed: `az cognitiveservices account list --resource-group rg-careercraft-dev`
- Check Azure OpenAI endpoint and key are configured

### No data in index after scraping

1. Run `verify-scraper-data.ps1` to check if index is empty
2. Check for errors in scraper output
3. Verify search index exists: `cd .. && .\create-search-index.ps1`
4. Check Azure Portal → AI Search → Indexes

### Memory errors

- The scraper is optimized for memory usage
- Browser restarts every 3 sites automatically
- If issues persist, reduce maxPages in scraper.js

---

## 📊 Expected Results

After running the enterprise scraper, you'll have:

- High-quality extracted content from all pages
- **Vector embeddings for all chunks** (enables vector similarity search)
- Properly tagged and categorized documents
- Ready for seamless RAG queries with optimal performance

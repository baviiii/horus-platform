# Document Labeling Rules

This document defines the labeling/metadata extraction rules used across all data sources (PDFs, web scraping, etc.).

**IMPORTANT:** Labeling logic is intentionally **duplicated** across sources to allow source-specific customizations:
- **PDF Parser**: `infrastructure/scripts/process-pdfs.ps1`
- **Web Scraper**: `infrastructure/web-scraper/enterprise-scraper/scraper.js`

When updating labeling rules, consider updating both files to maintain consistency, but feel free to customize per-source as needed.

---

## Categories

Documents are classified into these categories based on content and purpose:

| Category | Description | Keywords (Title/Filename) | Keywords (Content) |
|----------|-------------|---------------------------|-------------------|
| **budget** | Financial documents, budgets, revenue reports | budget, financial, revenue, expenditure | budget, appropriation, revenue, expenditure |
| **strategy** | Strategic plans, roadmaps | strategy, strategic, plan, roadmap | - |
| **workforce** | Employment, jobs, workforce data | workforce, employment, jobs, career | workforce, employment, job market |
| **education** | Education, training, learning | education, learning, school, training | - |
| **health** | Healthcare, medical services | health, medical, hospital | - |
| **career-guidance** | Resume help, interview prep, job applications | interview, resume, cv, selection | interview, resume, selection criteria |
| **report** | Annual reports, reviews | report, annual, review | - |
| **policy** | Policies, guidelines, procedures | policy, guideline, procedure | - |
| **government-document** | Default fallback category | - | - |

### Implementation Notes

**PDF Parser:**
- Checks filename first (most reliable)
- Then checks first 2000 chars of content
- Returns first match or "government-document"

**Web Scraper:**
- Can use scraping strategy as hint (jobs→workforce, news→report)
- Checks page title (equivalent to PDF filename)
- Then checks first 2000 chars of content
- Can also check URL for additional hints

---

## Sectors

Documents are classified by industry/government sector:

| Sector | Keywords (First 3000 chars) | URL Hints (Web Only) |
|--------|----------------------------|----------------------|
| **health** | health, hospital, nursing, medical, sa health | /health/ |
| **education** | education, school, teacher, learning, department for education | /education/ |
| **public-sector** | public sector, government, department, commissioner for public sector | /publicsector/ |
| **construction** | construction, building, infrastructure | - |
| **technology** | technology, it, digital, software, ict | /tech/ |
| **agriculture** | agriculture, farming, rural | - |
| **resources** | mining, resources, energy | - |
| **services** | retail, hospitality, tourism | - |
| **finance** | finance, accounting, treasury | - |
| **defense** | defense, security, police | /defence/ |
| **transport** | transport, logistics | - |
| **community-services** | community, social services, welfare | - |
| **general** | Default fallback | - |

### Implementation Notes

**Both Sources:**
- Check first 3000 chars of content
- Return first match or "general"

**Web Scraper Only:**
- Also checks URL path for sector hints
- Example: `sahealth.sa.gov.au` → health sector

---

## Tags

Multi-label tags extracted from content (not mutually exclusive):

| Tag | Keywords | Notes |
|-----|----------|-------|
| **south-australia** | south australia, sa government | Always added by web scraper |
| **web-scraped** | - | Always added by web scraper to distinguish from PDFs |
| **education** | education, school, learning | - |
| **health** | health, medical, nursing | - |
| **employment** | employment, job, career, workforce | - |
| **budget** | budget, financial, funding | - |
| **training** | training, skills, qualification | - |
| **job-application** | interview, resume, application | - |
| **migration** | migration, immigrant, visa | - |
| **regional** | regional, rural, country | - |
| **disability-inclusion** | disability, inclusion, accessibility | - |
| **indigenous** | indigenous, aboriginal | - |
| **youth** | youth, young people, graduate | - |

### Implementation Notes

**PDF Parser:**
- Scans entire content (no length limit)
- Returns unique tags only
- Defaults to `["sa-government", "general"]` if no matches

**Web Scraper:**
- Scans title + content combined
- Adds base tags: `["web-scraped", "south-australia"]`
- Can infer tags from category/sector
- Returns unique tags only

---

## Publication Year

Extract the most recent publication year from document:

### Logic (Both Sources)

1. **Check title/filename** for 4-digit year (most reliable)
   - Pattern: `\b(19|20)\d{2}\b`
   - Must be between 2000 and current year + 1
   - Example: "Budget-2024.pdf" → 2024

2. **Check content** for 4-digit years
   - Pattern: `\b(20\d{2})\b`
   - Find all years between 2000 and current year + 1
   - Return the **maximum** (most recent) year found

3. **Return null** if no valid year found

### Implementation Notes

- PDF: Checks filename + content
- Web: Checks page title + content
- Both use identical year range (2000 to current year + 1)

---

## Chunking Strategy

Both sources use identical chunking for consistency:

| Parameter | Value | Reason |
|-----------|-------|--------|
| **Chunk Size** | 800 characters | Optimal for embeddings (3072-dim vectors) |
| **Overlap** | 200 characters | Preserves context across chunks |
| **Min Chunk** | 50-100 characters | Filter out tiny/empty chunks |

### PDF Parser Chunking

```powershell
# Sentence-aware chunking with word-based overlap
Split-TextIntoChunks -ChunkSize 800 -Overlap 200
```

- Splits on sentences (`.!?`)
- Overlap uses last ~30 words from previous chunk
- Minimum chunk: 50 chars

### Web Scraper Chunking

```javascript
// Character-based chunking with character overlap
chunkContent(content, chunkSize=800, overlap=200)
```

- Splits at character positions
- Overlap uses last 200 chars from previous chunk
- Minimum chunk: 50-100 chars (configurable)

---

## Metadata Fields

Standard metadata structure used across all sources:

```javascript
{
  // Core identification
  "id": "unique-document-chunk-id",
  "title": "Document Title",
  "documentId": "parent-document-id",  // Groups chunks from same doc
  "documentType": "pdf" | "web",

  // Content
  "content": "chunk text content",
  "contentVector": [0.123, 0.456, ...],  // 3072-dim embedding

  // Location
  "url": "source URL or blob path",
  "source": "source identifier",
  "pageNumber": 1,
  "chunkIndex": 0,

  // Labeling (from this document)
  "category": "workforce",
  "sector": "health",
  "tags": ["employment", "health"],

  // Metadata
  "metadata": "{...}",  // JSON string with additional fields
  "indexedAt": "2026-01-08T12:00:00.000Z",

  // PDF-specific
  "chunkType": "text" | "table_row",  // PDF only
  "confidence": 0.95,  // PDF only
  "retrievalWeight": 1.0,  // PDF: 1.0 for text, 1.5 for tables

  // Web-specific
  "lastScraped": "2026-01-08T12:00:00.000Z",  // Web only
  "isLiveData": true  // Web only (content may change)
}
```

---

## Customization Guidelines

### When to Keep Rules Synchronized

✅ **Core categories** - Keep consistent across sources
✅ **Sector definitions** - Maintain same sectors
✅ **Common tags** - Use same tag names
✅ **Year extraction** - Keep logic identical
✅ **Chunking size** - Keep 800/200 for consistency

### When to Customize Per-Source

✅ **Web scraper** can use:
- URL-based hints (domain, path)
- Scraping strategy hints (jobs, news, skills)
- Additional web-specific tags
- DOM structure analysis
- HTTP headers/metadata

✅ **PDF parser** can use:
- Filename patterns
- Document structure (headers, footers)
- Table detection
- Page count/layout
- Confidence scores

---

## Update Checklist

When improving labeling logic:

### Option 1: Update Both (Recommended for Core Rules)

- [ ] Update `process-pdfs.ps1` functions:
  - `Get-DocumentCategory` (line ~414)
  - `Get-DocumentSector` (line ~461)
  - `Get-DocumentTags` (line ~438)
  - `Get-PublicationYear` (line ~482)

- [ ] Update `scraper.js` functions:
  - `extractCategory` (line ~427)
  - `extractSector` (line ~454)
  - `extractTags` (line ~474)
  - `extractPublicationYear` (line ~510)

- [ ] Update this documentation file
- [ ] Test both sources to verify consistency

### Option 2: Source-Specific Update

- [ ] Update only the relevant source file
- [ ] Document the customization reason below
- [ ] Add comments in code explaining the difference

---

## Source-Specific Customizations

Document any intentional differences here:

### Current Customizations

**Web Scraper Enhancements:**
- ✅ Uses scraping strategy as category hint (jobs→workforce, news→report)
- ✅ Checks URL for sector hints
- ✅ Adds `web-scraped` tag automatically
- ✅ Adds `south-australia` tag automatically
- ✅ Infers tags from category/sector

**PDF Parser Enhancements:**
- ✅ Uses filename for more reliable category detection
- ✅ Includes table row chunking (web scraper doesn't need this)
- ✅ Confidence scoring per chunk
- ✅ Retrieval weights (tables = 1.5, text = 1.0)

### Future Customizations

Add notes here when you make source-specific changes:

```
Date: YYYY-MM-DD
Source: PDF | Web
Change: Description of what you changed and why
Reason: Why this customization is source-specific
```

---

## Testing Labeling Consistency

### Quick Visual Check

Run both processes on sample data and compare outputs:

```powershell
# Process a PDF
.\infrastructure\scripts\process-pdfs.ps1 -ResourceGroupName "rg-test"

# Scrape a web page
cd infrastructure\web-scraper\enterprise-scraper
node scraper.js

# Compare categories, sectors, tags in Azure AI Search
```

### Automated Comparison Script

Coming soon: `infrastructure/scripts/compare-labeling.ps1`
- Samples documents from both sources
- Compares category/sector/tag distributions
- Flags major inconsistencies

---

## Vocabulary Reference

Quick reference for all labeling values:

**Categories (9):**
```
budget, strategy, workforce, education, health,
career-guidance, report, policy, government-document
```

**Sectors (13):**
```
health, education, public-sector, construction, technology,
agriculture, resources, services, finance, defense,
transport, community-services, general
```

**Tags (13+):**
```
south-australia, web-scraped, education, health, employment,
budget, training, job-application, migration, regional,
disability-inclusion, indigenous, youth
```

---

## Future Enhancements

Ideas for improving labeling (update both sources when implementing):

- [ ] **ML-based categorization** - Use Azure AI to auto-categorize
- [ ] **Confidence scores** - Add confidence to all labels (not just PDF)
- [ ] **Multi-language support** - Detect and label non-English content
- [ ] **Entity extraction** - Extract people, organizations, locations
- [ ] **Sentiment analysis** - Tag positive/negative/neutral content
- [ ] **Topic modeling** - Auto-discover new categories from content
- [ ] **Hierarchical categories** - Sub-categories (e.g., health → nursing)
- [ ] **Custom dictionaries** - Load industry-specific keyword lists
- [ ] **Regex library** - Shared regex patterns for both sources

---

## Questions?

For issues or questions about labeling:
1. Check this document first
2. Review source code comments
3. Test changes on sample data before production
4. Document any source-specific customizations above

**Remember:** It's OK for sources to have different logic! Just document why.

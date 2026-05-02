# Storage Architecture - How Data Flows

## Two Different Storage Patterns

### 1. PDFs: Blob Storage → Processing → AI Search Index

```
PDF File
    ↓
Azure Blob Storage (raw PDF stored here)
    ↓
Document Intelligence (extracts text)
    ↓
Processing Script (chunks, tags, extracts insights)
    ↓
Azure AI Search Index (searchable chunks stored here)
```

**PDFs are stored in TWO places:**
- **Blob Storage**: Original PDF files (long-term storage, ~$5-10/month)
- **AI Search Index**: Processed chunks (searchable content, part of ~$200/month)

### 2. Web Content: Direct Indexing (No Blob Storage)

```
Website URL
    ↓
Azure AI Search Indexer (crawls website)
    ↓
Extracts content directly from web
    ↓
Azure AI Search Index (searchable content stored here)
```

**Web content is stored in ONE place:**
- **AI Search Index**: Processed web content (searchable, part of ~$200/month)
- **NO Blob Storage**: Web content doesn't go to blob storage (it's temporary/live)

## Storage Details

### Azure Blob Storage (For PDFs Only)

**Location**: `rag-documents` container
**Purpose**: Store original PDF files
**Cost**: ~$5-10/month (depends on PDF size)
**Access**: Private (not publicly accessible)

**What's stored:**
- Original PDF files (your 53 PDFs)
- Organized by filename
- Used as source for Document Intelligence extraction

**Example structure:**
```
rag-documents/
  ├── budget-2024.pdf
  ├── policy-framework-2024.pdf
  ├── workforce-strategy.pdf
  └── ... (53 PDFs)
```

### Azure AI Search Index (For Both PDFs & Web)

**Index Name**: `sa-gov-documents`
**Purpose**: Searchable content database
**Cost**: Included in AI Search Basic (~$200/month)
**Access**: Private API (requires key)

**What's stored:**

#### From PDFs (after processing):
```json
{
  "id": "budget-2024.pdf-page15-chunk3",
  "content": "The health sector received $5 million...",
  "documentId": "budget-2024.pdf",
  "documentType": "pdf",
  "source": "pdf",
  "pageNumber": 15,
  "chunkIndex": 3,
  "category": "budget",
  "sector": "health",
  "tags": ["sa-government", "budget"],
  "topics": ["budget-allocation"],
  "extractedData": "{...budgets, trends...}",
  "metadata": "{fileName: 'budget-2024.pdf', ...}"
}
```

#### From Web Scraping (direct indexing):
```json
{
  "id": "web-abc123def456",
  "content": "SA Government announces new training programs...",
  "documentId": "https://jobs.sa.gov.au/job/12345",
  "documentType": "web",
  "source": "scraped",
  "url": "https://jobs.sa.gov.au/job/12345",
  "title": "Registered Nurse Position",
  "category": "job-listing",
  "sector": "health",
  "tags": ["sa-government", "full-time"],
  "topics": ["job-search"],
  "indexedAt": "2024-01-15T10:30:00Z"
}
```

## Key Differences

### PDFs:
- ✅ Stored in Blob Storage (original files)
- ✅ Processed through Document Intelligence
- ✅ Chunked, tagged, indexed into AI Search
- ✅ Can re-process anytime from original PDF
- ✅ Full source traceability (PDF + page number)

### Web Content:
- ❌ NOT stored in Blob Storage
- ✅ Directly indexed by AI Search indexers
- ✅ Indexed in real-time (or scheduled every 6 hours)
- ✅ Auto-updates when website changes
- ✅ Source traceability (URL)

## Why This Architecture?

### PDFs Need Blob Storage Because:
1. **Original files needed** for Document Intelligence
2. **Re-processing** - Can re-index if needed
3. **Backup** - Original documents preserved
4. **Cost-effective** - Blob storage is cheap (~$5-10/month)

### Web Content Doesn't Need Blob Storage Because:
1. **Live content** - Websites change, PDFs don't
2. **Auto-updates** - Indexers crawl every 6 hours
3. **No re-processing** - Direct indexing is simpler
4. **Cost savings** - No need to store temporary web content

## Data Flow Summary

### PDF Processing:
```
1. Upload PDF → Blob Storage
2. Process PDF → Extract text (Document Intelligence)
3. Chunk & Tag → Process content
4. Index chunks → AI Search Index
```

**Storage Locations:**
- PDF file: Blob Storage ✅
- Processed chunks: AI Search Index ✅

### Web Scraping:
```
1. Indexer crawls → Website URL
2. Extracts content → Direct from web
3. Tags content → Automatic tagging
4. Indexes content → AI Search Index
```

**Storage Locations:**
- Web content: AI Search Index only ✅
- No Blob Storage ❌

## Cost Breakdown

- **Blob Storage**: ~$5-10/month (PDFs only)
- **AI Search**: ~$200/month (includes indexing both PDFs and web)
- **Document Intelligence**: ~$50-100/month (PDF processing only)

**Total**: ~$255-310/month

## Querying the Data

Both PDFs and web content are queried the same way:

```
Query Azure AI Search Index
    ↓
Search across ALL content (PDFs + Web)
    Filter by: category, sector, tags, documentType
    ↓
Return results with source attribution
    - PDFs: "budget-2024.pdf, page 15"
    - Web: "https://jobs.sa.gov.au/job/12345"
```

## Important Notes

1. **PDFs are stored twice**: Original in Blob, processed in AI Search
2. **Web content stored once**: Only in AI Search Index
3. **Both searchable together**: Single index, unified search
4. **Source attribution**: Every result knows its source (PDF page or URL)
5. **Web content auto-updates**: Indexers refresh every 6 hours

This architecture gives you:
- ✅ Permanent storage for PDFs (Blob)
- ✅ Searchable content for both (AI Search)
- ✅ Cost-effective (no duplicate storage for web)
- ✅ Auto-updating web content
- ✅ Full source traceability






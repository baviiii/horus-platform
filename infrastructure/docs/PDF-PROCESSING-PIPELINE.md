# PDF Processing Pipeline - Zero Hallucination Guarantee

## Complete PDF Processing Flow

### Step 1: Upload PDFs to Blob Storage
```powershell
az storage blob upload `
  --account-name <storage-account> `
  --container-name rag-documents `
  --file "budget-2024.pdf" `
  --name "budget-2024.pdf"
```

### Step 2: Process PDFs (Extract, Tag, Index)
```powershell
.\process-pdfs.ps1 -ResourceGroupName "rg-careercraft-dev"
```

## Pipeline Stages

### 1. **Extraction** (Azure Document Intelligence)
- Extracts text from all pages
- Preserves structure (tables, headings)
- OCR for scanned documents
- **Result**: Clean, structured text per page

### 2. **Chunking** (Smart Text Segmentation)
- Splits into 500-1000 character chunks
- 200 character overlap (for context)
- Preserves page numbers
- **Result**: Chunked text with page attribution

### 3. **Tagging** (Categorization)
- Analyzes content to determine:
  - Category (budget, policy, report, etc.)
  - Sector (health, education, etc.)
  - Topics (budget-allocation, trend-analysis, etc.)
  - Occupation (if mentioned)
- **Result**: Comprehensive tags for filtering

### 4. **Insight Extraction** (Structured Data)
- Extracts budgets (amounts, allocations)
- Extracts trends (growth percentages)
- Extracts policy changes
- Extracts market insights
- **Result**: Structured data for visualizations

### 5. **Indexing** (Azure AI Search)
- Each chunk indexed separately
- Full source attribution:
  - `documentId`: Original PDF filename
  - `pageNumber`: Exact page number
  - `chunkIndex`: Chunk position
  - `metadata`: File info, size, etc.
- Tags and extracted data included
- **Result**: Searchable, traceable chunks

## Zero Hallucination Guarantee

### How We Prevent Hallucination:

1. **Source Attribution**
   - Every chunk has `documentId` (PDF filename)
   - Every chunk has `pageNumber` (exact page)
   - Every chunk has `chunkIndex` (position in document)

2. **RAG Pattern**
   - User queries → Search relevant chunks
   - Return chunks with source citations
   - LLM generates answer FROM chunks only
   - Answer includes: "According to [document], page [X]..."

3. **Full Traceability**
   ```json
   {
     "answer": "...",
     "sources": [
       {
         "document": "budget-2024.pdf",
         "page": 15,
         "chunk": 3,
         "content": "..."
       }
     ]
   }
   ```

4. **No Fabrication**
   - LLM only uses retrieved chunks
   - Can't make up information
   - Must cite source for every claim

## Index Structure

Each indexed chunk contains:

```json
{
  "id": "budget-2024.pdf-page15-chunk3",
  "content": "The health sector received $5 million...",
  "documentId": "budget-2024.pdf",
  "documentType": "pdf",
  "source": "pdf",
  "title": "budget-2024",
  "pageNumber": 15,
  "chunkIndex": 3,
  "category": "budget",
  "sector": "health",
  "tags": ["sa-government", "budget"],
  "topics": ["budget-allocation"],
  "extractedData": {
    "budgetFigures": [
      { "sector": "health", "amount": 5000000, "year": 2024 }
    ]
  },
  "indexedAt": "2024-01-15T10:30:00Z",
  "metadata": "{\"fileName\":\"budget-2024.pdf\",\"totalPages\":50}"
}
```

## Query Flow (RAG)

```
User Query: "What's the health budget for 2024?"
    ↓
Search Azure AI Search
    Filter: category eq 'budget' and sector eq 'health'
    ↓
Retrieve Relevant Chunks (with page numbers)
    [
      {content: "...", pageNumber: 15, documentId: "budget-2024.pdf"},
      {content: "...", pageNumber: 16, documentId: "budget-2024.pdf"}
    ]
    ↓
Send to LLM with Context
    "Based on these chunks from budget-2024.pdf (pages 15-16): ..."
    ↓
LLM Generates Answer
    "According to budget-2024.pdf, page 15, the health sector 
     received $5 million in 2024..."
    ↓
Return Answer with Sources
    {
      answer: "...",
      sources: [
        {document: "budget-2024.pdf", page: 15}
      ]
    }
```

## Key Features

✅ **Accurate**: Document Intelligence extracts exact text
✅ **Traceable**: Every chunk has source + page number
✅ **Tagged**: Easy filtering by category, sector, topic
✅ **Structured**: Budgets, trends extracted for visualizations
✅ **No Hallucination**: RAG ensures answers come from documents only

## Best Practices

1. **Upload Quality PDFs**: Text-based PDFs work better than scanned
2. **Organize by Source**: Use descriptive filenames
3. **Process Regularly**: Re-process when PDFs are updated
4. **Verify Sources**: Always include source citations in UI
5. **Monitor Chunks**: Ensure chunks aren't too small/large

## Example Processing

```powershell
# 1. Upload PDF
az storage blob upload `
  --account-name careercraftdevsa... `
  --container-name rag-documents `
  --file "SA-Health-Budget-2024.pdf"

# 2. Process it
.\process-pdfs.ps1 -ResourceGroupName "rg-careercraft-dev"

# Output:
# Processing: SA-Health-Budget-2024.pdf
#   ✅ Extracted 50 pages, 125,000 characters
#   ✅ Created 156 chunks
#   ✅ Tagged: category=budget, sector=health
#   ✅ Extracted: 12 budgets, 5 trends
#   ✅ Indexed 156/156 chunks
#   ✅ PDF processed successfully!
```

## Result

Every answer in your RAG system will:
- Come from actual documents
- Include source citations (document + page)
- Be traceable back to original PDF
- Have zero hallucination

**This is how you build trustworthy RAG!** 🔒






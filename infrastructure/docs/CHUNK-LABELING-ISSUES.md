# Chunk Labeling Issues & Fixes

## Overview

This document outlines identified issues with how chunks are labeled during PDF processing and embedding, particularly focusing on sector classification. These issues can be addressed in a future update without requiring full reprocessing of existing documents.

---

## Current Labeling Process

### How It Works Now

1. **Document-Level Analysis** (Once per PDF):
   - Sector, category, and tags are extracted from the entire document
   - Analysis uses first 3000 characters only
   - Simple regex pattern matching

2. **Applied to All Chunks**:
   - Every chunk from the same document gets identical labels
   - No chunk-level analysis
   - Same sector/category/tags for all chunks

3. **Embedding Generation**:
   - Each chunk's content is embedded semantically
   - Metadata (sector, category, tags) is stored but not embedded
   - Embeddings capture meaning, not metadata

---

## Issues Identified

### Issue 1: Document-Level Sector Assignment ⚠️ **HIGH PRIORITY**

**Problem:**
- Sector is extracted once per document and applied to ALL chunks
- Multi-sector documents get mislabeled
- Chunks discussing different topics get the same sector

**Example:**
```
Document: "SA Budget 2024" (covers health, education, defense)
Sector extracted: "health" (first match wins)

Result:
- Chunk 1: Healthcare funding → sector="health" ✅ Correct
- Chunk 2: Education programs → sector="health" ❌ Wrong (should be "education")
- Chunk 3: Defense spending → sector="health" ❌ Wrong (should be "defense")
```

**Impact:**
- Sector filtering misses relevant chunks
- Multi-sector queries return incomplete results
- Graph entity extraction may miss connections

**Current Code Location:**
```powershell
# infrastructure/process-pdfs.ps1:1033
$sector = Get-DocumentSector -Content $fullText  # Document-level

# infrastructure/process-pdfs.ps1:1123
$document["sector"] = $sector  # Applied to all chunks
```

---

### Issue 2: Basic Regex Pattern Matching ⚠️ **MEDIUM PRIORITY**

**Problem:**
- Only checks first 3000 characters of document
- Simple keyword matching (no context understanding)
- First match wins (no multi-sector detection)
- Limited to 12 predefined sectors

**Current Implementation:**
```powershell
function Get-DocumentSector {
    param([string]$Content)
    
    $lowerContent = $Content.ToLower().Substring(0, [Math]::Min(3000, $Content.Length))
    # Only checks FIRST 3000 characters!
    
    if ($lowerContent -match "health|hospital|nursing|medical|sa health") { return "health" }
    if ($lowerContent -match "education|school|teacher|learning") { return "education" }
    # ... 10 more patterns ...
    
    return "general"  # Fallback
}
```

**Impact:**
- Documents with sector info later in document may be misclassified
- No understanding of context (e.g., "health insurance" vs "healthcare sector")
- Cannot detect multiple sectors in one document

---

### Issue 3: Limited Sector Coverage ⚠️ **MEDIUM PRIORITY**

**Current Sectors (12):**
- health
- education
- public-sector
- construction
- technology
- agriculture
- resources
- services
- finance
- defense
- transport
- community-services
- general (fallback)

**Missing/Incomplete Sectors:**
- `renewable-energy` (only matches "energy" → "resources")
- `information-technology` (only matches "technology")
- `tourism` (only matches "services")
- `manufacturing` (not detected)
- `mining` (only matches "resources")
- `retail` (only matches "services")
- `hospitality` (only matches "services")
- `real-estate` (not detected)
- `space` (not detected)
- `creative-industries` (not detected)

**Impact:**
- Many sectors fall back to "general"
- Sector filtering is less precise
- Graph entity matching may fail

---

### Issue 4: Sector Naming Inconsistency ⚠️ **MEDIUM PRIORITY**

**Problem:**
- Script uses different sector names than graph entities
- Mismatch between chunk labels and graph RAG entities

**Current Script Uses:**
- `"health"` 
- `"technology"`
- `"defense"`

**Graph Entities Use:**
- `"healthcare"` (not "health")
- `"information_technology"` (not "technology")
- `"defence"` (not "defense")

**Impact:**
- Graph traversal may not match chunk sectors to graph entities
- Entity lookup may fail
- Relationship discovery less accurate

---

### Issue 5: No Chunk-Level Sector Analysis ⚠️ **HIGH PRIORITY**

**Problem:**
- Each chunk should potentially have its own sector
- Currently all chunks from same document share sector
- No analysis of individual chunk content

**Current:**
```powershell
# Document-level sector
$sector = Get-DocumentSector -Content $fullText

# Applied to ALL chunks
foreach ($chunk in $textChunks) {
    $document["sector"] = $sector  # Same for all
}
```

**Should Be:**
```powershell
# Chunk-level sector
foreach ($chunk in $textChunks) {
    $chunkSector = Get-ChunkSector -Content $chunk.text  # Analyze each chunk
    $document["sector"] = $chunkSector
}
```

**Impact:**
- Multi-sector documents mislabeled
- Chunk-level filtering inaccurate
- Graph entity extraction less precise

---

## Impact Assessment

### Current Impact: **MEDIUM**

**What's Affected:**
- ✅ Sector filtering may miss some chunks
- ✅ Multi-sector documents mislabeled
- ✅ Some sectors fall back to "general"
- ✅ Graph entity matching may fail

**What Still Works:**
- ✅ Vector search (semantic, not sector-dependent)
- ✅ Graph entity extraction (from content, not labels)
- ✅ General queries (don't rely on sector labels)
- ✅ Hybrid RAG (combines multiple search methods)

### After Fix: **HIGH ACCURACY**

**Benefits:**
- ✅ Accurate sector classification per chunk
- ✅ Chunk-level precision
- ✅ Better filtering and search
- ✅ Improved graph entity matching
- ✅ Multi-sector detection

---

## Solutions & Fixes

### Fix 1: Implement Chunk-Level Sector Analysis 🔧

**Implementation:**
```powershell
function Get-ChunkSector {
    param([string]$ChunkText)
    
    # Analyze THIS chunk's content
    $lowerChunk = $ChunkText.ToLower()
    
    # More sophisticated matching with context
    # Could use GPT-4 for better classification
    # ...
    
    return $sector
}

# In processing loop:
foreach ($chunk in $textChunks) {
    $chunkSector = Get-ChunkSector -Content $chunk.text
    $document["sector"] = $chunkSector
}
```

**Benefits:**
- Each chunk gets accurate sector
- Multi-sector documents handled correctly
- Better filtering precision

---

### Fix 2: Enhanced Sector Extraction 🔧

**Option A: Improved Regex (Quick Fix)**
```powershell
function Get-ChunkSector {
    param([string]$ChunkText)
    
    # Check entire chunk (not just first 3000 chars)
    $lowerChunk = $ChunkText.ToLower()
    
    # More comprehensive patterns
    # Context-aware matching
    # Multi-sector detection
    
    return $sectors  # Array of sectors
}
```

**Option B: GPT-4 Classification (Better Accuracy)**
```powershell
function Get-ChunkSectorWithGPT {
    param([string]$ChunkText, [string]$OpenAIEndpoint, [string]$OpenAIKey)
    
    # Use GPT-4 to classify chunk
    # More accurate than regex
    # Can detect multiple sectors
    # Better context understanding
    
    return $sectors
}
```

**Benefits:**
- More accurate classification
- Multi-sector detection
- Better context understanding

---

### Fix 3: Sector Normalization 🔧

**Implementation:**
```powershell
function Normalize-Sector {
    param([string]$Sector)
    
    $sectorMap = @{
        "health" = "healthcare"
        "technology" = "information_technology"
        "defense" = "defence"
        "it" = "information_technology"
        "ict" = "information_technology"
        "renewable-energy" = "renewable_energy"
        # ... more mappings
    }
    
    return $sectorMap[$Sector] ?? $Sector
}

# Apply normalization
$normalizedSector = Normalize-Sector -Sector $chunkSector
```

**Benefits:**
- Consistent naming with graph entities
- Better graph traversal matching
- Improved entity lookup

---

### Fix 4: Expand Sector Coverage 🔧

**Add Missing Sectors:**
```powershell
function Get-ChunkSector {
    param([string]$ChunkText)
    
    $lowerChunk = $ChunkText.ToLower()
    
    # Existing sectors...
    
    # Add missing sectors:
    if ($lowerChunk -match "renewable|solar|wind|clean energy") { return "renewable_energy" }
    if ($lowerChunk -match "tourism|travel|visitor") { return "tourism" }
    if ($lowerChunk -match "manufacturing|factory|production") { return "manufacturing" }
    if ($lowerChunk -match "mining|mineral|extraction") { return "mining" }
    if ($lowerChunk -match "retail|shopping|store") { return "retail" }
    if ($lowerChunk -match "hospitality|hotel|restaurant") { return "hospitality" }
    if ($lowerChunk -match "real estate|property|housing") { return "real_estate" }
    if ($lowerChunk -match "space|satellite|aerospace") { return "space" }
    if ($lowerChunk -match "creative|arts|media|design") { return "creative_industries" }
    
    return "general"
}
```

**Benefits:**
- More comprehensive sector coverage
- Fewer "general" fallbacks
- Better classification accuracy

---

### Fix 5: Update Existing Chunks (No Re-Embedding) 🔧

**Implementation:**
```powershell
# Update sector field in Azure AI Search
# No need to regenerate embeddings
# Just update the metadata

function Update-ChunkSectors {
    param(
        [string]$SearchEndpoint,
        [string]$SearchKey,
        [string]$SearchIndex
    )
    
    # Fetch all chunks
    # Re-analyze each chunk's content
    # Update sector field only
    # No embedding regeneration needed
}
```

**Benefits:**
- Fix existing chunks without reprocessing
- No embedding regeneration (saves time/cost)
- Metadata-only update

---

## Implementation Plan

### Phase 1: Quick Wins (1-2 days)
1. ✅ Implement chunk-level sector analysis
2. ✅ Expand sector coverage
3. ✅ Add sector normalization

**Files to Modify:**
- `infrastructure/process-pdfs.ps1`
  - Update `Get-DocumentSector` → `Get-ChunkSector`
  - Move sector extraction inside chunk loop
  - Add sector normalization

### Phase 2: Enhanced Classification (3-5 days)
1. ✅ Implement GPT-4-based sector classification (optional)
2. ✅ Multi-sector detection
3. ✅ Context-aware matching

**Files to Modify:**
- `infrastructure/process-pdfs.ps1`
  - Add `Get-ChunkSectorWithGPT` function
  - Update processing loop to use GPT-4

### Phase 3: Update Existing Chunks (1-2 days)
1. ✅ Create update script
2. ✅ Re-analyze existing chunks
3. ✅ Update Azure AI Search metadata

**New Files:**
- `infrastructure/update-chunk-sectors.ps1`

---

## Testing Plan

### Test Cases

1. **Multi-Sector Document:**
   - Document covering health, education, defense
   - Verify each chunk gets correct sector

2. **Sector Normalization:**
   - Chunk with "health" → should normalize to "healthcare"
   - Verify graph entity matching works

3. **Missing Sectors:**
   - Document about tourism
   - Verify gets "tourism" not "general"

4. **Chunk-Level Accuracy:**
   - Document with mixed content
   - Verify each chunk classified correctly

---

## Migration Strategy

### For New Documents
- ✅ Apply fixes immediately
- ✅ New processing uses chunk-level analysis
- ✅ Better classification from start

### For Existing Documents
- ✅ Option 1: Update metadata only (fast)
- ✅ Option 2: Reprocess if needed (thorough)
- ✅ Option 3: Hybrid (update metadata, reprocess critical docs)

---

## Cost Considerations

### Current (No Fix)
- Sector misclassification → missed results
- User frustration → lower satisfaction
- Graph matching failures → reduced intelligence

### After Fix
- **Option A (Regex):** No additional cost
- **Option B (GPT-4):** ~$0.001 per chunk classification
  - 30k chunks × $0.001 = ~$30 one-time
  - Worth it for accuracy improvement

---

## Priority Ranking

1. **HIGH:** Chunk-level sector analysis (Fix 1)
2. **HIGH:** Sector normalization (Fix 3)
3. **MEDIUM:** Expand sector coverage (Fix 4)
4. **MEDIUM:** Enhanced extraction (Fix 2)
5. **LOW:** Update existing chunks (Fix 5) - can be done later

---

## Notes

- ✅ Current system works for demos
- ✅ Vector search is semantic (not sector-dependent)
- ✅ Graph extraction reads content (not just labels)
- ✅ Fixes can be implemented incrementally
- ✅ No need to reprocess all documents immediately

---

## Related Files

- `infrastructure/process-pdfs.ps1` - Main processing script
- `supabase/migrations/20260106000001_add_graph_rag_tables.sql` - Graph entity types
- `azure-functions/entity-extraction/index.js` - Entity extraction (uses content, not labels)

---

## Questions?

- Can we fix this incrementally? **Yes**
- Do we need to reprocess all documents? **No (metadata update only)**
- Will this break existing functionality? **No**
- How long will fixes take? **1-2 days for quick wins, 3-5 days for full implementation**

---

**Last Updated:** 2025-01-06  
**Status:** Issues identified, fixes planned  
**Priority:** Medium (can be addressed post-demo)


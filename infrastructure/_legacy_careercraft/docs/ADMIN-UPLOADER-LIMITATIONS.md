# Admin PDF Uploader - Current Limitations & Missing Features

**Last Updated:** 2026-01-20  
**Status:** ⚠️ Functional but has limitations

## Overview

The admin PDF uploader uses Azure Automation Runbook (`process-single-pdf-runbook.ps1`) to process PDFs when uploaded via the admin UI. This document outlines what's missing compared to the local processing script (`process-pdfs.ps1`).

---

## 🔴 Missing: Python JSON Normalization

### What's Missing

- **Python script** (`prepare-search-doc.py`) is **NOT guaranteed** to be available in Azure Automation sandbox
- The runbook tries to find Python but may fall back to PowerShell-only JSON serialization

### Impact

1. **Array Serialization Issues:**
   - Azure Search expects `tags`, `sectors`, `topics` as **arrays** (`Collection(Edm.String)`)
   - PowerShell's `ConvertTo-Json` can sometimes serialize arrays incorrectly:
     - Empty arrays might become `null`
     - Single-item arrays might become scalars
     - This can cause **400 Bad Request** errors when indexing

2. **Data Quality:**
   - Documents may fail to index silently
   - Coverage metrics may be inaccurate
   - Some chunks might be missing from search results

### Current Workaround

- The runbook includes a **PowerShell fallback** (`Get-CleanSearchJson` function) that manually normalizes arrays
- This fallback tries to ensure arrays are always arrays, but it's less robust than the Python script
- **Status:** Works in most cases, but edge cases may still fail

### What Works Locally

- ✅ `process-pdfs.ps1` has Python available locally
- ✅ Uses `prepare-search-doc.py` for bulletproof JSON normalization
- ✅ Tracks `pythonJsonFixes` in statistics
- ✅ Zero serialization errors

---

## 🔴 Missing: PDF-to-Image Rendering Service

### What's Missing

- **PDF Renderer Service** (Azure Container Instance) is **NOT integrated** into the processing pipeline
- The service exists (`azure-functions/pdf-renderer/`) but is not called by either:
  - ❌ Local script (`process-pdfs.ps1`)
  - ❌ Admin uploader runbook (`process-single-pdf-runbook.ps1`)

### Current State

- **PDF Renderer Container:** ✅ Deployed and running in Azure Container Instance
- **Endpoint:** Available at `http://[fqdn]:3000/render`
- **Purpose:** Converts PDF pages → PNG images using Poppler (`pdftoppm`)
- **Integration:** ❌ Not used in PDF processing pipeline

### Impact

1. **Chart/Figure Extraction:**
   - Charts and figures are detected by Document Intelligence
   - Metadata is captured (bounding boxes, page numbers)
   - But actual image extraction/rendering is **not implemented**
   - Comments in code say: `"Full image extraction requires PDF rendering"`

2. **Visual Content:**
   - Visual elements (charts, graphs, diagrams) are not extracted as images
   - Only text content and table data are fully processed
   - Chart metadata exists but images are not stored/retrievable

### Why It's Not Used

- The PDF renderer service was created but never integrated
- Document Intelligence provides enough text/table extraction for current needs
- Chart rendering would require:
  1. Calling PDF renderer API for each chart region
  2. Storing rendered images (blob storage or base64)
  3. Adding image URLs to chunk metadata
  4. Additional processing time and costs

### What Works Locally

- ❌ **Neither** local script nor runbook use PDF renderer
- ✅ Document Intelligence extracts chart metadata
- ✅ Chart bounding boxes and page numbers are indexed
- ⚠️ Actual chart images are not rendered or stored

---

## 📊 Comparison: Local vs Admin Uploader

| Feature                         | Local Script (`process-pdfs.ps1`) | Admin Uploader (Runbook) |
| ------------------------------- | --------------------------------- | ------------------------ |
| **Python JSON Normalization**   | ✅ Available                      | ⚠️ May not be available  |
| **PowerShell Fallback**         | ✅ Available (backup)             | ✅ Available (primary)   |
| **Document Intelligence**       | ✅ Full support                   | ✅ Full support          |
| **Chunking (Text/Table/Chart)** | ✅ Full support                   | ✅ Full support          |
| **Embedding Generation**        | ✅ Full support                   | ✅ Full support          |
| **Status Reporting**            | ✅ Console output                 | ✅ Real-time API updates |
| **Batch Processing**            | ✅ Multiple PDFs                  | ❌ Single PDF only       |
| **Force Reprocess**             | ✅ Available                      | ❌ Not available         |
| **Coverage Verification**       | ✅ Detailed metrics               | ✅ Basic metrics         |
| **Error Recovery**              | ✅ Retry logic                    | ⚠️ Limited retry         |
| **PDF-to-Image Rendering**      | ❌ Not integrated                 | ❌ Not integrated        |

---

## 🛠️ Solutions to Fix Python Availability

### Option 1: Upload Python Script as Module (Recommended)

**Effort:** Medium  
**Reliability:** High

1. Upload `prepare-search-doc.py` to Azure Automation as a module
2. Update runbook to reference module path
3. **Pros:** Guaranteed availability, same as local script
4. **Cons:** Requires manual module upload

**Steps:**

```powershell
# In Azure Portal:
# 1. Automation Account → Modules → Add Module
# 2. Upload prepare-search-doc.py as a module
# 3. Update runbook to use: $env:AZURE_AUTOMATION_MODULE_PATH\prepare-search-doc.py
```

### Option 2: Download from Blob Storage

**Effort:** Low  
**Reliability:** Medium

1. Store `prepare-search-doc.py` in blob storage
2. Runbook downloads it at runtime
3. **Pros:** Easy to update, no manual upload
4. **Cons:** Adds download step, requires storage access

**Implementation:**

```powershell
# In runbook, add:
$pythonScriptUrl = "https://[storage].blob.core.windows.net/scripts/prepare-search-doc.py"
$pythonHelperScript = "/tmp/prepare-search-doc.py"
Invoke-WebRequest -Uri $pythonScriptUrl -OutFile $pythonHelperScript
```

### Option 3: Use Azure Container Instance (Like PDF Renderer)

**Effort:** High  
**Reliability:** Very High

1. Create a container with Python pre-installed
2. Run processing in container instead of runbook
3. **Pros:** Full control, Python guaranteed, can add more tools
4. **Cons:** More complex, requires container orchestration

**Note:** This would be similar to how `pdf-renderer` works (Azure Container Instance).

---

## 📝 Current Status

### What Works ✅

- PDF upload from admin UI
- Event Grid trigger
- Document Intelligence extraction
- Chunking (text, tables, charts)
- Embedding generation
- Azure Search indexing
- Real-time status updates
- Basic error handling

### What's Risky ⚠️

- JSON serialization (PowerShell fallback may miss edge cases)
- Array field normalization (tags, sectors, topics)
- Silent indexing failures (if JSON is malformed)

### What's Missing ❌

- Python JSON normalization (guaranteed)
- Batch processing (one PDF at a time)
- Force reprocess option
- Detailed coverage metrics in UI
- PDF-to-image rendering (chart/figure extraction)

---

## 🔍 How to Verify Current State

### Check if Python is Available in Runbook

1. Run the runbook manually
2. Check output logs for:
   - `"Python detected: Python X.X.X"` → ✅ Python available
   - `"Python not available - will use PowerShell fallback"` → ⚠️ Using fallback

### Check for Indexing Errors

1. Monitor Azure Search logs
2. Look for `400 Bad Request` errors
3. Check if documents have missing `tags`, `sectors`, or `topics` arrays

### Test JSON Serialization

1. Upload a test PDF via admin UI
2. Check the indexed document in Azure Search
3. Verify `tags`, `sectors`, `topics` are arrays (not null or scalars)

---

## 🎯 Recommended Next Steps

1. **Short-term:** Monitor admin uploads for indexing errors
2. **Medium-term:** Implement Option 2 (download from blob storage)
3. **Long-term:** Consider Option 3 (container-based processing) for full feature parity

---

## 📚 Related Files

- **Runbook:** `infrastructure/scripts/process-single-pdf-runbook.ps1`
- **Local Script:** `infrastructure/scripts/process-pdfs.ps1`
- **Python Helper:** `infrastructure/scripts/prepare-search-doc.py`
- **Azure Function:** `azure-functions/pdf-upload/index.js`
- **PDF Renderer Service:** `azure-functions/pdf-renderer/server.js` (exists but not integrated)
- **PDF Renderer Deployment:** `infrastructure/scripts/deploy-pdf-renderer.ps1`

---

## 💡 Notes

- The PowerShell fallback is **functional** but not as robust as Python
- Most PDFs process successfully with the fallback
- Edge cases (complex metadata, many tags) may fail
- Local script remains the most reliable option for bulk processing
- **PDF Renderer:** Service exists but is not integrated - would require additional API calls and image storage
- **Chart Extraction:** Currently only metadata is captured, not actual rendered images

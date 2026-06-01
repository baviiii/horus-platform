# Encoding Pipeline: Three Translation Stages Explained

## Overview

Your web scraper goes through **three critical encoding translations** where UTF-8/ASCII issues can occur:

```
[Stage 1] Web Scraping (JavaScript/Node.js)
    ↓
[Stage 2] Embedding Generation (PowerShell → Azure OpenAI API)
    ↓
[Stage 3] JSON Upload (PowerShell → Azure AI Search API)
```

---

## Stage 1: Web Scraping → Raw Text (JavaScript/Node.js)

**What happens:**

- Playwright scrapes HTML from websites
- Extracts text using `innerText` (handles Unicode automatically)
- Saves to JSON file

**Encoding:**

- JavaScript strings are **UTF-16 internally**
- When saved to JSON file: **UTF-8** (standard JSON encoding)
- **Issue:** Web pages can contain:
  - Smart quotes (`"` `"` `'` `'`)
  - Em dashes (`—`)
  - En dashes (`–`)
  - Ellipsis (`…`)
  - Zero-width characters
  - BOM (Byte Order Mark)
  - Control characters

**Example problematic characters:**

```javascript
// These come from web pages:
"South Australia's"; // Smart quote (U+2019)
'2024–2025'; // En dash (U+2013)
'Details…'; // Ellipsis (U+2026)
```

**Current state:** ✅ **No sanitization here** - raw text saved as-is

---

## Stage 2: Raw Text → Embeddings (PowerShell → Azure OpenAI)

**What happens:**

1. PowerShell reads JSON file (UTF-8)
2. Extracts `content` field
3. **FIRST SANITIZATION:** `Sanitize-TextForIndexing()` cleans text
4. Converts to JSON for Azure OpenAI API
5. Sends to embedding API
6. Receives vector embedding

**Encoding issues here:**

- **Problem:** Azure OpenAI API expects **valid UTF-8 JSON**
- Invalid characters cause **400 Bad Request** errors
- Example: Byte `[E2]` = start of 3-byte UTF-8 sequence (like `…` ellipsis)
  - If sequence is incomplete → invalid UTF-8 → 400 error

**Sanitization process:**

```powershell
# Step 1: Unicode Normalization (FormC)
$Text = $Text.Normalize([System.Text.NormalizationForm]::FormC)
# Converts: "é" (decomposed) → "é" (composed)

# Step 2: Character-by-character cleaning
foreach ($char in $Text.ToCharArray()) {
    if ($charCode -eq 0x2019) {  # Smart quote
        $sb.Append("'")  # Convert to ASCII apostrophe
    }
    # ... more conversions
}

# Step 3: UTF-8 validation
$bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
$Text = [System.Text.Encoding]::UTF8.GetString($bytes)
```

**What gets cleaned:**

- Smart quotes → standard quotes
- Em/En dashes → hyphens
- Ellipsis → three dots
- Non-ASCII → removed (or converted to ASCII equivalent)
- Control characters → removed

**Result:** Clean UTF-8 text that Azure OpenAI can process ✅

---

## Stage 3: Embeddings + Metadata → JSON Upload (PowerShell → Azure AI Search)

**What happens:**

1. Embeddings are generated (Stage 2) ✅
2. PowerShell creates upload document with:
   - `content` (sanitized from Stage 2)
   - `title` (NOT sanitized yet!)
   - `metadata` (NOT sanitized yet!)
   - `contentVector` (embedding array)
   - Other fields
3. **SECOND SANITIZATION:** All text fields sanitized
4. Converts entire document to JSON
5. Sends to Azure AI Search API

**Encoding issues here:**

- **Problem:** `ConvertTo-Json` in PowerShell can create invalid UTF-8 if:
  - Title has smart quotes
  - Metadata has Unicode characters
  - Any field has invalid sequences
- Azure AI Search rejects invalid UTF-8 → **"Unable to translate bytes [E2]"** error

**Why this happens:**

```powershell
# BEFORE FIX (problematic):
$uploadDoc = @{
    "title" = "South Australia's"  # Smart quote (U+2019) → invalid UTF-8 in JSON
    "content" = $sanitizedContent  # ✅ Already sanitized
}
$body = $uploadDoc | ConvertTo-Json  # ❌ Fails here!

# AFTER FIX (correct):
$sanitizedTitle = Sanitize-TextForIndexing -Text $doc.title  # ✅ Sanitize ALL fields
$uploadDoc = @{
    "title" = $sanitizedTitle  # ✅ Clean UTF-8
    "content" = $sanitizedContent  # ✅ Already sanitized
}
$body = $uploadDoc | ConvertTo-Json  # ✅ Works!
```

**What we sanitize in Stage 3:**

- ✅ `content` (already sanitized in Stage 2, but sanitize again for safety)
- ✅ `title` (NEW - this was the problem!)
- ✅ `metadata` (NEW - handles both string and object formats)
- ✅ All other text fields

---

## Why Three Stages?

### Stage 1 (No sanitization):

- **Reason:** Keep raw data for debugging
- **Risk:** Low - JavaScript handles Unicode well
- **Action:** None needed

### Stage 2 (First sanitization):

- **Reason:** Azure OpenAI API is strict about UTF-8
- **Risk:** High - 400 errors if invalid characters
- **Action:** ✅ Sanitize `content` before embedding

### Stage 3 (Second sanitization):

- **Reason:** PowerShell `ConvertTo-Json` + Azure AI Search both need valid UTF-8
- **Risk:** High - "Unable to translate bytes" errors
- **Action:** ✅ Sanitize **ALL** text fields before JSON conversion

---

## The Byte [E2] Error Explained

**What is [E2]?**

- `E2` (hex) = `226` (decimal) = `11100010` (binary)
- This is the **first byte** of a 3-byte UTF-8 sequence
- Common characters starting with `E2`:
  - `E2 80 93` = En dash (`–`)
  - `E2 80 94` = Em dash (`—`)
  - `E2 80 98` = Left single quote (`'`)
  - `E2 80 99` = Right single quote (`'`)
  - `E2 80 9C` = Left double quote (`"`)
  - `E2 80 9D` = Right double quote (`"`)
  - `E2 80 A6` = Ellipsis (`…`)

**Why it fails:**

1. Web page has smart quote: `'` (3 bytes: `E2 80 99`)
2. If only `E2` is read (incomplete sequence) → invalid UTF-8
3. Azure AI Search tries to decode → **"Unable to translate bytes [E2]"**

**Solution:**

- Sanitize **before** JSON conversion
- Convert smart quotes to ASCII: `'` → `'`
- Ensures only valid UTF-8 sequences

---

## Summary

| Stage             | Input                 | Output           | Sanitization      | Why                                             |
| ----------------- | --------------------- | ---------------- | ----------------- | ----------------------------------------------- |
| **1. Scraping**   | HTML                  | JSON file        | ❌ None           | JavaScript handles Unicode                      |
| **2. Embeddings** | Raw text              | Embedding vector | ✅ Content only   | Azure OpenAI needs valid UTF-8                  |
| **3. Upload**     | Embeddings + metadata | Azure AI Search  | ✅ **ALL fields** | PowerShell JSON + Azure Search need valid UTF-8 |

**Key insight:** You need sanitization at **both Stage 2 AND Stage 3** because:

- Stage 2: Only sanitizes `content` for embeddings
- Stage 3: Must sanitize **ALL** text fields (title, metadata, etc.) for JSON upload

**The fix:** Sanitize all text fields in Stage 3, not just content! ✅

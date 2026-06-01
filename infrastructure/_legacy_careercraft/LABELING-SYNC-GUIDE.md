# Labeling Sync Guide

Quick reference for maintaining labeling consistency between PDF parser and web scraper.

## TL;DR

**Labeling logic is intentionally duplicated** to allow source-specific customizations. This is by design!

When you improve labeling:

1. Update the source you're working on
2. Decide if other source needs same update
3. Update `docs/LABELING-RULES.md` documentation
4. Run `.\scripts\compare-labeling.ps1` to verify

---

## Files to Know

| File                                          | Purpose              | When to Edit                 |
| --------------------------------------------- | -------------------- | ---------------------------- |
| **docs/LABELING-RULES.md**                    | Master reference doc | After any labeling change    |
| **scripts/process-pdfs.ps1**                  | PDF labeling logic   | Improving PDF categorization |
| **web-scraper/enterprise-scraper/scraper.js** | Web labeling logic   | Improving web categorization |
| **scripts/compare-labeling.ps1**              | Consistency checker  | Run after updates            |

---

## Quick Workflow

### When Updating PDF Parser

```powershell
# 1. Update PDF parser labeling functions
code infrastructure/scripts/process-pdfs.ps1
# Functions: Get-DocumentCategory, Get-DocumentSector, Get-DocumentTags

# 2. Decide: Does web scraper need this change?
#    - Core rules (categories, sectors)? → YES, update both
#    - PDF-specific (filename patterns)? → NO, PDF only

# 3. Update web scraper if needed
code infrastructure/web-scraper/enterprise-scraper/scraper.js
# Functions: extractCategory, extractSector, extractTags

# 4. Update reference documentation
code infrastructure/docs/LABELING-RULES.md

# 5. Check consistency
.\infrastructure\scripts\compare-labeling.ps1
```

### When Updating Web Scraper

```powershell
# 1. Update web scraper labeling functions
code infrastructure/web-scraper/enterprise-scraper/scraper.js
# Functions: extractCategory, extractSector, extractTags

# 2. Decide: Does PDF parser need this change?
#    - Core rules (categories, sectors)? → YES, update both
#    - Web-specific (URL hints, strategy)? → NO, web only

# 3. Update PDF parser if needed
code infrastructure/scripts/process-pdfs.ps1
# Functions: Get-DocumentCategory, Get-DocumentSector, Get-DocumentTags

# 4. Update reference documentation
code infrastructure/docs/LABELING-RULES.md

# 5. Check consistency
.\infrastructure\scripts\compare-labeling.ps1
```

---

## What to Update in Both

✅ **Always sync these:**

- Category names (budget, workforce, etc.)
- Sector names (health, education, etc.)
- Tag names (employment, migration, etc.)
- Core keyword patterns
- Chunking size (800) and overlap (200)

❌ **OK to keep different:**

- Web scraper: URL-based hints
- Web scraper: Strategy-based defaults
- Web scraper: Additional web-specific tags
- PDF parser: Filename patterns
- PDF parser: Table-specific logic
- PDF parser: Confidence scoring

---

## Example: Adding New Category

Let's say you want to add a "climate" category for climate-related documents:

### Step 1: Update PDF Parser

```powershell
# In process-pdfs.ps1, function Get-DocumentCategory

# Add to filename checks (around line 428)
if ($lowerName -match "climate|environment|emissions|sustainability") { return "climate" }

# Add to content checks (around line 438)
if ($lowerContent -match "climate change|carbon neutral|emissions reduction") { return "climate" }
```

### Step 2: Update Web Scraper

```javascript
// In scraper.js, function extractCategory

// Add to title checks (around line 448)
if (lowerTitle.match(/climate|environment|emissions|sustainability/)) return 'climate';

// Add to content checks (around line 458)
if (lowerContent.match(/climate change|carbon neutral|emissions reduction/)) return 'climate';
```

### Step 3: Update Documentation

```markdown
# In docs/LABELING-RULES.md

| Category    | Description                               | Keywords                                                        |
| ----------- | ----------------------------------------- | --------------------------------------------------------------- |
| **climate** | Climate action, sustainability, emissions | climate, environment, emissions, sustainability, carbon neutral |
```

### Step 4: Verify

```powershell
.\infrastructure\scripts\compare-labeling.ps1
# Should show "climate" category present in both
```

---

## Example: Web-Specific Enhancement

Let's say you want to detect categories from URL structure (web only):

### Step 1: Update Web Scraper Only

```javascript
// In scraper.js, function extractCategory

// Add URL-based detection (WEB ONLY - no PDF equivalent needed)
if (url.includes('/jobs/') || url.includes('/careers/')) return 'workforce';
if (url.includes('/health/')) return 'health';
if (url.includes('/education/')) return 'education';
```

### Step 2: Document the Customization

```markdown
# In docs/LABELING-RULES.md, section "Source-Specific Customizations"

Date: 2026-01-08
Source: Web
Change: Added URL path detection for categories
Reason: Web pages often have structured URLs that indicate category
```

### Step 3: No PDF Update Needed

PDFs don't have URLs, so no update needed!

---

## Checking Consistency

### Quick Check

```powershell
# Run comparison script
.\infrastructure\scripts\compare-labeling.ps1

# Output shows:
# ✓ Categories match (9 categories)
# ✓ Sectors match (13 sectors)
# ✓ Common tags present in both (12 tags)
# ✓ Chunking parameters match
```

### Detailed Check

```powershell
# See full details
.\infrastructure\scripts\compare-labeling.ps1 -Detailed

# Shows all categories, sectors, tags found
```

### Manual Verification

```powershell
# Process test PDF
.\infrastructure\scripts\process-pdfs.ps1 -ResourceGroupName "rg-test"

# Scrape test webpage
cd infrastructure\web-scraper\enterprise-scraper
node scraper.js --resourceGroup="rg-test"

# Compare outputs in Azure AI Search
# Both should use same category/sector/tag values
```

---

## Common Scenarios

### Scenario 1: "I added a new sector to PDF parser, do I update web scraper?"

**YES** - Sectors should be consistent across sources.

Update web scraper's `extractSector()` function with same patterns.

### Scenario 2: "I want web scraper to use page title weight differently"

**OK** - This is web-specific logic.

Update web scraper only, document in LABELING-RULES.md.

### Scenario 3: "I improved category detection keywords"

**YES** - Keyword improvements should apply to both.

Update both `Get-DocumentCategory()` and `extractCategory()`.

### Scenario 4: "I want PDF parser to check for table-based metadata"

**NO** - This is PDF-specific.

Update PDF parser only (web scraper doesn't have tables).

### Scenario 5: "I want to rename 'workforce' category to 'employment'"

**YES** - This is a breaking change affecting both sources.

1. Update both files
2. Update docs/LABELING-RULES.md
3. Consider data migration in Azure AI Search
4. Test thoroughly before production

---

## Troubleshooting

### "Comparison script shows differences but I want them different"

That's fine! Document the difference in `docs/LABELING-RULES.md` under "Source-Specific Customizations".

### "I updated both but consistency check still fails"

- Check spelling/capitalization (case-sensitive)
- Check regex patterns match exactly
- Run with `-Detailed` flag to see what's missing
- Review the actual code, not just comments

### "Should I centralize labeling to avoid duplication?"

**No** - You intentionally chose separation for flexibility. Web pages are unpredictable and need custom handling. Duplication is intentional and correct!

### "What if I forget to update the other source?"

The comparison script will catch it! Run it regularly:

```powershell
# Add to your workflow
.\infrastructure\scripts\compare-labeling.ps1
```

---

## Best Practices

✅ **DO:**

- Update docs/LABELING-RULES.md after every change
- Run comparison script before committing
- Document source-specific customizations
- Test changes on sample data first
- Keep core vocabulary consistent

❌ **DON'T:**

- Feel obligated to sync everything
- Remove source-specific enhancements
- Worry about small differences
- Centralize if it limits flexibility
- Skip documentation

---

## Quick Reference Commands

```powershell
# Compare labeling logic
.\infrastructure\scripts\compare-labeling.ps1

# Detailed comparison
.\infrastructure\scripts\compare-labeling.ps1 -Detailed

# Edit PDF parser labeling
code infrastructure\scripts\process-pdfs.ps1
# Jump to: line ~414 (Get-DocumentCategory)

# Edit web scraper labeling
code infrastructure\web-scraper\enterprise-scraper\scraper.js
# Jump to: line ~436 (extractCategory)

# Edit documentation
code infrastructure\docs\LABELING-RULES.md

# Test PDF processing
.\infrastructure\scripts\process-pdfs.ps1 -ResourceGroupName "rg-test"

# Test web scraping
cd infrastructure\web-scraper\enterprise-scraper
node scraper.js --resourceGroup="rg-test"
```

---

## Remember

**Having separate labeling logic is a feature, not a bug!**

It gives you the flexibility to handle source-specific quirks while maintaining overall consistency where it matters.

Update both when it makes sense, keep separate when it doesn't. The comparison script helps you stay aware of differences without forcing you to eliminate them.

For questions, see `docs/LABELING-RULES.md` for detailed reference.

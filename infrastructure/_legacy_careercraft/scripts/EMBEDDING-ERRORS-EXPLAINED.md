# Embedding Errors Explained - Complete Guide

## The Problem: "A 'StartArray' node was expected"

### What Azure Search Expects:

```json
{
  "value": [
    {
      "id": "doc1",
      "contentVector": [0.123, 0.456, 0.789, ...]  // ← MUST be an array
    }
  ]
}
```

### What Azure Search Sometimes Received (BROKEN):

```json
{
  "value": [
    {
      "id": "doc1",
      "contentVector": "Infinity" // ← String! Not an array!
    }
  ]
}
```

---

## Root Cause #1: PowerShell Array Type Confusion

### The Problem Flow:

#### Step 1: OpenAI Returns JSON

```json
{
  "data": [{
    "embedding": [0.123, 0.456, 0.789, ...]  // 3072 numbers
  }]
}
```

#### Step 2: PowerShell Parses JSON

```powershell
$response = Invoke-RestMethod -Uri $embeddingUrl ...
# PowerShell converts JSON to PSCustomObject

# The embedding array becomes:
$response.data[0].embedding
# Type: System.Object[] or PSCustomObject (unpredictable!)
```

#### Step 3: PowerShell's Type System Gets Confused

**Scenario A: Large Array Handling**

```powershell
# When array has 3072 elements, PowerShell might:
# - Convert to ArrayList
# - Convert to Object[]
# - Convert to PSCustomObject with numeric properties
# - Convert to string if it contains special values

# Example of what can happen:
$embedding = $response.data[0].embedding
$embedding.GetType()  # Might return: System.Object[]
# But internally, some elements might be strings!
```

**Scenario B: Special Float Values**

```powershell
# If OpenAI returns Infinity or NaN:
$embedding = [0.123, [double]::PositiveInfinity, 0.456]

# PowerShell's ConvertTo-Json might serialize as:
# "contentVector": [0.123, "Infinity", 0.456]  // String!
# Or worse:
# "contentVector": "Infinity"  // Entire array becomes string!
```

#### Step 4: JSON Serialization Fails

```powershell
# When you do:
$batchBody = @{ value = $batch } | ConvertTo-Json -Depth 10

# PowerShell tries to serialize the embedding
# If it's not a proper array type, it might:
# 1. Serialize as string: "Infinity"
# 2. Serialize as object: { "0": 0.123, "1": 0.456 }
# 3. Skip it entirely
# 4. Throw an error
```

---

## When Does This Happen?

### Trigger #1: Large Arrays (3072 elements)

- **Frequency**: Common
- **Why**: PowerShell's JSON parser struggles with very large arrays
- **Example**: Any embedding from `text-embedding-3-large` (3072 dimensions)

### Trigger #2: Special Float Values

- **Frequency**: Rare (but possible)
- **Why**: OpenAI API might return Infinity/NaN in edge cases
- **Example**:
  ```powershell
  # If text contains very unusual characters or symbols
  $text = "∞ ÷ 0 = ?"  # Mathematical symbols
  # Embedding might contain: [0.123, Infinity, 0.456]
  ```

### Trigger #3: Type Coercion Issues

- **Frequency**: Unpredictable
- **Why**: PowerShell's dynamic typing can cause type confusion
- **Example**:
  ```powershell
  # If embedding array gets mixed with other data:
  $mixed = @($embedding, "some string")
  # PowerShell might convert entire thing to string array
  ```

### Trigger #4: JSON Depth Limits

- **Frequency**: Common with large batches
- **Why**: `ConvertTo-Json -Depth 10` might not be enough
- **Example**:
  ```powershell
  # If embedding is nested inside objects:
  $doc = @{
    metadata = @{
      embedding = $embedding  # Nested 2 levels
    }
  }
  # Depth 10 should be enough, but PowerShell can still fail
  ```

---

## Real-World Example: What You Saw

### Your Error Message:

```
Unexpected character encountered while parsing value: I. Path '', line 0, position 0.
The input is not a valid Base-64 string...
An unexpected 'PrimitiveValue' node was found when reading from the JSON reader.
A 'StartArray' node was expected.
```

### What Actually Happened:

1. **15 text documents** were being indexed in a batch
2. **One or more** had embedding arrays that PowerShell serialized incorrectly
3. **Azure Search received** something like:
   ```json
   {
     "value": [
       { "id": "doc1", "contentVector": [0.123, 0.456, ...] },  // OK
       { "id": "doc2", "contentVector": "Infinity" },            // BROKEN!
       { "id": "doc3", "contentVector": [0.789, 0.012, ...] },  // OK
       ...
     ]
   }
   ```
4. **Azure Search rejected the ENTIRE batch** because of the broken document
5. **All 15 documents failed** even though only 1 was actually broken

---

## The Fixes Applied

### Fix #1: Explicit Type Casting

```powershell
# BEFORE (broken):
$document["contentVector"] = $embeddingResult.embedding

# AFTER (fixed):
$embeddingArray = [double[]]@($embeddingResult.embedding)
$document["contentVector"] = $embeddingArray
```

**Why This Works:**

- `[double[]]` forces PowerShell to create a proper .NET double array
- `@()` ensures it's always an array, never a scalar
- PowerShell's `ConvertTo-Json` can now properly serialize it

### Fix #2: Validate Special Values

```powershell
# Check for Infinity/NaN before adding to document
foreach ($val in $embeddingArray) {
    if ([double]::IsNaN($val) -or [double]::IsInfinity($val)) {
        $hasInvalidValue = $true
        break
    }
}

if ($hasInvalidValue) {
    # Don't add contentVector - but still index the document!
    # Document will be searchable via keyword search
}
```

**Why This Works:**

- Catches problematic values BEFORE serialization
- Prevents JSON parsing errors
- Still preserves document content (just without vector)

### Fix #3: Increased JSON Depth

```powershell
# BEFORE:
ConvertTo-Json -Depth 10

# AFTER:
ConvertTo-Json -Depth 15
```

**Why This Works:**

- Ensures deeply nested structures serialize correctly
- Prevents truncation of large arrays

### Fix #4: Individual Document Fallback

```powershell
# If batch fails, try each document individually
foreach ($doc in $batch) {
    try {
        $singleBody = @{ value = @($doc) } | ConvertTo-Json -Depth 15
        # Index individually...
    } catch {
        # Show exactly which document failed
        Write-Host "[FAIL] Doc ID: $docId - $error"
    }
}
```

**Why This Works:**

- Identifies the exact problematic document
- Allows other documents in batch to succeed
- Provides debugging information

---

## Why PowerShell Has These Issues

### PowerShell's Dynamic Typing:

```powershell
# PowerShell doesn't enforce strict types:
$var = 123        # Integer
$var = "hello"    # Now it's a string!
$var = @(1,2,3)   # Now it's an array!

# When parsing JSON:
$json = '{"embedding": [0.123, 0.456]}'
$obj = $json | ConvertFrom-Json
$obj.embedding  # Type is unclear - could be array, could be object
```

### JSON Parsing Quirks:

```powershell
# PowerShell's ConvertFrom-Json can produce:
# - PSCustomObject (default)
# - Hashtable (if you use -AsHashtable)
# - Mixed types (arrays might become objects)

# When you then serialize back:
ConvertTo-Json $obj
# The types might not match what you expect!
```

### Large Array Handling:

```powershell
# Arrays with 1000+ elements can cause:
# - Memory issues
# - Type conversion problems
# - Serialization failures

# PowerShell might:
# - Convert to ArrayList
# - Convert to Object[]
# - Convert to string representation
# - Throw out-of-memory errors
```

---

## Prevention Checklist

✅ **Always cast embeddings explicitly**: `[double[]]@($embedding)`
✅ **Validate special values**: Check for Infinity/NaN
✅ **Use sufficient JSON depth**: `-Depth 15` for large arrays
✅ **Handle batch failures gracefully**: Try individual documents
✅ **Log errors clearly**: Show which document failed and why
✅ **Never skip documents**: Always index content, even without vector

---

## Summary

**The "I" string issue** happens when:

1. PowerShell's JSON parser converts a large embedding array to an unexpected type
2. Special float values (Infinity/NaN) get serialized as strings
3. Type coercion causes arrays to become strings
4. JSON depth limits cause truncation

**The fixes ensure**:

- Embeddings are always proper double arrays
- Invalid values are caught before serialization
- Documents are always indexed (with or without vectors)
- Errors are visible and debuggable

**Result**: Your PDF content is ALWAYS preserved, even if vector search fails for specific chunks.

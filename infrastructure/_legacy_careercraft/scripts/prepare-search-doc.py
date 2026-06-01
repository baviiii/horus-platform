#!/usr/bin/env python3
"""
Azure Search Document JSON Normalizer

This script ensures:
1. Collection(Edm.String) fields are always arrays (never null or scalar)
2. Primitive fields (Edm.String) are always scalars (never arrays)

PowerShell has inconsistent array handling during JSON serialization.
This Python helper guarantees correct output for Azure Search.

Usage:
    PowerShell: $jsonBody | python prepare-search-doc.py
    
Input: JSON document(s) from stdin
Output: Normalized JSON to stdout
"""

import sys
import json

# Fields that Azure Search expects as Collection(Edm.String) - must be arrays
ARRAY_FIELDS = ['tags', 'sectors', 'topics']

# Fields that Azure Search expects as Edm.String - must be scalars (NOT arrays)
# If PowerShell accidentally wraps these in arrays, unwrap them
PRIMITIVE_STRING_FIELDS = [
    'id', 'content', 'documentId', 'documentType', 'source', 'url', 
    'title', 'category', 'sector', 'occupation', 'metadata',
    'embeddingModel', 'embeddingGeneratedAt', 'indexedAt', 'chunkType',
    '@search.action'
]

def ensure_arrays(doc):
    """
    Guarantee Collection fields are always arrays, never null or scalars.
    """
    if not isinstance(doc, dict):
        return doc
    
    for field in ARRAY_FIELDS:
        if field in doc:
            val = doc[field]
            if val is None:
                doc[field] = []
            elif isinstance(val, str):
                doc[field] = [val]
            elif not isinstance(val, list):
                doc[field] = [val]
    
    return doc

def ensure_primitives(doc):
    """
    Guarantee primitive string fields are scalars, not arrays or objects.
    If PowerShell accidentally wrapped a string in an array or object, fix it.
    """
    if not isinstance(doc, dict):
        return doc
    
    for field in PRIMITIVE_STRING_FIELDS:
        if field in doc:
            val = doc[field]
            
            # If value is an object/dict - convert to string or extract value
            if isinstance(val, dict):
                # Try to extract a meaningful string value from the object
                if len(val) == 0:
                    doc[field] = ""  # Empty object -> empty string
                elif 'value' in val:
                    doc[field] = str(val['value']) if val['value'] is not None else ""
                elif 'name' in val:
                    doc[field] = str(val['name']) if val['name'] is not None else ""
                else:
                    # Take first value or convert to JSON string
                    first_val = next(iter(val.values()), "")
                    if isinstance(first_val, str):
                        doc[field] = first_val
                    else:
                        doc[field] = ""  # Can't extract - use empty string
            
            # If value is an array but should be a string, take first element or convert
            elif isinstance(val, list):
                if len(val) == 0:
                    doc[field] = ""  # Empty array -> empty string
                elif len(val) == 1:
                    # Handle nested objects in arrays too
                    inner = val[0]
                    if isinstance(inner, dict):
                        doc[field] = str(next(iter(inner.values()), "")) if inner else ""
                    else:
                        doc[field] = str(inner) if inner is not None else ""
                else:
                    # Multiple elements - join them (shouldn't happen, but handle gracefully)
                    parts = []
                    for v in val:
                        if isinstance(v, dict):
                            parts.append(str(next(iter(v.values()), "")))
                        elif v is not None:
                            parts.append(str(v))
                    doc[field] = " ".join(parts)
            
            # If value is None, convert to empty string
            elif val is None:
                doc[field] = ""
    
    return doc

def normalize_document(doc):
    """
    Apply both array and primitive field normalization.
    """
    doc = ensure_arrays(doc)
    doc = ensure_primitives(doc)
    return doc

def process_documents(data):
    """
    Process Azure Search batch format or single document.
    
    Azure Search format: { "value": [{doc1}, {doc2}] }
    Also handles: [{doc1}, {doc2}] or {doc1}
    
    Args:
        data: Azure Search batch object, list of documents, or single document
        
    Returns:
        Normalized document(s) in same format
    """
    # Handle Azure Search batch format: { "value": [...] }
    if isinstance(data, dict) and "value" in data:
        # Recursively process documents inside "value" array
        if isinstance(data["value"], list):
            data["value"] = [normalize_document(doc) for doc in data["value"]]
        else:
            data["value"] = normalize_document(data["value"])
        return data
    # Handle list of documents: [{doc1}, {doc2}]
    elif isinstance(data, list):
        return [normalize_document(doc) for doc in data]
    # Handle single document: {doc1}
    else:
        return normalize_document(data)

def main():
    try:
        # Read JSON from stdin
        input_data = sys.stdin.read()
        
        if not input_data.strip():
            # Empty input - return empty array
            print('[]')
            return
        
        # Parse JSON
        docs = json.loads(input_data)
        
        # Process and normalize
        result = process_documents(docs)
        
        # Output clean JSON (no pretty print to save bandwidth)
        print(json.dumps(result, ensure_ascii=False))
        
    except json.JSONDecodeError as e:
        # If JSON is invalid, output error to stderr and exit with error code
        print(f"JSON parse error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()

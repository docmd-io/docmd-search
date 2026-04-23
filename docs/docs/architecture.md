---
title: Architecture
---

# Architecture

## Design Principles

1. **Build-time heavy, runtime light** — All ML inference happens at build time. The browser only does vector math.
2. **Quantize everything** — Int8 vectors are 4x smaller than float32 with minimal quality loss.
3. **Hybrid search** — Semantic vectors + BM25 keyword fallback for exact-match queries.
4. **Incremental by default** — Only re-embed changed files on rebuild.

## Pipeline

```
Files → Crawl → Chunk → Embed (ONNX) → Quantize → Serialize
                                                      ↓
                              Browser ← Load ← Binary Index
                                ↓
                         Cosine Similarity → Results
```

## Index Format

The search index consists of two files:

- **`search-index.json`** — Metadata + chunks (file paths, headings, text)
- **`search-index.bin`** — Flat binary buffer of quantized Int8 vectors

This split allows the browser to stream the metadata first (for instant UI) while the vector data loads in parallel.

## Embedding Model

We use `all-MiniLM-L6-v2` (384 dimensions) as the default model:

- 22M parameters — small enough for fast build-time inference
- Strong semantic quality for documentation search
- Well-tested across multiple languages
- Runs via ONNX Runtime in Node.js (no Python needed)

## Client Runtime

The client-side code is intentionally minimal:

1. Fetch `search-index.json` + `search-index.bin`
2. On query: encode query → cosine similarity against all vectors → sort → return top-k
3. Total runtime JS: <5KB minified + gzipped

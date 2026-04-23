---
title: docmd-search
description: Universal offline semantic search engine. The Pagefind of AI search.
---

# docmd-search

**AI semantic search for any folder or website. Completely offline. No API keys. No cloud. 100% client-side.**

## What is docmd-search?

`docmd-search` is a universal, offline semantic search engine. Drop it into any directory and get instant, intelligent search over all your content — powered by AI embeddings, running entirely in the browser.

## Quick Start

```bash
# Index any directory
npx docmd-search ./my-docs

# That's it. Open .docmd-search/index.html to search.
```

## How It Works

1. **Build time** — Crawls your files, chunks them intelligently, generates vector embeddings
2. **Runtime** — Pure cosine similarity search over quantized vectors. No model loading. Sub-5ms queries.

### The Key Insight

The ML model runs at **build time only** (Node.js + ONNX Runtime). The browser receives a tiny compressed vector index and performs simple math — no WASM models, no WebGPU, just fast array operations.

| Docs Size | Index Size (quantized) | Query Time |
|-----------|----------------------|------------|
| 100 pages | ~400 KB | <1ms |
| 1,000 pages | ~4 MB | <5ms |
| 10,000 pages | ~40 MB | ~20ms |

## Features

- 🧠 **Semantic search** — Find concepts, not just keywords
- ⚡ **Instant queries** — <5ms for typical documentation sites
- 📦 **Tiny runtime** — <5KB client-side JavaScript
- 🔌 **Universal** — Works with any static site, any framework
- 🔒 **Fully offline** — Zero cloud dependency, no API keys
- 🎯 **Zero config** — `npx docmd-search` and done

## Integration with docmd

```js
// docmd.config.js
export default {
  semanticSearch: true  // That's it.
};
```

When used with [docmd](https://docmd.io), semantic search replaces the default fuzzy search automatically with zero additional configuration.

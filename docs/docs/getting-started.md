---
title: Getting Started
---

# Getting Started

## Installation

```bash
# Run directly (no install needed)
npx docmd-search ./path/to/docs

# Or install globally
npm install -g docmd-search

# Or add to your project
npm install docmd-search
```

## Basic Usage

### Index a Directory

```bash
docmd-search ./docs
```

This will:
1. Crawl all `.md`, `.txt`, and `.html` files
2. Split content into intelligent chunks (by headings, then by size)
3. Generate vector embeddings using a local ML model
4. Output a compressed search index to `.docmd-search/`

### Use in the Browser

```js
import { load, search } from 'docmd-search/client';

// Load the pre-built index
await load('/path/to/.docmd-search');

// Search!
const results = search('how to deploy to production');
results.forEach(r => {
  console.log(`${r.chunk.file} — ${r.chunk.heading} (score: ${r.score})`);
});
```

## Configuration

```js
// search.config.js (optional)
export default {
  include: ['**/*.md', '**/*.txt'],
  exclude: ['**/node_modules/**'],
  chunkSize: 256,
  chunkOverlap: 32,
};
```

<div align="center">

  <!-- PROJECT TITLE -->
  <h3>
    <a href="https://docmd.io/search">
      docmd-search
    </a>
  </h3>
  
  <!-- ONE LINE SUMMARY -->
  <p>
    <b>Offline semantic search engine for documentation.</b>
    <br/>
    Local embeddings, browser-ready indexes.
  </p>
  
  <!-- BADGES -->
  <p>
    <a href="https://www.npmjs.com/package/docmd-search"><img src="https://img.shields.io/npm/v/docmd-search.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/docmd-search?activeTab=versions"><img src="https://img.shields.io/npm/dm/docmd-search.svg?style=flat-square&color=38bd24" alt="downloads"></a>
    <a href="https://github.com/docmd-io/docmd-search"><img src="https://img.shields.io/github/stars/docmd-io/docmd-search?style=flat-square&logo=github" alt="stars"></a>
    <a href="https://github.com/docmd-io/docmd-search/blob/main/LICENSE"><img src="https://img.shields.io/github/license/docmd-io/docmd-search.svg?style=flat-square&color=A31F34" alt="license"></a>
  </p>

  <!-- MENU -->
  <p>
    <h4>
      <a href="https://docmd.io/search/">Website</a> • 
      <a href="https://docs.docmd.io/search/">Documentation</a> • 
      <a href="https://github.com/docmd-io/docmd-search/issues">Report Bug</a>
    </h4>
  </p>

</div>

## Quick Start

**Run docmd-search instantly on any folder:**

```bash
npx docmd-search ./docs
```

**That's it.**

- Files are discovered and chunked automatically
- Embeddings are generated locally (no cloud API)
- Search is available in the terminal immediately

### Install for regular usage

```bash
npm install -g docmd-search
```

```bash
# Install ML dependencies (one-time)
npm install -g @huggingface/transformers onnxruntime-node
```

```bash
docmd-search ./docs          # index + interactive search
docmd-search ./docs --ui     # index + web UI
docmd-search --settings      # configure model
```

## Features

Designed to work offline, ship nothing to the browser, and stay out of your way.

### Offline by default

* All embeddings generated locally with ONNX Runtime
* No data leaves your machine
* No cloud API keys needed

### Instant search

* Progressive indexing: search available from the first batch
* Incremental: only re-indexes changed files
* Resumable: interrupted indexing resumes from last checkpoint

### Tiny client

* Browser runtime is **<3KB gzipped**
* No model weights in the browser
* Hybrid scoring: keyword matching + vector similarity

### Built-in capabilities

* Multi-batch index format with automatic compression
* Navigation tree generation for web UIs
* First-run setup wizard with model selection
* Interactive terminal search with live results

## How It Works

```
Build time (Node.js)                    Search time (Browser, <3KB)
───────────────────                     ──────────────────────────
 Crawl files                             Load manifest.json
   → Chunk by heading                      → Load batch 000 (instant)
     → Embed via ONNX                        → Background-load rest
       → Quantize Float32 → Int8               → Keyword + cosine
         → Compress (ternary/PQ)                 → Ranked results
           → Save multi-batch index
```

## Models

First run prompts you to select an embedding model:

| Model | Dimensions | Size | Best for |
| :---- | :--------- | :--- | :------- |
| **MiniLM L6 v2** ★ | 384 | ~30 MB | Fast, general purpose |
| BGE Small (English) | 384 | ~45 MB | English-optimised |
| BGE Base (English) | 768 | ~110 MB | Higher quality |
| MPNet Base v2 | 768 | ~110 MB | Multilingual |

Change model later: `docmd-search --settings`

## Configuration (optional)

No configuration is required to get started.

**Global** (`~/.docmd-search/config.json`):
```json
{
  "model": "Xenova/all-MiniLM-L6-v2",
  "wizardCompleted": true
}
```

**Per-project** (`.docmd-search/config.json`):
```json
{
  "model": "Xenova/bge-small-en-v1.5",
  "chunkSize": 512,
  "include": ["**/*.md"],
  "exclude": ["**/drafts/**"]
}
```

Config resolution: defaults → global → project → CLI flags.

## Programmatic Usage

Use in scripts or CI pipelines:

```js
import { indexDirectory, loadAllBatches } from 'docmd-search';

const index = await indexDirectory({
  rootDir: './docs',
  outDir: '.docmd-search',
});
```

Browser client:

```js
import { load, search } from 'docmd-search/client';

await load('/path/to/.docmd-search');
const results = search('deploy kubernetes', 10);
```

## Project Structure

Keeps the codebase flat and modular.

```
src/
├── bin/docmd-search.ts   # CLI entry point
├── client/index.ts       # Browser runtime (<3KB)
├── config.ts             # Config + model profiles
├── index-io.ts           # Multi-batch format + compression
├── index.ts              # Barrel exports
├── indexer/
│   ├── chunk.ts          # Heading-aware chunking
│   ├── crawl.ts          # File discovery
│   └── index.ts          # Progressive pipeline
├── model.ts              # ONNX embedding manager
├── tui.ts                # Terminal UI
├── types.ts              # Core types
└── ui/
    └── launcher.ts       # Web UI via docmd
```

## Part of the docmd ecosystem

docmd-search works standalone with any documentation project. It also integrates with [docmd](https://docmd.io) as a semantic search plugin.

| Tool | What it does |
| :--- | :----------- |
| [docmd](https://github.com/docmd-io/docmd) | Zero-config documentation generator |
| **docmd-search** | Offline semantic search engine |

## Community & Support

* Contributions are welcome
* If you find it useful, consider [sponsoring](https://github.com/sponsors/mgks) or starring the repo ⭐

## License

MIT License. See `LICENSE` for details.
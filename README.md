# docmd-search

Universal offline semantic search. AI-powered, client-side, zero cloud dependency.

```bash
npx docmd-search ./docs
```

## What it does

docmd-search indexes your documentation at build time using transformer embeddings, then provides instant semantic search via a lightweight browser client — **no cloud APIs, no WASM models, just math**.

### Key features

- **🔌 Zero config** — point at a directory and go
- **🏠 100% offline** — all embeddings generated locally, no data leaves your machine
- **⚡ Instant search** — progressive indexing: search is available from the first batch
- **🔄 Incremental** — only re-indexes changed files on subsequent runs
- **📦 Tiny client** — browser runtime is <3KB gzipped (no model in the browser)
- **🎨 Web UI** — built-in web interface via docmd (`--ui` flag)
- **🖥️ TUI** — interactive terminal search with live results

## Quick start

```bash
# Install (or use npx)
npm install -g docmd-search

# Install ML dependencies (one-time)
npm install -g @huggingface/transformers onnxruntime-node

# Index a directory
docmd-search ./docs

# With web UI
docmd-search ./docs --ui
```

On first run, a setup wizard helps you choose an embedding model:

| Model | Dimensions | Size | Best for |
|-------|-----------|------|----------|
| **MiniLM L6 v2** ★ | 384 | ~30 MB | Fast, general purpose |
| BGE Small (English) | 384 | ~45 MB | English-optimised |
| BGE Base (English) | 768 | ~110 MB | Higher quality |
| MPNet Base v2 | 768 | ~110 MB | Multilingual |

## CLI

```bash
docmd-search [directory]          # Index + interactive search
docmd-search [directory] --ui     # Index + web UI in browser
docmd-search [directory] --dev    # Verbose output
docmd-search --model <id>         # Override embedding model
docmd-search --settings           # Change model, view config
docmd-search --version            # Print version
docmd-search --help               # Show help
```

## How it works

```
┌────────────┐    ┌────────────┐    ┌────────────┐    ┌────────────┐
│  Crawl     │ →  │  Chunk     │ →  │  Embed     │ →  │  Save      │
│  files     │    │  by heading│    │  ONNX/HF   │    │  batches   │
└────────────┘    └────────────┘    └────────────┘    └────────────┘
                                                            │
                                                     ┌──────┴──────┐
                                                     │ manifest    │
                                                     │ batches/    │
                                                     │ nav.json    │
                                                     └─────────────┘
```

**Build time** (Node.js):
1. Crawl directory for .md, .txt, .html files
2. Chunk by headings, then split by token count with overlap
3. Generate embeddings via ONNX Runtime (transformer model)
4. Quantize Float32 → Int8 (4x compression)
5. Apply automatic compression (ternary/PQ for large indexes)
6. Save as multi-batch index with progressive availability

**Search time** (Browser, <3KB):
1. Load manifest.json → batch 000 (instant search)
2. Background-load remaining batches
3. Keyword scoring (BM25-ish) + vector cosine similarity reranking
4. Hybrid score: `keyword × 0.6 + similarity × 0.4`

## Programmatic API

```typescript
import { indexDirectory, loadAllBatches } from 'docmd-search';

// Index
const index = await indexDirectory({
  rootDir: './docs',
  outDir: '.docmd-search',
});

// Load and search
const loaded = await loadAllBatches('.docmd-search');
```

```typescript
// Browser client
import { load, search } from 'docmd-search/client';

await load('/path/to/.docmd-search');
const results = search('deploy kubernetes', 10);
```

## Configuration

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

## Architecture

```
src/
├── bin/docmd-search.ts   # CLI entry point
├── client/index.ts       # Browser search runtime (<3KB)
├── config.ts             # Config system + model profiles
├── index-io.ts           # Multi-batch index format + compression
├── index.ts              # Barrel exports
├── indexer/
│   ├── chunk.ts          # Heading-aware document chunking
│   ├── crawl.ts          # File discovery with glob matching
│   └── index.ts          # Progressive indexing pipeline
├── model.ts              # ONNX embedding manager
├── tui.ts                # Terminal UI (wizard, progress, search)
├── types.ts              # Core type definitions
└── ui/
    └── launcher.ts       # Web UI via docmd
```

## License

MIT

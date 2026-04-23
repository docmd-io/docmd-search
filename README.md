# docmd-search

**Universal offline semantic search. The Pagefind of AI search.**

AI semantic search for any folder or website. Completely offline. No API keys. No cloud. 100% client-side.

## Quick Start

```bash
npx docmd-search ./my-docs
```

## Packages

| Package | Description |
|---------|-------------|
| [`docmd-search`](packages/core) | Core search engine — CLI + client runtime |
| [`@docmd-search/docs`](packages/docs) | Documentation site (built with docmd) |

## Architecture

- **Build time**: Crawl → Chunk → Embed (ONNX/MiniLM) → Quantize → Binary index
- **Runtime**: Cosine similarity over Int8 vectors. <5ms queries. <5KB JS.

## License

MIT

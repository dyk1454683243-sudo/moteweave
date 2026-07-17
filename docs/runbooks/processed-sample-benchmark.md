# Processed Sample Benchmark

Use this benchmark after generating real character packs locally. It scans existing `generated/*/debug_report.json` files and summarizes the actual post-processing results without spending model quota.

```bash
npm run benchmark:processed
```

Useful options:

```bash
npm run benchmark:processed -- --limit 30
npm run benchmark:processed -- --root-dir generated --output-dir generated/processed-sample-benchmarks
```

The report includes:

- validation pass / warning / fail counts
- source layout and background mode distribution
- top warnings and blocking errors
- failure-mode buckets for cropped frames, empty frames, frame-count mismatch, anchor drift, baseline drift, subpixel jitter, low motion, duplicate frames, halo, edge pressure, source-region edge pressure, dual matte, and background cleanup warnings
- shared failure taxonomy buckets matching the OpenRouter benchmark report
- drift-related metrics such as anchor spread, auto-correction count, and motion-stabilization count

Outputs:

```text
generated/processed-sample-benchmarks/<run_id>/
  processed_sample_benchmark.json
  processed_sample_benchmark.md
```

Treat template, provider, or prompt changes as proven only after this report improves on a comparable set of generated samples.

# Satellite imagery prototype (local, not wired into the app)

Built 2026-10-22 in `tools/satellite/`: `control.mjs` (control image) then `generate.py` (diffusion). Outputs go to `assets/satellite/proto/` (git-ignored). `sheet.mjs` (contact sheet) was removed on 2026-10-27; recover it from git history if needed.

## Stack
- conda env `sat` (torch 2.6 cu124, diffusers 0.41). The `gis` env is separate (QGIS/GDAL).
- Model: MVRL/GeoSynth-OSM ControlNet on `sd2-community/stable-diffusion-2-1-base` (the stabilityai repo now returns 401).
- RTX 2060 6 GB: 4.8 s per 512 px tile, 3.7 GB VRAM.

## Results
- The city (King's Landing) looks convincing; the village and grass are plausible.
- Failures: open water comes out as land; thin rivers and roads get lost; tile seams show; buildings look modern; a faint Bing/Microsoft watermark appears at tile bottoms (trained on Bing tiles).

## Cost of the whole world
Known World land is about 32.5 M km2. At 30 m/px that is about 10 GPU-days; at 0.6 m/px about 25k GPU-days. A whole world needs resolution tiers, not one pass.

## Next steps
Water and river masking, seam handling, cropping tile margins, a coarse-scale model.

## Why
A cheap local pipeline that could eventually paint the Known World from descriptions.

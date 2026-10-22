# Paints a "satellite photo" over a control map from control.mjs with GeoSynth-OSM (a ControlNet trained on
# OpenStreetMap tiles paired with satellite imagery, Apache-2.0) on Stable Diffusion 2.1-base (openrail++).
# The control is cut into 512 px tiles overlapping by 64 px; every tile gets the same prompt and seed, and the
# overlaps are feather-blended. Logs seconds per tile and peak VRAM, the numbers the whole-world estimate needs.
# Env: conda env `sat` (torch CUDA, diffusers, transformers, accelerate). Models download to the HF cache (~4 GB).
# Usage: conda run -n sat python tools/satellite/generate.py <city|village|grass> [variant] [steps=20]
import sys, time
import numpy as np
import torch
from PIL import Image
from diffusers import ControlNetModel, StableDiffusionControlNetPipeline, UniPCMultistepScheduler

DIR = 'assets/satellite/proto'
TILE, OVERLAP = 512, 64
# GeoSynth's captions read "Satellite image features ..."; ours keep that form. Sources: docs/wiki/*.md.
PROMPTS = {
    'city': "Satellite image features a dense medieval city with red tile roofs, narrow winding streets and a large stone castle",
    'village': "Satellite image features a medieval village of thatched houses beside a huge black stone castle on a lake shore, farmland and meadows",
    'village-burned': "Satellite image features a burned village of ash and blackened stone ruins beside a huge black stone castle on a lake shore",  # ASOS, Jaime IV
    'grass': "Satellite image features green farmland and meadows with hedgerows, a dirt road and a river in summer",
}
NEGATIVE = "map, text, labels, drawing, cartoon, blurry, clouds, modern cars, asphalt"

crop = sys.argv[1]
variant = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else crop
steps = int(sys.argv[3]) if len(sys.argv) > 3 else 20
prompt = PROMPTS[variant]

controlnet = ControlNetModel.from_pretrained('MVRL/GeoSynth-OSM', torch_dtype=torch.float16, use_safetensors=True)
pipe = StableDiffusionControlNetPipeline.from_pretrained(
    'sd2-community/stable-diffusion-2-1-base', controlnet=controlnet, torch_dtype=torch.float16, variant='fp16',
    use_safetensors=True, safety_checker=None, requires_safety_checker=False).to('cuda')
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)
pipe.set_progress_bar_config(disable=True)

control = Image.open(f'{DIR}/{crop}-control.png').convert('RGB')
W, H = control.size
starts = lambda n: sorted(set(list(range(0, n - TILE, TILE - OVERLAP)) + [n - TILE]))
xs, ys = starts(W), starts(H)

# feather weights: ramps over the overlap at every tile edge
ramp = np.minimum(np.arange(TILE) + 1, TILE - np.arange(TILE)) / OVERLAP
w1 = np.clip(ramp, 1e-3, 1.0)
weight = (w1[:, None] * w1[None, :])[..., None]
acc, wsum = np.zeros((H, W, 3)), np.zeros((H, W, 1))

torch.cuda.reset_peak_memory_stats()
t0, n = time.time(), len(xs) * len(ys)
for j, y in enumerate(ys):
    for i, x in enumerate(xs):
        tile = control.crop((x, y, x + TILE, y + TILE))
        out = pipe(prompt, image=tile, negative_prompt=NEGATIVE, num_inference_steps=steps,
                   generator=torch.Generator('cuda').manual_seed(1234 + j * 1000 + i)).images[0]
        acc[y:y + TILE, x:x + TILE] += np.asarray(out, dtype=np.float64) * weight
        wsum[y:y + TILE, x:x + TILE] += weight
        done = j * len(xs) + i + 1
        print(f'tile {done}/{n}  {(time.time() - t0) / done:.1f} s/tile', flush=True)

name = f'{DIR}/{variant}-sat.png'
Image.fromarray((acc / wsum).clip(0, 255).astype(np.uint8)).save(name)
spt = (time.time() - t0) / n
print(f'{name}: {n} tiles, {spt:.1f} s/tile at {steps} steps, peak VRAM {torch.cuda.max_memory_allocated() / 2**30:.2f} GB')

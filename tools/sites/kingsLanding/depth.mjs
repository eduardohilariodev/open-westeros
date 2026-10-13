// Runs Depth Anything V2 (small) on the map and writes a grayscale depth image, same size as the input.
// Experimental: the result reads camera distance, not elevation (see assets/city/heightmap.png instead).
// Usage: node tools/sites/kingsLanding/depth.mjs [in] [out]
import { pipeline } from '@huggingface/transformers';

const [input = 'assets/sites/kingsLanding/kingslanding.jpg', output = 'assets/sites/kingsLanding/depth.png'] = process.argv.slice(2);

const estimate = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small');
const { depth } = await estimate(input); // RawImage, 8-bit, brighter = closer to camera
await depth.save(output);
console.log(`wrote ${output} (${depth.width}x${depth.height})`);

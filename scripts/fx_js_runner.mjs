// Reads JSON {width,height,adj,amount,seed,pixels:[...0..255 rgba]} from argv[2] (a file),
// runs applyFx, writes the resulting RGBA bytes to stdout as base64. Used by
// scripts/fx_parity_check.py to compare the JS engine against the Python engine.
import { readFileSync } from "node:fs";
import { applyFx } from "../js/composer/fx_engine.mjs";

const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rgba = Uint8ClampedArray.from(job.pixels);
applyFx(rgba, job.width, job.height, job.adj, job.amount, job.seed ?? 0);
process.stdout.write(Buffer.from(rgba.buffer).toString("base64"));

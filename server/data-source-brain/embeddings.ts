let pipelinePromise: Promise<any> | null = null;

async function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import("@xenova/transformers");
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    })();
  }
  return pipelinePromise;
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getPipeline();
  const result = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(result.data as Float32Array);
}

export const EMBEDDING_DIM = 384;

/**
 * Emit opt-in structured timings for slow server-side operations. Keeping this
 * disabled by default avoids production log noise; enable it with
 * OFB_PERFORMANCE_LOGGING=true while profiling a deployment or preview.
 */
export async function measureServerOperation<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (process.env.OFB_PERFORMANCE_LOGGING !== "true") {
    return operation();
  }

  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    console.info(
      JSON.stringify({
        event: "ofb.server_timing",
        name,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      }),
    );
  }
}

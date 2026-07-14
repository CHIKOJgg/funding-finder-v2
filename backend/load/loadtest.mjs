/**
 * Standalone load/throughput harness for the core resilience primitives.
 *
 * This is NOT a Jest test. Run it directly with plain `node`:
 *
 *     npm run load            # -> node load/loadtest.mjs
 *
 * It benchmarks two primitives that live in `src/utils/exchangeClient.ts`:
 *   - `mapWithConcurrency`  (bounded-concurrency fan-out over async tasks)
 *   - `CircuitBreaker.execute` (opens after `failureThreshold` failures)
 *
 * The implementations below are faithful, dependency-free mirrors of the
 * TypeScript source so the script runs under `node` without a TS transpile
 * step. They match the semantics (concurrency cap, failure threshold = 5,
 * reset timeout = 60s) used by the real code.
 */
import { Bench } from 'tinybench';

// ---------------------------------------------------------------------------
// Mirrors of src/utils/exchangeClient.ts primitives (plain JS, same behaviour)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapWithConcurrency(arr, options, worker) {
  const { concurrency, delayMs = 40 } = options;
  const results = new Array(arr.length);
  let index = 0;

  async function runner() {
    while (index < arr.length) {
      const i = index++;
      try {
        results[i] = await worker(arr[i], i);
      } catch {
        results[i] = null;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, arr.length) },
    () => runner()
  );
  await Promise.all(runners);
  return results;
}

class CircuitBreaker {
  constructor() {
    this.circuits = new Map();
    this.failureThreshold = 5;
    this.resetTimeout = 60_000;
  }

  async execute(key, fn) {
    const circuit = this.getCircuit(key);

    if (circuit.state === 'open') {
      if (Date.now() - circuit.lastFailure > this.resetTimeout) {
        circuit.state = 'half-open';
      } else {
        throw new Error(`Circuit breaker open for ${key}`);
      }
    }

    try {
      const result = await fn();
      if (circuit.state === 'half-open') {
        circuit.failures = 0;
        circuit.state = 'closed';
      }
      return result;
    } catch (error) {
      circuit.failures++;
      circuit.lastFailure = Date.now();
      if (circuit.failures >= this.failureThreshold) {
        circuit.state = 'open';
      }
      throw error;
    }
  }

  getCircuit(key) {
    if (!this.circuits.has(key)) {
      this.circuits.set(key, { failures: 0, lastFailure: 0, state: 'closed' });
    }
    return this.circuits.get(key);
  }

  reset() {
    this.circuits.clear();
  }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

const failingFn = async () => {
  throw new Error('simulated exchange failure');
};

async function main() {
  // 1) Explicit correctness check: the breaker must open after 5 failures and
  //    then reject fast (no network call) with "Circuit breaker open".
  const probe = new CircuitBreaker();
  for (let i = 0; i < 5; i++) {
    try {
      await probe.execute('probe-key', failingFn);
    } catch {
      /* expected */
    }
  }
  let openedFast = false;
  try {
    await probe.execute('probe-key', failingFn);
  } catch (err) {
    openedFast = err.message === 'Circuit breaker open for probe-key';
  }
  console.log(`Circuit breaker opened after 5 failures: ${openedFast ? 'YES' : 'NO'}`);

  // 2) Throughput benchmark.
  const breaker = new CircuitBreaker();
  const bench = new Bench({ time: 1000 });

  bench.add('mapWithConcurrency(1000 items, concurrency=8)', async () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const res = await mapWithConcurrency(
      items,
      { concurrency: 8, delayMs: 0 },
      async (x) => x * 2
    );
    if (res.length !== 1000) throw new Error('length mismatch');
  });

  bench.add('CircuitBreaker.execute failing path (trips open)', async () => {
    // Once open, subsequent calls throw synchronously -> very cheap.
    try {
      await breaker.execute('bench-key', failingFn);
    } catch {
      /* expected */
    }
  });

  await bench.run();

  console.log('\n=== Load test report (tinybench) ===');
  console.log(bench.table());

  bench.results.forEach((r, i) => {
    const name = bench.tasks[i] ? bench.tasks[i].name : `task-${i}`;
    const ops = Math.round(r.throughput.mean);
    const p99 = `${Math.round(r.latency.p99 * 1000) / 1000}ms`;
    console.log(`- ${name}: ${ops} ops/sec, p99=${p99}`);
  });

  if (!openedFast) {
    console.error('\nFATAL: circuit breaker did not open as expected.');
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

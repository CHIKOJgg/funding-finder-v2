/**
 * Shared test helpers for the funding-finder backend test suite.
 *
 * These utilities give every test file a consistent way to:
 *  - mock axios (both the default export used by `priceService` and the
 *    per-exchange `axios.create(...)` clients used by the scanners/clients)
 *  - mock the Prisma client
 *  - build a throwaway Express app to integration-test a route handler
 *
 * Every helper is side-effect free except where noted; tests should call the
 * relevant `reset()`/`cleanupConnections()` in `beforeEach`.
 */
import express, { Express, Request, Response, NextFunction } from 'express';
import axios from 'axios';

// ----------------------------------------------------------------------------
// Axios mocking
// ----------------------------------------------------------------------------

export interface MockAxios {
  /** Mock fn for `axios.get` and the `.get` of created clients. */
  get: jest.Mock;
  /** Mock fn for `axios.post` and the `.post` of created clients. */
  post: jest.Mock;
  /** The shared fake axios instance returned by `axios.create`. */
  client: any;
  /** Reset both mock fns (keeps the client object). */
  reset(): void;
  /**
   * Route GET responses by URL substring. The first key that is a substring of
   * the requested URL wins; `*` is used as a fallback.
   */
  routeGet(map: Record<string, any>): void;
  /** Route POST responses by URL substring (see `routeGet`). */
  routePost(map: Record<string, any>): void;
  /** Make every GET reject (simulates a down exchange / network error). */
  rejectGet(error?: Error): void;
  /** Make every POST reject. */
  rejectPost(error?: Error): void;
}

/**
 * Install a global axios mock. Call `jest.mock('axios')` at the top of the
 * consuming test file BEFORE importing this helper.
 */
export function installMockAxios(): MockAxios {
  const get = jest.fn();
  const post = jest.fn();

  const client = {
    get,
    post,
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn(), clear: jest.fn() },
    },
  };

  (axios as any).create = jest.fn(() => client);
  (axios as any).get = get;
  (axios as any).post = post;
  (axios as any).isAxiosError = (e: any): boolean =>
    !!e && (e.isAxiosError === true || (!!e.response && !!e.config));

  const resolve = (map: Record<string, any>, url: any): any => {
    const u = String(url ?? '');
    const key = Object.keys(map).find((k) => k === '*' || u.includes(k)) ?? '*';
    const data = map[key];
    return Promise.resolve({ status: 200, statusText: 'OK', data, headers: {} });
  };

  return {
    get,
    post,
    client,
    reset() {
      get.mockReset();
      post.mockReset();
    },
    routeGet(map) {
      get.mockImplementation((url: any) => resolve(map, url));
    },
    routePost(map) {
      post.mockImplementation((url: any) => resolve(map, url));
    },
    rejectGet(error = new Error('network down')) {
      get.mockImplementation(() => Promise.reject(error));
    },
    rejectPost(error = new Error('network down')) {
      post.mockImplementation(() => Promise.reject(error));
    },
  };
}

// ----------------------------------------------------------------------------
// Prisma mocking
// ----------------------------------------------------------------------------

/**
 * Build a deep auto-mock of the Prisma client. Every `prisma.<model>.<method>`
 * access returns a `jest.fn()` that resolves to `null` by default. Tests can
 * override behaviour per-call via `(prismaMock.user.findUnique as jest.Mock)
 * .mockResolvedValue(...)`.
 */
export function createPrismaMock(): any {
  const modelCache = new Map<string, any>();

  // Each model gets its OWN method cache so that, e.g., `order.findUnique`
  // and `user.findUnique` resolve to distinct `jest.fn` instances. (The
  // previous implementation shared a single method cache keyed only by the
  // method name, which collapsed every model's `findUnique` onto one fn and
  // made it impossible to stub per-model return values.)
  const makeModel = (modelName: string): any => {
    const methodCache = new Map<string, jest.Mock>();
    return new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (typeof prop !== 'string') return undefined;
          if (!methodCache.has(prop)) {
            methodCache.set(prop, jest.fn(() => Promise.resolve(null)));
          }
          return methodCache.get(prop);
        },
      }
    );
  };

  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (typeof prop !== 'string') return undefined;
        // Prisma client-level helpers (e.g. `$transaction`, `$queryRaw`,
        // `$connect`) are callable functions rather than model namespaces.
        if (prop.startsWith('$')) {
          if (!modelCache.has(`r:${prop}`)) {
            modelCache.set(`r:${prop}`, jest.fn(() => Promise.resolve(null)));
          }
          return modelCache.get(`r:${prop}`);
        }
        if (!modelCache.has(`r:${prop}`)) {
          modelCache.set(`r:${prop}`, makeModel(prop));
        }
        return modelCache.get(`r:${prop}`);
      },
      // Allow tests to (re)assign root-level helpers such as `$transaction`.
      // Without a set trap the assignment would land on the proxy target and be
      // invisible to the `get` trap, silently dropping custom implementations.
      set(_t, prop: string, value: any) {
        if (typeof prop !== 'string') return false;
        modelCache.set(`r:${prop}`, value);
        return true;
      },
    }
  );
}

/** Singleton Prisma mock (reference it inside a `jest.mock` factory). */
export const prismaMock = createPrismaMock();

// ----------------------------------------------------------------------------
// Express integration harness
// ----------------------------------------------------------------------------

export interface TestAppOptions {
  /** If provided, the `authenticate` middleware is bypassed with this user. */
  authUser?: any;
  /** Extra middleware to inject before the router (e.g. stubs). */
  before?: (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Mount a router on a fresh Express app for supertest. When `authUser` is set,
 * import `../middleware/auth` should be mocked in the test to call `next()`.
 */
export function createTestApp(router: express.Router, opts: TestAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  if (opts.before) app.use(opts.before);
  if (opts.authUser) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = opts.authUser;
      (req as any).userId = opts.authUser.id || opts.authUser.userId;
      next();
    });
  }
  app.use(router);
  return app;
}

/** A minimal authenticated user fixture for route tests. */
export function makeAuthUser(overrides: Record<string, any> = {}): any {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    plan: 'pro',
    role: 'user',
    isAdmin: false,
    ...overrides,
  };
}

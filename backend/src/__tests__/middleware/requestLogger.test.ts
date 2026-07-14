import { requestLogger, requestId } from '../../middleware/requestLogger.js';

describe('requestLogger middleware', () => {
  it('requestId sets an id header and calls next', () => {
    const req: any = { headers: {} };
    const res: any = {};
    const next = jest.fn();

    requestId(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(typeof req.headers['x-request-id']).toBe('string');
  });

  it('requestLogger calls next and registers a finish listener', () => {
    const req: any = { method: 'GET', url: '/test', headers: {} };
    const finishHandlers: Array<() => void> = [];
    const res: any = {
      statusCode: 200,
      on(event: string, cb: () => void) {
        if (event === 'finish') finishHandlers.push(cb);
      },
    };
    const next = jest.fn();

    requestLogger(req, res, next);

    expect(next).toHaveBeenCalled();
    // The finish listener should be registered without throwing.
    expect(finishHandlers.length).toBe(1);
    expect(() => finishHandlers.forEach((h) => h())).not.toThrow();
  });
});

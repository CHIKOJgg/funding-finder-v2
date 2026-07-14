import { validate } from '../../middleware/validation.js';
import { z } from 'zod';

const schema = z.object({ name: z.string().min(1), age: z.number().int() });

function makeRes() {
  const res: any = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return res;
    },
    json() {
      return res;
    },
  };
  return res;
}

describe('validation middleware', () => {
  it('passes a valid body through and replaces req.body', async () => {
    const mw = validate(schema);
    const req: any = { body: { name: 'alice', age: 30 } };
    const res = makeRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ name: 'alice', age: 30 });
  });

  it('rejects an invalid body with 400', async () => {
    const mw = validate(schema);
    const req: any = { body: { name: '', age: 'not-a-number' } };
    const res = makeRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('validates query source', async () => {
    const mw = validate(z.object({ page: z.coerce.number().int().min(1) }), 'query');
    const req: any = { query: { page: '2' }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(2);
  });
});

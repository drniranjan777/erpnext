# @nextgen/sdk

TypeScript client for the NextGen ERP public API.

- Authenticates with an API key (`ngk_…`, created under Settings → Integrations; keys carry scopes).
- Retries `429` and `5xx` answers, honouring `Retry-After`.
- `paginate()` walks cursor-paginated lists.
- `verifyWebhook()` checks the `X-NextGen-Signature` header (`t=<unix>,v1=<HMAC-SHA256 of "t.body">`) and refuses replays older than five minutes.
- Errors are `NextGenError` with the API's problem details (`status`, `detail`, `errors`).

```ts
import { NextGenClient, verifyWebhook } from '@nextgen/sdk';

const erp = new NextGenClient({ apiKey: process.env.NEXTGEN_API_KEY!, baseUrl: 'https://api.nextgen-erp.in/api/v1' });

for await (const item of erp.paginate(erp.items.list, { q: 'bearing' })) console.log(item.code, item.name);

const order = await erp.salesOrders.create({ customerId, lines: [{ itemId, qty: 10, rate: 450 }] });
await erp.salesOrders.submit(order.id, order.version);

// In your webhook handler (use the raw body, before JSON parsing):
if (!(await verifyWebhook(rawBody, req.headers['x-nextgen-signature'], process.env.WEBHOOK_SECRET!))) return res.status(401).end();
```

Any other endpoint the key's scopes allow: `erp.request('GET', '/inventory/stock', { query: { itemId } })`.

Build with `npm run build` (TypeScript 5+). The API reference is served at `/api/docs` on every installation.

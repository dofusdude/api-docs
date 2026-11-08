# Documentation checks

Run `npm ci`, `npm test`, and `npm run check` from this repository.
The tests validate the generated JSON filter and QUERY body examples against
their schemas and require an executable example for every public game-data
GET, QUERY, and OPTIONS operation.

To execute those examples against a running API:

```sh
API_TEST_BASE_URL=https://beta.api.dofusdu.de npm run test:examples
```

The check uses read-only requests, consumes bulk exports, and checks CORS
preflights for QUERY and OPTIONS. Every example must return a successful
response, including searches. Webhook administration is
excluded because it requires credentials and user-owned subscription IDs.
The same check is available as the **Check live documentation examples**
workflow. For deployment checks before DNS propagation, optionally set
`API_TEST_ADDRESS` to the server's IPv4 address; TLS hostname verification
remains enabled.

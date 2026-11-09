# API Documentation

This is the OpenAPI Specification for the [Dofusdude API](https://docs.dofusdu.de).

If you find errors or want to propose features (never break backwards compatibility), you are welcome to contribute.

The original yaml was created with a GUI Tool named [Stoplight Studio](https://stoplight.io). There are many tools for working with OpenAPI, checkout [OpenAPI.Tools](https://openapi.tools) for more.

Edit `openapi-3.0.yaml` for GET/response schemas and
`scripts/build-openapi.mjs` for QUERY schemas. Explain concepts in the relevant
endpoint and schema descriptions. `openapi-3.2.yaml` is generated.
Do not edit it directly. `query-contract.json` is generated from doduapi's
`query/contract.go` registry:

```sh
# Set these to your checkout locations:
DODUAPI_DIR=/absolute/path/to/doduapi
API_DOCS_DIR=/absolute/path/to/api-docs
(cd "$DODUAPI_DIR" && go run ./cmd/query-contract -output "$API_DOCS_DIR/query-contract.json")
cd "$API_DOCS_DIR"
npm ci
npm run build
npm run check
```

Serve this directory over HTTP and open `index.html`. Deploy the bundled UI
with `openapi-3.2.yaml` for QUERY support. SDK generators without OpenAPI 3.2
support can use `openapi-3.0.yaml` for GET operations. Both describe API v1.

The hosted beta documentation loads `openapi-3.2.yaml` directly from the
`beta` branch on GitHub. Push the regenerated specification to update the
website. Its default API server is `https://beta.api.dofusdu.de`.

## Release channels

`main` generates stable SDKs on their `main` branches. `beta` generates
prerelease SDKs on their `beta` branches. Set `info.version` to a stable version
on `main` or `X.Y.Z-beta.N` on `beta`. The workflow rejects mismatches.
Both channels run the same generator jobs. SDKs currently expose GET operations
only. The complete documentation also describes HTTP QUERY.

Generated SDK workflows run on both branches. Publish beta SDK GitHub releases
as prereleases from their `beta` branch. Their npm publishers use the `beta`
dist-tag, leaving `latest` unchanged. Python versions are normalized to
`X.Y.ZbN`. Run `npm test` and `npm run check` before pushing.

## Propose Features

2 Ways. One way is to just visit the [Discord](https://discord.gg/3EtHskZD8h) and write something into the chat.

The second, much more serious way:

Fork this repository. Then make the desired changes and push. GitHub will ask to if you want to create a pull request. Do that.

To avoid blowing up the git history, please use the [Prettier plugin](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) in VS Code for formatting.

In the comments of the pull request we can talk about the changes.
If your feature is really complicated or you want to talk about it, visit the [Discord](https://discord.gg/3EtHskZD8h).
A feature can be discussed in the PR and will be merged as soon as it goes online.

The first way is much simpler but the chances of actually getting the feature implemented is higher because you already did the initial part of designing the API.

## Thank you!
I highly welcome everyone on my Discord to just talk about projects and use cases or give feedback of any kind.

The servers have a fixed monthly cost to provide very fast responses. If you want to help me keeping them running or simply  donate, consider becoming a [GitHub Sponsor](https://github.com/sponsors/dofusdude).

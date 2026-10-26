# Assets

Put the final logo source file in this directory while preparing metadata.

Recommended final logo filename:

```text
assets/logo.png
```

Before mainnet, upload the logo to permanent public storage such as IPFS,
Arweave, NFT.Storage, Pinata, Bundlr, or Irys. Then update
`assets/metadata.json` so its `image` field points to that permanent URL.

The token creation script writes the local metadata JSON from `.env`, but the
on-chain metadata account stores only the public metadata URI, not this local
file itself.


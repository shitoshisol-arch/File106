# Jupiter VRFD verification submission — FILE106 (F106)

Submit at <https://verified.jup.ag/tokens> using **Verify token**. Standard review is free. Do not use the 1,000 JUP Express API unless you specifically need automation.

## Before submitting

- [ ] Deploy the trust site in `site/` and replace `[SITE_URL]` below.
- [ ] Create an official X account and replace `[X_URL]`. VRFD expects a project X handle.
- [ ] Optional: create Telegram/Discord and replace the placeholders.
- [ ] Never share a private key or seed phrase with anyone, including reviewers.

## Fields

```text
Token name: FILE106
Symbol: F106
Mint: Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE
Website: [SITE_URL]
X: [X_URL]
Telegram: [TELEGRAM_URL]
Discord: [DISCORD_URL]
```

## Description

```text
FILE106 is a fixed-supply Solana archive token: exactly 106 coins, 8 decimals. Mint and freeze authorities are revoked, metadata is locked and immutable, and Raydium CPMM liquidity is burned. There are no transfer fees, no Token-2022 extensions, and no active admin powers. The token is live and routable on Jupiter. Verification is requested so wallets and explorers can display accurate metadata and so the official mint can be distinguished from copycats.
```

## On-chain evidence

```text
Mint account:
https://solscan.io/token/Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE

Mint authority revoked:
https://solscan.io/tx/2S5X3AXzJu9tKGCLNFuaBWpUQgqhCVzUpn8npH4pXuKN59BmF881b555zEfdUhB7xiBbYbq2R21aB8rwaKuU2kf9

Freeze authority revoked:
https://solscan.io/tx/2mzsivzkeaeej1DXUiLudNgwPkBuYGJDFRuNmY8VPchuvuhi8Kn6aukwCzhPMiSKXeRa1LfkVU89awtmxhKL61B6

Metadata locked (isMutable = false):
https://solscan.io/tx/5zW8fWVPG32booC1taXG6pMMxKabLuZpXSyXAonPoeCuxfFNWPWpt5Ft1G2JCaqmuSsoK2kHSo7mmWF5R8V8iGph

Raydium CPMM pool:
https://dexscreener.com/solana/HVpCVM92m6TkJpXpnudWEDZbjq5ucLJvJuJZAzSZhqtB

LP mint (supply 0, burned):
https://solscan.io/token/2isypyBvgEm3FmXDiSWfJRPM5ck8gW599mtAxXLv33kK

Explorer:
https://explorer.solana.com/address/Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE
```

## Supply and treasury

```text
Total supply: 106 F106. No inflation; the mint authority is revoked.
Decimals: 8 (10,600,000,000 base units).
Liquidity: Raydium CPMM pool HVpCVM92m6TkJpXpnudWEDZbjq5ucLJvJuJZAzSZhqtB. LP mint supply is 0, so liquidity is burned.
Remaining supply: [describe treasury custody, lock, or vesting plan, if applicable].
Third-party audit: none. All security claims are verifiable on-chain.
```

## Notes for reviewers

```text
- The on-chain metadata is immutable, so website and social links cannot be added to the Metaplex account. They are provided in this submission and on [SITE_URL].
- This is the first verification request; the token is not yet listed on Jupiter or CoinGecko.
- Contract-level security is complete. The request concerns metadata accuracy and official-mint recognition.
- The token is sellable: Jupiter returns a Raydium CPMM route for both buy and sell quotes.
```

## After submitting

- Track the request at <https://verified.jup.ag/tokens/browse>.
- Do not pay unofficial “verification” services or share keys with anyone claiming to expedite review.
- Do not wash trade or fake volume while the review is pending. Jupiter's organic-score systems detect it.

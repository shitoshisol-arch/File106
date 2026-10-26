# CoinGecko listing request — FILE106 (F106)

Use CoinGecko's official listing/update form. Read the current guide first:

<https://support.coingecko.com/hc/en-us/articles/23725417857817-Verification-Guide-for-Listing-Update-Requests-on-CoinGecko>

CoinGecko reviews market data, community presence, and project documentation. A 106-supply micro-cap with roughly $500 of liquidity may not qualify immediately. Submit after the trust site and official X account are live, and after more organic trading activity. Do not pay unofficial intermediaries.

## Token details

```text
Coin name: FILE106
Ticker: F106
Chain: Solana
Contract: Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE
Decimals: 8
Total supply: 106
Circulating supply: [define; e.g., 106 minus treasury-held tokens]
Launch date: 2026-10-26
Website: https://shitoshisol-arch.github.io/File106/
Explorer: https://solscan.io/token/Ha6cqBCf5rCcka3M1BNK46BeBbZFbq5Mq1KgAjCmFiLE
Market: Raydium CPMM pool HVpCVM92m6TkJpXpnudWEDZbjq5ucLJvJuJZAzSZhqtB
Logo: https://gateway.pinata.cloud/ipfs/bafybeicl5gjlcbpxmbdiomezfv5afnkedwmzk3dizouamrs7td7ltp6vuq
X: [X_URL]
Telegram: [TELEGRAM_URL]
Discord: [DISCORD_URL]
```

## Description

```text
FILE106 is a fixed-supply Solana archive token with exactly 106 coins and 8 decimals. The mint and freeze authorities are revoked, metadata is locked and immutable, and Raydium CPMM liquidity is burned. The token has no transfer fees, no Token-2022 extensions, and no active admin powers. Supply can never increase and holder accounts cannot be frozen.
```

## Proof of fixed supply and security

```text
Mint authority revoked:
https://solscan.io/tx/2S5X3AXzJu9tKGCLNFuaBWpUQgqhCVzUpn8npH4pXuKN59BmF881b555zEfdUhB7xiBbYbq2R21aB8rwaKuU2kf9

Freeze authority revoked:
https://solscan.io/tx/2mzsivzkeaeej1DXUiLudNgwPkBuYGJDFRuNmY8VPchuvuhi8Kn6aukwCzhPMiSKXeRa1LfkVU89awtmxhKL61B6

Metadata locked:
https://solscan.io/tx/5zW8fWVPG32booC1taXG6pMMxKabLuZpXSyXAonPoeCuxfFNWPWpt5Ft1G2JCaqmuSsoK2kHSo7mmWF5R8V8iGph

LP burned (LP mint supply 0):
https://solscan.io/token/2isypyBvgEm3FmXDiSWfJRPM5ck8gW599mtAxXLv33kK

Pool:
https://dexscreener.com/solana/HVpCVM92m6TkJpXpnudWEDZbjq5ucLJvJuJZAzSZhqtB
```

## Circulating supply methodology

```text
Total supply is 106. Circulating supply must exclude tokens held by the treasury or locked/vested allocations. Disclose the exact methodology and the holding addresses in the application. Do not report the full 106 as circulating if a material portion is treasury-controlled.
```

## Website checklist

The trust site in `site/` is designed to cover these requirements:

- [ ] Official mint address and chain
- [ ] Fixed supply, decimals, and token standard
- [ ] Mint/freeze revocation transaction links
- [ ] Metadata lock transaction link
- [ ] LP burn proof
- [ ] Raydium/Jupiter market links
- [ ] Tokenomics and treasury disclosure
- [ ] Official X/Telegram/Discord links
- [ ] FAQ explaining wallet warnings and copycats
- [ ] Risk disclaimer

## Notes

- No third-party audit exists. Do not claim one.
- Do not report fake volume, fake holders, or a fake circulating supply.
- CoinGecko may decline a listing until liquidity and organic activity grow. That is normal; keep building and reapply later.
- CoinGecko verification is free through the official form. Ignore paid “guaranteed listing” offers.

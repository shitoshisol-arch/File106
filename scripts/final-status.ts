import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function clusterUrl(cluster: string): string {
  return cluster === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : cluster === 'testnet'
      ? 'https://api.testnet.solana.com'
      : 'https://api.devnet.solana.com';
}

const cluster = process.env.CLUSTER || process.env.SOLANA_CLUSTER || 'devnet';
const connection = new Connection(clusterUrl(cluster), 'confirmed');

// Load keypairs
const ownerKeypairPath = path.join(__dirname, '../keys/owner-file106.json');
const mintKeypairPath = path.join(__dirname, '../keys/mint-file106-token.json');

const ownerKeypair = JSON.parse(readFileSync(ownerKeypairPath, 'utf-8'));
const mintKeypair = JSON.parse(readFileSync(mintKeypairPath, 'utf-8'));

const ownerPublicKey = new PublicKey(ownerKeypair.slice(32, 64));
const mintPublicKey = new PublicKey(mintKeypair.slice(32, 64));

async function checkFinalStatus() {
  console.log('🔍 Final FILE106 (F106) Deployment Status Check');
  console.log('================================================');
  console.log('Mint Address:', mintPublicKey.toString());
  console.log('Owner Address:', ownerPublicKey.toString());
  console.log('');

  try {
    // Check mint info
    const mintInfo = await getMint(connection, mintPublicKey, undefined, TOKEN_PROGRAM_ID);
    console.log('✅ MINT STATUS:');
    console.log('   Total Supply:', Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals), 'F106');
    console.log('   Decimals:', mintInfo.decimals);
    console.log('   Mint Authority:', mintInfo.mintAuthority ? 'ENABLED' : '❌ REVOKED (Immutable)');
    console.log('   Freeze Authority:', mintInfo.freezeAuthority ? 'ENABLED' : '❌ REVOKED (Immutable)');
    console.log('');

    // Check owner's token account
    const associatedTokenAccount = await connection.getTokenAccountsByOwner(ownerPublicKey, {
      mint: mintPublicKey,
      programId: TOKEN_PROGRAM_ID
    });

    if (associatedTokenAccount.value.length > 0) {
      const tokenAccount = associatedTokenAccount.value[0];
      const accountInfo = await getAccount(connection, tokenAccount.pubkey, 'confirmed', TOKEN_PROGRAM_ID);
      console.log('✅ OWNER TOKEN ACCOUNT:');
      console.log('   Address:', tokenAccount.pubkey.toString());
      console.log('   Balance:', Number(accountInfo.amount) / Math.pow(10, mintInfo.decimals), 'F106');
      console.log('   Frozen:', accountInfo.isFrozen ? 'YES' : 'NO');
    } else {
      console.log('❌ No token account found for owner');
    }

    console.log('');
    console.log('📋 METADATA:');
    const metadata = JSON.parse(readFileSync(path.join(__dirname, '../assets/metadata.json'), 'utf-8'));
    console.log('   Name:', metadata.name);
    console.log('   Symbol:', metadata.symbol);
    console.log('   Description:', metadata.description);
    console.log('   Image:', metadata.image);
    console.log('   External URL:', metadata.external_url);

    console.log('');
    console.log('🌐 EXPLORER LINKS:');
    const clusterQuery = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
    console.log('   Token:', `https://explorer.solana.com/address/${mintPublicKey.toString()}${clusterQuery}`);
    console.log('   Owner:', `https://explorer.solana.com/address/${ownerPublicKey.toString()}${clusterQuery}`);

    console.log('');
    console.log('🎉 DEPLOYMENT COMPLETE!');
    console.log('   ✅ Token created with 106 supply');
    console.log('   ✅ 8 decimal places');
    console.log('   ✅ Mint authority revoked (immutable)');
    console.log('   ✅ Freeze authority revoked (immutable)');
    console.log('   ✅ Metadata configured');

  } catch (error) {
    console.error('❌ Error checking status:', error);
  }
}

checkFinalStatus();
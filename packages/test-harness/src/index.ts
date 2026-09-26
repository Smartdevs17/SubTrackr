import fetch from 'node-fetch';

const DEFAULT_RPC = process.env.SOROBAN_RPC_URL || 'http://localhost:8000';

export async function deployContract(wasmHex: string) {
  // Placeholder: submit a contract deploy to the RPC
  const resp = await fetch(`${DEFAULT_RPC}/deploy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wasm: wasmHex })
  });
  return resp.json();
}

export async function fundAccount(publicKey: string) {
  // Use friendbot-style endpoint if available on the standalone server
  const resp = await fetch(`${DEFAULT_RPC}/friendbot?addr=${encodeURIComponent(publicKey)}`);
  return resp.json();
}

export async function invokeContract(payload: any) {
  const MAX_RETRIES = 2;
  let attempts = 0;
  while (true) {
    attempts++;
    const resp = await fetch(`${DEFAULT_RPC}/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await resp.json();
    if (resp.ok) return body;
    // simple retry on sequence number error
    if (body && body.error && body.error.includes && body.error.includes('sequence')) {
      if (attempts <= MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
    }
    throw new Error(JSON.stringify(body));
  }
}

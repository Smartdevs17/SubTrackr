#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 --leaked-key <stellar-secret-key>

Automatically rotate a leaked Stellar secret key by creating a new signer key pair.
Requires:
  STELLAR_HORIZON_URL
  STELLAR_ROTATION_SIGNER_SECRET

EOF
  exit 1
}

LEAKED_KEY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --leaked-key)
      LEAKED_KEY="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

if [[ -z "$LEAKED_KEY" ]]; then
  echo "Error: --leaked-key is required"
  usage
fi

if [[ -z "${STELLAR_HORIZON_URL:-}" ]]; then
  echo "Error: STELLAR_HORIZON_URL must be set"
  exit 1
fi

if [[ -z "${STELLAR_ROTATION_SIGNER_SECRET:-}" ]]; then
  echo "Error: STELLAR_ROTATION_SIGNER_SECRET must be set"
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "python3 is required"; exit 1; }

python3 <<'PY'
import os
import sys
from stellar_sdk import Keypair, Server, TransactionBuilder, Network

leaked_key = os.environ['LEAKED_KEY']
horizon_url = os.environ['STELLAR_HORIZON_URL']
signer_secret = os.environ['STELLAR_ROTATION_SIGNER_SECRET']

if not leaked_key.startswith('S'):
    print('Invalid Stellar secret key format', file=sys.stderr)
    sys.exit(1)

old_kp = Keypair.from_secret(leaked_key)
new_kp = Keypair.random()

server = Server(horizon_url=horizon_url)
account = server.load_account(old_kp.public_key)
base_fee = server.fetch_base_fee()
network_passphrase = Network.PUBLIC_NETWORK_PASSPHRASE

if 'testnet' in horizon_url:
    network_passphrase = Network.TESTNET_NETWORK_PASSPHRASE

transaction = (
    TransactionBuilder(
        source_account=account,
        network_passphrase=network_passphrase,
        base_fee=base_fee,
    )
    .append_set_options_op(master_weight=0, low_threshold=1, med_threshold=1, high_threshold=1)
    .append_set_options_op(signer={'ed25519_public_key': new_kp.public_key, 'weight': 1})
    .set_timeout(180)
    .build()

transaction.sign(old_kp)
transaction.sign(signer_secret)
response = server.submit_transaction(transaction)
print('Rotated Stellar secret key successfully:')
print('New public key:', new_kp.public_key)
print('New secret key:', new_kp.secret)
print('Transaction hash:', response['hash'])
PY

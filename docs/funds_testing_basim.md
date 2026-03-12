# Lightning Testing Flow (Regtest, 2 Nodes)

## 1. Start Bitcoin Core in regtest mode

```bash
bitcoind -regtest -daemon
```

Check it's running:

```bash
bitcoin-cli -regtest getblockchaininfo
```

## 2. Start both Lightning nodes

```bash
# First node (default dir)
lightningd --network=regtest --log-level=debug

# Second node (custom dir)
lightningd --network=regtest --lightning-dir=/Users/a1707/.lightning/secondnode --log-level=debug
```

## 3. Get node info

```bash
# First node
lightning-cli --network=regtest getinfo

# Second node
lightning-cli --network=regtest --lightning-dir=/Users/a1707/.lightning/secondnode getinfo
```

Note both `id` values.

## 4. Fund the first node's wallet

Get an address:

```bash
lightning-cli --network=regtest newaddr
```

Mine 101 blocks with funds:

```bash
bitcoin-cli -regtest generatetoaddress 101 <ADDRESS_FROM_ABOVE>
```

Verify balance:

```bash
lightning-cli --network=regtest listfunds
```

## 5. Connect nodes

Use the `id` and `port` from second node:

```bash
lightning-cli --network=regtest connect <SECOND_NODE_ID>@127.0.0.1:9736
```

## 6. Open a channel

```bash
lightning-cli --network=regtest fundchannel <SECOND_NODE_ID> 1000000
```

Mine 6 blocks to confirm:

```bash
bitcoin-cli -regtest generatetoaddress 6 $(bitcoin-cli -regtest getnewaddress)
```

Check channels:

```bash
lightning-cli --network=regtest listpeers
```

## 7. Create invoice on second node

```bash
lightning-cli --network=regtest --lightning-dir=/Users/a1707/.lightning/secondnode invoice 3msat "test1" "test payment"
```

Copy the `"bolt11"` value.

## 8. Pay invoice from first node

```bash
lightning-cli --network=regtest pay <BOLT11_STRING>
```

Expected: `"status": "complete"`

## 9. Verify payment

On **second node**:

```bash
lightning-cli --network=regtest --lightning-dir=/Users/a1707/.lightning/secondnode listinvoices
```

On **both nodes** (check balances):

```bash
# First node
lightning-cli --network=regtest listfunds

# Second node
lightning-cli --network=regtest --lightning-dir=/Users/a1707/.lightning/secondnode listfunds
```
# How Flamingo Routes Lightning Payments

## Summary

Flamingo uses Node 5 as the default hub between configured wallet nodes. Before paying, the app identifies the invoice recipient, checks both sides of the route, reuses existing liquidity, and opens additional channels when required. This lets most users make Lightning payments without managing channels themselves.

For a Node 4 to Node 6 payment, Flamingo prepares:

```text
Node 4 -> Node 5 (Flamingo Hub) -> Node 6
```

This is the default path in the current regtest setup. Flamingo prepares it, but Core Lightning still makes the final route choice. The payment is not strictly pinned to Node 5 if another route is available.

## What happens before payment

1. Flamingo decodes the BOLT11 invoice and reads its amount and payee public key.
2. It matches that key against the configured nodes to identify the recipient.
3. It checks whether the sender can send enough to Node 5.
4. It checks whether Node 5 can send enough to the recipient.
5. Existing channels are reused when they have enough liquidity.
6. Missing liquidity is added by opening another channel from the node that needs to send.
7. On regtest, funding and confirmation mining happen automatically.
8. Flamingo waits for channel activation and routing gossip, estimates the fee, and asks the user to confirm.
9. After payment, the estimate is replaced with the confirmed fee.

## Practical glossary

### Routing

Routing means sending a payment through intermediate Lightning nodes instead of opening a direct channel with every recipient. Flamingo normally prepares Node 5 as that intermediate node.

### Flamingo Hub

Node 5 is the Flamingo Hub. It receives a payment on one channel, forwards it through another, and earns a small routing fee. It is hidden from the normal account selector because it is infrastructure, but it remains visible in debug tools.

### Channel

A channel is Bitcoin locked between two Lightning nodes for off-chain payments. It is bidirectional, but the spendable balance may be mostly on one side.

### Liquidity

Liquidity is the channel balance available in a particular direction. A channel may have enough total capacity but still be unable to carry a payment because the balance is on the wrong side.

### Outbound liquidity

Outbound liquidity is what a node can send. For Node 4 -> Node 6, Node 4 needs outbound liquidity to Node 5, and Node 5 needs outbound liquidity to Node 6.

### Inbound liquidity

Inbound liquidity is what a node can receive. When Node 5 funds a channel to Node 6, Node 5 gains outbound liquidity and Node 6 gains inbound liquidity.    

### Payment direction

“Direction” describes who needs spendable balance for the current payment; the channel itself is still bidirectional. For Node 6 -> Node 4, Flamingo separately checks Node 6 -> Node 5 and Node 5 -> Node 4.

### Channel reuse and expansion

Flamingo first totals the usable balance in active channels. If it is enough, no new channel is opened. If it is too low, Flamingo adds a channel sized to at least 1,000,000 sats or roughly twice the required payment capacity.

### Confirmations and gossip

A new channel needs blockchain confirmations and time to appear in the routing graph. On regtest, Flamingo mines the blocks automatically, waits for activation, refreshes peer connections, and allows up to 90 seconds for route discovery.

### Routing fee

Before payment, Flamingo estimates the fee from the prepared route. After payment, it displays the exact difference between the amount sent by the payer and the amount received by the destination.

## Benefits

- Users do not need a direct channel with every recipient.
- The same hub channels can support many payments.
- Liquidity checks and channel setup are handled automatically.
- Fees are shown before and after payment.
- Advanced channel controls remain available in the debug tools.

## Downsides and limits

- Payments depend on the hub being online and sufficiently funded.
- The hub must lock Bitcoin in channels.
- A shared hub provides less privacy and decentralization.
- Real networks still have channel-opening fees and confirmation delays.
- Automatic funding and mining are only enabled on regtest.
- Automatic recipient-side setup currently works only for nodes configured in Flamingo.
- The prepared route uses Node 5, but the final payment is not yet forced through it.

## When to optimize manually

The default hub route is suitable for normal payments. A direct channel may be better when two nodes pay each other frequently, move larger amounts, need more privacy, or want less dependency on the hub.

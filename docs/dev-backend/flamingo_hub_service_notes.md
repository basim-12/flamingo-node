# Flamingo Hub — Service Notes

This is a living notes page for ideas, decisions, and open questions about the future Flamingo Hub service. It is not a final product specification or pricing model.

## Current development model

- Node 5 acts as the Flamingo Hub.
- Flamingo prepares the route `sender -> Node 5 -> recipient` for configured local nodes.
- Existing channel liquidity is reused first.
- If liquidity is insufficient, regtest can fund nodes, open additional channels, mine confirmations, and wait for the route automatically.
- This works without approval in development because we control all nodes and use test funds.

## Proposed production payment flow

1. Reuse an existing route when it has enough liquidity.
2. Try alternative routes before opening a new channel.
3. If the sender needs a hub channel, show its capacity, on-chain fee, expected confirmation time, and ask for approval.
4. If the recipient needs inbound liquidity, offer a just-in-time Flamingo Hub liquidity service when available.
5. Estimate the routing and service fees before confirmation and enforce a maximum fee limit.
6. If no route or liquidity option is available, fail clearly rather than leaving the payment waiting indefinitely.

## Possible Flamingo Hub services

### Payment routing

Forward payments through the hub and charge the normal Lightning routing fee.

### Inbound liquidity

The hub opens or allocates a channel toward a user so the user can receive payments. The hub pays the opening transaction and locks its own capital, so the service may need a separate fee.

### Just-in-time liquidity

Offer liquidity only when a payment cannot complete with the current channels. The user sees the option, price, capacity, and expected delay before accepting it.

### Channel monitoring

Monitor send and receive capacity, warn users before liquidity becomes critical, and suggest rebalancing, additional liquidity, or a direct channel.

### Rebalancing

Move liquidity between channels without opening another channel when a suitable circular route is available.

### Direct-channel recommendation

Recommend a direct channel when two nodes transact frequently or when repeated hub fees are becoming more expensive than opening one.

## Fee ideas to evaluate

- Standard routing fee: base fee plus a proportional fee based on the forwarded amount.
- Liquidity setup fee: covers the channel-opening transaction and operational work.
- Liquidity lease fee: compensates the hub for locking capital for a defined capacity and period.
- Just-in-time fee: a clear one-off quote shown when liquidity is needed during payment.
- Subscription or service tier: includes a defined amount of managed liquidity or discounted setup fees.
- Closing-cost policy: define who pays if a managed channel must later be closed.

The UI should keep these costs separate. Channel capacity is still locked Bitcoin, while routing fees, service fees, and on-chain fees are actual costs.

## Approval and ownership rules

- Flamingo must not spend a user's funds or open a user-funded channel without permission.
- The sender approves any new channel funded from the sender's wallet.
- The hub can use its own funds under predefined service limits, but the user must see and accept any related service fee.
- A recipient cannot be forced to fund a channel or change its liquidity.
- Removing a node from Flamingo should disconnect it from the app, not close channels or delete wallet data.

## Node management ideas

- Keep one node as the simple default experience.
- Offer multiple nodes as an advanced feature for personal/business separation, multiple stores, or local and hosted nodes.
- Add nodes through a registry rather than hard-coded configuration.
- Validate each connection with `getinfo` before saving it.
- Support rename, enable, disable, reconnect, and remove actions.
- Connect to remote nodes through an authenticated agent, VPN, or SSH tunnel; never expose the raw Lightning RPC socket publicly.

## Risks and tradeoffs

- The hub must remain online and sufficiently funded.
- Capital locked in channels has an opportunity cost.
- A shared hub reduces privacy and decentralization compared with independent route choices.
- On-chain fee changes can make liquidity services expensive.
- Channel opening is not instant on real networks.
- Liquidity estimates can become outdated before payment completes.
- Abuse controls and per-user limits will be required before the hub uses real funds automatically.

## Open decisions

- Who is eligible for hub-funded inbound liquidity?
- How much liquidity can one user request?
- How long is liquidity reserved, and can unused capacity expire?
- Which costs are paid upfront and which are collected through routing fees?
- Should the hub require minimum payment volume, a deposit, or account reputation?
- When should Flamingo rebalance instead of opening another channel?
- When should Flamingo recommend a direct channel?
- What happens if the payment fails after a just-in-time channel has been opened?
- How will fee limits, refunds, channel closure, and support be handled?

## Notes to collect during development

When a new idea or issue appears, record the scenario, who provides the funds, who benefits, which fee could apply, what approval is required, and what happens if the operation fails. This should give us the information needed to define the real Hub service later.

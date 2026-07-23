# Flamingo Wallet: Lightning Channel Approach

## The goal

Our goal is to make Lightning payments simple for people who do not understand channel management, while still giving experienced users the freedom to manage channels themselves.

For most users, Flamingo should handle the basic Lightning setup automatically. They should not need to think about peers, routing, liquidity, channel capacity, or confirmations before making a payment.

Advanced users should still be able to inspect their channels, open a direct channel, choose its size, and eventually connect through another hub. The default experience should be easy without limiting users who want more control.

## Recommended approach

We recommend making the **Flamingo Hub** the default connection for every user Lightning node.

Each user node will have a managed channel relationship with the hub. The hub will maintain connections to the wider Lightning Network and route normal payments for the user.

This avoids opening a direct channel for every payment. A new channel has an on-chain cost, locks funds into a particular relationship, takes time to confirm, and may need another on-chain transaction when it is closed. For one-time payments, routing through the hub will usually make more sense.

A direct channel is still useful when two nodes interact regularly. Flamingo should offer it as an optimization rather than making it the default.

The three choices will be:

1. **Flamingo Hub** — recommended for normal payments.
2. **Direct channel** — useful for frequent or higher-volume relationships.
3. **Custom route** — a future advanced option.

## Flamingo Hub in the development setup

For development, we will keep `node5` running exactly as it does now and use it as the Flamingo Hub. We are not removing the node; we are only changing how it is classified and displayed.

```text
node4 — User Lightning node
node5 — Flamingo Hub
node6 — Another user or test node
```

The main Lightning-node selector will show only user-owned nodes, such as `node4` and `node6`. It will not show `node5` because the user does not own or control the hub wallet.

The backend will still use `node5` internally. When the user selects `node4`, the wallet will check or create the `node4 ↔ node5` channel. If the user switches to `node6`, it will work with the `node6 ↔ node5` channel instead.

The user will see the relationship with the hub, not the hub account itself:

```text
Connected through Flamingo Hub
Channel active
Ready to send and receive
```

The debug dashboard can continue showing all nodes, including `node5`, so we can inspect its balance, liquidity, channels, and routing during development.

## Automatic onboarding

When a user creates or adds a Lightning node, Flamingo should:

1. Connect it to the Flamingo Hub.
2. Check whether it has enough capacity to send and receive.
3. Arrange the required hub channel when funds and permission are available.
4. Track the channel while it opens and waits for confirmation.
5. Tell the user when Lightning is ready.

The user should see simple progress rather than technical channel controls:

```text
Setting up Lightning...
Connecting your node to Flamingo Hub
```

Once finished:

```text
Lightning is ready
You can now send and receive payments
```

Flamingo will also manage the difference between sending and receiving capacity. The main UI can explain this simply:

```text
Available to send:       620,000 sats
Available to receive:    365,000 sats
```

If either side becomes low, the wallet can warn the user and recommend the appropriate action.

## The normal payment screen

For a normal payment, Flamingo will check the hub route and show the expected cost before confirmation:

```text
Confirm payment
Amount                         50,000 sats
Estimated Lightning fee           12 sats
Route                         Flamingo Hub
Total                          50,012 sats

Optimize                 Pay 50,012 sats
```

The fee should be presented as an estimate. Flamingo should also apply a maximum fee limit so the final payment cannot unexpectedly cost much more.

Most users can simply confirm the payment. Users who want to compare alternatives can select **Optimize**.

## The Optimize screen

The Optimize screen will compare three options.

### 1. Route through Flamingo Hub

```text
Recommended — Flamingo Hub
Estimated fee: 12 sats
Available now
No new channel required
```

### 2. Open a direct channel

```text
Channel capacity:                 250,000 sats
Estimated opening fee:              1,800 sats
Estimated closing fee today:           900 sats
Future direct payment fee:        Usually 0 sats
Available:                    After confirmation
```

Channel capacity must be shown separately from fees. It is still the user's bitcoin, but it is allocated to that channel. The closing fee is only a current estimate because future network conditions are unknown.

Where possible, Flamingo can explain when a direct channel may become worthwhile, for example after a certain number of similar payments.

### 3. Custom route

This will initially appear as **Coming later** and explain that users will eventually be able to connect through another hub or manage the route themselves.

## When to recommend a direct channel

Flamingo should not automatically open a channel whenever a payment is made, a contact is added, or someone joins a chatroom. These actions do not prove that the relationship will continue.

Instead, the wallet can recommend a direct channel when:

- Several payments have been made to the same node.
- The total payment volume is high.
- Hub fees are becoming more expensive than a direct channel.
- Payments through the hub repeatedly fail.
- A contact is marked as frequent or trusted.
- A private group has regular financial activity.

This provides a useful suggestion without unnecessarily committing the user's funds.

## Final direction

The Flamingo Hub should be the default foundation for Lightning onboarding. It gives users a reliable route for normal payments without asking them to understand channel management.
Direct channels should remain available when they genuinely provide value. This gives Flamingo an easy onboarding experience today while preserving the flexibility and user control expected from a self-managed Lightning wallet.

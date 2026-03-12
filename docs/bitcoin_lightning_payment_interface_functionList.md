# Suggested List of Functions for Bitcoin & Lightning Payment Interfaces

Bitcoin Node Functions

1.	create_btc_transaction(sender_id, recipient_address, amount, note)  -> Build and sign a raw Bitcoin transaction ready to broadcast.
Includes optional note or label for UI display.
2.	broadcast_btc_transaction(tx_hex)  -> Push the signed BTC transaction to the Bitcoin network and return the tx_id.
3.	get_tx_details_from_btcnode(tx_id) -> Get details like confirmations, timestamp, block hash, and transaction fee.
Used for showing “Payment Sent” or “Awaiting Confirmation”.
4.	estimate_btc_fee(amount, priority) -> Fetch estimated transaction fee (fast / normal / low).
Helps the user see updated “You are sending USD $XXX” in UI.
5.	get_btc_balance(user_id) -> Return current on-chain wallet balance.
Shown as “New Balance” after payment.
6.	update_btc_balance(user_id, amount, type) -> Update user’s BTC wallet after sending or receiving a payment.
7.	validate_btc_payment(sender_id, amount) -> Make sure sender has enough BTC to cover amount + network fee.
8.	cancel_btc_transaction(tx_id) -> Optional helper — mark a stuck or unbroadcasted transaction as canceled in local records.

Lightning Node Functions

9.	create_ln_invoice(user_id, amount, label, note) ->  Generate a Lightning Network invoice to request payment.
Returns the invoice string (bolt11), expiry, and payment hash.
10.	process_ln_payment(payer_id, invoice_string) -> Pay a given Lightning invoice via the user’s Lightning node.
Handles routing, fees, and returns status (“paid”, “failed”, “timeout”).
11.	get_tx_details_from_lnnode(payment_hash) -> Fetch full payment details: route info, fee, timestamp, and status.
12.	get_ln_balance(user_id) -> Retrieve user’s Lightning wallet balance (off-chain funds).
13.	update_ln_balance(user_id, amount, type) -> Update balance after invoice payment or receipt.
14.	validate_ln_payment(payer_id, amount) -> Ensure payer’s Lightning wallet has enough liquidity to pay.
15.	cancel_ln_invoice(invoice_id) -> Mark or remove expired/unpaid invoice.

Transaction Management 

16.	log_transaction(user_id, tx_id, amount, network, direction, status, note) -> Store transaction locally for audit, history, and UI logs.
Example: “Luis → Nina | 0.0019 BTC | Lightning | Paid”.
17.	get_transaction_history(user_id, network, limit, filter) -> Return list of recent BTC or LN transactions for display in wallet or chat.
18.	validate_payment_amount(user_id, amount, wallet_type) -> Universal balance check before payment is initiated.
19.	sync_wallet_balances(user_id) -> Fetch latest balances from both Bitcoin and Lightning nodes to update dashboard.
20.	convert_btc_to_usd(amount) -> Convert BTC to fiat value for display (e.g. “You are sending USD $225”).

Notifications & Realtime UI Sync

21.	send_tx_status_update(user_id, tx_id, status) -> Notify the UI when a transaction status changes (sent, confirmed, failed).
22.	send_payment_notification(sender_id, recipient_id, tx_id, status)  -> Notify both peers (via P2P event) about payment result.





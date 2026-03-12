# Suggested List of Functions for Pay Lightning Invoice Page

Lightning Payment Core

1.	get_invoice_details(invoice_id) -> Fetch invoice info (amount, recipient, label, note).
2.	process_lightning_payment(sender_id(user_id), invoice_id) -> Pay the Lightning invoice via sender’s node.
3.	update_invoice_status(invoice_id, status) -> Mark invoice as paid, failed, or expired.
4.	get_payment_status(payment_id) -> Retrieve real-time payment result from node.

User Wallet

5.	get_user_balance(user_id) -> Get user’s current Lightning wallet balance.
6.	update_user_balance(user_id, amount, type) -> Deduct or credit BTC after payment.
7.	validate_payment_amount(user_id, amount) -> Check if user has enough funds to pay invoice.

Logging & Notifications

8.	log_transaction(user_id, invoice_id, amount, status) -> Record the transaction for history/audit.
9.	send_payment_notification(payer_id, recipient_id, status) -> Notify both users of success/failure.



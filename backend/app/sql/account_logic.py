import json
import time
from datetime import date, datetime, timedelta

import requests
from app.config import FILES, PLAID_CLIENT_ID, PLAID_SECRET, logger
from app.extensions import db
from app.models import Account, AccountDetails, AccountHistory, PlaidItem, Transaction

TRANSACTIONS_RAW = FILES["TRANSACTIONS_RAW"]
TRANSACTIONS_RAW_ENRICHED = FILES["TRANSACTIONS_RAW_ENRICHED"]


def save_plaid_item(user_id, item_id, access_token, institution_name, product):
    """
    Save or update a PlaidItem record in the database.
    """
    item = PlaidItem.query.filter_by(item_id=item_id).first()
    if item:
        item.access_token = access_token
        item.institution_name = institution_name
        item.updated_at = datetime.utcnow()
    else:
        item = PlaidItem(
            user_id=user_id,
            item_id=item_id,
            access_token=access_token,
            institution_name=institution_name,
            product=product,
        )
        db.session.add(item)
    db.session.commit()
    return item


def upsert_accounts(user_id, accounts_data, provider, batch_size=100):
    """
    Inserts or updates account information from the provided accounts_data.
    For liability accounts like credit cards, the balance sign is reversed.
    """
    logger.debug(f"Upserting accounts for user {user_id}: {accounts_data}")
    processed_ids = set()
    count = 0

    for account in accounts_data:
        account_id = account.get("id")
        if not account_id:
            logger.warning("Encountered an account with no 'id'; skipping.")
            continue

        if account_id in processed_ids:
            logger.warning(
                f"Duplicate account id {account_id} encountered; skipping duplicate."
            )
            continue
        processed_ids.add(account_id)

        name = account.get("name") or "Unnamed Account"
        acc_type = account.get("type") or "Unknown"
        # Normalize the account type to ensure consistent matching
        normalized_type = acc_type.strip().lower()
        balance = account.get("balance", {}).get("current", 0) or 0

        # Check if the account type indicates a liability (e.g., credit or credit card)
        if normalized_type in ["credit", "credit card", "credit_card", "liability"]:
            credit_balance = -balance
            logger.debug(
                f"Account {account_id} is {normalized_type}; inverting balance from {balance} to {credit_balance}."
            )
            balance = credit_balance

        unformatted_subtype = account.get("subtype") or "Unknown"

        subtype = unformatted_subtype.capitalize()

        status = account.get("status") or "Unknown"
        institution = account.get("institution", {}) or {}
        institution_name = institution.get("name") or "Unknown"
        enrollment_id = account.get("enrollment_id") or ""
        refresh_links = account.get("links") or {}
        access_token = account.get("access_token") or ""

        logger.debug(f"Processing account id: {account_id}")
        existing = Account.query.filter_by(account_id=account_id).first()
        now = datetime.utcnow()
        if existing:
            logger.debug(f"Updating account {name}, {account_id}")
            existing.name = name
            existing.access_token = access_token
            existing.type = acc_type
            existing.balance = balance
            existing.subtype = subtype
            existing.status = status
            existing.institution_name = institution_name
            existing.last_refreshed = now
            existing.link_type = provider
            if existing.details:
                existing.details.enrollment_id = enrollment_id
                existing.details.refresh_links = json.dumps(refresh_links)
            else:
                details = AccountDetails(
                    account_id=account_id,
                    enrollment_id=enrollment_id,
                    refresh_links=json.dumps(refresh_links),
                )
                db.session.add(details)
        else:
            logger.debug(f"Inserting new account {account_id}")
            new_account = Account(
                account_id=account_id,
                user_id=user_id,
                access_token=access_token,
                name=name,
                type=acc_type,
                balance=balance,
                subtype=subtype,
                status=status,
                institution_name=institution_name,
                last_refreshed=now,
                link_type=provider,
            )
            db.session.add(new_account)
            db.session.flush()  # Ensure new_account gets an ID before adding details.
            details = AccountDetails(
                account_id=account_id,
                enrollment_id=enrollment_id,
                refresh_links=json.dumps(refresh_links),
            )
            db.session.add(details)

        # Insert a historical record if not already present for today.
        today = date.today()
        existing_history = AccountHistory.query.filter_by(
            account_id=account_id, date=today
        ).first()
        if not existing_history:
            history_record = AccountHistory(
                account_id=account_id, date=today, balance=balance
            )
            db.session.add(history_record)

        count += 1
        if count % batch_size == 0:
            db.session.commit()
            logger.debug(f"Committed batch of {batch_size} accounts.")

    db.session.commit()  # Commit any remaining accounts
    logger.debug("Finished upserting accounts.")


def fetch_url_with_backoff(url, cert, auth, max_retries=3, initial_delay=10):
    """
    Perform a GET request with exponential backoff if we receive a 429 (rate-limit) response.

    :param url: URL to request
    :param cert: A tuple (cert_file, key_file) or None
    :param auth: A tuple (username, password) or (token, '')
    :param max_retries: Maximum number of total attempts before giving up
    :param initial_delay: How many seconds to wait for the first backoff; doubles each time
    :return: The final response object (even if not 200 OK)
    """
    wait_time = initial_delay
    for attempt in range(1, max_retries + 1):
        resp = requests.get(url, cert=cert, auth=auth)

        # If no rate-limit error, return immediately
        if resp.status_code != 429:
            return resp

        # Otherwise, handle 429
        logger.warning(
            f"Received 429 (rate-limit) on attempt {attempt} for {url}. "
            f"Sleeping {wait_time} seconds before retry."
        )
        time.sleep(wait_time)
        wait_time *= 2  # Exponential backoff

    # Return the last response after exhausting retries
    return resp


def refresh_data_for_teller_account(
    account, access_token, teller_dot_cert, teller_dot_key, teller_api_base_url
):
    """
    Refreshes account balance and transactions by querying the Teller API.
    Updates the account balance and adds/updates transactions accordingly.
    """
    updated = False
    datetime.utcnow()

    # --- Refresh Balance ---
    url_balance = f"{teller_api_base_url}/accounts/{account.account_id}/balances"
    resp_balance = fetch_url_with_backoff(
        url_balance, cert=(teller_dot_cert, teller_dot_key), auth=(access_token, "")
    )
    if resp_balance.status_code == 200:
        logger.debug(
            f"Balance response for account {account.account_id}: {resp_balance.text}"
        )
        balance_json = resp_balance.json()
        new_balance = account.balance  # default fallback

        # Check if response contains the "available" key
        if "available" in balance_json:
            account_type = account.type.lower() if account.type else ""
            # For credit/liability accounts: use the ledger value and invert its sign
            if account_type in ["credit", "liability"]:
                try:
                    ledger_value = float(balance_json.get("ledger", account.balance))
                    new_balance = -ledger_value  # Invert the sign for credit accounts
                    logger.debug(
                        f"Inverting ledger balance for credit account {account.account_id}: {ledger_value} -> {new_balance}"
                    )
                except Exception as e:
                    logger.error(f"Error parsing 'ledger' balance: {e}", exc_info=True)
                    new_balance = account.balance
            else:
                # For depository accounts: use the available value
                try:
                    new_balance = float(balance_json.get("available", account.balance))
                    logger.debug(
                        f"Using available balance for depository account {account.account_id}: {new_balance}"
                    )
                except Exception as e:
                    logger.error(
                        f"Error parsing 'available' balance: {e}", exc_info=True
                    )
                    new_balance = account.balance

        # Fallback: Check if response contains a nested "balance" key
        elif isinstance(balance_json, dict) and "balance" in balance_json:
            new_balance = (
                balance_json.get("balance", {}).get("current", account.balance) or 0
            )
            logger.debug("Extracted balance using nested 'balance' key.")
        elif isinstance(balance_json, dict) and "balances" in balance_json:
            balances_list = balance_json.get("balances", [])
            if balances_list:
                new_balance = balances_list[0].get("current", account.balance) or 0
                logger.debug(
                    "Extracted balance from the first element of 'balances' list."
                )
            else:
                logger.warning(
                    f"'balances' list is empty for account {account.account_id}."
                )
                new_balance = account.balance
        else:
            logger.warning(
                f"Unexpected balance response format for account {account.account_id}: {balance_json}"
            )
            new_balance = account.balance

        if new_balance != account.balance:
            logger.debug(
                f"Account {account.account_id}: Balance updated from {account.balance} to {new_balance}"
            )
            account.balance = new_balance
            updated = True
        else:
            logger.debug(
                f"Account {account.account_id}: Balance remains unchanged: {account.balance}"
            )
    else:
        logger.error(
            f"Failed to refresh balance for account {account.account_id}: {resp_balance.text}"
        )

    # --- Refresh Transactions ---
    url_txns = f"{teller_api_base_url}/accounts/{account.account_id}/transactions"
    logger.debug(
        f"Requesting transactions for account {account.account_id} from {url_txns}"
    )
    resp_txns = fetch_url_with_backoff(
        url_txns, cert=(teller_dot_cert, teller_dot_key), auth=(access_token, "")
    )
    if resp_txns.status_code == 200:
        logger.debug(
            f"Transactions response for account {account.account_id}: {resp_txns.text}"
        )
        txns_json = resp_txns.json()
        with open(TRANSACTIONS_RAW, "w") as f:
            json.dump(txns_json, f, indent=4)
        if isinstance(txns_json, dict) and "transactions" in txns_json:
            txns_list = txns_json.get("transactions", [])
        elif isinstance(txns_json, list):
            txns_list = txns_json
        else:
            txns_list = []

        for txn in txns_list:
            txn_id = txn.get("id")
            if not txn_id:
                logger.warning(
                    "Encountered a transaction without an 'id'; skipping this transaction."
                )
                continue

            try:
                existing_txn = Transaction.query.filter_by(
                    transaction_id=txn_id
                ).first()
            except Exception as ex:
                logger.error(
                    f"Error querying transaction {txn_id}: {ex}", exc_info=True
                )
                existing_txn = None

            # Process transaction details.
            details = txn.get("details", {}) or {}
            category = details.get("category")
            if isinstance(category, list) and category:
                category = category[-1] or "Unknown"
            else:
                category = category or "Unknown"

            counterparty = details.get("counterparty")
            merchant_name = "Unknown"
            merchant_typ = "Unknown"
            if isinstance(counterparty, list):
                if counterparty and isinstance(counterparty[0], dict):
                    merchant_name = counterparty[0].get("name", "Unknown")
                    merchant_typ = counterparty[0].get("type", "Unknown")
                else:
                    logger.debug(
                        f"Counterparty list for transaction {txn_id} is empty or improperly formatted."
                    )
            elif isinstance(counterparty, dict):
                merchant_name = counterparty.get("name", "Unknown")
                merchant_typ = counterparty.get("type", "Unknown")
            else:
                logger.debug(
                    f"Counterparty for transaction {txn_id} is of unexpected type: {type(counterparty)}"
                )

            if existing_txn:
                logger.debug(
                    f"Updating existing transaction {txn_id} for account {account.account_id}."
                )
                existing_txn.amount = txn.get("amount") or 0
                existing_txn.date = txn.get("date") or ""
                existing_txn.description = txn.get("description") or ""
                existing_txn.category = category
                existing_txn.merchant_name = merchant_name
                existing_txn.merchant_typ = merchant_typ
            else:
                logger.debug(
                    f"Inserting new transaction {txn_id} for account {account.account_id}."
                )
                new_txn = Transaction(
                    transaction_id=txn_id,
                    account_id=account.account_id,
                    amount=txn.get("amount") or 0,
                    date=txn.get("date") or "",
                    description=txn.get("description") or "",
                    category=category,
                    merchant_name=merchant_name,
                    merchant_typ=merchant_typ,
                )
                db.session.add(new_txn)
        updated = True
    else:
        logger.error(
            f"Failed to refresh transactions for account {account.account_id}: {resp_txns.text}"
        )

    # --- Update Last Refreshed and Account History ---
    today = datetime.today()
    existing_history = AccountHistory.query.filter_by(
        account_id=account.account_id, date=today
    ).first()
    if not existing_history:
        logger.debug(
            f"Creating new history record for account {account.account_id} for date {today}."
        )
        history_record = AccountHistory(
            account_id=account.account_id, date=today, balance=account.balance
        )
        db.session.add(history_record)
        updated = True
    else:
        logger.debug(
            f"History record already exists for account {account.account_id} for date {today}."
        )

    return updated


def refresh_data_for_plaid_account(account, access_token, plaid_base_url):
    """
    Refreshes a Plaid-linked account by querying the Plaid API.
    It refreshes the account balance and transactions by calling:
      - /accounts/get to fetch balance information.
      - /transactions/get to fetch recent transactions.
    Updates the account record in the SQL database accordingly.
    Also upserts each transaction in the Transactions table.
    Returns True if any update occurred.
    """
    updated = False
    now = datetime.utcnow()

    logger.debug(
        f"Called refresh_data_for_plaid_account for account {account.account_id}"
    )

    # --- Refresh Balance ---
    url_balance = f"{plaid_base_url}/accounts/get"
    payload_balance = {
        "client_id": PLAID_CLIENT_ID,
        "secret": PLAID_SECRET,
        "access_token": access_token,
    }
    try:
        resp_balance = requests.post(url_balance, json=payload_balance)
        logger.debug(
            f"Plaid balance response for account {account.account_id}: {resp_balance.status_code} - {resp_balance.text}"
        )
        if resp_balance.status_code == 200:
            data = resp_balance.json()
            # Optional: Save raw response for debugging.
            with open(TRANSACTIONS_RAW_ENRICHED, "w") as f:
                json.dump(data, f, indent=4)
            accounts_list = data.get("accounts", [])
            plaid_account = next(
                (
                    acc
                    for acc in accounts_list
                    if acc.get("account_id") == account.account_id
                ),
                None,
            )
            if plaid_account:
                try:
                    new_balance = float(
                        plaid_account.get("balances", {}).get(
                            "current", account.balance
                        )
                    )
                except Exception as e:
                    logger.error(
                        f"Error parsing Plaid balance for account {account.account_id}: {e}",
                        exc_info=True,
                    )
                    new_balance = account.balance

                if new_balance != account.balance:
                    logger.debug(
                        f"Account {account.account_id}: Balance updated from {account.balance} to {new_balance}"
                    )
                    account.balance = new_balance
                    updated = True
                else:
                    logger.debug(
                        f"Account {account.account_id}: Balance remains unchanged: {account.balance}"
                    )
            else:
                logger.warning(
                    f"Account {account.account_id} not found in Plaid balance response."
                )
        else:
            logger.error(
                f"Failed to refresh Plaid balance for account {account.account_id}: {resp_balance.text}"
            )
    except Exception as e:
        logger.error(
            f"Exception while refreshing Plaid balance for account {account.account_id}: {e}",
            exc_info=True,
        )

    # --- Refresh Transactions ---
    url_txns = f"{plaid_base_url}/transactions/get"
    start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    end_date = datetime.now().strftime("%Y-%m-%d")
    payload_txns = {
        "client_id": PLAID_CLIENT_ID,
        "secret": PLAID_SECRET,
        "access_token": access_token,
        "start_date": start_date,
        "end_date": end_date,
    }
    try:
        resp_txns = requests.post(url_txns, json=payload_txns, timeout=10)
        logger.debug(
            f"Plaid transactions response for account {account.account_id}: {resp_txns.status_code} - {resp_txns.text}"
        )
        if resp_txns.status_code == 200:
            txns_json = resp_txns.json()
            # Optional: Save raw transactions response for auditing.
            with open(TRANSACTIONS_RAW_ENRICHED, "w") as f:
                json.dump(txns_json, f, indent=4)
            transactions = txns_json.get("transactions", [])
            if transactions:
                for txn in transactions:
                    txn_id = txn.get("transaction_id")
                    if not txn_id:
                        logger.warning(
                            "Encountered a transaction without a 'transaction_id'; skipping."
                        )
                        continue

                    existing_txn = Transaction.query.filter_by(
                        transaction_id=txn_id
                    ).first()

                    # Extract common fields
                    amount = txn.get("amount") or 0
                    date_str = txn.get("date") or txn.get("authorized_date") or ""
                    # Use the 'name' field as description if available; fallback to merchant_name.
                    description = txn.get("name") or txn.get("merchant_name") or ""

                    # Process category: if a list is provided, use the last element.
                    category_list = txn.get("category")
                    if isinstance(category_list, list) and category_list:
                        category = category_list[-1] or "Unknown"
                    else:
                        category = "Unknown"

                    # Process merchant details:
                    merchant_name = txn.get("merchant_name") or "Unknown"
                    merchant_typ = "Unknown"
                    counterparties = txn.get("counterparties")
                    if isinstance(counterparties, list) and counterparties:
                        merchant_typ = counterparties[0].get("type", "Unknown")

                    if existing_txn:
                        logger.debug(
                            f"Updating existing transaction {txn_id} for account {account.account_id}."
                        )
                        existing_txn.amount = amount
                        existing_txn.date = date_str
                        existing_txn.description = description
                        existing_txn.category = category
                        existing_txn.merchant_name = merchant_name
                        existing_txn.merchant_typ = merchant_typ
                    else:
                        logger.debug(
                            f"Inserting new transaction {txn_id} for account {account.account_id}."
                        )
                        new_txn = Transaction(
                            transaction_id=txn_id,
                            account_id=account.account_id,
                            amount=amount,
                            date=date_str,
                            description=description,
                            category=category,
                            merchant_name=merchant_name,
                            merchant_typ=merchant_typ,
                        )
                        db.session.add(new_txn)
                updated = True
            else:
                logger.debug(
                    f"No transactions found in Plaid response for account {account.account_id}."
                )
        else:
            logger.error(
                f"Failed to refresh Plaid transactions for account {account.account_id}: {resp_txns.text}"
            )
    except Exception as e:
        logger.error(
            f"Exception while refreshing Plaid transactions for account {account.account_id}: {e}",
            exc_info=True,
        )

    # --- Update Last Refreshed ---
    account.last_refreshed = now

    return updated


def get_accounts_from_db():
    """
    Fetch all saved accounts from the database and return as a list of dictionaries.
    """
    accounts = Account.query.all()
    serialized = []
    for acc in accounts:
        serialized.append(
            {
                "account_id": acc.account_id,
                "user_id": acc.user_id,
                "name": acc.name or "Unnamed Account",
                "type": acc.type or "Unknown",
                "subtype": acc.subtype or "Unknown",
                "status": acc.status or "Unknown",
                "institution_name": acc.institution_name or "Unknown",
                "balance": acc.balance if acc.balance is not None else 0,
                "last_refreshed": acc.last_refreshed.isoformat()
                if acc.last_refreshed
                else None,
                "link_type": acc.link_type or "Unknown",
            }
        )
    return serialized


def get_paginated_transactions(page, page_size):
    """
    Returns a tuple (transactions_list, total_count) where each transaction record
    includes fields from both the Transaction and the associated Account.
    """
    query = (
        db.session.query(Transaction, Account)
        .join(Account, Transaction.account_id == Account.account_id)
        .order_by(Transaction.date.desc())
    )
    total = query.count()
    results = query.offset((page - 1) * page_size).limit(page_size).all()
    serialized = []
    for txn, acc in results:
        serialized.append(
            {
                "transaction_id": txn.transaction_id,
                "date": txn.date or "",
                "amount": txn.amount if txn.amount is not None else 0,
                "description": txn.description or "",
                "category": txn.category or "Unknown",
                "merchant_name": txn.merchant_name or "Unknown",
                # Account fields:
                "account_name": acc.name or "Unnamed Account",
                "institution_name": acc.institution_name or "Unknown",
                "subtype": acc.subtype or "Unknown",
            }
        )
    return serialized, total

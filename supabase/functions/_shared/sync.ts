import { plaidRequest } from './plaid.ts';
import { decryptAccessToken } from './crypto.ts';

type FinancialAccountRow = {
  id: number;
  subtype: string | null;
};

function mapPlaidToAppTransaction(txn: Record<string, unknown>) {
  const amount = Number(txn.amount || 0);
  const isIncome = amount < 0;
  const absoluteAmount = Math.abs(amount);
  const name = String(txn.name || txn.merchant_name || 'Bank transaction');
  const lowerName = name.toLowerCase();

  const categoryArray = Array.isArray(txn.category) ? txn.category.map((v) => String(v).toLowerCase()) : [];
  const personalFinance = txn.personal_finance_category as Record<string, unknown> | undefined;
  const primary = String(personalFinance?.primary || '').toLowerCase();
  const detailed = String(personalFinance?.detailed || '').toLowerCase();

  let category = isIncome ? 'Other Income' : 'Other Expenses';

  if (isIncome) {
    if (primary.includes('income') || detailed.includes('payroll') || lowerName.includes('payroll') || lowerName.includes('salary')) {
      category = 'Salary';
    } else if (lowerName.includes('refund')) {
      category = 'Refunds';
    }
  } else {
    if (primary.includes('food') || categoryArray.some((c) => c.includes('grocer'))) {
      category = 'Groceries';
    } else if (primary.includes('travel') || primary.includes('transport') || lowerName.includes('uber') || lowerName.includes('lyft') || lowerName.includes('gas')) {
      category = 'Transportation';
    } else if (primary.includes('entertainment') || lowerName.includes('netflix') || lowerName.includes('spotify')) {
      category = 'Entertainment';
    } else if (primary.includes('rent') || lowerName.includes('rent')) {
      category = 'Rent/Mortgage';
    } else if (primary.includes('medical') || primary.includes('healthcare')) {
      category = 'Healthcare';
    } else if (primary.includes('loan') || primary.includes('credit')) {
      category = 'Debt Payments';
    }
  }

  return {
    description: name,
    type: isIncome ? 'Income' : 'Expense',
    category,
    amount: absoluteAmount,
    start_date: String(txn.date || new Date().toISOString().slice(0, 10)),
    frequency: 'Once',
    end_date: null
  };
}

function isCheckingAccount(account: FinancialAccountRow | null) {
  return String(account?.subtype || '').toLowerCase() === 'checking';
}

function shouldProjectToAppTransaction(txn: Record<string, unknown>, account: FinancialAccountRow | null) {
  return isCheckingAccount(account) && !Boolean(txn.pending);
}

async function getFinancialAccountByPlaidId(
  adminClient: any,
  userId: string,
  plaidAccountId: string
): Promise<FinancialAccountRow | null> {
  const { data: accountRow, error } = await adminClient
    .from('financial_accounts')
    .select('id, subtype')
    .eq('user_id', userId)
    .eq('plaid_account_id', plaidAccountId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return accountRow || null;
}

async function upsertFinancialTransactionRecord(
  adminClient: any,
  userId: string,
  itemId: number,
  plaidTransactionId: string,
  accountId: number | null,
  plaidTxn: Record<string, unknown>
) {
  const { error } = await adminClient
    .from('financial_transactions')
    .upsert({
      user_id: userId,
      item_id: itemId,
      plaid_transaction_id: plaidTransactionId,
      account_id: accountId,
      amount: Number(plaidTxn.amount || 0),
      date: String(plaidTxn.date || new Date().toISOString().slice(0, 10)),
      name: String(plaidTxn.name || plaidTxn.merchant_name || 'Bank transaction'),
      merchant_name: plaidTxn.merchant_name ? String(plaidTxn.merchant_name) : null,
      category: plaidTxn.category ? plaidTxn.category : null,
      pending: Boolean(plaidTxn.pending),
      raw: plaidTxn,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,plaid_transaction_id' });

  if (error) {
    throw new Error(error.message);
  }
}

async function deleteLinkedAppTransaction(
  adminClient: any,
  userId: string,
  plaidTransactionId: string
) {
  const { data: linkRow, error: linkError } = await adminClient
    .from('financial_transaction_links')
    .select('id, app_transaction_id')
    .eq('user_id', userId)
    .eq('plaid_transaction_id', plaidTransactionId)
    .maybeSingle();

  if (linkError) {
    throw new Error(linkError.message);
  }

  if (!linkRow) return false;

  const { error: deleteTxnError } = await adminClient
    .from('transactions')
    .delete()
    .eq('id', linkRow.app_transaction_id);

  if (deleteTxnError) {
    throw new Error(deleteTxnError.message);
  }

  const { error: deleteLinkError } = await adminClient
    .from('financial_transaction_links')
    .delete()
    .eq('id', linkRow.id);

  if (deleteLinkError) {
    throw new Error(deleteLinkError.message);
  }

  return true;
}

async function upsertLinkedAppTransaction(
  adminClient: any,
  userId: string,
  plaidTransactionId: string,
  appTxn: Record<string, unknown>
) {
  const { data: existingLink, error: linkError } = await adminClient
    .from('financial_transaction_links')
    .select('id, app_transaction_id')
    .eq('user_id', userId)
    .eq('plaid_transaction_id', plaidTransactionId)
    .maybeSingle();

  if (linkError) {
    throw new Error(linkError.message);
  }

  if (existingLink?.app_transaction_id) {
    const { error: updateError } = await adminClient
      .from('transactions')
      .update({
        ...appTxn,
        updated_by: userId
      })
      .eq('id', existingLink.app_transaction_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return { created: false };
  }

  const { data: insertedAppTxn, error: appTxnError } = await adminClient
    .from('transactions')
    .insert({
      ...appTxn,
      created_by: userId,
      updated_by: userId
    })
    .select('id')
    .single();

  if (appTxnError || !insertedAppTxn) {
    throw new Error(appTxnError?.message || 'Unable to create app transaction from Plaid data.');
  }

  const { error: createLinkError } = await adminClient
    .from('financial_transaction_links')
    .insert({
      user_id: userId,
      plaid_transaction_id: plaidTransactionId,
      app_transaction_id: insertedAppTxn.id
    });

  if (createLinkError) {
    throw new Error(createLinkError.message);
  }

  return { created: true };
}

export async function syncItemTransactions(
  adminClient: any,
  userId: string,
  item: { id: number; plaid_item_id: string; access_token_ciphertext: string; cursor: string | null }
) {
  const accessToken = await decryptAccessToken(item.access_token_ciphertext);
  let cursor = item.cursor || null;
  let hasMore = true;
  let syncedCount = 0;
  let skippedCount = 0;

  while (hasMore) {
    const syncResponse = await plaidRequest('/transactions/sync', {
      access_token: accessToken,
      cursor,
      count: 100
    });

    const added = Array.isArray(syncResponse?.added) ? syncResponse.added : [];
    const modified = Array.isArray(syncResponse?.modified) ? syncResponse.modified : [];
    const removed = Array.isArray(syncResponse?.removed) ? syncResponse.removed : [];

    for (const removedTxn of removed) {
      const plaidTransactionId = String(removedTxn.transaction_id || '');
      if (!plaidTransactionId) continue;

      await deleteLinkedAppTransaction(adminClient, userId, plaidTransactionId);

      await adminClient
        .from('financial_transactions')
        .delete()
        .eq('user_id', userId)
        .eq('plaid_transaction_id', plaidTransactionId);
    }

    for (const plaidTxn of added) {
      const plaidTransactionId = String(plaidTxn.transaction_id || '');
      if (!plaidTransactionId) continue;

      const accountRow = await getFinancialAccountByPlaidId(adminClient, userId, String(plaidTxn.account_id || ''));
      await upsertFinancialTransactionRecord(adminClient, userId, item.id, plaidTransactionId, accountRow?.id || null, plaidTxn);

      const appTxn = mapPlaidToAppTransaction(plaidTxn);
      if (!shouldProjectToAppTransaction(plaidTxn, accountRow)) {
        await deleteLinkedAppTransaction(adminClient, userId, plaidTransactionId);
        skippedCount += 1;
        continue;
      }

      const appSyncResult = await upsertLinkedAppTransaction(adminClient, userId, plaidTransactionId, appTxn);
      if (appSyncResult.created) {
        syncedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    for (const plaidTxn of modified) {
      const plaidTransactionId = String(plaidTxn.transaction_id || '');
      if (!plaidTransactionId) continue;

      const accountRow = await getFinancialAccountByPlaidId(adminClient, userId, String(plaidTxn.account_id || ''));
      await upsertFinancialTransactionRecord(adminClient, userId, item.id, plaidTransactionId, accountRow?.id || null, plaidTxn);

      if (!shouldProjectToAppTransaction(plaidTxn, accountRow)) {
        await deleteLinkedAppTransaction(adminClient, userId, plaidTransactionId);
        continue;
      }

      const appTxn = mapPlaidToAppTransaction(plaidTxn);
      await upsertLinkedAppTransaction(adminClient, userId, plaidTransactionId, appTxn);
    }

    cursor = String(syncResponse?.next_cursor || cursor || '');
    hasMore = Boolean(syncResponse?.has_more);
  }

  const accountsResponse = await plaidRequest('/accounts/get', { access_token: accessToken });
  const plaidAccounts = Array.isArray(accountsResponse?.accounts) ? accountsResponse.accounts : [];

  for (const account of plaidAccounts) {
    const plaidAccountId = String(account.account_id || '');
    if (!plaidAccountId) continue;

    await adminClient
      .from('financial_accounts')
      .update({
        current_balance: account.balances?.current != null ? Number(account.balances.current) : null,
        available_balance: account.balances?.available != null ? Number(account.balances.available) : null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('plaid_account_id', plaidAccountId);
  }

  const { error: updateError } = await adminClient
    .from('financial_items')
    .update({
      cursor,
      status: 'connected',
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', item.id)
    .eq('user_id', userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return { syncedCount, skippedCount, cursor };
}

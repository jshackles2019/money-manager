import { plaidRequest } from './plaid.ts';
import { decryptAccessToken } from './crypto.ts';

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
    const removed = Array.isArray(syncResponse?.removed) ? syncResponse.removed : [];

    for (const removedTxn of removed) {
      const plaidTransactionId = String(removedTxn.transaction_id || '');
      if (!plaidTransactionId) continue;

      const { data: linkRow } = await adminClient
        .from('financial_transaction_links')
        .select('app_transaction_id')
        .eq('user_id', userId)
        .eq('plaid_transaction_id', plaidTransactionId)
        .maybeSingle();

      if (linkRow?.app_transaction_id) {
        await adminClient.from('transactions').delete().eq('id', linkRow.app_transaction_id);
      }

      await adminClient
        .from('financial_transaction_links')
        .delete()
        .eq('user_id', userId)
        .eq('plaid_transaction_id', plaidTransactionId);

      await adminClient
        .from('financial_transactions')
        .delete()
        .eq('user_id', userId)
        .eq('plaid_transaction_id', plaidTransactionId);
    }

    for (const plaidTxn of added) {
      const plaidTransactionId = String(plaidTxn.transaction_id || '');
      if (!plaidTransactionId) continue;

      const { data: existingLink } = await adminClient
        .from('financial_transaction_links')
        .select('id')
        .eq('user_id', userId)
        .eq('plaid_transaction_id', plaidTransactionId)
        .maybeSingle();

      if (existingLink) {
        skippedCount += 1;
        continue;
      }

      const { data: accountRow } = await adminClient
        .from('financial_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('plaid_account_id', String(plaidTxn.account_id || ''))
        .maybeSingle();

      await adminClient
        .from('financial_transactions')
        .upsert({
          user_id: userId,
          item_id: item.id,
          plaid_transaction_id: plaidTransactionId,
          account_id: accountRow?.id || null,
          amount: Number(plaidTxn.amount || 0),
          date: String(plaidTxn.date || new Date().toISOString().slice(0, 10)),
          name: String(plaidTxn.name || plaidTxn.merchant_name || 'Bank transaction'),
          merchant_name: plaidTxn.merchant_name ? String(plaidTxn.merchant_name) : null,
          category: plaidTxn.category ? plaidTxn.category : null,
          pending: Boolean(plaidTxn.pending),
          raw: plaidTxn,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,plaid_transaction_id' });

      const appTxn = mapPlaidToAppTransaction(plaidTxn);
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

      const { error: linkError } = await adminClient
        .from('financial_transaction_links')
        .insert({
          user_id: userId,
          plaid_transaction_id: plaidTransactionId,
          app_transaction_id: insertedAppTxn.id
        });

      if (linkError) {
        throw new Error(linkError.message);
      }

      syncedCount += 1;
    }

    cursor = String(syncResponse?.next_cursor || cursor || '');
    hasMore = Boolean(syncResponse?.has_more);
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

// ===== MONEY MANAGER WEB APP =====
// Replicates Excel Money Manager functionality

// ===== CONFIGURATION =====
const CONFIG = {
    incomeCategories: ['Salary', 'Freelance', 'Investment', 'Bonus', 'Side Hustle', 'Gifts Received', 'Refunds', 'Other Income'],
    expenseCategories: ['Rent/Mortgage', 'Utilities', 'Groceries', 'Transportation', 'Insurance', 'Subscriptions', 'Entertainment', 'Dining Out', 'Healthcare', 'Debt Payments', 'Credit Card', 'Loans', 'Other Expenses'],
    frequencies: ['Once', 'Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Yearly']
};

const BANK_LINKING = {
    priorityInstitutions: [
        {
            key: 'randolf-broofs-fcu',
            name: 'Randolf Broofs Federal Credit Union',
            aliases: [
                'Randolf Broofs Federal Credit Union',
                'Randolph-Brooks Federal Credit Union',
                'Randolph Brooks Federal Credit Union',
                'RBFCU'
            ]
        },
        {
            key: 'onepay-financial',
            name: 'OnePay Financial',
            aliases: [
                'OnePay Financial',
                'One Pay Financial',
                'OnePay'
            ]
        }
    ]
};

// ===== STATE =====
let state = {
    startDate: '2026-06-17',
    startingBalance: 2316.00,
    transactions: [],
    bankConnections: [],
    bankAccounts: [],
    currentMonth: new Date(2026, 5, 1),
    selectedDate: null
};

let supabaseClient = null;
let authState = {
    session: null,
    user: null,
    profile: null,
    configured: false
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    initSupabase();
    initNavigation();
    initCategories();
    initBankLinking();
    updateCategories();
    setDefaultDate();
    initAuth();
    await refreshSession();
});

function initSupabase() {
    const config = window.MONEY_MANAGER_SUPABASE || {};
    const publicKey = config.publishableKey || config.anonKey;
    authState.configured = Boolean(config.url && publicKey && window.supabase);

    if (!authState.configured) {
        document.getElementById('authIntro').textContent = 'Supabase is not configured yet. Add your project URL and publishable key in js/supabase-config.js.';
        showAuthPage();
        return;
    }

    supabaseClient = window.supabase.createClient(config.url, publicKey);
}

function initAuth() {
    const form = document.getElementById('authForm');
    form.addEventListener('submit', signIn);

    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange((_event, session) => {
        authState.session = session;
        authState.user = session?.user || null;

        if (authState.user) {
            setTimeout(() => {
                finishSignIn().catch(error => {
                    showStatus('authStatus', error.message, 'error');
                });
            }, 0);
        } else {
            authState.profile = null;
            showAuthPage();
        }
    });
}

async function refreshSession() {
    if (!supabaseClient) return;

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        showStatus('authStatus', error.message, 'error');
        showAuthPage();
        return;
    }

    authState.session = data.session;
    authState.user = data.session?.user || null;

    if (!authState.user) {
        showAuthPage();
        return;
    }

    await finishSignIn();
}

async function signIn(event) {
    event.preventDefault();
    if (!supabaseClient) return;

    showStatus('authStatus', 'Signing in...', 'success');
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const { data, error } = await withTimeout(
        supabaseClient.auth.signInWithPassword({ email, password }),
        15000,
        'Sign-in timed out. Check the Supabase URL, publishable key, and your network connection.'
    );

    if (error) {
        showStatus('authStatus', error.message, 'error');
        return;
    }

    authState.session = data.session;
    authState.user = data.user;

    try {
        await finishSignIn();
    } catch (loadError) {
        showStatus('authStatus', loadError.message, 'error');
    }
}

function withTimeout(promise, timeoutMs, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(message)), timeoutMs);
        })
    ]);
}

async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
}

async function loadProfile() {
    let { data, error } = await supabaseClient
        .from('profiles')
        .select('id, email, role')
        .eq('id', authState.user.id)
        .maybeSingle();

    if (error) throw error;

    if (!data) {
        const { data: insertedProfile, error: insertError } = await supabaseClient
            .from('profiles')
            .insert({
                id: authState.user.id,
                email: authState.user.email,
                role: 'viewer'
            })
            .select('id, email, role')
            .single();

        if (insertError) throw insertError;
        data = insertedProfile;
    }

    authState.profile = data;
}

async function finishSignIn() {
    try {
        await loadProfile();
        await loadAppData();
        showApp();

        // If Plaid redirected back after OAuth, resume Link using received_redirect_uri.
        await maybeResumePlaidOauth();
    } catch (error) {
        authState.profile = null;
        showAuthPage();
        showStatus('authStatus', `Signed in, but the app could not load your account: ${error.message}`, 'error');
        throw error;
    }
}

async function loadAppData() {
    loadUiPreferences();

    const [
        { data: settings, error: settingsError },
        { data: transactions, error: transactionsError },
        { data: transactionLinks, error: transactionLinksError }
    ] = await Promise.all([
        supabaseClient.from('settings').select('start_date, starting_balance').eq('id', 1).single(),
        supabaseClient.from('transactions').select('*').order('start_date', { ascending: true }).order('id', { ascending: true }),
        supabaseClient.from('financial_transaction_links').select('app_transaction_id')
    ]);

    if (settingsError) throw settingsError;
    if (transactionsError) throw transactionsError;
    if (transactionLinksError && transactionLinksError.code !== '42P01') throw transactionLinksError;

    const linkedTransactionIds = new Set((transactionLinks || []).map(link => link.app_transaction_id));

    state.startDate = settings.start_date;
    state.startingBalance = Number(settings.starting_balance);
    state.transactions = (transactions || []).map(txn => fromDatabaseTransaction(txn, linkedTransactionIds.has(txn.id)));

    await Promise.all([loadBankConnections(), loadBankAccounts()]);

    document.getElementById('startDate').value = state.startDate;
    document.getElementById('startingBalance').value = state.startingBalance;
    renderAll();
    applyPermissions();
}

function loadUiPreferences() {
    const saved = localStorage.getItem('moneyManagerUi');
    if (!saved) return;

    const data = JSON.parse(saved);
    if (data.currentMonth) state.currentMonth = new Date(data.currentMonth);
    if (data.selectedDate) state.selectedDate = data.selectedDate;
}

function saveUiPreferences() {
    localStorage.setItem('moneyManagerUi', JSON.stringify({
        currentMonth: state.currentMonth.toISOString(),
        selectedDate: state.selectedDate
    }));
}

function fromDatabaseTransaction(txn, isBankLinked = false) {
    return {
        id: txn.id,
        description: txn.description,
        type: txn.type,
        category: txn.category,
        amount: Number(txn.amount),
        startDate: txn.start_date,
        frequency: txn.frequency,
        endDate: txn.end_date,
        isBankLinked
    };
}

function toDatabaseTransaction(txn) {
    return {
        description: txn.description,
        type: txn.type,
        category: txn.category,
        amount: txn.amount,
        start_date: txn.startDate,
        frequency: txn.frequency,
        end_date: txn.endDate || null,
        updated_by: authState.user.id
    };
}

function canEdit() {
    return ['editor', 'admin'].includes(authState.profile?.role);
}

function isAdmin() {
    return authState.profile?.role === 'admin';
}

function requireEditPermission(statusElementId = 'txnStatus') {
    if (canEdit()) return true;
    showStatus(statusElementId, 'You have view-only access. Ask an administrator for editor access to make changes.', 'error');
    return false;
}

function showAuthPage() {
    document.body.classList.remove('is-authenticated');
    document.body.classList.add('is-signed-out');
}

function showApp() {
    document.body.classList.add('is-authenticated');
    document.body.classList.remove('is-signed-out');
    document.getElementById('userSummary').textContent = `${authState.profile.email || authState.user.email} (${authState.profile.role})`;
    applyPermissions();
}

function applyPermissions() {
    document.body.dataset.role = authState.profile?.role || 'viewer';

    document.querySelectorAll('.admin-only').forEach(el => {
        el.hidden = !isAdmin();
    });

    document.querySelectorAll('#transactionForm input, #transactionForm select, #transactionForm button').forEach(el => {
        el.disabled = !canEdit();
    });

    document.querySelectorAll('#startDate, #startingBalance').forEach(el => {
        el.disabled = !canEdit();
    });

    document.querySelectorAll('.bank-link-action').forEach(el => {
        el.disabled = !canEdit();
    });
}

async function renderAdmin() {
    if (!isAdmin()) return;

    await loadBankSupportDiagnostics();
    await loadWebhookEvents();

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, email, role')
        .order('email', { ascending: true });

    if (error) {
        showStatus('adminStatus', error.message, 'error');
        return;
    }

    const tbody = document.querySelector('#userRolesTable tbody');
    tbody.innerHTML = data.map(user => `
        <tr>
            <td>${user.email || user.id}</td>
            <td>
                <select id="role-${user.id}">
                    <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                    <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            </td>
            <td><button class="btn primary" onclick="updateUserRole('${user.id}')">Save</button></td>
        </tr>
    `).join('');
}

async function updateUserRole(userId) {
    if (!isAdmin()) return;

    const role = document.getElementById(`role-${userId}`).value;
    const { error } = await supabaseClient
        .from('profiles')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', userId);

    if (error) {
        showStatus('adminStatus', error.message, 'error');
        return;
    }

    showStatus('adminStatus', 'User role updated.', 'success');
    await renderAdmin();
}

// ===== NAVIGATION =====
function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const pageId = btn.dataset.page;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');
            if (pageId === 'dashboard') renderDashboard();
            if (pageId === 'calendar') renderCalendar();
            if (pageId === 'admin') renderAdmin();
        });
    });
}

// ===== SETUP PAGE =====
function initCategories() {
    const incomeList = document.getElementById('incomeCategories');
    const expenseList = document.getElementById('expenseCategories');
    incomeList.innerHTML = CONFIG.incomeCategories.map(c => `<li>${c}</li>`).join('');
    expenseList.innerHTML = CONFIG.expenseCategories.map(c => `<li>${c}</li>`).join('');
}

async function saveSetup() {
    if (!requireEditPermission('importStatus')) return;

    state.startDate = document.getElementById('startDate').value;
    state.startingBalance = parseFloat(document.getElementById('startingBalance').value) || 0;

    const { error } = await supabaseClient
        .from('settings')
        .update({
            start_date: state.startDate,
            starting_balance: state.startingBalance,
            updated_by: authState.user.id,
            updated_at: new Date().toISOString()
        })
        .eq('id', 1);

    if (error) {
        showStatus('importStatus', error.message, 'error');
        return;
    }

    renderAll();
    showStatus('importStatus', 'Settings saved successfully!', 'success');
}

// ===== BANK LINKING =====
function initBankLinking() {
    renderBankConnections();
}

function getPriorityInstitutionByKey(bankKey) {
    return BANK_LINKING.priorityInstitutions.find(inst => inst.key === bankKey) || null;
}

function normalizeInstitutionName(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findPriorityInstitutionMatch(name) {
    const normalized = normalizeInstitutionName(name);
    if (!normalized) return null;

    return BANK_LINKING.priorityInstitutions.find(inst =>
        inst.aliases.some(alias => normalizeInstitutionName(alias) === normalized)
    ) || null;
}

async function loadBankConnections() {
    if (!supabaseClient || !authState.user) {
        state.bankConnections = [];
        renderBankConnections();
        return;
    }

    const { data, error } = await supabaseClient
        .from('financial_items')
        .select('id, institution_name, status, accounts_count, last_sync_at')
        .order('created_at', { ascending: false });

    if (error) {
        // Relation missing is expected before the migration has been applied.
        if (error.code === '42P01') {
            state.bankConnections = [];
            renderBankConnections();
            return;
        }

        showStatus('bankLinkStatus', error.message, 'error');
        state.bankConnections = [];
        renderBankConnections();
        return;
    }

    state.bankConnections = data || [];
    renderBankConnections();
}

async function loadBankAccounts() {
    if (!supabaseClient || !authState.user) {
        state.bankAccounts = [];
        return;
    }

    const { data, error } = await supabaseClient
        .from('financial_accounts')
        .select('id, name, type, subtype, current_balance, available_balance')
        .order('name', { ascending: true });

    if (error) {
        if (error.code === '42P01') {
            state.bankAccounts = [];
            return;
        }

        showStatus('bankLinkStatus', error.message, 'error');
        state.bankAccounts = [];
        return;
    }

    state.bankAccounts = data || [];
}

function isIncludedBankBalanceAccount(account) {
    const subtype = String(account?.subtype || '').toLowerCase();
    return subtype === 'checking' || subtype === 'savings';
}

function getBankAccountBalance(account) {
    const currentBalance = Number(account?.current_balance);
    if (Number.isFinite(currentBalance)) {
        return currentBalance;
    }

    const availableBalance = Number(account?.available_balance);
    return Number.isFinite(availableBalance) ? availableBalance : 0;
}

function getLinkedCashAccountBalance() {
    return state.bankAccounts
        .filter(isIncludedBankBalanceAccount)
        .reduce((total, account) => total + getBankAccountBalance(account), 0);
}

function isBankLinkedTransaction(txn) {
    return Boolean(txn?.isBankLinked);
}

function hasLinkedCashAccountBalances() {
    return state.bankAccounts.some(isIncludedBankBalanceAccount);
}

function getEffectiveStartingBalance() {
    return hasLinkedCashAccountBalances()
        ? getLinkedCashAccountBalance()
        : state.startingBalance;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function renderBankConnections() {
    const tbody = document.querySelector('#bankConnectionsTable tbody');
    if (!tbody) return;

    if (!state.bankConnections.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-secondary);">No bank connections yet.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = state.bankConnections.map(item => {
        const matched = findPriorityInstitutionMatch(item.institution_name);
        const institutionLabel = matched
            ? `${item.institution_name} (Priority)`
            : (item.institution_name || 'Unknown institution');
        const statusClass = (item.status || '').toLowerCase();
        const statusText = item.status || 'unknown';
        return `
            <tr>
                <td>${institutionLabel}</td>
                <td><span class="connection-status ${statusClass}">${statusText}</span></td>
                <td>${item.accounts_count || 0}</td>
                <td>${item.last_sync_at ? formatDate(item.last_sync_at) : '-'}</td>
            </tr>
        `;
    }).join('');
}

async function invokeEdgeFunction(functionName, payload) {
    const { data, error } = await supabaseClient.functions.invoke(functionName, {
        body: payload
    });

    if (error) {
        let details = '';
        let statusDetails = '';

        // Supabase wraps non-2xx function responses in error.context (a Response object).
        if (error.context) {
            statusDetails = error.context.status
                ? `HTTP ${error.context.status}${error.context.statusText ? ` ${error.context.statusText}` : ''}`
                : '';

            try {
                const cloned = error.context.clone();
                const maybeJson = await cloned.json();

                if (maybeJson && typeof maybeJson === 'object') {
                    const parts = [];

                    if (maybeJson.error) {
                        parts.push(String(maybeJson.error));
                    } else if (maybeJson.message) {
                        parts.push(String(maybeJson.message));
                    }

                    if (maybeJson.stage) {
                        parts.push(`stage=${String(maybeJson.stage)}`);
                    }

                    if (maybeJson.debug) {
                        parts.push(`debug=${JSON.stringify(maybeJson.debug)}`);
                    }

                    details = parts.length ? parts.join(' | ') : JSON.stringify(maybeJson);
                } else {
                    details = String(maybeJson || '');
                }
            } catch (_jsonError) {
                try {
                    details = await error.context.text();
                } catch (_textError) {
                    details = '';
                }
            }
        }

        const baseMessage = error.message || `Failed to call function: ${functionName}`;

        const contextMessage = [statusDetails, details].filter(Boolean).join(' | ');
        throw new Error(contextMessage ? `${baseMessage}. ${contextMessage}` : baseMessage);
    }

    return data || {};
}

async function connectPriorityBank(bankKey) {
    const institution = getPriorityInstitutionByKey(bankKey);
    if (!institution) {
        showStatus('bankLinkStatus', 'Unknown bank target.', 'error');
        return;
    }

    await connectBank(institution);
}

function getPlaidOauthResumeUrl() {
    const url = new URL(window.location.href);
    const hasOauthState = url.searchParams.has('oauth_state_id');
    return hasOauthState ? window.location.href : null;
}

function clearPlaidOauthQueryParams() {
    const url = new URL(window.location.href);
    const keys = ['oauth_state_id', 'error', 'error_code', 'error_message', 'link_session_id'];
    let changed = false;

    keys.forEach((key) => {
        if (url.searchParams.has(key)) {
            url.searchParams.delete(key);
            changed = true;
        }
    });

    if (changed) {
        const next = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, document.title, next);
    }
}

async function maybeResumePlaidOauth() {
    const resumeUrl = getPlaidOauthResumeUrl();
    if (!resumeUrl) return;

    showStatus('bankLinkStatus', 'Resuming bank authentication...', 'success');
    await connectBank(null, {
        receivedRedirectUri: resumeUrl,
        isOauthResume: true
    });
}

function getErrorMessage(error, fallbackMessage = 'Unknown error') {
    if (!error) return fallbackMessage;
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string' && error.message.trim()) return error.message;

    try {
        return JSON.stringify(error);
    } catch (_stringifyError) {
        return fallbackMessage;
    }
}

async function connectBank(preferredInstitution = null, options = {}) {
    if (!requireEditPermission('bankLinkStatus')) return;
    if (!supabaseClient || !authState.user) {
        showStatus('bankLinkStatus', 'Sign in before connecting a bank.', 'error');
        return;
    }

    if (!window.Plaid) {
        showStatus('bankLinkStatus', 'Bank-linking library did not load. Use JSON import for now.', 'error');
        return;
    }

    try {
        const bankName = preferredInstitution?.name;
        const receivedRedirectUri = options.receivedRedirectUri || null;
        const isOauthResume = Boolean(options.isOauthResume);

        if (isOauthResume) {
            showStatus('bankLinkStatus', 'Finalizing bank OAuth authentication...', 'success');
        } else {
            showStatus('bankLinkStatus', bankName ? `Preparing secure link for ${bankName}...` : 'Preparing secure bank link...', 'success');
        }

        const createResponse = await invokeEdgeFunction('create-link-token', {
            preferred_institution_name: bankName || null,
            preferred_institution_aliases: preferredInstitution?.aliases || [],
            priority_institutions: BANK_LINKING.priorityInstitutions,
            received_redirect_uri: receivedRedirectUri
        });

        const linkToken = createResponse.link_token;
        const supportStatus = createResponse.support_status || 'unknown';
        if (!linkToken) {
            openManualImportFallback(bankName, supportStatus);
            return;
        }

        if (supportStatus === 'unsupported') {
            showStatus('bankLinkStatus', `${bankName || 'This institution'} may not be directly supported. You can still search in Plaid Link or use JSON import.`, 'error');
        }

        const handler = window.Plaid.create({
            token: linkToken,
            onSuccess: async (publicToken, metadata) => {
                clearPlaidOauthQueryParams();
                await exchangePublicToken(publicToken, metadata, preferredInstitution);
            },
            onExit: (_err, metadata) => {
                clearPlaidOauthQueryParams();

                if (metadata?.status === 'institution_not_found') {
                    openManualImportFallback(bankName, 'unsupported');
                    return;
                }

                showStatus('bankLinkStatus', 'Bank linking was canceled.', 'error');
            }
        });

        if (isOauthResume) {
            clearPlaidOauthQueryParams();
        }

        handler.open();
    } catch (error) {
        openManualImportFallback(preferredInstitution?.name, 'unknown', getErrorMessage(error));
    }
}

async function syncBankTransactions() {
    if (!requireEditPermission('bankLinkStatus')) return;
    if (!supabaseClient || !authState.user) {
        showStatus('bankLinkStatus', 'Sign in before syncing bank data.', 'error');
        return;
    }

    try {
        showStatus('bankLinkStatus', 'Running bank transaction sync...', 'success');
        const response = await invokeEdgeFunction('sync-transactions', {});
        const syncedCount = response.synced_count || 0;
        const skippedCount = response.skipped_count || 0;
        showStatus('bankLinkStatus', `Sync complete. Added ${syncedCount} new transaction(s), skipped ${skippedCount} existing item(s).`, 'success');
        await loadBankConnections();
        await loadAppData();
    } catch (error) {
        showStatus('bankLinkStatus', getErrorMessage(error, 'Bank sync failed.'), 'error');
    }
}

async function loadBankSupportDiagnostics() {
    if (!isAdmin()) return;

    const tbody = document.querySelector('#bankSupportTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">Checking support...</td></tr>';

    try {
        const response = await invokeEdgeFunction('check-bank-support', {
            institutions: BANK_LINKING.priorityInstitutions.map(inst => ({
                name: inst.name,
                aliases: inst.aliases
            }))
        });

        const rows = response.results || [];
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">No diagnostic data available.</td></tr>';
            showStatus('bankSupportStatus', 'No support data returned.', 'error');
            return;
        }

        tbody.innerHTML = rows.map((row) => `
            <tr>
                <td>${row.name}</td>
                <td><span class="connection-status ${row.supported ? 'connected' : 'error'}">${row.supported ? 'supported' : 'unsupported'}</span></td>
                <td>${row.matched_name || '-'}</td>
                <td>${row.institution_id || '-'}</td>
            </tr>
        `).join('');

        showStatus('bankSupportStatus', 'Diagnostics updated.', 'success');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center">Diagnostics failed.</td></tr>';
        showStatus('bankSupportStatus', getErrorMessage(error, 'Diagnostics failed.'), 'error');
    }
}

async function loadWebhookEvents() {
    if (!isAdmin()) return;

    const tbody = document.querySelector('#webhookEventsTable tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Loading webhook events...</td></tr>';

    try {
        const response = await invokeEdgeFunction('get-webhook-events', {});
        const events = response.events || [];

        if (!events.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No webhook events found.</td></tr>';
            showStatus('webhookEventsStatus', 'No webhook events found.', 'success');
            return;
        }

        tbody.innerHTML = events.map((event) => `
            <tr>
                <td>${formatDate(event.created_at)}</td>
                <td>${event.webhook_type || '-'}</td>
                <td>${event.webhook_code || '-'}</td>
                <td><span class="connection-status ${event.status === 'processed' ? 'connected' : (event.status === 'received' ? 'pending' : 'error')}">${event.status || 'unknown'}</span></td>
                <td>${event.plaid_item_id || '-'}</td>
                <td>${event.error_message || '-'}</td>
            </tr>
        `).join('');

        showStatus('webhookEventsStatus', 'Webhook events updated.', 'success');
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Failed to load webhook events.</td></tr>';
        showStatus('webhookEventsStatus', getErrorMessage(error, 'Failed to load webhook events.'), 'error');
    }
}

async function exchangePublicToken(publicToken, metadata, preferredInstitution) {
    const institutionName = metadata?.institution?.name || preferredInstitution?.name || null;

    showStatus('bankLinkStatus', `Linking ${institutionName || 'bank account'}...`, 'success');

    try {
        const response = await invokeEdgeFunction('exchange-public-token', {
            public_token: publicToken,
            institution_name: institutionName,
            institution_id: metadata?.institution?.institution_id || null,
            accounts: metadata?.accounts || []
        });

        const linkedName = response.institution_name || institutionName || 'bank account';
        showStatus('bankLinkStatus', `Connected ${linkedName}. Initial sync started.`, 'success');
        await loadBankConnections();
        await loadBankAccounts();
        renderAll();
    } catch (error) {
        openManualImportFallback(institutionName, 'unknown', getErrorMessage(error));
    }
}

function openManualImportFallback(institutionName, supportStatus = 'unknown', reason = '') {
    const supportDetail = supportStatus === 'unsupported'
        ? 'This institution was reported as unsupported by the current provider.'
        : 'Automatic linking is temporarily unavailable.';

    const reasonText = reason ? ` Details: ${reason}` : '';
    const nameText = institutionName ? `${institutionName}: ` : '';
    showStatus(
        'bankLinkStatus',
        `${nameText}${supportDetail} You can continue using JSON import below.${reasonText}`,
        'error'
    );

    const importSectionButton = document.getElementById('importFile');
    if (importSectionButton) {
        importSectionButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ===== QUICK ENTRY PAGE =====
function updateCategories() {
    const type = document.getElementById('txnType').value;
    const categorySelect = document.getElementById('txnCategory');
    const categories = type === 'Income' ? CONFIG.incomeCategories : CONFIG.expenseCategories;
    categorySelect.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
}

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('txnStartDate').value = today;
}

async function addTransaction(event) {
    event.preventDefault();
    if (!requireEditPermission('txnStatus')) return;

    const transaction = {
        description: document.getElementById('txnDescription').value,
        type: document.getElementById('txnType').value,
        category: document.getElementById('txnCategory').value,
        amount: parseFloat(document.getElementById('txnAmount').value),
        startDate: document.getElementById('txnStartDate').value,
        frequency: document.getElementById('txnFrequency').value,
        endDate: document.getElementById('txnEndDate').value || null
    };

    const { data, error } = await supabaseClient
        .from('transactions')
        .insert({ ...toDatabaseTransaction(transaction), created_by: authState.user.id })
        .select()
        .single();

    if (error) {
        showStatus('txnStatus', error.message, 'error');
        return;
    }

    state.transactions.push(fromDatabaseTransaction(data));
    document.getElementById('transactionForm').reset();
    updateCategories();
    setDefaultDate();
    showStatus('txnStatus', `Transaction '${transaction.description}' added successfully!`, 'success');
    renderAll();
}

async function deleteTransaction(id) {
    if (!requireEditPermission('txnStatus')) return;

    const txn = state.transactions.find(t => t.id === id);
    if (confirm(`Delete transaction "${txn.description}"?`)) {
        const { error } = await supabaseClient.from('transactions').delete().eq('id', id);
        if (error) {
            showStatus('txnStatus', error.message, 'error');
            return;
        }

        state.transactions = state.transactions.filter(t => t.id !== id);
        renderAll();
    }
}

function renderRecentTransactions() {
    const tbody = document.querySelector('#recentTransactions tbody');
    const recent = [...state.transactions].reverse().slice(0, 10);
    tbody.innerHTML = recent.map(t => `
        <tr>
            <td>${t.description}</td>
            <td>${t.type}</td>
            <td>${t.category}</td>
            <td class="${t.type === 'Income' ? 'income' : 'expense'}">${formatCurrency(t.amount)}</td>
            <td>${formatDate(t.startDate)}</td>
            <td>${canEdit() ? `<button class="btn danger" onclick="deleteTransaction(${t.id})">Delete</button>` : '-'}</td>
        </tr>
    `).join('');
}

// ===== CALENDAR PAGE =====
function changeMonth(delta) {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + delta);
    saveUiPreferences();
    renderCalendar();
}

function renderCalendar() {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const dailyBalances = calculateDailyBalances(year, month);
    const grid = document.getElementById('calendarGrid');
    
    let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="day-header">${d}</div>`).join('');
    
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="day-cell empty"></div>';
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const balance = dailyBalances[day] ?? getEffectiveStartingBalance();
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = state.selectedDate && date.toDateString() === new Date(state.selectedDate).toDateString();
        
        let classes = ['day-cell'];
        if (isSelected) classes.push('selected');
        else if (isToday) classes.push('today');
        else classes.push(balance >= 0 ? 'positive' : 'negative');
        
        html += `
            <div class="${classes.join(' ')}" onclick="selectDate(${year}, ${month}, ${day})">
                <div class="day-number">${day}</div>
                <div class="day-balance">${formatCurrency(balance)}</div>
            </div>
        `;
    }
    
    grid.innerHTML = html;
    
    const monthSummary = calculateMonthSummary(year, month);
    document.getElementById('monthIncome').textContent = formatCurrency(monthSummary.income);
    document.getElementById('monthExpenses').textContent = formatCurrency(monthSummary.expenses);
    document.getElementById('monthNetFlow').textContent = formatCurrency(monthSummary.netFlow);
    document.getElementById('monthNetFlow').className = monthSummary.netFlow >= 0 ? 'income' : 'expense';
    document.getElementById('monthStartBalance').textContent = formatCurrency(monthSummary.startBalance);
    document.getElementById('monthEndBalance').textContent = formatCurrency(monthSummary.endBalance);
}

function selectDate(year, month, day) {
    state.selectedDate = new Date(year, month, day).toISOString();
    saveUiPreferences();
    renderCalendar();
    renderSelectedDateTransactions();
}

function renderSelectedDateTransactions() {
    if (!state.selectedDate) return;
    const date = new Date(state.selectedDate);
    const dateStr = date.toISOString().split('T')[0];
    const transactions = getTransactionsForDate(date);
    const balance = calculateBalanceUpToDate(date);
    
    document.getElementById('selectedDateDisplay').textContent = formatDate(dateStr);
    document.getElementById('selectedDateBalance').textContent = formatCurrency(balance);
    document.getElementById('selectedDateBalance').className = balance >= 0 ? 'income' : 'expense';
    
    const tbody = document.querySelector('#selectedDateTransactions tbody');
    if (transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">No transactions on this date</td></tr>';
    } else {
        tbody.innerHTML = transactions.map(t => {
            const impact = t.type === 'Income' ? t.amount : -t.amount;
            return `
                <tr>
                    <td>${t.description}</td>
                    <td>${t.type}</td>
                    <td>${t.category}</td>
                    <td>${formatCurrency(t.amount)}</td>
                    <td class="${impact >= 0 ? 'income' : 'expense'}">${formatCurrency(impact)}</td>
                </tr>
            `;
        }).join('');
    }
}

// ===== DASHBOARD PAGE =====
let charts = {};

function renderDashboard() {
    const summary = calculateAnnualSummary();
    
    document.getElementById('dashStartBalance').textContent = formatCurrency(getEffectiveStartingBalance());
    document.getElementById('dashTotalIncome').textContent = formatCurrency(summary.totalIncome);
    document.getElementById('dashTotalExpenses').textContent = formatCurrency(summary.totalExpenses);
    document.getElementById('dashNetFlow').textContent = formatCurrency(summary.netFlow);
    document.getElementById('dashNetFlow').className = summary.netFlow >= 0 ? 'income' : 'expense';
    document.getElementById('dashEndBalance').textContent = formatCurrency(summary.endBalance);
    document.getElementById('dashAvgSavings').textContent = formatCurrency(summary.avgSavings);
    document.getElementById('dashAvgSavings').className = summary.avgSavings >= 0 ? 'income' : 'expense';
    
    Object.values(charts).forEach(c => c.destroy());
    
    charts.cashFlow = new Chart(document.getElementById('cashFlowChart'), {
        type: 'bar',
        data: {
            labels: summary.months.map(m => m.name),
            datasets: [
                { label: 'Income', data: summary.months.map(m => m.income), backgroundColor: '#22c55e' },
                { label: 'Expenses', data: summary.months.map(m => m.expenses), backgroundColor: '#ef4444' }
            ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
    
    charts.income = new Chart(document.getElementById('incomeChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(summary.incomeByCategory),
            datasets: [{ data: Object.values(summary.incomeByCategory), backgroundColor: ['#22c55e', '#86efac', '#4ade80', '#16a34a'] }]
        },
        options: { responsive: true }
    });
    
    charts.expense = new Chart(document.getElementById('expenseChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(summary.expensesByCategory),
            datasets: [{ data: Object.values(summary.expensesByCategory), backgroundColor: ['#ef4444', '#f87171', '#fca5a5', '#dc2626', '#b91c1c', '#fee2e2', '#fecaca', '#f97316', '#fb923c'] }]
        },
        options: { responsive: true }
    });
    
    charts.balance = new Chart(document.getElementById('balanceChart'), {
        type: 'line',
        data: {
            labels: summary.months.map(m => m.name),
            datasets: [{ label: 'Balance', data: summary.months.map(m => m.endBalance), borderColor: '#2563eb', fill: true, backgroundColor: 'rgba(37, 99, 235, 0.1)' }]
        },
        options: { responsive: true, scales: { y: { beginAtZero: false } } }
    });
}

// ===== TRANSACTIONS PAGE =====
function filterTransactions() {
    const search = document.getElementById('searchTransactions').value.toLowerCase();
    const typeFilter = document.getElementById('filterType').value;
    const categoryFilter = document.getElementById('filterCategory').value;
    
    const filtered = state.transactions.filter(t => {
        const matchesSearch = t.description.toLowerCase().includes(search);
        const matchesType = !typeFilter || t.type === typeFilter;
        const matchesCategory = !categoryFilter || t.category === categoryFilter;
        return matchesSearch && matchesType && matchesCategory;
    });
    renderTransactionTable(filtered);
}

function renderAllTransactions() {
    const allCategories = [...new Set(state.transactions.map(t => t.category))];
    document.getElementById('filterCategory').innerHTML = 
        '<option value="">All Categories</option>' + 
        allCategories.map(c => `<option value="${c}">${c}</option>`).join('');
    renderTransactionTable(state.transactions);
}

function renderTransactionTable(transactions) {
    const tbody = document.querySelector('#allTransactions tbody');
    tbody.innerHTML = transactions.map(t => `
        <tr>
            <td>${t.description}</td>
            <td>${t.type}</td>
            <td>${t.category}</td>
            <td class="${t.type === 'Income' ? 'income' : 'expense'}">${formatCurrency(t.amount)}</td>
            <td>${formatDate(t.startDate)}</td>
            <td>${t.frequency}</td>
            <td>${t.endDate ? formatDate(t.endDate) : '-'}</td>
            <td>${canEdit() ? `<button class="btn danger" onclick="deleteTransaction(${t.id})">Delete</button>` : '-'}</td>
        </tr>
    `).join('');
}

// ===== CALCULATION HELPERS =====
function getTransactionsForDate(targetDate) {
    const result = [];
    const targetYear = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();
    const targetDay = targetDate.getDate();
    
    state.transactions.forEach(txn => {
        const occurrences = getOccurrences(txn, 
            new Date(targetYear, targetMonth, targetDay, 0, 0, 0),
            new Date(targetYear, targetMonth, targetDay, 23, 59, 59)
        );
        if (occurrences.length > 0) result.push(txn);
    });
    return result;
}

function getOccurrences(txn, startRange, endRange) {
    const occurrences = [];
    
    // Parse the transaction start date (handle both "YYYY-MM-DD" and Date objects)
    let txnStart;
    if (typeof txn.startDate === 'string') {
        const parts = txn.startDate.split('-');
        txnStart = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    } else {
        txnStart = new Date(txn.startDate);
    }
    
    // Parse end date if exists
    let txnEnd;
    if (txn.endDate) {
        if (typeof txn.endDate === 'string') {
            const parts = txn.endDate.split('-');
            txnEnd = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        } else {
            txnEnd = new Date(txn.endDate);
        }
    } else {
        txnEnd = new Date(endRange.getFullYear() + 1, 11, 31);
    }
    
    if (txn.frequency === 'Once') {
        // For one-time transactions, check if the date falls within range
        if (txnStart >= new Date(startRange.getFullYear(), startRange.getMonth(), startRange.getDate()) && 
            txnStart <= new Date(endRange.getFullYear(), endRange.getMonth(), endRange.getDate())) {
            occurrences.push(new Date(txnStart));
        }
    } else {
        // For recurring transactions
        let current = new Date(txnStart);
        const endCheck = new Date(endRange.getFullYear(), endRange.getMonth(), endRange.getDate());
        const startCheck = new Date(startRange.getFullYear(), startRange.getMonth(), startRange.getDate());
        
        while (current <= endCheck && current <= txnEnd) {
            if (current >= startCheck) {
                occurrences.push(new Date(current));
            }
            current = getNextDate(current, txn.frequency);
        }
    }
    return occurrences;
}

function getNextDate(date, frequency) {
    const next = new Date(date);
    switch (frequency) {
        case 'Weekly': next.setDate(next.getDate() + 7); break;
        case 'Bi-Weekly': next.setDate(next.getDate() + 14); break;
        case 'Monthly': next.setMonth(next.getMonth() + 1); break;
        case 'Quarterly': next.setMonth(next.getMonth() + 3); break;
        case 'Yearly': next.setFullYear(next.getFullYear() + 1); break;
    }
    return next;
}

function calculateBalanceUpToDate(targetDate) {
    const normalizedTargetDate = startOfDay(targetDate);
    const today = startOfDay(new Date());
    const historicalStartDate = startOfDay(new Date(state.startDate));

    const useLiveLinkedAnchor = hasLinkedCashAccountBalances() && normalizedTargetDate >= today;
    let balance = useLiveLinkedAnchor ? getLinkedCashAccountBalance() : state.startingBalance;

    state.transactions.forEach(txn => {
        let occurrenceStart = historicalStartDate;

        if (useLiveLinkedAnchor) {
            occurrenceStart = isBankLinkedTransaction(txn)
                ? addDays(today, 1)
                : today;
        }

        const occurrences = getOccurrences(txn, occurrenceStart, normalizedTargetDate);
        occurrences.forEach(() => {
            if (txn.type === 'Income') balance += txn.amount;
            else balance -= txn.amount;
        });
    });
    return balance;
}

function calculateDailyBalances(year, month) {
    const balances = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        balances[day] = calculateBalanceUpToDate(date);
    }
    return balances;
}

function calculateMonthSummary(year, month) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevDay = new Date(firstDay); prevDay.setDate(prevDay.getDate() - 1);
    const today = startOfDay(new Date());
    const isCurrentMonth = today >= startOfDay(firstDay) && today <= startOfDay(lastDay);
    
    let income = 0, expenses = 0;
    state.transactions.forEach(txn => {
        let rangeStart = firstDay;

        if (hasLinkedCashAccountBalances() && isCurrentMonth) {
            rangeStart = isBankLinkedTransaction(txn)
                ? addDays(today, 1)
                : today;
        }

        const occurrences = getOccurrences(txn, rangeStart, lastDay);
        occurrences.forEach(() => {
            if (txn.type === 'Income') income += txn.amount;
            else expenses += txn.amount;
        });
    });
    
    const startBalance = hasLinkedCashAccountBalances() && isCurrentMonth
        ? calculateBalanceUpToDate(today)
        : calculateBalanceUpToDate(prevDay);
    const endBalance = calculateBalanceUpToDate(lastDay);
    return { income, expenses, netFlow: income - expenses, startBalance, endBalance };
}

function calculateAnnualSummary() {
    const today = startOfDay(new Date());
    const startDate = hasLinkedCashAccountBalances()
        ? new Date(today.getFullYear(), today.getMonth(), 1)
        : new Date(state.startDate);
    const months = [];
    let totalIncome = 0, totalExpenses = 0;
    const incomeByCategory = {}, expensesByCategory = {};
    let startingBalance = hasLinkedCashAccountBalances()
        ? getLinkedCashAccountBalance()
        : state.startingBalance;
    
    for (let i = 0; i < 12; i++) {
        const date = new Date(startDate);
        date.setMonth(date.getMonth() + i);
        const year = date.getFullYear();
        const month = date.getMonth();
        const summary = calculateMonthSummary(year, month);
        
        months.push({
            name: new Date(year, month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            ...summary,
            endBalance: summary.endBalance
        });
        
        totalIncome += summary.income;
        totalExpenses += summary.expenses;
    }

    state.transactions.forEach(txn => {
        let categoryProjectionStart = new Date(state.startDate);

        if (hasLinkedCashAccountBalances()) {
            categoryProjectionStart = isBankLinkedTransaction(txn)
                ? addDays(today, 1)
                : today;
        }

        const occurrences = getOccurrences(txn, categoryProjectionStart, new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate()));
        const total = occurrences.length * txn.amount;
        if (txn.type === 'Income') {
            incomeByCategory[txn.category] = (incomeByCategory[txn.category] || 0) + total;
        } else {
            expensesByCategory[txn.category] = (expensesByCategory[txn.category] || 0) + total;
        }
    });
    
    return {
        totalIncome, totalExpenses,
        netFlow: totalIncome - totalExpenses,
        endBalance: months.length ? months[months.length - 1].endBalance : startingBalance,
        avgSavings: (totalIncome - totalExpenses) / 12,
        months, incomeByCategory, expensesByCategory
    };
}

// ===== UTILITY FUNCTIONS =====
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.className = `status ${type}`;
        setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 5000);
    }
}

function renderAll() {
    renderRecentTransactions();
    renderCalendar();
    renderAllTransactions();
    if (document.getElementById('dashboard').classList.contains('active')) {
        renderDashboard();
    }
}

// ===== IMPORT / EXPORT FUNCTIONS =====

function exportToJSON() {
    const exportData = {
        startDate: state.startDate,
        startingBalance: state.startingBalance,
        transactions: state.transactions,
        exportedAt: new Date().toISOString(),
        source: 'Money Manager Web App'
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `money-manager-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showStatus('importStatus', '✅ Data exported successfully!', 'success');
}

function importFromJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            // Validate the data structure
            if (!data.transactions || !Array.isArray(data.transactions)) {
                throw new Error('Invalid file format: missing transactions array');
            }
            
            // Show confirmation modal with preview
            showImportConfirmation(data);
            
        } catch (error) {
            showStatus('importStatus', `❌ Error reading file: ${error.message}`, 'error');
        }
    };
    reader.readAsText(file);
    
    // Reset file input so same file can be selected again
    event.target.value = '';
}

function showImportConfirmation(data) {
    // Count transaction types
    const incomeCount = data.transactions.filter(t => t.type === 'Income').length;
    const expenseCount = data.transactions.filter(t => t.type === 'Expense').length;
    
    // Get unique categories
    const categories = [...new Set(data.transactions.map(t => t.category))];
    
    // Calculate totals
    let totalIncome = 0, totalExpenses = 0;
    data.transactions.forEach(t => {
        if (t.type === 'Income') totalIncome += t.amount;
        else totalExpenses += t.amount;
    });
    
    // Store data for later use
    window.pendingImportData = data;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal">
            <h2>📥 Import Data</h2>
            <p>You're about to import the following data:</p>
            
            <div class="import-preview">
                <div class="stat-row">
                    <span>Starting Balance:</span>
                    <strong>${formatCurrency(data.startingBalance || 0)}</strong>
                </div>
                <div class="stat-row">
                    <span>Start Date:</span>
                    <strong>${data.startDate || 'Not specified'}</strong>
                </div>
                <div class="stat-row">
                    <span>Total Transactions:</span>
                    <strong>${data.transactions.length}</strong>
                </div>
                <div class="stat-row">
                    <span>Income Entries:</span>
                    <strong style="color: var(--success);">${incomeCount} (${formatCurrency(totalIncome)})</strong>
                </div>
                <div class="stat-row">
                    <span>Expense Entries:</span>
                    <strong style="color: var(--danger);">${expenseCount} (${formatCurrency(totalExpenses)})</strong>
                </div>
                <div class="stat-row">
                    <span>Categories:</span>
                    <strong>${categories.length}</strong>
                </div>
            </div>
            
            <p style="color: var(--danger); margin-top: 12px;">
                ⚠️ <strong>Warning:</strong> This will replace ALL your current data!
            </p>
            
            <div class="modal-actions">
                <button class="btn" onclick="closeModal()">Cancel</button>
                <button class="btn primary" onclick="confirmImport()">
                    ✅ Import Data
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

async function confirmImport() {
    if (!requireEditPermission('importStatus')) {
        closeModal();
        return;
    }

    const data = window.pendingImportData;
    if (!data) {
        closeModal();
        return;
    }

    const importedTransactions = data.transactions.map(t => ({
        description: t.description,
        type: t.type,
        category: t.category,
        amount: Number(t.amount),
        startDate: t.startDate,
        frequency: t.frequency,
        endDate: t.endDate || null
    }));

    const { error: deleteError } = await supabaseClient.from('transactions').delete().neq('id', 0);
    if (deleteError) {
        showStatus('importStatus', deleteError.message, 'error');
        return;
    }

    const { error: settingsError } = await supabaseClient
        .from('settings')
        .update({
            start_date: data.startDate || state.startDate,
            starting_balance: data.startingBalance || state.startingBalance,
            updated_by: authState.user.id,
            updated_at: new Date().toISOString()
        })
        .eq('id', 1);

    if (settingsError) {
        showStatus('importStatus', settingsError.message, 'error');
        return;
    }

    if (importedTransactions.length > 0) {
        const rows = importedTransactions.map(t => ({
            ...toDatabaseTransaction(t),
            created_by: authState.user.id
        }));
        const { error: insertError } = await supabaseClient.from('transactions').insert(rows);
        if (insertError) {
            showStatus('importStatus', insertError.message, 'error');
            return;
        }
    }

    state.startDate = data.startDate || state.startDate;
    state.startingBalance = data.startingBalance || state.startingBalance;

    // Update the setup form
    document.getElementById('startDate').value = state.startDate;
    document.getElementById('startingBalance').value = state.startingBalance;
    
    await loadAppData();
    
    // Clean up
    delete window.pendingImportData;
    closeModal();
    showStatus('importStatus', `✅ Successfully imported ${state.transactions.length} transactions!`, 'success');
}

function closeModal() {
    const modal = document.querySelector('.modal-overlay');
    if (modal) {
        modal.remove();
    }
    delete window.pendingImportData;
}

// ===== CLEAR DATA FUNCTION =====
async function clearAllData() {
    if (!requireEditPermission('importStatus')) return;
    if (confirm('⚠️ Are you sure you want to delete ALL transactions? This cannot be undone!')) {
        if (confirm('🔴 FINAL WARNING: Click OK to permanently delete all data.')) {
            const newStartDate = new Date().toISOString().split('T')[0];
            const { error: deleteError } = await supabaseClient.from('transactions').delete().neq('id', 0);
            if (deleteError) {
                showStatus('importStatus', deleteError.message, 'error');
                return;
            }

            const { error: settingsError } = await supabaseClient
                .from('settings')
                .update({
                    start_date: newStartDate,
                    starting_balance: 0,
                    updated_by: authState.user.id,
                    updated_at: new Date().toISOString()
                })
                .eq('id', 1);

            if (settingsError) {
                showStatus('importStatus', settingsError.message, 'error');
                return;
            }

            state.transactions = [];
            state.startDate = newStartDate;
            state.startingBalance = 0;
            document.getElementById('startDate').value = state.startDate;
            document.getElementById('startingBalance').value = state.startingBalance;
            renderAll();
            showStatus('importStatus', '🗑️ All data cleared.', 'success');
        }
    }
}

// ===== SAMPLE DATA (loads if no data exists) =====
if (state.transactions.length === 0) {
    // Start with empty transactions - user will import from Excel
    console.log('No transactions found. Use Import to load data from Excel.');
}

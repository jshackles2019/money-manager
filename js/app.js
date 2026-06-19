// ===== MONEY MANAGER WEB APP =====
// Replicates Excel Money Manager functionality

// ===== CONFIGURATION =====
const CONFIG = {
    incomeCategories: ['Salary', 'Freelance', 'Investment', 'Bonus', 'Side Hustle', 'Gifts Received', 'Refunds', 'Other Income'],
    expenseCategories: ['Rent/Mortgage', 'Utilities', 'Groceries', 'Transportation', 'Insurance', 'Subscriptions', 'Entertainment', 'Dining Out', 'Healthcare', 'Debt Payments', 'Credit Card', 'Loans', 'Other Expenses'],
    frequencies: ['Once', 'Weekly', 'Bi-Weekly', 'Monthly', 'Quarterly', 'Yearly']
};

// ===== STATE =====
let state = {
    startDate: '2026-06-17',
    startingBalance: 2316.00,
    transactions: [],
    currentMonth: new Date(2026, 5, 1),
    selectedDate: null
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    initNavigation();
    initCategories();
    updateCategories();
    setDefaultDate();
    renderAll();
});

function loadFromStorage() {
    const saved = localStorage.getItem('moneyManager');
    if (saved) {
        const data = JSON.parse(saved);
        state = { ...state, ...data };
        state.currentMonth = new Date(state.currentMonth);
    }
    document.getElementById('startDate').value = state.startDate;
    document.getElementById('startingBalance').value = state.startingBalance;
}

function saveToStorage() {
    localStorage.setItem('moneyManager', JSON.stringify({
        startDate: state.startDate,
        startingBalance: state.startingBalance,
        transactions: state.transactions,
        currentMonth: state.currentMonth.toISOString()
    }));
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

function saveSetup() {
    state.startDate = document.getElementById('startDate').value;
    state.startingBalance = parseFloat(document.getElementById('startingBalance').value) || 0;
    saveToStorage();
    renderAll();
    showStatus('importStatus', 'Settings saved successfully!', 'success');
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

function addTransaction(event) {
    event.preventDefault();
    const transaction = {
        id: Date.now(),
        description: document.getElementById('txnDescription').value,
        type: document.getElementById('txnType').value,
        category: document.getElementById('txnCategory').value,
        amount: parseFloat(document.getElementById('txnAmount').value),
        startDate: document.getElementById('txnStartDate').value,
        frequency: document.getElementById('txnFrequency').value,
        endDate: document.getElementById('txnEndDate').value || null
    };
    state.transactions.push(transaction);
    saveToStorage();
    document.getElementById('transactionForm').reset();
    updateCategories();
    setDefaultDate();
    showStatus('txnStatus', `Transaction '${transaction.description}' added successfully!`, 'success');
    renderAll();
}

function deleteTransaction(id) {
    const txn = state.transactions.find(t => t.id === id);
    if (confirm(`Delete transaction "${txn.description}"?`)) {
        state.transactions = state.transactions.filter(t => t.id !== id);
        saveToStorage();
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
            <td><button class="btn danger" onclick="deleteTransaction(${t.id})">🗑️</button></td>
        </tr>
    `).join('');
}

// ===== CALENDAR PAGE =====
function changeMonth(delta) {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + delta);
    saveToStorage();
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
        const balance = dailyBalances[day] || state.startingBalance;
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
    saveToStorage();
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
    
    document.getElementById('dashStartBalance').textContent = formatCurrency(state.startingBalance);
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
            <td><button class="btn danger" onclick="deleteTransaction(${t.id})">🗑️</button></td>
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
    const start = new Date(state.startDate);
    let balance = state.startingBalance;
    state.transactions.forEach(txn => {
        const occurrences = getOccurrences(txn, start, targetDate);
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
    
    let income = 0, expenses = 0;
    state.transactions.forEach(txn => {
        const occurrences = getOccurrences(txn, firstDay, lastDay);
        occurrences.forEach(() => {
            if (txn.type === 'Income') income += txn.amount;
            else expenses += txn.amount;
        });
    });
    
    const startBalance = calculateBalanceUpToDate(prevDay);
    const endBalance = startBalance + income - expenses;
    return { income, expenses, netFlow: income - expenses, startBalance, endBalance };
}

function calculateAnnualSummary() {
    const startDate = new Date(state.startDate);
    const months = [];
    let totalIncome = 0, totalExpenses = 0;
    const incomeByCategory = {}, expensesByCategory = {};
    let runningBalance = state.startingBalance;
    
    for (let i = 0; i < 12; i++) {
        const date = new Date(startDate);
        date.setMonth(date.getMonth() + i);
        const year = date.getFullYear();
        const month = date.getMonth();
        const summary = calculateMonthSummary(year, month);
        runningBalance += summary.netFlow;
        
        months.push({
            name: new Date(year, month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            ...summary,
            endBalance: runningBalance
        });
        
        totalIncome += summary.income;
        totalExpenses += summary.expenses;
    }
    
    state.transactions.forEach(txn => {
        const occurrences = getOccurrences(txn, new Date(state.startDate), new Date(startDate.getFullYear() + 1, startDate.getMonth(), startDate.getDate()));
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
        endBalance: state.startingBalance + totalIncome - totalExpenses,
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

function confirmImport() {
    const data = window.pendingImportData;
    if (!data) {
        closeModal();
        return;
    }
    
    // Update state with imported data
    state.startDate = data.startDate || state.startDate;
    state.startingBalance = data.startingBalance || state.startingBalance;
    state.transactions = data.transactions;
    
    // Ensure all transactions have IDs
    state.transactions.forEach((t, index) => {
        if (!t.id) t.id = Date.now() + index;
    });
    
    // Update the setup form
    document.getElementById('startDate').value = state.startDate;
    document.getElementById('startingBalance').value = state.startingBalance;
    
    // Save and refresh
    saveToStorage();
    renderAll();
    
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
function clearAllData() {
    if (confirm('⚠️ Are you sure you want to delete ALL transactions? This cannot be undone!')) {
        if (confirm('🔴 FINAL WARNING: Click OK to permanently delete all data.')) {
            state.transactions = [];
            state.startDate = new Date().toISOString().split('T')[0];
            state.startingBalance = 0;
            document.getElementById('startDate').value = state.startDate;
            document.getElementById('startingBalance').value = state.startingBalance;
            saveToStorage();
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

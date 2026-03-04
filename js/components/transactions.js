/**
 * Portfolio Tracker - 交易管理組件 (輕量化版)
 * 所有資料讀寫只走 IndexedDB，不依賴 Google Sheets
 */

const Transactions = {
    pendingCSVData: null,

    /**
     * 渲染交易紀錄表
     */
    renderTransactionsTable(transactions) {
        const tbody = document.getElementById('transactions-tbody');
        if (!tbody) return;

        const settings = CacheService.settings.get();

        // 過濾只顯示主要交易類型
        const displayTx = transactions.filter(tx =>
            ['BUY', 'SELL', 'DIVIDEND', 'SPLIT'].includes(tx.action)
        );

        if (displayTx.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center" style="padding: 2rem; color: var(--text-muted);">
                        尚無交易紀錄。請透過「匯入資料」新增交易。
                    </td>
                </tr>
            `;
            return;
        }

        // 按日期排序 (最新在前)
        const sorted = [...displayTx].sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = sorted.map(tx => {
            let actionClass = 'action-dividend';
            if (tx.action === 'BUY') actionClass = 'action-buy';
            else if (tx.action === 'SELL') actionClass = 'action-sell';
            else if (tx.action === 'SPLIT') actionClass = 'action-dividend';

            const actionText = CONFIG.TRANSACTION_TYPES[tx.action] || tx.action;

            let totalAmount = 0;
            if (tx.amount) {
                totalAmount = Math.abs(tx.amount);
            } else if (tx.action === 'SPLIT') {
                totalAmount = 0;
            } else if (tx.quantity && tx.price) {
                totalAmount = (tx.quantity * tx.price) + (tx.fees || 0);
            }

            const quantityDisplay = (tx.action === 'DIVIDEND') ? '--' :
                Finance.formatNumber(tx.quantity, 4);

            const priceDisplay = (tx.action === 'DIVIDEND' || tx.action === 'SPLIT') ? '--' :
                Finance.formatCurrency(tx.price);

            return `
                <tr data-id="${tx.id}">
                    <td>${tx.date}</td>
                    <td><span class="action-badge ${actionClass}">${actionText}</span></td>
                    <td><strong>${tx.symbol}</strong></td>
                    <td class="text-right">${quantityDisplay}</td>
                    <td class="text-right">${priceDisplay}</td>
                    <td class="text-right">${Finance.formatCurrency(tx.fees || 0)}</td>
                    <td class="text-right">${totalAmount > 0 ? Finance.formatCurrency(totalAmount) : '--'}</td>
                    <td>
                        <button class="btn-icon btn-delete" title="刪除" onclick="Transactions.deleteTransaction(${tx.id})">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3,6 5,6 21,6"/>
                                <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    /**
     * 初始化手動輸入表單
     */
    initManualForm() {
        const form = document.getElementById('manual-transaction-form');
        if (!form) return;

        const dateInput = document.getElementById('tx-date');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleManualSubmit(form);
        });
    },

    /**
     * 處理手動表單提交 - 只寫入本地 IndexedDB
     */
    async handleManualSubmit(form) {
        const transaction = {
            date: form.querySelector('#tx-date').value,
            symbol: form.querySelector('#tx-symbol').value.toUpperCase(),
            action: form.querySelector('#tx-type').value,
            quantity: parseFloat(form.querySelector('#tx-quantity').value) || 0,
            price: parseFloat(form.querySelector('#tx-price').value) || 0,
            fees: parseFloat(form.querySelector('#tx-fees').value) || 0,
            notes: form.querySelector('#tx-notes').value,
            currency: 'USD'
        };

        // 計算總金額
        transaction.amount = transaction.action === 'DIVIDEND'
            ? transaction.price
            : transaction.quantity * transaction.price;

        // 驗證
        const validation = CSVParser.validate(transaction);
        if (!validation.valid) {
            App.showToast(validation.errors.join(', '), 'error');
            return;
        }

        try {
            // 儲存到本地 IndexedDB
            await CacheService.indexedDB.addTransaction(transaction);

            App.showToast('交易已新增', 'success');
            form.reset();

            // 重設日期
            const dateInput = form.querySelector('#tx-date');
            if (dateInput) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }

            // 重新載入資料
            await App.loadData();
        } catch (error) {
            console.error('新增交易失敗:', error);
            App.showToast('新增失敗: ' + error.message, 'error');
        }
    },

    /**
     * 初始化 CSV 匯入
     */
    initCSVImport() {
        const uploadZone = document.getElementById('csv-upload-zone');
        const fileInput = document.getElementById('csv-file-input');
        const confirmBtn = document.getElementById('confirm-import-btn');

        if (!uploadZone || !fileInput) return;

        uploadZone.addEventListener('click', () => fileInput.click());

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) this.handleCSVFile(file);
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleCSVFile(file);
        });

        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.confirmCSVImport());
        }
    },

    /**
     * 處理 CSV 檔案
     */
    async handleCSVFile(file) {
        if (!file.name.endsWith('.csv')) {
            App.showToast('請選擇 CSV 檔案', 'error');
            return;
        }

        try {
            const text = await file.text();
            const brokerType = document.getElementById('broker-select')?.value || 'auto';
            const transactions = CSVParser.parse(text, brokerType);

            if (transactions.length === 0) {
                App.showToast('未找到有效的交易紀錄', 'warning');
                return;
            }

            this.pendingCSVData = transactions;
            this.showCSVPreview(transactions);
        } catch (error) {
            console.error('CSV 解析錯誤:', error);
            App.showToast('解析失敗: ' + error.message, 'error');
        }
    },

    /**
     * 顯示 CSV 預覽
     */
    showCSVPreview(transactions) {
        const preview = document.getElementById('csv-preview');
        const thead = document.getElementById('csv-preview-thead');
        const tbody = document.getElementById('csv-preview-tbody');
        const rowCount = document.getElementById('csv-row-count');

        if (!preview || !thead || !tbody) return;

        const { headers, rows } = CSVParser.generatePreview(transactions, 5);

        thead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
        tbody.innerHTML = rows.map(row =>
            `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`
        ).join('');

        if (rowCount) {
            rowCount.textContent = `${transactions.length} 筆交易記錄`;
        }

        preview.classList.remove('hidden');
    },

    /**
     * 確認 CSV 匯入 - 只寫入本地 IndexedDB
     */
    async confirmCSVImport() {
        if (!this.pendingCSVData || this.pendingCSVData.length === 0) {
            App.showToast('沒有待匯入的資料', 'warning');
            return;
        }

        try {
            // 儲存到本地 IndexedDB (追加)
            const existing = await CacheService.indexedDB.getTransactions();
            await CacheService.indexedDB.saveTransactions([...existing, ...this.pendingCSVData]);

            App.showToast(`成功匯入 ${this.pendingCSVData.length} 筆交易`, 'success');

            // 清除預覽
            this.pendingCSVData = null;
            document.getElementById('csv-preview')?.classList.add('hidden');
            document.getElementById('csv-file-input').value = '';

            // 重新載入資料
            await App.loadData();

            // 切換到交易紀錄頁面
            App.switchView('transactions');
        } catch (error) {
            console.error('匯入失敗:', error);
            App.showToast('匯入失敗: ' + error.message, 'error');
        }
    },

    /**
     * 刪除交易
     */
    async deleteTransaction(id) {
        if (!confirm('確定要刪除這筆交易嗎？')) {
            return;
        }

        try {
            await CacheService.indexedDB.deleteTransaction(id);
            App.showToast('交易已刪除', 'success');
            await App.loadData();
        } catch (error) {
            console.error('刪除失敗:', error);
            App.showToast('刪除失敗', 'error');
        }
    }
};

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Transactions;
}

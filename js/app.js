/**
 * Portfolio Tracker - 主應用程式 (輕量化版)
 * 無需認證，直接使用本地 IndexedDB 儲存
 * 雙擊 index.html 即可運行
 */

const App = {
    isInitialized: false,
    currentView: 'dashboard',
    // 狀態
    transactions: [],
    prices: {},
    stats: null,

    /**
     * 應用程式初始化
     */
    async init() {
        console.log('Portfolio Tracker 初始化中 (本地模式)...');

        try {
            // 初始化快取服務
            await CacheService.init();

            // 載入使用者設定
            this.applySettings();

            // 初始化 UI 事件
            this.initUIEvents();

            // 直接進入主畫面
            this.enterApp();

            this.isInitialized = true;
            console.log('Portfolio Tracker 初始化完成');
        } catch (error) {
            console.error('初始化失敗:', error);
            this.showToast('初始化失敗，請重新整理頁面', 'error');
        }
    },

    /**
     * 直接進入主應用程式（無需登入）
     */
    async enterApp() {
        // 直接顯示主畫面
        document.getElementById('main-app').classList.add('active');

        // 載入資料
        await this.loadData();
    },

    /**
     * 套用使用者設定
     */
    applySettings() {
        const settings = CacheService.settings.get();

        // 套用顏色方案
        if (settings.colorScheme === 'tw') {
            document.documentElement.setAttribute('data-color-scheme', 'tw');
        } else {
            document.documentElement.removeAttribute('data-color-scheme');
        }

        // 更新設定 UI
        const colorRadios = document.querySelectorAll('input[name="color-scheme"]');
        colorRadios.forEach(radio => {
            radio.checked = radio.value === settings.colorScheme;
        });

        const currencySelect = document.getElementById('currency-display');
        if (currencySelect) {
            currencySelect.value = settings.currency || 'USD';
        }

        const benchmarkInput = document.getElementById('benchmark-symbol');
        if (benchmarkInput) {
            benchmarkInput.value = settings.benchmark || '^GSPC';
        }

        // 更新快取資訊
        this.updateCacheInfo();
    },

    /**
     * 初始化 UI 事件
     */
    initUIEvents() {
        // 側邊欄導航
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const view = item.dataset.view;
                if (view) this.switchView(view);
            });
        });

        // 重新整理按鈕
        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            this.loadData(true);
        });

        // 資產配置類型選擇
        document.getElementById('allocation-type')?.addEventListener('change', (e) => {
            this.updateAllocationChart(e.target.value);
        });

        // 圖表時間範圍選擇
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                const range = e.target.dataset.range;
                Charts.updateChartRange('portfolio-chart', range);
            });
        });

        // 設定頁面事件
        this.initSettingsEvents();

        // 交易相關初始化
        Transactions.initManualForm();
        Transactions.initCSVImport();

        // 初始化圖表
        Charts.initPortfolioChart('portfolio-chart');
        Charts.initAllocationChart('allocation-chart');
    },

    /**
     * 初始化設定頁面事件
     */
    initSettingsEvents() {
        // 顏色方案
        document.querySelectorAll('input[name="color-scheme"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                CacheService.settings.set('colorScheme', e.target.value);
                this.applySettings();
                this.refreshDisplay();
            });
        });

        // 貨幣
        document.getElementById('currency-display')?.addEventListener('change', (e) => {
            CacheService.settings.set('currency', e.target.value);
            this.refreshDisplay();
        });

        // 基準指數
        document.getElementById('benchmark-symbol')?.addEventListener('change', (e) => {
            CacheService.settings.set('benchmark', e.target.value);
        });

        // 清除快取
        document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
            if (confirm('確定要清除所有本地快取嗎？')) {
                await CacheService.clearAll();
                this.showToast('快取已清除', 'success');
                this.updateCacheInfo();
            }
        });

        // 匯出資料
        document.getElementById('export-data-btn')?.addEventListener('click', () => {
            this.exportData();
        });
    },

    /**
     * 載入資料
     * @param {boolean} forceRefresh - 是否強制重新整理
     */
    async loadData(forceRefresh = false) {
        try {
            // 顯示載入狀態
            this.showLoading(true);

            if (forceRefresh) {
                // 只清除價格快取，不清除交易資料
                PriceService.clearCache();
            }

            // 從 IndexedDB 載入交易紀錄
            this.transactions = await CacheService.indexedDB.getTransactions();

            if (this.transactions.length === 0) {
                this.showLoading(false);
                this.showEmptyState();
                return;
            }

            // 計算持股
            this.holdings = Dashboard.calculateHoldings(this.transactions);

            // 取得股價 (Current Prices)
            if (this.holdings.length > 0) {
                const symbols = this.holdings.map(h => h.symbol);
                this.prices = await PriceService.getPrices(symbols);
            }

            // PHASE 1: 計算核心數據 (Sync/Fast)
            const overview = Dashboard.calculateOverview(this.transactions, this.prices);

            // 初始化 stats
            this.stats = {
                ...overview,
                portfolioHistory: [],
                monthlyReturns: [],
                xirr: 0, sharpe: 0, mdd: 0, beta: 0
            };

            // 渲染基本 UI
            this.showToast('資料載入完成');
            this.refreshDisplay(true);

            this.showLoading(false);

            // PHASE 2: 背景載入歷史數據 (Async/Slow)
            this.loadHistoricalData(overview);

        } catch (error) {
            console.error('載入資料失敗:', error);
            this.showToast('載入資料失敗: ' + error.message, 'error');
            this.showLoading(false);
        }
    },

    /**
     * 顯示空狀態提示
     */
    showEmptyState() {
        const kpiGrid = document.querySelector('.kpi-grid');
        if (kpiGrid) {
            // KPI 維持 $0.00 顯示即可
        }
        this.showToast('尚無交易資料，請透過「匯入資料」開始使用', 'info');
    },

    /**
     * 渲染年度績效表格
     */
    renderYearlyTable(stats) {
        const tbody = document.getElementById('yearly-performance-tbody');
        if (!tbody) return;

        let html = '';
        const settings = CacheService.settings.get();
        const isUSStyle = settings.colorScheme !== 'tw';

        stats.forEach(yearStat => {
            const profitClass = Dashboard.getPnLClass(yearStat.profit, isUSStyle);
            const returnClass = Dashboard.getPnLClass(yearStat.returnPct, isUSStyle);

            html += `
                <tr>
                    <td>${yearStat.year}</td>
                    <td class="text-right">${Finance.formatCurrency(yearStat.startValue, settings.currency)}</td>
                    <td class="text-right">${Finance.formatCurrency(yearStat.netInflow, settings.currency)}</td>
                    <td class="text-right ${profitClass}">${Finance.formatCurrency(yearStat.profit, settings.currency)}</td>
                    <td class="text-right ${returnClass}">${Finance.formatPercentage(yearStat.returnPct)}</td>
                    <td class="text-right">${Finance.formatCurrency(yearStat.endValue, settings.currency)}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    },

    /**
     * 背景載入歷史數據
     */
    async loadHistoricalData(overview) {
        console.log('開始載入歷史數據...');
        try {
            if (!this.prices || Object.keys(this.prices).length === 0) {
                return;
            }

            const { portfolioHistory, monthlyReturns, historicalPrices } = await Dashboard.calculateHistoricalReturns(
                this.transactions,
                this.prices,
                overview.holdings
            );

            // 計算風險指標
            const riskMetrics = Dashboard.calculateRiskMetrics(
                this.transactions,
                overview,
                portfolioHistory,
                monthlyReturns
            );

            // 計算年度績效
            const yearlyPerformance = Dashboard.calculateYearlyPerformance(this.transactions, portfolioHistory, historicalPrices, overview.netWorth);

            this.stats = {
                ...this.stats,
                ...riskMetrics,
                portfolioHistory,
                yearlyPerformance
            };

            // 更新 UI
            this.refreshDisplay(false);

        } catch (error) {
            console.error('歷史數據載入失敗:', error);
            this.showToast('無法載入歷史數據，請稍後再試', 'error');
        }
    },

    /**
     * 重新整理顯示
     */
    async refreshDisplay(basicOnly = false) {
        if (this.transactions.length === 0) return;
        if (!this.stats) return;

        // 更新 KPI
        Dashboard.updateKPIs(this.stats);

        // 更新資產配置圖
        this.updateAllocationChart('symbol');

        // 更新持股表
        Portfolio.renderHoldingsTable(this.stats.holdings, this.stats.stockValue, this.stats.cashBalance);

        // 更新已實現損益表
        Portfolio.renderRealizedTable(this.transactions);

        // 更新交易紀錄表
        Transactions.renderTransactionsTable(this.transactions);

        if (basicOnly) return;

        // --- 以下為歷史數據相關 (Phase 2) ---

        // 更新資產走勢圖
        if (this.stats.portfolioHistory && this.stats.portfolioHistory.length > 0) {
            const chartData = {
                labels: this.stats.portfolioHistory.map(p => p.date),
                portfolio: this.stats.portfolioHistory.map(p => p.value),
                benchmark: []
            };
            if (Charts.updatePortfolioChart) {
                Charts.updatePortfolioChart('portfolio-chart', chartData);
            } else if (Charts.drawPortfolioChart) {
                Charts.drawPortfolioChart('portfolio-chart', this.stats.portfolioHistory);
            }
        }

        // 渲染年度績效
        if (this.stats.yearlyPerformance) {
            this.renderYearlyTable(this.stats.yearlyPerformance);
        }
    },

    /**
     * 更新資產配置圖
     */
    updateAllocationChart(groupBy) {
        if (!this.stats?.holdings) return;
        const data = Dashboard.generateAllocationData(this.stats.holdings, groupBy);
        Charts.updateAllocationChart('allocation-chart', data);
    },

    /**
     * 切換視圖
     */
    switchView(viewName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `view-${viewName}`);
        });

        this.currentView = viewName;

        if (viewName === 'performance') {
            this.refreshPerformance(false);
        }
    },

    /**
     * 更新個股績效視圖
     */
    async refreshPerformance(force = true) {
        if (!this.transactions || this.transactions.length === 0) return;

        if (!force && this.stats && this.stats.performanceData) {
            Performance.render('performance-table', this.stats.performanceData);
            return;
        }

        const loadingDiv = document.getElementById('performance-loading');
        const tableDiv = document.getElementById('performance-table');

        if (loadingDiv) loadingDiv.classList.remove('hidden');
        if (tableDiv) tableDiv.classList.add('hidden');

        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            const performanceData = Performance.calculateAll(this.transactions, this.prices);
            if (!this.stats) this.stats = {};
            this.stats.performanceData = performanceData;
            Performance.render('performance-table', performanceData);
        } catch (error) {
            console.error('績效計算失敗:', error);
            this.showToast('績效計算失敗', 'error');
        } finally {
            if (loadingDiv) loadingDiv.classList.add('hidden');
            if (tableDiv) tableDiv.classList.remove('hidden');
        }
    },

    /**
     * 匯出所有交易資料為 JSON
     */
    async exportData() {
        try {
            const transactions = await CacheService.indexedDB.getTransactions();
            const settings = CacheService.settings.get();

            const exportObj = {
                version: '2.0-local',
                exportDate: new Date().toISOString(),
                settings,
                transactions
            };

            const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `portfolio-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('資料已匯出', 'success');
        } catch (error) {
            this.showToast('匯出失敗: ' + error.message, 'error');
        }
    },

    /**
     * 匯入 JSON 備份
     */
    async importBackup(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.transactions || !Array.isArray(data.transactions)) {
                throw new Error('無效的備份檔案格式');
            }

            // 寫入 IndexedDB
            const existing = await CacheService.indexedDB.getTransactions();
            await CacheService.indexedDB.saveTransactions([...existing, ...data.transactions]);

            // 還原設定
            if (data.settings) {
                CacheService.settings.save(data.settings);
                this.applySettings();
            }

            this.showToast(`已匯入 ${data.transactions.length} 筆交易`, 'success');
            await this.loadData();
        } catch (error) {
            this.showToast('匯入失敗: ' + error.message, 'error');
        }
    },

    /**
     * 更新快取資訊
     */
    updateCacheInfo() {
        const sizeElement = document.getElementById('cache-size');
        const syncElement = document.getElementById('last-sync');

        if (sizeElement) {
            sizeElement.textContent = CacheService.getTotalSize();
        }

        if (syncElement) {
            const lastSync = CacheService.settings.get().lastSync;
            syncElement.textContent = lastSync
                ? new Date(lastSync).toLocaleString('zh-TW')
                : '--';
        }
    },

    /**
     * 顯示/隱藏載入狀態
     */
    showLoading(show) {
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.disabled = show;
            refreshBtn.innerHTML = show
                ? '<span class="spinner"></span>載入中...'
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23,4 23,10 17,10"/>
                    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
                   </svg>重新整理`;
        }
    },

    /**
     * 顯示 Toast 通知
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span>${message}</span>
            <button class="btn-icon" onclick="this.parentElement.remove()">×</button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
};

// DOM 載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = App;
}

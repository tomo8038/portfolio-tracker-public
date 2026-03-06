/**
 * Portfolio Tracker - 個股績效組件
 * 負責計算與顯示每支股票的詳細績效 (XIRR, 機械報酬等)
 */
const Performance = {
    /**
     * 計算所有股票的績效數據
     * @param {Array} transactions - 所有交易紀錄
     * @param {Object} currentPrices - 當前股價 Map
     * @returns {Array} 績效數據陣列
     */
    calculateAll(transactions, currentPrices) {
        const performanceData = [];

        // 1. 找出所有涉及的股票代碼
        const symbols = [...new Set(transactions
            .filter(tx => tx.symbol && !['CASH', 'TAX', 'INTEREST'].includes(tx.symbol))
            .map(tx => tx.symbol)
        )];

        for (const symbol of symbols) {
            const symbolTxs = transactions.filter(tx => tx.symbol === symbol);

            // 計算各項指標
            const realized = this.calculateRealizedPnL(symbolTxs);
            const dividends = this.calculateDividends(symbolTxs);
            const unrealized = this.calculateUnrealized(symbolTxs, currentPrices[symbol]);

            // 總報酬 (金額) = 已實現 + 未實現 + 股利
            const totalReturnAmt = realized + unrealized.amount + dividends;

            // 總投入成本 (Adjusted Cost Basis for Return %)
            // 簡易算法：總買入金額 (不含手續費?) 或者使用 Max Invested Capital?
            // 精確算法：XIRR 不需要分母。但 "總報酬率 (%)" 需要分母。
            // 使用 "Net Invested" (總買入 - 總賣出)? No.
            // 使用 "Total Buy Amount" (累計投入)? 比較合理。
            const totalInvested = symbolTxs
                .filter(tx => tx.action === 'BUY')
                .reduce((sum, tx) => sum + (tx.amount ? Math.abs(tx.amount) : tx.quantity * tx.price), 0);

            const totalReturnPct = totalInvested > 0 ? totalReturnAmt / totalInvested : 0;

            // XIRR 計算
            const xirr = this.calculateStockXIRR(symbolTxs, unrealized.marketValue);

            performanceData.push({
                symbol,
                realized,
                unrealized: unrealized.amount,
                dividends,
                totalReturnAmt,
                totalReturnPct,
                xirr,
                marketValue: unrealized.marketValue,
                holdings: unrealized.quantity
            });
        }

        // 依市值排序
        return performanceData.sort((a, b) => b.marketValue - a.marketValue);
    },

    calculateRealizedPnL(transactions) {
        let realized = 0;
        const positions = []; // FIFO queue

        const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const tx of sorted) {
            if (tx.action === 'BUY' || tx.action === 'TRANSFER_IN') {
                positions.push({
                    q: tx.quantity,
                    p: tx.price
                });
            } else if (tx.action === 'SELL' || tx.action === 'TRANSFER_OUT') {
                let remaining = tx.quantity;
                while (remaining > 0.0001 && positions.length > 0) {
                    const lot = positions[0];
                    const sellQty = Math.min(remaining, lot.q);

                    if (tx.action === 'SELL') {
                        // 只有賣出產生已實現損益 (Transfer 不算)
                        realized += sellQty * (tx.price - lot.p);
                    }

                    lot.q -= sellQty;
                    remaining -= sellQty;

                    if (lot.q < 0.0001) positions.shift();
                }
                // 扣除賣出手續費
                if (tx.action === 'SELL') realized -= (tx.fees || 0);
            } else if (tx.action === 'SPLIT') {
                // 股票分割：往前調整所有現有批次的成本
                // tx.quantity = 分割後新增的股數
                // 分割比例 = (現有+新增) / 現有
                const currentQty = positions.reduce((sum, p) => sum + p.q, 0);
                if (currentQty > 0) {
                    const ratio = (currentQty + tx.quantity) / currentQty;
                    positions.forEach(p => {
                        p.q *= ratio;       // 股數 × ratio
                        p.p /= ratio;       // 每股成本 ÷ ratio（總成本不變）
                    });
                    console.log(`[Performance] SPLIT ${tx.symbol}: ratio=${ratio.toFixed(4)}, adjusted ${positions.length} lots`);
                }
            }
        }
        return realized;
    },

    calculateUnrealized(transactions, currentPrice = 0) {
        // 簡易持股計算
        let quantity = 0;
        for (const tx of transactions) {
            if (tx.action === 'BUY' || tx.action === 'TRANSFER_IN') quantity += tx.quantity;
            else if (tx.action === 'SELL' || tx.action === 'TRANSFER_OUT') quantity -= tx.quantity;
            else if (tx.action === 'SPLIT') quantity += tx.quantity;
        }

        // 浮點數誤差修正
        if (Math.abs(quantity) < 0.0001) quantity = 0;

        if (quantity === 0) return { amount: 0, marketValue: 0, quantity: 0 };

        // 計算平均成本 (需重跑一次 FIFO? 或者直接用 App.holdings 的結果?)
        // 為了獨立性，這裡重新計算有點浪費。但為了傳入參數簡單，先重算。
        // 其實可以優化：直接傳入 holdings 對象。
        // 但這裡先用簡易成本 (Total Buy - Total Sell Cost) -> 不準確。
        // 用 FIFO 算出剩餘成本 basis。

        let costBasis = 0;
        const positions = [];
        const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const tx of sorted) {
            if (tx.action === 'BUY' || tx.action === 'TRANSFER_IN') {
                const price = tx.action === 'TRANSFER_IN' ? (positions.length > 0 ? 0 : tx.price) : tx.price; // Transfer In 成本處理需一致
                // 簡化：TRANSFER_IN 視為成本 0 或市價？ App.dashboard 邏輯是"平均成本"。
                // 這裡簡單處理：TRANSFER_IN 若無輸入價格，可能導致誤差。但通常 CSV 有價格。
                positions.push({ q: tx.quantity, p: tx.price });
            } else if (tx.action === 'SELL' || tx.action === 'TRANSFER_OUT') {
                let remaining = tx.quantity;
                while (remaining > 0.0001 && positions.length > 0) {
                    const lot = positions[0];
                    const sellQty = Math.min(remaining, lot.q);
                    lot.q -= sellQty;
                    remaining -= sellQty;
                    if (lot.q < 0.0001) positions.shift();
                }
            } else if (tx.action === 'SPLIT') {
                const currentQty = positions.reduce((sum, p) => sum + p.q, 0);
                if (currentQty > 0) {
                    const ratio = (currentQty + tx.quantity) / currentQty;
                    positions.forEach(p => { p.q *= ratio; p.p /= ratio; });
                }
            }
        }

        costBasis = positions.reduce((sum, p) => sum + p.q * p.p, 0);
        const marketValue = quantity * currentPrice;

        return {
            amount: marketValue - costBasis,
            marketValue,
            quantity
        };
    },

    calculateDividends(transactions) {
        return transactions
            .filter(tx => tx.action === 'DIVIDEND' && tx.amount > 0)
            .reduce((sum, tx) => sum + tx.amount, 0);
    },

    calculateStockXIRR(transactions, currentMarketValue) {
        const cashflows = [];
        for (const tx of transactions) {
            let amount = 0;
            if (tx.action === 'BUY') {
                // 買入 = 負現金流
                amount = -Math.abs(tx.amount || (tx.quantity * tx.price));
                // 扣除手續費 (買入支出更多)
                if (tx.fees) amount -= tx.fees;
            } else if (tx.action === 'SELL') {
                // 賣出 = 正現金流
                amount = Math.abs(tx.amount || (tx.quantity * tx.price));
                // 扣除手續費 (賣出收入更少)
                if (tx.fees) amount -= tx.fees;
            } else if (tx.action === 'DIVIDEND') {
                amount = tx.amount;
            }

            if (amount !== 0) {
                cashflows.push({ date: new Date(tx.date), amount });
            }
        }

        // 加入現值 (視為賣出)
        if (currentMarketValue > 0) {
            cashflows.push({ date: new Date(), amount: currentMarketValue });
        }

        return Finance.calculateXIRR(cashflows);
    },

    /**
     * 渲染表格
     */
    render(containerId, stats) {
        const container = document.getElementById(containerId);
        if (!container) return;

        let html = `
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>代號</th>
                            <th class="text-right">持有股數</th>
                            <th class="text-right">現價</th>
                            <th class="text-right">未實現損益</th>
                            <th class="text-right">已實現損益</th>
                            <th class="text-right">股利</th>
                            <th class="text-right">總報酬 ($)</th>
                            <th class="text-right">總報酬 (%)</th>
                            <th class="text-right">年化報酬 (XIRR)</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (stats.length === 0) {
            html += `<tr><td colspan="9" class="text-center">無資料</td></tr>`;
        } else {
            const settings = CacheService.settings.get();
            const isUSStyle = settings.colorScheme !== 'tw';

            stats.forEach(item => {
                const unrealizedClass = Dashboard.getPnLClass(item.unrealized, isUSStyle);
                const realizedClass = Dashboard.getPnLClass(item.realized, isUSStyle);
                const totalClass = Dashboard.getPnLClass(item.totalReturnAmt, isUSStyle);
                const xirrClass = Dashboard.getPnLClass(item.xirr, isUSStyle);

                html += `
                    <tr>
                        <td class="font-bold">${item.symbol}</td>
                        <td class="text-right">${item.holdings.toFixed(2)}</td>
                        <td class="text-right">${Finance.formatCurrency(item.marketValue / (item.holdings || 1), settings.currency)}</td>
                        <td class="text-right ${unrealizedClass}">${Finance.formatCurrency(item.unrealized, settings.currency)}</td>
                        <td class="text-right ${realizedClass}">${Finance.formatCurrency(item.realized, settings.currency)}</td>
                        <td class="text-right">${Finance.formatCurrency(item.dividends, settings.currency)}</td>
                        <td class="text-right ${totalClass}">${Finance.formatCurrency(item.totalReturnAmt, settings.currency)}</td>
                        <td class="text-right ${totalClass}">${Finance.formatPercentage(item.totalReturnPct)}</td>
                        <td class="text-right ${xirrClass}">${Finance.formatPercentage(item.xirr)}</td>
                    </tr>
                `;
            });
        }

        html += `   </tbody>
                </table>
            </div>`;

        container.innerHTML = html;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Performance;
}

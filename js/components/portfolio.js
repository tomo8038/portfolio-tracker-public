/**
 * Portfolio Tracker - 持股分析組件
 * 負責持股列表與已實現損益表的渲染
 */

const Portfolio = {
    /**
     * 渲染持股列表
     * @param {Array<Object>} holdings - 持股陣列
     * @param {number} totalValue - 總市值 (股票)
     * @param {number} cashBalance - 現金餘額
     */
    renderHoldingsTable(holdings, totalValue, cashBalance = 0) {
        const tbody = document.getElementById('holdings-tbody');
        if (!tbody) return;

        const settings = CacheService.settings.get();
        const isUSStyle = settings.colorScheme !== 'tw';

        // 總資產 = 股票市值 + 現金
        const netWorth = totalValue + Math.max(0, cashBalance);

        if (holdings.length === 0 && cashBalance <= 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center" style="padding: 2rem; color: var(--text-muted);">
                        尚無持股資料
                    </td>
                </tr>
            `;
            return;
        }

        // 按市值排序
        const sorted = [...holdings].sort((a, b) => b.marketValue - a.marketValue);

        tbody.innerHTML = sorted.map(h => {
            const pnlClass = this.getPnLClass(h.pnl, isUSStyle);
            const weight = netWorth > 0 ? (h.marketValue / netWorth * 100) : 0;

            return `
                <tr>
                    <td><strong>${h.symbol}</strong></td>
                    <td class="text-muted">${h.name || '--'}</td>
                    <td class="text-right">${Finance.formatNumber(h.quantity, 4)}</td>
                    <td class="text-right">${Finance.formatCurrency(h.avgCost)}</td>
                    <td class="text-right">${Finance.formatCurrency(h.currentPrice)}</td>
                    <td class="text-right">${Finance.formatCurrency(h.marketValue)}</td>
                    <td class="text-right ${pnlClass}">${h.pnl >= 0 ? '+' : ''}${Finance.formatCurrency(h.pnl)}</td>
                    <td class="text-right ${pnlClass}">${Finance.formatPercentage(h.pnlPct)}</td>
                    <td class="text-right">
                        <div class="weight-bar">
                            <div class="weight-fill" style="width: ${Math.min(weight, 100)}%"></div>
                            <span>${weight.toFixed(1)}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // 加入現金餘額列 (如果有)
        if (cashBalance > 0) {
            const cashWeight = netWorth > 0 ? (cashBalance / netWorth * 100) : 0;
            tbody.innerHTML += `
                <tr class="cash-row">
                    <td><strong>💵 現金</strong></td>
                    <td class="text-muted">Cash Balance</td>
                    <td class="text-right">--</td>
                    <td class="text-right">--</td>
                    <td class="text-right">--</td>
                    <td class="text-right">${Finance.formatCurrency(cashBalance)}</td>
                    <td class="text-right neutral">--</td>
                    <td class="text-right neutral">--</td>
                    <td class="text-right">
                        <div class="weight-bar">
                            <div class="weight-fill cash" style="width: ${Math.min(cashWeight, 100)}%"></div>
                            <span>${cashWeight.toFixed(1)}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }

        // 加入總計列
        const totalPnL = holdings.reduce((sum, h) => sum + h.pnl, 0);
        const totalCost = holdings.reduce((sum, h) => sum + h.totalCost, 0);
        const totalPnLPct = totalCost > 0 ? totalPnL / totalCost : 0;
        const totalPnLClass = this.getPnLClass(totalPnL, isUSStyle);

        tbody.innerHTML += `
            <tr class="total-row">
                <td colspan="5"><strong>總計</strong></td>
                <td class="text-right"><strong>${Finance.formatCurrency(netWorth)}</strong></td>
                <td class="text-right ${totalPnLClass}"><strong>${totalPnL >= 0 ? '+' : ''}${Finance.formatCurrency(totalPnL)}</strong></td>
                <td class="text-right ${totalPnLClass}"><strong>${Finance.formatPercentage(totalPnLPct)}</strong></td>
                <td class="text-right"><strong>100%</strong></td>
            </tr>
        `;
    },

    /**
     * 渲染已實現損益表
     * @param {Array<Object>} transactions - 所有交易紀錄
     */
    renderRealizedTable(transactions) {
        const tbody = document.getElementById('realized-tbody');
        if (!tbody) return;

        const settings = CacheService.settings.get();
        const isUSStyle = settings.colorScheme !== 'tw';

        // 找出所有賣出交易並計算損益
        const sellTxs = transactions.filter(tx => tx.action === 'SELL');

        if (sellTxs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center" style="padding: 2rem; color: var(--text-muted);">
                        尚無已實現損益
                    </td>
                </tr>
            `;
            return;
        }

        // 計算每筆賣出的損益 (需要追蹤買入成本)
        const realizedTrades = this.calculateRealizedTrades(transactions);

        // 按日期排序 (最新在前)
        realizedTrades.sort((a, b) => new Date(b.sellDate) - new Date(a.sellDate));

        tbody.innerHTML = realizedTrades.map(trade => {
            const pnlClass = this.getPnLClass(trade.realizedPnL, isUSStyle);

            return `
                <tr>
                    <td>${trade.sellDate}</td>
                    <td><strong>${trade.symbol}</strong></td>
                    <td class="text-right">${Finance.formatNumber(trade.quantity, 4)}</td>
                    <td class="text-right">${Finance.formatCurrency(trade.avgCost)}</td>
                    <td class="text-right">${Finance.formatCurrency(trade.sellPrice)}</td>
                    <td class="text-right ${pnlClass}">${trade.realizedPnL >= 0 ? '+' : ''}${Finance.formatCurrency(trade.realizedPnL)}</td>
                    <td class="text-right ${pnlClass}">${Finance.formatPercentage(trade.returnPct)}</td>
                </tr>
            `;
        }).join('');

        // 總計
        const totalRealizedPnL = realizedTrades.reduce((sum, t) => sum + t.realizedPnL, 0);
        const totalRealizedClass = this.getPnLClass(totalRealizedPnL, isUSStyle);

        tbody.innerHTML += `
            <tr class="total-row">
                <td colspan="5"><strong>總計</strong></td>
                <td class="text-right ${totalRealizedClass}"><strong>${totalRealizedPnL >= 0 ? '+' : ''}${Finance.formatCurrency(totalRealizedPnL)}</strong></td>
                <td></td>
            </tr>
        `;
    },

    /**
     * 計算每筆賣出的已實現損益 (含股票分割調整)
     * @param {Array<Object>} transactions - 交易紀錄
     * @returns {Array<Object>} 已實現交易陣列
     */
    calculateRealizedTrades(transactions) {
        const positions = {}; // { symbol: [{ date, quantity, price }] }
        const realizedTrades = [];

        // 按日期排序
        const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const tx of sorted) {
            // 跳過非相關交易類型
            if (!['BUY', 'SELL', 'SPLIT'].includes(tx.action)) continue;

            const symbol = tx.symbol;
            if (!symbol) continue;

            if (!positions[symbol]) {
                positions[symbol] = [];
            }

            if (tx.action === 'BUY') {
                // 買入：記錄批次
                positions[symbol].push({
                    date: tx.date,
                    quantity: tx.quantity,
                    price: tx.price
                });
            } else if (tx.action === 'SPLIT') {
                // 股票分割：調整所有現有批次
                const lots = positions[symbol];
                if (lots && lots.length > 0) {
                    const currentQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
                    if (currentQuantity > 0) {
                        // tx.quantity 是分割後獲得的新股數
                        const newTotalQuantity = currentQuantity + tx.quantity;
                        const splitRatio = newTotalQuantity / currentQuantity;

                        console.log(`[Portfolio] Stock Split: ${symbol}, ratio: ${splitRatio.toFixed(4)}`);
                        console.log(`  Before: ${currentQuantity} shares`);
                        console.log(`  After: ${newTotalQuantity} shares`);

                        // 調整每個批次
                        for (const lot of lots) {
                            const oldPrice = lot.price;
                            lot.quantity *= splitRatio;  // 股數增加
                            lot.price /= splitRatio;       // 每股成本降低
                            console.log(`  Lot adjusted: ${oldPrice.toFixed(2)} -> ${lot.price.toFixed(2)}`);
                        }
                    }
                }
            } else if (tx.action === 'TRANSFER_OUT') {
                // 轉移轉出：只從持股中扣除，不計入已實現損益
                console.log(`[Portfolio] Transfer OUT: ${symbol} x ${tx.quantity} (skipped from P&L)`);
                let remaining = tx.quantity;
                while (remaining > 0.0001 && positions[symbol] && positions[symbol].length > 0) {
                    const lot = positions[symbol][0];
                    if (lot.quantity <= remaining + 0.0001) {
                        remaining -= lot.quantity;
                        positions[symbol].shift();
                    } else {
                        lot.quantity -= remaining;
                        remaining = 0;
                    }
                }
                // 不記錄到 realizedTrades，直接繼續
            } else if (tx.action === 'SELL') {
                let remaining = tx.quantity;
                let totalCostBasis = 0;
                let totalQty = 0;

                while (remaining > 0.0001 && positions[symbol].length > 0) {
                    const lot = positions[symbol][0];
                    const matchQty = Math.min(remaining, lot.quantity);

                    totalCostBasis += matchQty * lot.price;
                    totalQty += matchQty;

                    if (lot.quantity <= remaining + 0.0001) {
                        remaining -= lot.quantity;
                        positions[symbol].shift();
                    } else {
                        lot.quantity -= remaining;
                        remaining = 0;
                    }
                }

                const avgCost = totalQty > 0 ? totalCostBasis / totalQty : 0;
                const proceeds = tx.quantity * tx.price - (tx.fees || 0);
                const realizedPnL = proceeds - totalCostBasis;
                const returnPct = totalCostBasis > 0 ? realizedPnL / totalCostBasis : 0;

                console.log(`[Portfolio] Sell: ${symbol} x ${tx.quantity} @ ${tx.price}`);
                console.log(`  Avg Cost: ${avgCost.toFixed(2)}, Proceeds: ${proceeds.toFixed(2)}, P&L: ${realizedPnL.toFixed(2)}`);

                realizedTrades.push({
                    sellDate: tx.date,
                    symbol,
                    quantity: tx.quantity,
                    avgCost,
                    sellPrice: tx.price,
                    realizedPnL,
                    returnPct
                });
            }
        }

        return realizedTrades;
    },

    /**
     * 取得損益樣式類別
     */
    getPnLClass(value, isUSStyle = true) {
        if (value > 0) return isUSStyle ? 'profit' : 'loss';
        if (value < 0) return isUSStyle ? 'loss' : 'profit';
        return 'neutral';
    }
};

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Portfolio;
}

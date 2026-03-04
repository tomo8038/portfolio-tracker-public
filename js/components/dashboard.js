/**
 * Portfolio Tracker - 儀表板組件
 * 負責 KPI 卡片更新與儀表板數據計算
 * 
 * 支援股票分割調整：
 * - 當偵測到 SPLIT 交易時，自動調整該 symbol 所有買入批次的成本與股數
 */

const Dashboard = {
    /**
     * 更新所有 KPI 卡片
     */
    updateKPIs(data) {
        const settings = CacheService.settings.get();
        const isUSStyle = settings.colorScheme !== 'tw';

        // 總資產
        this.updateKPI('kpi-net-worth', Finance.formatCurrency(data.netWorth, settings.currency));

        // 總損益
        const pnlElement = document.getElementById('kpi-total-pnl');
        const pnlPctElement = document.getElementById('kpi-total-pnl-pct');
        if (pnlElement) {
            pnlElement.textContent = Finance.formatCurrency(data.totalPnL, settings.currency);
            pnlElement.className = 'kpi-value ' + this.getPnLClass(data.totalPnL, isUSStyle);
        }
        if (pnlPctElement) {
            pnlPctElement.textContent = Finance.formatPercentage(data.totalPnLPct);
            pnlPctElement.className = 'kpi-change ' + this.getPnLClass(data.totalPnL, isUSStyle);
        }

        // XIRR
        const xirrElement = document.getElementById('kpi-xirr');
        if (xirrElement) {
            xirrElement.textContent = Finance.formatPercentage(data.xirr);
            xirrElement.className = 'kpi-value ' + this.getPnLClass(data.xirr, isUSStyle);
        }

        // 夏普值
        this.updateKPI('kpi-sharpe', Finance.formatNumber(data.sharpe, 2));

        // MDD
        const mddElement = document.getElementById('kpi-mdd');
        if (mddElement) {
            mddElement.textContent = Finance.formatPercentage(data.mdd);
            mddElement.className = 'kpi-value loss';
        }

        // Beta
        this.updateKPI('kpi-beta', Finance.formatNumber(data.beta, 2));

        // 最後更新時間
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            lastUpdated.textContent = `最後更新: ${new Date().toLocaleTimeString('zh-TW')}`;
        }
    },

    updateKPI(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    },

    getPnLClass(value, isUSStyle = true) {
        if (value > 0) return isUSStyle ? 'profit' : 'loss';
        if (value < 0) return isUSStyle ? 'loss' : 'profit';
        return 'neutral';
    },

    /**
     * 從交易計算投資組合統計
     */
    /**
     * 計算概覽數據 (同步/快速)
     * - 用於首屏快速渲染
     */
    calculateOverview(transactions, prices) {
        // 過濾出投資相關交易
        const investmentTx = transactions.filter(tx =>
            ['BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'TRANSFER_OUT', 'TRANSFER_IN'].includes(tx.action) &&
            tx.symbol && tx.symbol !== 'CASH' && tx.symbol !== 'TAX' && tx.symbol !== 'INTEREST'
        );

        // 計算持股
        const holdings = this.calculateHoldings(investmentTx);

        // 計算市值與成本
        let totalMarketValue = 0;
        let totalCostBasis = 0;

        const holdingsWithPrices = holdings.map(h => {
            let currentPrice = prices[h.symbol] || h.avgCost;

            // 債券價格調整（僅適用於美股債券，排除台股 .TW 後綴，長度通常超過 5 碼）
            const isBond = /^\d/.test(h.symbol) && !h.symbol.toUpperCase().endsWith('.TW') && !h.symbol.toUpperCase().endsWith('.TWO') && h.symbol.length >= 6;
            if (isBond && prices[h.symbol]) {
                currentPrice = currentPrice / 100;
            }

            const marketValue = h.quantity * currentPrice;
            const costBasis = h.quantity * h.avgCost;
            const pnl = Finance.calculateUnrealizedPnL(h.quantity, h.avgCost, currentPrice);

            totalMarketValue += marketValue;
            totalCostBasis += costBasis;

            return {
                ...h,
                currentPrice,
                marketValue,
                pnl: pnl.amount,
                pnlPct: pnl.percentage
            };
        });

        // 計算現金餘額
        let cashBalance = 0;
        for (const tx of transactions) {
            switch (tx.action) {
                case 'DEPOSIT': cashBalance += Math.abs(tx.amount || 0); break;
                case 'WITHDRAW': cashBalance -= Math.abs(tx.amount || 0); break;
                case 'BUY':
                    if (!tx.isTransfer) {
                        const buyAmount = tx.amount ? Math.abs(tx.amount) : ((tx.quantity * tx.price) + (tx.fees || 0));
                        cashBalance -= buyAmount;
                    }
                    break;
                case 'SELL':
                    if (!tx.isTransfer) {
                        const sellAmount = tx.amount ? Math.abs(tx.amount) : ((tx.quantity * tx.price) - (tx.fees || 0));
                        cashBalance += sellAmount;
                    }
                    break;
                case 'CASH_TRANSFER': cashBalance += tx.amount || 0; break;
                case 'DIVIDEND': cashBalance += tx.amount || 0; break;
                case 'TAX': cashBalance += tx.amount || 0; break;
                case 'INTEREST': cashBalance += tx.amount || 0; break;
                case 'PROMOTIONAL': cashBalance += tx.amount || 0; break;
            }
        }

        // 股利與稅務
        const dividends = transactions
            .filter(tx => tx.action === 'DIVIDEND' && tx.amount > 0)
            .reduce((sum, tx) => sum + tx.amount, 0);

        const taxes = transactions
            .filter(tx => tx.action === 'TAX')
            .reduce((sum, tx) => sum + tx.amount, 0);

        // 已實現損益
        const realizedPnL = this.calculateRealizedPnL(investmentTx);

        // 未實現損益
        const unrealizedPnL = totalMarketValue - totalCostBasis;

        // 總損益
        const totalPnL = unrealizedPnL + realizedPnL + dividends + taxes;
        const totalInvested = this.calculateTotalInvested(investmentTx);
        const totalPnLPct = totalInvested > 0 ? totalPnL / totalInvested : 0;

        // 總資產
        const netWorth = totalMarketValue + Math.max(0, cashBalance);

        return {
            netWorth,
            stockValue: totalMarketValue,
            cashBalance,
            totalCost: totalCostBasis,
            totalPnL,
            totalPnLPct,
            unrealizedPnL,
            realizedPnL,
            dividends,
            taxes,
            holdings: holdingsWithPrices,
            totalInvested // 用於後續計算
        };
    },

    /**
     * 計算風險指標 (XIRR, Sharpe, MDD)
     */
    calculateRiskMetrics(transactions, overviewData, portfolioHistory, monthlyReturns) {
        // XIRR
        const investmentTx = transactions.filter(tx =>
            ['BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'TRANSFER_OUT', 'TRANSFER_IN'].includes(tx.action) &&
            tx.symbol && tx.symbol !== 'CASH' && tx.symbol !== 'TAX'
        );
        const xirr = this.calculateXIRR(investmentTx, overviewData.stockValue);

        // MDD
        const mdd = Finance.calculateMDD(portfolioHistory.map(p => p.value));

        // Sharpe
        const sharpe = Finance.calculateSharpe(monthlyReturns, CONFIG.DEFAULTS.riskFreeRate, 12);

        return { xirr, mdd, sharpe, beta: 1.0 };
    },

    /**
     * 計算持股 (含股票分割調整)
     * 
     * 股票分割處理邏輯：
     * 1. 偵測到 SPLIT 交易時，記錄分割事件
     * 2. 計算分割比例 = 分割後股數 / 分割前股數
     * 3. 調整該 symbol 所有現有批次：
     *    - 股數 *= 分割比例
     *    - 成本 /= 分割比例
     */
    calculateHoldings(transactions) {
        const positions = {};

        // 按日期排序
        const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const tx of sorted) {
            // 調試：顯示所有交易的 action
            if (tx.symbol === 'QLD') {
                console.log(`[Holdings DEBUG] QLD tx: action="${tx.action}", date=${tx.date}, qty=${tx.quantity}`);
            }

            // 跳過非相關交易類型
            if (!['BUY', 'SELL', 'SPLIT', 'TRANSFER_OUT', 'TRANSFER_IN'].includes(tx.action)) continue;

            console.log(`[Holdings] Processing: ${tx.date} ${tx.action} ${tx.symbol} x ${tx.quantity}`);

            const symbol = tx.symbol;
            if (!symbol) continue;

            if (!positions[symbol]) {
                positions[symbol] = {
                    symbol,
                    quantity: 0,
                    totalCost: 0,
                    lots: []
                };
            }

            const pos = positions[symbol];

            if (tx.action === 'BUY') {
                // 買入
                pos.quantity += tx.quantity;
                pos.totalCost += tx.quantity * tx.price + (tx.fees || 0);
                pos.lots.push({
                    date: tx.date,
                    quantity: tx.quantity,
                    price: tx.price,
                    originalQuantity: tx.quantity,
                    originalPrice: tx.price
                });
            } else if (tx.action === 'SELL' || tx.action === 'TRANSFER_OUT') {
                // 賣出或轉出 (FIFO)
                console.log(`[Holdings] Processing ${tx.action}: ${tx.symbol} x ${tx.quantity}`);
                let remaining = tx.quantity;
                while (remaining > 0.0001 && pos.lots.length > 0) {
                    const lot = pos.lots[0];
                    if (lot.quantity <= remaining + 0.0001) {
                        remaining -= lot.quantity;
                        pos.quantity -= lot.quantity;
                        pos.totalCost -= lot.quantity * lot.price;
                        pos.lots.shift();
                    } else {
                        pos.totalCost -= remaining * lot.price;
                        lot.quantity -= remaining;
                        pos.quantity -= remaining;
                        remaining = 0;
                    }
                }
                console.log(`[Holdings] After ${tx.action}: ${tx.symbol} quantity = ${pos.quantity}`);
            } else if (tx.action === 'TRANSFER_IN') {
                // 轉入：類似買入但沒有價格，使用當前平均成本
                const price = pos.quantity > 0 ? pos.totalCost / pos.quantity : 0;
                pos.quantity += tx.quantity;
                pos.lots.push({
                    date: tx.date,
                    quantity: tx.quantity,
                    price: price,
                    originalQuantity: tx.quantity,
                    originalPrice: price
                });
            } else if (tx.action === 'SPLIT') {
                // 股票分割
                // tx.quantity 是分割後獲得的新股數
                // 需要計算分割比例

                const currentQuantity = pos.quantity;
                if (currentQuantity > 0) {
                    // 分割後總股數 = 現有股數 + 新獲得股數
                    const newTotalQuantity = currentQuantity + tx.quantity;
                    // 分割比例
                    const splitRatio = newTotalQuantity / currentQuantity;

                    console.log(`Stock Split: ${symbol}, ratio: ${splitRatio.toFixed(4)}, before: ${currentQuantity}, after: ${newTotalQuantity}`);

                    // 調整所有現有批次
                    for (const lot of pos.lots) {
                        // 股數乘以分割比例
                        lot.quantity *= splitRatio;
                        // 成本除以分割比例 (總成本不變，但每股成本降低)
                        lot.price /= splitRatio;
                    }

                    // 更新總量
                    pos.quantity = newTotalQuantity;
                    // 總成本不變，只是股數增加
                }
            }
        }

        // 轉換為陣列，過濾掉零持股
        return Object.values(positions)
            .filter(p => p.quantity > 0.0001)
            .map(p => ({
                symbol: p.symbol,
                quantity: p.quantity,
                avgCost: p.quantity > 0 ? p.totalCost / p.quantity : 0,
                totalCost: p.totalCost,
                lots: p.lots
            }));
    },

    /**
     * 計算已實現損益 (含股票分割調整)
     */
    calculateRealizedPnL(transactions) {
        const positions = {};
        let realizedPnL = 0;

        const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        for (const tx of sorted) {
            if (!['BUY', 'SELL', 'SPLIT'].includes(tx.action)) continue;

            const symbol = tx.symbol;
            if (!symbol) continue;

            if (!positions[symbol]) {
                positions[symbol] = [];
            }

            if (tx.action === 'BUY') {
                positions[symbol].push({
                    quantity: tx.quantity,
                    price: tx.price
                });
            } else if (tx.action === 'SELL') {
                let remaining = tx.quantity;
                while (remaining > 0.0001 && positions[symbol].length > 0) {
                    const lot = positions[symbol][0];
                    const sellQty = Math.min(remaining, lot.quantity);

                    // 計算這批的損益
                    realizedPnL += sellQty * (tx.price - lot.price);

                    if (lot.quantity <= remaining + 0.0001) {
                        remaining -= lot.quantity;
                        positions[symbol].shift();
                    } else {
                        lot.quantity -= remaining;
                        remaining = 0;
                    }
                }
                // 扣除手續費
                realizedPnL -= (tx.fees || 0);
            } else if (tx.action === 'SPLIT') {
                // 股票分割調整
                const lots = positions[symbol];
                if (lots && lots.length > 0) {
                    const currentQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
                    if (currentQuantity > 0) {
                        const newTotalQuantity = currentQuantity + tx.quantity;
                        const splitRatio = newTotalQuantity / currentQuantity;

                        for (const lot of lots) {
                            lot.quantity *= splitRatio;
                            lot.price /= splitRatio;
                        }
                    }
                }
            }
        }

        return realizedPnL;
    },

    /**
     * 計算總投入金額
     */
    calculateTotalInvested(transactions) {
        return transactions
            .filter(tx => tx.action === 'BUY')
            .reduce((sum, tx) => sum + (tx.amount || (tx.quantity * tx.price)) + (tx.fees || 0), 0);
    },

    /**
     * 計算 XIRR
     */
    calculateXIRR(transactions, currentValue) {
        const cashflows = [];

        for (const tx of transactions) {
            let amount = 0;

            if (tx.action === 'BUY') {
                // 買入為負現金流
                amount = -((tx.amount || (tx.quantity * tx.price)) + (tx.fees || 0));
            } else if (tx.action === 'SELL') {
                // 賣出為正現金流
                amount = (tx.amount || (tx.quantity * tx.price)) - (tx.fees || 0);
            } else if (tx.action === 'DIVIDEND') {
                // 股利為正現金流
                amount = tx.amount;
            } else {
                // SPLIT 等不影響現金流
                continue;
            }

            if (amount !== 0) {
                cashflows.push({
                    date: new Date(tx.date),
                    amount
                });
            }
        }

        // 加入目前價值
        if (currentValue > 0) {
            cashflows.push({
                date: new Date(),
                amount: currentValue
            });
        }

        return Finance.calculateXIRR(cashflows);
    },

    /**
     * 計算歷史報酬 (使用歷史價格 API)
     */
    async calculateHistoricalReturns(transactions, currentPrices, holdings = []) {
        const portfolioHistory = [];
        const monthlyReturns = [];

        if (transactions.length === 0) {
            return { portfolioHistory, monthlyReturns };
        }

        // 過濾出投資相關交易
        const investmentTx = transactions.filter(tx =>
            ['BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'TRANSFER_OUT', 'TRANSFER_IN'].includes(tx.action) &&
            tx.symbol && tx.symbol !== 'CASH' && tx.symbol !== 'TAX' && tx.symbol !== 'INTEREST'
        );

        const sorted = [...investmentTx].sort((a, b) => new Date(a.date) - new Date(b.date));
        const startDate = new Date(sorted[0].date);
        const endDate = new Date();

        // 取得所有持有過的股票
        const allSymbols = [...new Set(investmentTx.map(tx => tx.symbol))];
        console.log(`[Historical] 取得 ${allSymbols.length} 檔股票的歷史價格...`);

        // 批次取得歷史價格 (使用區間優化 Range Optimization)
        const historicalPrices = {};
        for (const symbol of allSymbols) {
            try {
                // 1. 找出該股票的首次買入日 (Min Date)
                const symbolTxs = sorted.filter(tx => tx.symbol === symbol);
                const firstTxDate = new Date(symbolTxs[0].date);

                // 2. 判斷目前是否持有 (從 Holdings 檢查)
                const isHeld = holdings.some(h => h.symbol === symbol && h.quantity > 0.0001);

                // 3. 決定結束日期
                let fetchEndDate = endDate;
                if (!isHeld) {
                    // 若已清倉，只抓到最後一次交易日
                    const lastTxDate = new Date(symbolTxs[symbolTxs.length - 1].date);
                    fetchEndDate = lastTxDate;
                    console.log(`[Range Opt] ${symbol} 已清倉，僅下載 ${firstTxDate.toISOString().slice(0, 10)} ~ ${fetchEndDate.toISOString().slice(0, 10)}`);
                } else {
                    console.log(`[Range Opt] ${symbol} 持有中，下載 ${firstTxDate.toISOString().slice(0, 10)} ~ Today`);
                }

                // 防呆：如果時間過短，至少抓一天
                if (fetchEndDate < firstTxDate) fetchEndDate = firstTxDate;

                const prices = await PriceService.getHistoricalPrices(symbol, firstTxDate, fetchEndDate);
                historicalPrices[symbol] = {};
                for (const p of prices) {
                    historicalPrices[symbol][p.date] = p.price;
                }

                // 若已清倉，且有最近的交易日，補上最後一筆價格延伸到今天嗎？
                // 不需要，因為持有量為 0，不會用到價格。

            } catch (error) {
                console.warn(`[Historical] ${symbol} 取得歷史價格失敗:`, error);
                historicalPrices[symbol] = {};
            }
        }

        // 調試：輸出各股票抓到的歷史價格筆數
        for (const [symbol, prices] of Object.entries(historicalPrices)) {
            const count = Object.keys(prices).length;
            const firstDate = Object.keys(prices)[0];
            const lastDate = Object.keys(prices).slice(-1)[0];
            console.log(`[Historical] ${symbol}: ${count} 筆歷史價格 (${firstDate} ~ ${lastDate})`);
        }
        // 計算分割調整倍數（用於將歷史持股調整為分割調整後的數量）
        const splitAdjustments = this.calculateSplitAdjustments(sorted, endDate);
        console.log('[Historical] 分割調整倍數:', splitAdjustments);

        // 準備完整交易列表 (包含所有類型，如 DEPOSIT/WITHDRAW)，用於計算現金
        const allTxSorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

        // 增量狀態
        let runningCash = 0;
        const runningHoldings = {}; // symbol -> quantity
        const lastKnownPrices = {}; // symbol -> price
        let txIndex = 0;

        let previousValue = 0;
        let previousMonth = -1;

        // 每日取樣 (跳過週末)
        const currentDate = new Date(startDate);

        // 校正起始現金與持股: 如果 StartDate 之前就有交易 (雖不應發生，因 StartDate 取自 sorted[0])
        // 但若 StartDate 是 Investment Start，而 Deposit 在更早?
        // sorted 是 investmentTx。 StartDate 是第一筆投資交易日。
        // 如果 Deposit 在 Investment 之前?
        // 為了安全，我們將 currentDate 設為 allTxSorted[0].date 和 startDate 的較小值?
        // 簡單起見，我們還是從 startDate 開始跑。
        // 但是必須先把 startDate 之前的交易處理完。

        while (txIndex < allTxSorted.length && new Date(allTxSorted[txIndex].date) < currentDate) {
            const tx = allTxSorted[txIndex];
            this.updateRunningState(runningHoldings, tx, (amount) => runningCash += amount);
            if (tx.price > 0 && tx.symbol) lastKnownPrices[tx.symbol] = tx.price;
            txIndex++;
        }

        while (currentDate <= endDate) {
            // 跳過週末 (週六=6, 週日=0)
            const dayOfWeek = currentDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }

            const dateStr = currentDate.toISOString().split('T')[0];

            // 處理當日及之前的交易 (增量更新)
            while (txIndex < allTxSorted.length && new Date(allTxSorted[txIndex].date) <= currentDate) {
                const tx = allTxSorted[txIndex];
                this.updateRunningState(runningHoldings, tx, (amount) => runningCash += amount);
                if (tx.price > 0 && tx.symbol) lastKnownPrices[tx.symbol] = tx.price;
                txIndex++;
            }

            // 計算當日股票市值
            let stockValue = 0;
            for (const [symbol, quantity] of Object.entries(runningHoldings)) {
                if (quantity <= 0.0001) continue;

                // 尋找價格 (優先使用歷史價格)
                let price = this.findClosestPrice(historicalPrices[symbol], dateStr);

                // 如果找到歷史價格，更新 lastKnownPrices（確保未交易日也能使用最新價格）
                if (price) {
                    lastKnownPrices[symbol] = price;
                } else {
                    // 降級: 使用最後已知價格
                    price = lastKnownPrices[symbol] || currentPrices[symbol] || 0;
                }

                // 分割調整量
                let adjustedQuantity = quantity;
                const adjustment = splitAdjustments[symbol];
                if (adjustment && currentDate < new Date(adjustment.splitDate)) {
                    adjustedQuantity = quantity * adjustment.ratio;
                    // 調試：顯示分割調整
                    if (dateStr.startsWith('2025-02') || dateStr.startsWith('2024-12')) {
                        console.log(`[Split Debug] ${dateStr} ${symbol}: qty=${quantity} -> adjusted=${adjustedQuantity} (ratio=${adjustment.ratio})`);
                    }
                }

                // 債券價格調整（僅適用於美股債券，排除台股 .TW 後綴，長度通常超過 5 碼）
                const isBond = /^\d/.test(symbol) && !symbol.toUpperCase().endsWith('.TW') && !symbol.toUpperCase().endsWith('.TWO') && symbol.length >= 6;
                if (isBond) price = price / 100;

                const val = adjustedQuantity * price;
                stockValue += val;

                // 調試：顯示市值計算
                if (dateStr.startsWith('2026-01')) {
                    console.log(`[Value Debug] ${dateStr} ${symbol}: qty=${adjustedQuantity.toFixed(0)}, price=${price.toFixed(2)}, val=${val.toFixed(0)}`);
                }

                if (dateStr === '2023-12-31' || dateStr === '2023-12-29') {
                    console.log(`[2023-12-31 Debug] ${symbol}: Qty=${adjustedQuantity.toFixed(2)}, Price=${price.toFixed(2)}, Val=${val.toFixed(2)}`);
                }
            }

            // 總資產 = 股票市值 + 現金餘額 (不小於 0)
            const totalValue = stockValue + Math.max(0, runningCash);

            if (dateStr === '2023-12-31' || dateStr === '2023-12-29') {
                console.log(`[2023-12-31 Debug] Cash=${runningCash.toFixed(2)}, Stock=${stockValue.toFixed(2)}, Total=${totalValue.toFixed(2)}`);
            }

            portfolioHistory.push({
                date: dateStr,
                value: totalValue
            });

            // 月度報酬計算
            const currentMonth = currentDate.getMonth();
            if (previousMonth !== currentMonth && previousValue > 0 && totalValue > 0) {
                // 若本月發生重大斷層(大於30%)，紀錄 log 排查
                const pctChange = (totalValue - previousValue) / previousValue;
                if (Math.abs(pctChange) > 0.3) {
                    console.log(`[Large PnL Change] ${dateStr} Value: ${previousValue.toFixed(0)} -> ${totalValue.toFixed(0)} (${(pctChange * 100).toFixed(2)}%)`);
                }
                monthlyReturns.push(pctChange);
                previousValue = totalValue;
            }
            if (previousValue === 0 && totalValue > 0) {
                previousValue = totalValue;
            }
            previousMonth = currentMonth;

            // 每日取樣
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return { portfolioHistory, monthlyReturns, historicalPrices };
    },

    /**
     * 更新增量狀態 (現金與持股)
     */
    updateRunningState(holdings, tx, updateCash) {
        // 更新現金
        switch (tx.action) {
            case 'DEPOSIT': updateCash(Math.abs(tx.amount || 0)); break;
            case 'WITHDRAW': updateCash(-Math.abs(tx.amount || 0)); break;
            case 'BUY':
                if (!tx.isTransfer) {
                    const amt = tx.amount ? Math.abs(tx.amount) : ((tx.quantity * tx.price) + (tx.fees || 0));
                    updateCash(-amt);
                }
                break;
            case 'SELL':
                if (!tx.isTransfer) {
                    const amt = tx.amount ? Math.abs(tx.amount) : ((tx.quantity * tx.price) - (tx.fees || 0));
                    updateCash(amt);
                }
                break;
            case 'CASH_TRANSFER': updateCash(tx.amount || 0); break;
            case 'DIVIDEND': updateCash(tx.amount || 0); break;
            case 'TAX': updateCash(tx.amount || 0); break;
            case 'INTEREST': updateCash(tx.amount || 0); break;
            case 'PROMOTIONAL': updateCash(tx.amount || 0); break;
        }

        // 更新持股 (僅數量)
        if (['BUY', 'SELL', 'SPLIT', 'TRANSFER_OUT', 'TRANSFER_IN'].includes(tx.action) && tx.symbol) {
            if (!holdings[tx.symbol]) holdings[tx.symbol] = 0;

            if (tx.action === 'BUY' || tx.action === 'TRANSFER_IN') {
                holdings[tx.symbol] += tx.quantity;
            } else if (tx.action === 'SELL' || tx.action === 'TRANSFER_OUT') {
                holdings[tx.symbol] -= tx.quantity;
            } else if (tx.action === 'SPLIT') {
                holdings[tx.symbol] += tx.quantity;
            }

            // 修正浮點數
            if (Math.abs(holdings[tx.symbol]) < 0.0001) delete holdings[tx.symbol];
        }
    },

    /**
     * 尋找最接近的歷史價格
     * 改進版：往前找最多 30 天，且返回找到的價格及其日期
     */
    findClosestPrice(priceMap, targetDate) {
        if (!priceMap) return null;

        // 先找精確匹配
        if (priceMap[targetDate]) {
            return priceMap[targetDate];
        }

        // 找最近的日期（往前找最多 30 天，涵蓋假日與休市）
        const target = new Date(targetDate);
        for (let i = 1; i <= 30; i++) {
            const checkDate = new Date(target);
            checkDate.setDate(target.getDate() - i);
            const checkStr = checkDate.toISOString().split('T')[0];
            if (priceMap[checkStr]) {
                return priceMap[checkStr];
            }
        }

        // 如果往前找不到，嘗試往後找（可能是資料集開始日期）
        for (let i = 1; i <= 7; i++) {
            const checkDate = new Date(target);
            checkDate.setDate(target.getDate() + i);
            const checkStr = checkDate.toISOString().split('T')[0];
            if (priceMap[checkStr]) {
                return priceMap[checkStr];
            }
        }

        return null;
    },

    /**
     * 計算分割調整倍數
     * @param {Array} transactions - 交易紀錄
     * @param {Date} endDate - 結束日期
     * @returns {Object} { symbol: { splitDate, ratio } }
     */
    calculateSplitAdjustments(transactions, endDate) {
        const adjustments = {};

        // 手動補丁: 針對 CSV 缺失但 Google Finance 已調整價格的分割
        // ratio: 分割後獲得的股數比例 (1:4 拆股 = ratio 4)
        const HARDCODED_SPLITS = {
            'SSO': { ratio: 2, splitDate: '2025-12-31' },
            'QLD': { ratio: 2, splitDate: '2025-11-20' },
            // 台股 ETF 分割 (2025/6/18 生效)
            '0050.TW': { ratio: 4, splitDate: '2025-06-18' },  // 0050 1:4 拆股
            '0056.TW': { ratio: 4, splitDate: '2025-06-18' },  // 0056 1:4 拆股
            '006208.TW': { ratio: 4, splitDate: '2025-06-18' } // 富邦台50 1:4 拆股
        };

        // 載入預設值
        for (const [sym, setting] of Object.entries(HARDCODED_SPLITS)) {
            adjustments[sym] = setting;
        }

        // 找出所有 SPLIT 交易 (覆蓋或確認)
        const splits = transactions.filter(tx => tx.action === 'SPLIT');

        for (const split of splits) {
            const symbol = split.symbol;
            if (!symbol) continue;

            // 計算分割前的持股數量
            const preSplitTxs = transactions.filter(tx =>
                tx.symbol === symbol &&
                new Date(tx.date) < new Date(split.date)
            );
            const preSplitHoldings = this.calculateHoldings(preSplitTxs);
            const preSplitQty = preSplitHoldings.find(h => h.symbol === symbol)?.quantity || 0;

            if (preSplitQty > 0) {
                // 分割比例 = (分割前數量 + 新增數量) / 分割前數量
                const ratio = (preSplitQty + split.quantity) / preSplitQty;
                adjustments[symbol] = {
                    splitDate: split.date,
                    ratio: ratio
                };
                console.log(`[Split] ${symbol}: ${preSplitQty} -> ${preSplitQty + split.quantity}, ratio=${ratio.toFixed(4)}`);
            }
        }

        return adjustments;
    },

    /**
     * 計算年度績效
     * @param {Array} transactions - 交易記錄
     * @param {Array} portfolioHistory - 資產走勢歷史
     * @param {Object} historicalPrices - 歷史價格
     * @param {number} currentNetWorth - 當前淨資產（確保當年期末正確）
     */
    calculateYearlyPerformance(transactions, portfolioHistory, historicalPrices, currentNetWorth = null) {
        if (!portfolioHistory || portfolioHistory.length === 0) return [];

        const years = {};
        const historyMap = new Map();
        portfolioHistory.forEach(p => historyMap.set(p.date, p.value));

        // 計算分割調整 (用於修正因為價格回溯調整導致的市值差異)
        // 使用目前日期作為結束日期，確保涵蓋所有 Split
        const splitAdjustments = this.calculateSplitAdjustments(transactions, new Date());

        // 找出年份範圍
        const startYear = new Date(portfolioHistory[0].date).getFullYear();
        const endYear = new Date().getFullYear();

        const yearlyStats = [];

        for (let year = startYear; year <= endYear; year++) {
            const startDateStr = `${year}-01-01`;
            const endDateStr = `${year}-12-31`;

            // 期初資產
            let startValue = 0;
            if (year > startYear) {
                const prevYearEnd = `${year - 1}-12-31`;
                startValue = this.findClosestValue(historyMap, prevYearEnd) || 0;
            }

            // 期末資產
            let endValue = 0;
            const todayYear = new Date().getFullYear();
            if (year === todayYear) {
                // 當年度使用即時淨資產值，確保與儀表板一致
                endValue = currentNetWorth !== null ? currentNetWorth : portfolioHistory[portfolioHistory.length - 1].value;
                console.log(`[Yearly] ${year} endValue: using currentNetWorth=${currentNetWorth}`);
            } else {
                endValue = this.findClosestValue(historyMap, endDateStr) || 0;
            }

            const yearTxs = transactions.filter(tx => {
                const y = new Date(tx.date).getFullYear();
                return y === year;
            });

            let netInflow = 0;
            const cashflows = [];

            // 加入期初
            if (startValue > 0) {
                cashflows.push({ date: new Date(startDateStr), amount: -startValue });
            }

            for (const tx of yearTxs) {
                let amount = 0;
                let isInflow = false;
                let isOutflow = false;

                if (tx.action === 'DEPOSIT') {
                    amount = Math.abs(tx.amount || 0);
                    isInflow = true;
                } else if (tx.action === 'WITHDRAW') {
                    amount = Math.abs(tx.amount || 0);
                    isOutflow = true;
                } else if (tx.action === 'TRANSFER_IN') {
                    if (tx.symbol) {
                        let price = 0;
                        if (historicalPrices && historicalPrices[tx.symbol]) {
                            price = this.findClosestPrice(historicalPrices[tx.symbol], tx.date) || 0;
                        }

                        let qty = tx.quantity;
                        // 檢查是否有 Split 調整
                        const adj = splitAdjustments[tx.symbol];
                        if (adj && new Date(tx.date) < new Date(adj.splitDate)) {
                            qty = tx.quantity * adj.ratio;
                        }
                        amount = qty * price;
                    } else {
                        // 現金移轉 (無 symbol)
                        amount = Math.abs(tx.amount || 0);
                    }
                    isInflow = true;
                } else if (tx.action === 'TRANSFER_OUT') {
                    if (tx.symbol) {
                        let price = 0;
                        if (historicalPrices && historicalPrices[tx.symbol]) {
                            price = this.findClosestPrice(historicalPrices[tx.symbol], tx.date) || 0;
                        }

                        let qty = tx.quantity;
                        // 檢查是否有 Split 調整
                        const adj = splitAdjustments[tx.symbol];
                        if (adj && new Date(tx.date) < new Date(adj.splitDate)) {
                            qty = tx.quantity * adj.ratio;
                        }
                        amount = qty * price;
                    } else {
                        // 現金移轉 (無 symbol)
                        amount = Math.abs(tx.amount || 0);
                        if (amount === 0 && tx.quantity > 0) amount = tx.quantity;
                    }
                    isOutflow = true;
                } else if (tx.action === 'CASH_TRANSFER') {
                    amount = Math.abs(tx.amount || 0);
                    if ((tx.amount || 0) > 0) {
                        isInflow = true;
                    } else {
                        isOutflow = true;
                    }
                }

                if (isInflow) {
                    netInflow += amount;
                    cashflows.push({ date: new Date(tx.date), amount: -amount });
                } else if (isOutflow) {
                    netInflow -= amount;
                    cashflows.push({ date: new Date(tx.date), amount: amount });
                }
            }

            // 加入期末
            if (endValue > 0) {
                const d = year === todayYear ? new Date() : new Date(endDateStr);
                cashflows.push({ date: d, amount: endValue });
            }

            const profit = endValue - startValue - netInflow;
            const returnPct = Finance.calculateXIRR(cashflows);

            yearlyStats.push({
                year,
                startValue,
                netInflow,
                profit,
                returnPct,
                endValue
            });
        }

        return yearlyStats.sort((a, b) => b.year - a.year); // 倒序
    },

    /**
     * 尋找最近日期的數值 (往前找)
     */
    findClosestValue(historyMap, dateStr) {
        if (historyMap.has(dateStr)) return historyMap.get(dateStr);

        // 往前找最多 30 天 (涵蓋週末或休市)
        const target = new Date(dateStr);
        for (let i = 1; i <= 30; i++) {
            const d = new Date(target);
            d.setDate(d.getDate() - i);
            const s = d.toISOString().split('T')[0];
            if (historyMap.has(s)) return historyMap.get(s);
        }
        return null;
    },

    /**
     * 產生資產配置資料
     */
    generateAllocationData(holdings, groupBy = 'symbol') {
        if (groupBy === 'symbol') {
            const sorted = [...holdings].sort((a, b) => b.marketValue - a.marketValue);
            return {
                labels: sorted.map(h => h.symbol),
                values: sorted.map(h => h.marketValue)
            };
        }

        return {
            labels: holdings.map(h => h.symbol),
            values: holdings.map(h => h.marketValue)
        };
    }
};

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Dashboard;
}

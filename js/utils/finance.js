/**
 * Portfolio Tracker - 財務計算工具
 * 包含 XIRR, TWRR, Sharpe Ratio, MDD, Beta 等核心演算法
 */

const Finance = {
    /**
     * 計算 XIRR (擴展內部報酬率)
     * 使用 Newton-Raphson 迭代法求解
     * 
     * @param {Array<{date: Date, amount: number}>} cashflows - 現金流陣列
     * @returns {number} 年化報酬率
     */
    calculateXIRR(cashflows) {
        if (!cashflows || cashflows.length < 2) {
            return 0;
        }

        // 確保有正負現金流
        const hasPositive = cashflows.some(cf => cf.amount > 0);
        const hasNegative = cashflows.some(cf => cf.amount < 0);
        if (!hasPositive || !hasNegative) {
            return 0;
        }

        const sortedFlows = [...cashflows].sort((a, b) => a.date - b.date);
        const firstDate = sortedFlows[0].date;

        // 計算每個現金流距離第一天的年數
        const yearFractions = sortedFlows.map(cf => {
            const days = (cf.date - firstDate) / (1000 * 60 * 60 * 24);
            return days / 365;
        });

        // NPV 函數
        const npv = (rate) => {
            return sortedFlows.reduce((sum, cf, i) => {
                return sum + cf.amount / Math.pow(1 + rate, yearFractions[i]);
            }, 0);
        };

        // NPV 導數
        const npvDerivative = (rate) => {
            return sortedFlows.reduce((sum, cf, i) => {
                if (yearFractions[i] === 0) return sum;
                return sum - yearFractions[i] * cf.amount / Math.pow(1 + rate, yearFractions[i] + 1);
            }, 0);
        };

        // Newton-Raphson 迭代
        let rate = 0.1; // 初始猜測 10%
        const maxIterations = 100;
        const tolerance = 1e-7;

        for (let i = 0; i < maxIterations; i++) {
            const npvValue = npv(rate);
            const derivativeValue = npvDerivative(rate);

            if (Math.abs(derivativeValue) < tolerance) {
                break;
            }

            const newRate = rate - npvValue / derivativeValue;

            if (Math.abs(newRate - rate) < tolerance) {
                return newRate;
            }

            rate = newRate;

            // 防止發散
            if (rate < -0.99) rate = -0.99;
            if (rate > 10) rate = 10;
        }

        return rate;
    },

    /**
     * 計算 TWRR (時間加權報酬率)
     * 
     * @param {Array<{startValue: number, endValue: number, cashflow: number}>} periods - 期間陣列
     * @returns {number} 時間加權報酬率
     */
    calculateTWRR(periods) {
        if (!periods || periods.length === 0) {
            return 0;
        }

        let cumulativeReturn = 1;

        for (const period of periods) {
            // 調整後的期初價值 = 期初價值 + 現金流入
            const adjustedStartValue = period.startValue + (period.cashflow > 0 ? period.cashflow : 0);

            if (adjustedStartValue <= 0) continue;

            // 期間報酬率
            const periodReturn = (period.endValue - adjustedStartValue) / adjustedStartValue;
            cumulativeReturn *= (1 + periodReturn);
        }

        return cumulativeReturn - 1;
    },

    /**
     * 計算年化報酬率
     * 
     * @param {number} totalReturn - 總報酬率
     * @param {number} years - 年數
     * @returns {number} 年化報酬率
     */
    annualizeReturn(totalReturn, years) {
        if (years <= 0) return 0;
        return Math.pow(1 + totalReturn, 1 / years) - 1;
    },

    /**
     * 計算夏普值 (Sharpe Ratio)
     * 
     * @param {Array<number>} returns - 報酬率陣列 (每期報酬)
     * @param {number} riskFreeRate - 無風險利率 (年化)
     * @param {number} periodsPerYear - 每年的期數 (日報酬=252, 月報酬=12)
     * @returns {number} 夏普值
     */
    calculateSharpe(returns, riskFreeRate = 0.05, periodsPerYear = 252) {
        if (!returns || returns.length < 2) {
            return 0;
        }

        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = this.calculateStdDev(returns);

        if (stdDev === 0) return 0;

        // 年化
        const annualizedReturn = avgReturn * periodsPerYear;
        const annualizedStdDev = stdDev * Math.sqrt(periodsPerYear);

        return (annualizedReturn - riskFreeRate) / annualizedStdDev;
    },

    /**
     * 計算標準差
     * 
     * @param {Array<number>} values - 數值陣列
     * @returns {number} 標準差
     */
    calculateStdDev(values) {
        if (!values || values.length < 2) {
            return 0;
        }

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);

        return Math.sqrt(variance);
    },

    /**
     * 計算最大回撤 (Maximum Drawdown)
     * 
     * @param {Array<number>} portfolioValues - 投資組合價值陣列 (時間序列)
     * @returns {number} 最大回撤 (負數百分比)
     */
    calculateMDD(portfolioValues) {
        if (!portfolioValues || portfolioValues.length < 2) {
            return 0;
        }

        let maxDrawdown = 0;
        let peak = portfolioValues[0];

        for (const value of portfolioValues) {
            if (value > peak) {
                peak = value;
            }

            const drawdown = (value - peak) / peak;
            if (drawdown < maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        return maxDrawdown;
    },

    /**
     * 計算 Beta 值
     * 
     * @param {Array<number>} stockReturns - 個股報酬率陣列
     * @param {Array<number>} marketReturns - 大盤報酬率陣列
     * @returns {number} Beta 值
     */
    calculateBeta(stockReturns, marketReturns) {
        if (!stockReturns || !marketReturns ||
            stockReturns.length < 2 ||
            stockReturns.length !== marketReturns.length) {
            return 1; // 預設 Beta = 1
        }

        const n = stockReturns.length;
        const avgStock = stockReturns.reduce((a, b) => a + b, 0) / n;
        const avgMarket = marketReturns.reduce((a, b) => a + b, 0) / n;

        let covariance = 0;
        let marketVariance = 0;

        for (let i = 0; i < n; i++) {
            const stockDiff = stockReturns[i] - avgStock;
            const marketDiff = marketReturns[i] - avgMarket;
            covariance += stockDiff * marketDiff;
            marketVariance += marketDiff * marketDiff;
        }

        if (marketVariance === 0) return 1;

        return covariance / marketVariance;
    },

    /**
     * 計算未實現損益
     * 
     * @param {number} quantity - 股數
     * @param {number} avgCost - 平均成本
     * @param {number} currentPrice - 現價
     * @returns {{amount: number, percentage: number}} 損益金額與百分比
     */
    calculateUnrealizedPnL(quantity, avgCost, currentPrice) {
        const costBasis = quantity * avgCost;
        const marketValue = quantity * currentPrice;
        const amount = marketValue - costBasis;
        const percentage = costBasis > 0 ? amount / costBasis : 0;

        return { amount, percentage };
    },

    /**
     * 計算已實現損益
     * 
     * @param {number} quantity - 賣出股數
     * @param {number} avgCost - 平均成本
     * @param {number} sellPrice - 賣出價格
     * @param {number} fees - 手續費
     * @returns {{amount: number, percentage: number}} 損益金額與百分比
     */
    calculateRealizedPnL(quantity, avgCost, sellPrice, fees = 0) {
        const costBasis = quantity * avgCost;
        const proceeds = quantity * sellPrice - fees;
        const amount = proceeds - costBasis;
        const percentage = costBasis > 0 ? amount / costBasis : 0;

        return { amount, percentage };
    },

    /**
     * 使用 FIFO 計算平均成本
     * 
     * @param {Array<{quantity: number, price: number}>} lots - 買進批次
     * @returns {number} 平均成本
     */
    calculateAvgCostFIFO(lots) {
        if (!lots || lots.length === 0) return 0;

        let totalQuantity = 0;
        let totalCost = 0;

        for (const lot of lots) {
            totalQuantity += lot.quantity;
            totalCost += lot.quantity * lot.price;
        }

        return totalQuantity > 0 ? totalCost / totalQuantity : 0;
    },

    /**
     * 格式化貨幣
     * 
     * @param {number} value - 數值
     * @param {string} currency - 貨幣代碼
     * @returns {string} 格式化字串
     */
    formatCurrency(value, currency = 'USD') {
        const formatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return formatter.format(value);
    },

    /**
     * 格式化百分比
     * 
     * @param {number} value - 數值 (0.15 = 15%)
     * @param {number} decimals - 小數位數
     * @returns {string} 格式化字串
     */
    formatPercentage(value, decimals = 2) {
        const sign = value >= 0 ? '+' : '';
        return `${sign}${(value * 100).toFixed(decimals)}%`;
    },

    /**
     * 格式化數字
     * 
     * @param {number} value - 數值
     * @param {number} decimals - 小數位數
     * @returns {string} 格式化字串
     */
    formatNumber(value, decimals = 2) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(value);
    }
};

// 匯出 (若使用 ES Modules)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Finance;
}

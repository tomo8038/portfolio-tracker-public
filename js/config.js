/**
 * Portfolio Tracker - 應用程式設定 (輕量化版)
 * 移除所有 Google 相關設定，純本地運作
 */

const CONFIG = {
    // 快取設定
    CACHE_TTL: 5 * 60 * 1000, // 5 分鐘 (毫秒)
    CACHE_PREFIX: 'portfolio_tracker_',

    // 預設設定
    DEFAULTS: {
        colorScheme: 'us', // 'us' 美股 (綠漲紅跌) | 'tw' 台股 (紅漲綠跌)
        currency: 'USD',
        benchmark: '^GSPC', // S&P 500
        riskFreeRate: 0.05 // 5% 無風險利率 (用於夏普值計算)
    },

    // 交易類型
    TRANSACTION_TYPES: {
        BUY: '買入',
        SELL: '賣出',
        DIVIDEND: '股利',
        SPLIT: '分割',
        TAX: '稅務',
        DEPOSIT: '匯入',
        WITHDRAW: '匯出',
        INTEREST: '利息'
    },

    // 圖表顏色
    CHART_COLORS: {
        portfolio: '#6366f1',
        benchmark: '#64748b',
        palette: [
            '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
            '#ec4899', '#f43f5e', '#f97316', '#eab308',
            '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
            '#0ea5e9', '#3b82f6'
        ]
    }
};

// 凍結設定物件，防止意外修改
Object.freeze(CONFIG);
Object.freeze(CONFIG.DEFAULTS);
Object.freeze(CONFIG.TRANSACTION_TYPES);
Object.freeze(CONFIG.CHART_COLORS);

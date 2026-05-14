/**
 * Portfolio Tracker - 股價服務 (輕量化版)
 * 使用免費公開 API 取得股價，不需任何認證
 * - Yahoo Finance (透過 public query endpoint)
 * - 備援: 使用快取中的最後已知價格
 */

const PriceService = {
    priceCache: new Map(),
    pendingRequests: new Map(),

    /**
     * 將代號轉換為 Yahoo Finance 格式
     * @param {string} symbol - 股票代號
     * @returns {string} Yahoo Finance 格式的代號
     */
    normalizeSymbol(symbol) {
        if (!symbol) return symbol;
        // 台股代號已經是 Yahoo 格式 (e.g. 0050.TW)
        return symbol.toUpperCase();
    },

    /**
     * 取得單一股票現價
     * @param {string} symbol - 股票代號
     * @returns {Promise<number>} 股價
     */
    async getPrice(symbol) {
        // 檢查記憶體快取
        const cached = this.priceCache.get(symbol);
        if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
            return cached.price;
        }

        // 檢查 LocalStorage 快取
        const lsCached = CacheService.localStorage.get(`price_${symbol}`);
        if (lsCached) {
            this.priceCache.set(symbol, { price: lsCached, timestamp: Date.now() });
            return lsCached;
        }

        // 透過公開 API 取得價格
        return await this.fetchPrice(symbol);
    },

    /**
     * 批次取得多檔股價
     * @param {Array<string>} symbols - 股票代號陣列
     * @returns {Promise<Object>} { symbol: price }
     */
    async getPrices(symbols) {
        const uniqueSymbols = [...new Set(symbols)];
        const results = {};
        const toFetch = [];

        // 檢查快取
        for (const symbol of uniqueSymbols) {
            const cached = this.priceCache.get(symbol);
            if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
                results[symbol] = cached.price;
            } else {
                const lsCached = CacheService.localStorage.get(`price_${symbol}`);
                if (lsCached) {
                    results[symbol] = lsCached;
                    this.priceCache.set(symbol, { price: lsCached, timestamp: Date.now() });
                } else {
                    toFetch.push(symbol);
                }
            }
        }

        // 批次取得未快取的股價
        if (toFetch.length > 0) {
            const fetched = await this.fetchPricesBatch(toFetch);
            Object.assign(results, fetched);
        }

        return results;
    },

    /**
     * 透過公開 API 取得單一股價
     * 使用多個 CORS proxy 備援
     */
    async fetchPrice(symbol) {
        if (this.pendingRequests.has(symbol)) {
            return await this.pendingRequests.get(symbol);
        }

        const promise = (async () => {
            try {
                const price = await this.fetchFromYahoo(symbol);
                if (price > 0) {
                    this.priceCache.set(symbol, { price, timestamp: Date.now() });
                    CacheService.localStorage.set(`price_${symbol}`, price);
                    return price;
                }
                return 0;
            } finally {
                this.pendingRequests.delete(symbol);
            }
        })();

        this.pendingRequests.set(symbol, promise);
        return promise;
    },

    /**
     * 批次取得股價
     */
    async fetchPricesBatch(symbols) {
        const results = {};

        // 並行請求，但限制並發數
        const batchSize = 3;
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const promises = batch.map(async (symbol) => {
                try {
                    const price = await this.fetchFromYahoo(symbol);
                    results[symbol] = price || 0;
                    if (price > 0) {
                        this.priceCache.set(symbol, { price, timestamp: Date.now() });
                        CacheService.localStorage.set(`price_${symbol}`, price);
                    }
                } catch (e) {
                    console.warn(`取得 ${symbol} 股價失敗:`, e.message);
                    results[symbol] = 0;
                }
            });
            await Promise.all(promises);
            // 批次間加入延遲避免被擋
            if (i + batchSize < symbols.length) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        return results;
    },

    /**
     * 使用多個 CORS proxy 輪詢請求
     */
    async fetchWithProxies(targetUrl) {
        // 若在本地伺服器執行 (透過 server.js)，優先使用本地 Proxy
        const isLocalServer = window.location.protocol === 'http:' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

        // 請在此填寫您剛建立好的 Cloudflare Worker 網址
        // 例如: const CLOUDFLARE_WORKER_URL = 'https://yahoo-proxy.yourname.workers.dev';
        const CLOUDFLARE_WORKER_URL = 'https://proxy-worker.tomo305312.workers.dev/';

        let proxies = [];

        if (isLocalServer) {
            // 從 https://query1.finance.yahoo.com/v8/finance/chart/... 擷取路徑
            const urlObj = new URL(targetUrl);
            const proxyPath = `/proxy/yahoo${urlObj.pathname}${urlObj.search}`;
            proxies.push(proxyPath);
        } else if (CLOUDFLARE_WORKER_URL) {
            // 雲端 Worker Proxy 模式
            const urlObj = new URL(targetUrl);
            const proxyUrl = CLOUDFLARE_WORKER_URL.replace(/\/$/, '') + urlObj.pathname + urlObj.search;
            proxies.push(proxyUrl);
        }

        // 備用公共代理 (目前多數已被 Yahoo 封鎖)
        proxies.push(
            `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
        );

        let lastError;
        for (const proxyUrl of proxies) {
            try {
                const controller = new AbortController();
                // 30 秒超時 (因為歷史股價查詢可能較慢)
                const timeoutId = setTimeout(() => controller.abort(), 30000);

                const response = await fetch(proxyUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const text = await response.text();
                    try {
                        const json = JSON.parse(text);
                        // 處理 allorigins 的 get endpoint 格式
                        if (proxyUrl.includes('allorigins.win/get') && json.contents) {
                            return JSON.parse(json.contents);
                        }
                        return json;
                    } catch (e) {
                        throw new Error("Invalid JSON response from proxy");
                    }
                }
            } catch (e) {
                lastError = e;
                console.warn(`Proxy failed: ${proxyUrl}`, e.message);
                // 失敗後延遲一下再試下一個
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        throw lastError || new Error("All proxies failed");
    },

    /**
     * 從 Yahoo Finance 公開 API 取得股價
     */
    async fetchFromYahoo(symbol) {
        try {
            const yahooSymbol = this.normalizeSymbol(symbol);
            const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;

            const data = await this.fetchWithProxies(targetUrl);
            const meta = data.chart?.result?.[0]?.meta;
            if (meta?.regularMarketPrice) {
                return meta.regularMarketPrice;
            }

            return 0;
        } catch (error) {
            console.warn(`Yahoo Finance API 全部失敗 (${symbol}):`, error.message);

            // 回傳快取中的最後已知價格 (如果有)
            try {
                const lastKnown = CacheService.localStorage.get(`price_${symbol}`);
                if (lastKnown) {
                    console.log(`使用 ${symbol} 的最後已知快取價格: ${lastKnown}`);
                    return lastKnown;
                }
            } catch (e) { }

            return 0;
        }
    },

    /**
     * 取得歷史股價 (用於圖表)
     * 使用 Yahoo Finance chart API
     * @param {string} symbol - 股票代號
     * @param {Date} startDate - 開始日期
     * @param {Date} endDate - 結束日期
     * @returns {Promise<Array<{date: string, price: number}>>}
     */
    async getHistoricalPrices(symbol, startDate, endDate) {
        const cacheKey = `hist_${symbol}_${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`;
        const cached = CacheService.localStorage.get(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            const yahooSymbol = this.normalizeSymbol(symbol);
            const period1 = Math.floor(startDate.getTime() / 1000);
            const period2 = Math.floor(endDate.getTime() / 1000);

            const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=1d`;

            const data = await this.fetchWithProxies(targetUrl);
            const result = data.chart?.result?.[0];
            if (!result) return [];

            const timestamps = result.timestamp || [];
            const closes = result.indicators?.quote?.[0]?.close || [];

            const prices = [];
            for (let i = 0; i < timestamps.length; i++) {
                if (closes[i] != null) {
                    const date = new Date(timestamps[i] * 1000);
                    prices.push({
                        date: date.toISOString().split('T')[0],
                        price: closes[i]
                    });
                }
            }

            // 快取結果
            CacheService.localStorage.set(cacheKey, prices, CONFIG.CACHE_TTL * 2);

            return prices;
        } catch (error) {
            console.error('取得歷史股價失敗:', error);
            return [];
        }
    },

    /**
     * 解析日期格式 (保留相容性)
     */
    parseGoogleDate(dateValue) {
        if (typeof dateValue === 'number') {
            const date = new Date((dateValue - 25569) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }

        if (typeof dateValue === 'string') {
            const yyyymmdd = dateValue.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
            if (yyyymmdd) {
                const [, year, month, day] = yyyymmdd;
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }

            const mmddyyyy = dateValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (mmddyyyy) {
                const [, month, day, year] = mmddyyyy;
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }

            const date = new Date(dateValue);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
        }

        return '';
    },

    /**
     * 延遲函數
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * 清除價格快取
     */
    clearCache() {
        this.priceCache.clear();
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.includes('price_')) {
                localStorage.removeItem(key);
            }
        }
    }
};

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PriceService;
}

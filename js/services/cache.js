/**
 * Portfolio Tracker - 快取服務
 * 使用 LocalStorage + IndexedDB 實現本地快取
 */

const CacheService = {
    DB_NAME: 'PortfolioTrackerDB',
    DB_VERSION: 1,
    STORE_NAME: 'cache',
    db: null,

    /**
     * 初始化 IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // 建立快取儲存區
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
                }

                // 建立交易儲存區
                if (!db.objectStoreNames.contains('transactions')) {
                    const txStore = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
                    txStore.createIndex('date', 'date', { unique: false });
                    txStore.createIndex('symbol', 'symbol', { unique: false });
                }

                // 建立持股儲存區
                if (!db.objectStoreNames.contains('holdings')) {
                    db.createObjectStore('holdings', { keyPath: 'symbol' });
                }
            };
        });
    },

    /**
     * LocalStorage 快取 (適合小資料，如 API 回應)
     */
    localStorage: {
        /**
         * 設定快取
         * @param {string} key - 鍵
         * @param {any} value - 值
         * @param {number} ttl - 存活時間 (毫秒)
         */
        set(key, value, ttl = CONFIG.CACHE_TTL) {
            const item = {
                value,
                expiry: Date.now() + ttl
            };
            try {
                localStorage.setItem(CONFIG.CACHE_PREFIX + key, JSON.stringify(item));
            } catch (e) {
                console.warn('LocalStorage 寫入失敗:', e);
            }
        },

        /**
         * 取得快取
         * @param {string} key - 鍵
         * @returns {any} 值或 null
         */
        get(key) {
            try {
                const itemStr = localStorage.getItem(CONFIG.CACHE_PREFIX + key);
                if (!itemStr) return null;

                const item = JSON.parse(itemStr);
                if (Date.now() > item.expiry) {
                    localStorage.removeItem(CONFIG.CACHE_PREFIX + key);
                    return null;
                }
                return item.value;
            } catch (e) {
                return null;
            }
        },

        /**
         * 刪除快取
         * @param {string} key - 鍵
         */
        remove(key) {
            localStorage.removeItem(CONFIG.CACHE_PREFIX + key);
        },

        /**
         * 清除所有快取
         */
        clear() {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(CONFIG.CACHE_PREFIX)) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
        },

        /**
         * 取得快取大小
         * @returns {number} 大小 (bytes)
         */
        getSize() {
            let size = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(CONFIG.CACHE_PREFIX)) {
                    size += localStorage.getItem(key).length * 2; // UTF-16
                }
            }
            return size;
        }
    },

    /**
     * IndexedDB 操作 (適合大量資料)
     */
    indexedDB: {
        /**
         * 儲存交易紀錄
         * @param {Array<Object>} transactions - 交易陣列
         */
        async saveTransactions(transactions) {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction('transactions', 'readwrite');
                const store = tx.objectStore('transactions');

                // 清除現有資料
                store.clear();

                // 批次寫入
                for (const transaction of transactions) {
                    store.add(transaction);
                }

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        },

        /**
         * 取得所有交易紀錄
         * @returns {Promise<Array<Object>>} 交易陣列
         */
        async getTransactions() {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction('transactions', 'readonly');
                const store = tx.objectStore('transactions');
                const request = store.getAll();

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * 新增單筆交易
         * @param {Object} transaction - 交易紀錄
         * @returns {Promise<number>} 新增的 ID
         */
        async addTransaction(transaction) {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction('transactions', 'readwrite');
                const store = tx.objectStore('transactions');
                const request = store.add(transaction);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * 刪除交易
         * @param {number} id - 交易 ID
         */
        async deleteTransaction(id) {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction('transactions', 'readwrite');
                const store = tx.objectStore('transactions');
                const request = store.delete(id);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * 儲存持股資料
         * @param {Array<Object>} holdings - 持股陣列
         */
        async saveHoldings(holdings) {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction('holdings', 'readwrite');
                const store = tx.objectStore('holdings');

                store.clear();

                for (const holding of holdings) {
                    store.put(holding);
                }

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        },

        /**
         * 取得持股資料
         * @returns {Promise<Array<Object>>} 持股陣列
         */
        async getHoldings() {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction('holdings', 'readonly');
                const store = tx.objectStore('holdings');
                const request = store.getAll();

                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * 清除所有 IndexedDB 資料
         */
        async clear() {
            if (!CacheService.db) await CacheService.init();

            return new Promise((resolve, reject) => {
                const tx = CacheService.db.transaction(['transactions', 'holdings'], 'readwrite');

                tx.objectStore('transactions').clear();
                tx.objectStore('holdings').clear();

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
    },

    /**
     * 使用者設定存取
     */
    settings: {
        /**
         * 儲存設定
         * @param {Object} settings - 設定物件
         */
        save(settings) {
            localStorage.setItem(CONFIG.CACHE_PREFIX + 'settings', JSON.stringify(settings));
        },

        /**
         * 取得設定
         * @returns {Object} 設定物件
         */
        get() {
            try {
                const stored = localStorage.getItem(CONFIG.CACHE_PREFIX + 'settings');
                return stored ? JSON.parse(stored) : { ...CONFIG.DEFAULTS };
            } catch {
                return { ...CONFIG.DEFAULTS };
            }
        },

        /**
         * 更新單一設定
         * @param {string} key - 設定鍵
         * @param {any} value - 設定值
         */
        set(key, value) {
            const settings = this.get();
            settings[key] = value;
            this.save(settings);
        }
    },

    /**
     * 清除所有快取資料
     */
    async clearAll() {
        this.localStorage.clear();
        await this.indexedDB.clear();
    },

    /**
     * 取得總快取大小
     * @returns {string} 格式化後的大小
     */
    getTotalSize() {
        const bytes = this.localStorage.getSize();
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
};

// 初始化
CacheService.init().catch(console.error);

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CacheService;
}

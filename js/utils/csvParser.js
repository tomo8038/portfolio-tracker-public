/**
 * Portfolio Tracker - CSV 解析器
 * 支援 Firstrade, Charles Schwab, Interactive Brokers, 複委託 (元大/富邦)
 * 
 * 特別針對 Schwab 格式優化，支援：
 * - Buy/Sell 買賣交易
 * - Reinvest Shares 股利再投資 (視為買入)
 * - Reinvest Dividend / Cash Dividend / Qualified Dividend 股利收入
 * - Stock Split 股票分割
 * - NRA Tax Adj / Foreign Tax Paid 稅務扣款
 * - Wire Received/Sent 現金匯入匯出
 * - Security Transfer / Journal 內部轉移
 */

const CSVParser = {
    /**
     * 解析 CSV 字串
     */
    parseCSV(csvText) {
        const lines = [];
        let currentLine = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i++) {
            const char = csvText[i];
            const nextChar = csvText[i + 1];

            if (inQuotes) {
                if (char === '"') {
                    if (nextChar === '"') {
                        currentField += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    currentField += char;
                }
            } else {
                if (char === '"') {
                    inQuotes = true;
                } else if (char === ',') {
                    currentLine.push(currentField.trim());
                    currentField = '';
                } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
                    currentLine.push(currentField.trim());
                    if (currentLine.some(f => f !== '')) {
                        lines.push(currentLine);
                    }
                    currentLine = [];
                    currentField = '';
                    if (char === '\r') i++;
                } else if (char !== '\r') {
                    currentField += char;
                }
            }
        }

        if (currentField || currentLine.length > 0) {
            currentLine.push(currentField.trim());
            if (currentLine.some(f => f !== '')) {
                lines.push(currentLine);
            }
        }

        return lines;
    },

    /**
     * 自動偵測券商格式
     */
    detectBroker(headers) {
        const headerStr = headers.join(',').toLowerCase();

        // Schwab 格式: Date,Action,Symbol,Description,Quantity,Price,Fees & Comm,Amount
        if (headerStr.includes('date') && headerStr.includes('action') &&
            headerStr.includes('fees & comm')) {
            return 'schwab';
        }

        if (headerStr.includes('symbol') && headerStr.includes('action') && headerStr.includes('quantity')) {
            if (headerStr.includes('description') && headerStr.includes('commission')) {
                return 'firstrade';
            }
            return 'schwab';
        }

        if (headerStr.includes('transaction history') && headerStr.includes('transaction type')) {
            return 'ibkr';
        }

        if (headerStr.includes('tradedate') || headerStr.includes('trade date') || headerStr.includes('date/time')) {
            if (headerStr.includes('buy/sell') || headerStr.includes('buysell') || headerStr.includes('side')) {
                return 'ibkr';
            }
        }

        if (headerStr.includes('交易日期') || headerStr.includes('股票代號')) {
            if (headerStr.includes('元大') || headerStr.includes('yuanta')) {
                return 'tw-yuanta';
            }
            if (headerStr.includes('富邦') || headerStr.includes('fubon')) {
                return 'tw-fubon';
            }
            return 'tw-yuanta';
        }

        // 永豐台股格式: 成交日,商品,買賣,...
        if (headerStr.includes('成交日') && headerStr.includes('商品') && headerStr.includes('買賣')) {
            return 'tw-sinopac';
        }

        return 'schwab'; // 預設使用 Schwab 格式
    },

    /**
     * Schwab 交易類型對應表
     */
    schwabActionTypes: {
        // 買入類
        'buy': { action: 'BUY', category: 'trade' },
        'reinvest shares': { action: 'BUY', category: 'reinvest' },

        // 賣出類
        'sell': { action: 'SELL', category: 'trade' },

        // 股利類 (現金收入)
        'reinvest dividend': { action: 'DIVIDEND', category: 'dividend' },
        'cash dividend': { action: 'DIVIDEND', category: 'dividend' },
        'qualified dividend': { action: 'DIVIDEND', category: 'dividend' },
        'qual div reinvest': { action: 'DIVIDEND', category: 'dividend' },
        'special dividend': { action: 'DIVIDEND', category: 'dividend' },
        'long term cap gain reinvest': { action: 'DIVIDEND', category: 'dividend' },

        // 股票分割
        'stock split': { action: 'SPLIT', category: 'corporate' },

        // 稅務
        'nra tax adj': { action: 'TAX', category: 'tax' },
        'foreign tax paid': { action: 'TAX', category: 'tax' },

        // 現金流
        'wire received': { action: 'DEPOSIT', category: 'cash' },
        'wire sent': { action: 'WITHDRAW', category: 'cash' },
        'credit interest': { action: 'INTEREST', category: 'cash' },
        'cash in lieu': { action: 'CASH_IN_LIEU', category: 'cash' },

        // 轉移 (需要處理)
        'journal': { action: 'TRANSFER', category: 'transfer' },
        'security transfer': { action: 'SECURITY_TRANSFER', category: 'transfer' },

        // 其他
        'promotional award': { action: 'PROMOTIONAL', category: 'other' },
        'service fee': { action: 'FEE', category: 'other' },
        'misc cash entry': { action: 'MISC_CASH', category: 'cash' },
        'adr mgmt fee': { action: 'FEE', category: 'other' }
    },

    /**
     * 解析 Schwab 交易類型
     */
    parseSchwabAction(actionStr) {
        const actionLower = (actionStr || '').toLowerCase().trim();

        // 優先精確匹配
        if (this.schwabActionTypes[actionLower]) {
            return this.schwabActionTypes[actionLower];
        }

        // 部分匹配
        for (const [key, value] of Object.entries(this.schwabActionTypes)) {
            if (actionLower.includes(key) || key.includes(actionLower)) {
                return value;
            }
        }

        return { action: 'UNKNOWN', category: 'unknown' };
    },

    /**
     * 解析通用交易動作
     */
    parseAction(action) {
        const actionLower = (action || '').toLowerCase().trim();

        // 買入
        if (actionLower === 'buy' || actionLower.includes('reinvest shares') ||
            actionLower.includes('bought') || actionLower.includes('購') ||
            actionLower.includes('買') || actionLower === 'b' || actionLower === 'bot') {
            return 'BUY';
        }

        // 賣出
        if (actionLower === 'sell' || actionLower.includes('sold') ||
            actionLower.includes('賣') || actionLower.includes('售') ||
            actionLower === 's' || actionLower === 'sld') {
            return 'SELL';
        }

        // 股利
        if (actionLower.includes('dividend') || actionLower.includes('div') ||
            actionLower.includes('股利') || actionLower.includes('配息')) {
            return 'DIVIDEND';
        }

        // 股票分割
        if (actionLower.includes('split')) {
            return 'SPLIT';
        }

        // 資金進出
        if (actionLower.includes('deposit') || actionLower.includes('received') ||
            actionLower.includes('ach') || actionLower.includes('入金')) {
            return 'DEPOSIT';
        }
        if (actionLower.includes('withdraw') || actionLower.includes('sent') ||
            actionLower.includes('wire') || actionLower.includes('出金')) {
            return 'WITHDRAW';
        }

        // 移轉
        if (actionLower.includes('transfer') || actionLower.includes('移轉')) {
            return 'TRANSFER';
        }

        // 稅務與利息
        if (actionLower.includes('tax')) return 'TAX';
        if (actionLower.includes('interest')) return 'INTEREST';



        return 'UNKNOWN';
    },

    /**
     * 解析日期 - 支援 Schwab "MM/DD/YYYY as of MM/DD/YYYY" 格式
     */
    parseDate(dateStr) {
        if (!dateStr) return '';

        // 處理 "MM/DD/YYYY as of MM/DD/YYYY" 格式，取前面的日期
        let cleaned = dateStr.trim().split(' as of ')[0].trim();

        // MM/DD/YYYY 格式
        const mmddyyyy = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (mmddyyyy) {
            const month = mmddyyyy[1].padStart(2, '0');
            const day = mmddyyyy[2].padStart(2, '0');
            const year = mmddyyyy[3];
            return `${year}-${month}-${day}`;
        }

        // YYYY-MM-DD 格式
        const yyyymmdd = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (yyyymmdd) {
            return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
        }

        // YYYY/MM/DD 格式
        const yyyymmdd2 = cleaned.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
        if (yyyymmdd2) {
            return `${yyyymmdd2[1]}-${yyyymmdd2[2]}-${yyyymmdd2[3]}`;
        }

        // 民國年 (XXX/MM/DD)
        const rocDate = cleaned.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
        if (rocDate) {
            const year = (parseInt(rocDate[1]) + 1911).toString();
            return `${year}-${rocDate[2]}-${rocDate[3]}`;
        }

        // 嘗試 Date 解析
        const parsed = new Date(cleaned);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }

        return '';
    },

    /**
     * 解析數字 (支援 $1,234.56 和 -$1,234.56 格式)
     */
    parseNumber(numStr) {
        if (!numStr) return 0;

        const cleaned = numStr
            .replace(/[$€£¥NT\s]/g, '')
            .replace(/,/g, '')
            .replace(/\((.+)\)/, '-$1')
            .trim();

        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    },

    /**
     * 欄位對應表
     */
    brokerMappings: {
        schwab: {
            date: ['date'],
            symbol: ['symbol'],
            action: ['action'],
            description: ['description'],
            quantity: ['quantity'],
            price: ['price'],
            amount: ['amount'],
            fees: ['fees & comm', 'fees', 'commission']
        },
        firstrade: {
            date: ['trade date', 'date', 'tradedate'],
            symbol: ['symbol', 'ticker'],
            action: ['action', 'transaction type', 'type'],
            quantity: ['quantity', 'shares', 'qty'],
            price: ['price', 'execution price'],
            amount: ['amount', 'net amount', 'total'],
            fees: ['commission', 'fee', 'fees']
        },
        ibkr: {
            date: ['date', 'tradedate', 'trade date', 'date/time'],
            symbol: ['symbol', 'underlying'],
            action: ['transaction type', 'buy/sell', 'buysell', 'side', 'type'],
            quantity: ['quantity', 'qty', 'shares'],
            price: ['price', 'tradeprice', 't. price', 'amount'], // IBKR 某些報表 price 為空，可能需要特殊處理
            amount: ['net amount', 'proceeds', 'amount', 'total'],
            fees: ['commission', 'comm/fee', 'ibcommission', 'fee']
        },
        'tw-yuanta': {
            date: ['交易日期', '成交日期', '日期'],
            symbol: ['股票代號', '證券代號', '代號'],
            action: ['買賣別', '買/賣', '交易類型'],
            quantity: ['股數', '成交股數', '數量'],
            price: ['成交價', '價格', '成交價格'],
            amount: ['成交金額', '金額'],
            fees: ['手續費', '費用']
        },
        'tw-fubon': {
            date: ['交易日', '成交日期'],
            symbol: ['商品代碼', '股票代號'],
            action: ['交易別', '買賣'],
            quantity: ['成交數量', '股數'],
            price: ['成交價格', '價格'],
            amount: ['成交金額'],
            fees: ['手續費']
        },
        'tw-sinopac': {
            date: ['成交日'],
            product: ['商品'],
            action: ['買賣'],
            quantity: ['數量'],
            price: ['成交價'],
            fees: ['手續費'],
            tax: ['交易稅'],
            amountPay: ['應付金額'],
            amountReceive: ['應收金額'],
            margin: ['融資金額'],
            deposit: ['保證金']
        }
    },

    /**
     * 找出欄位索引
     */
    findColumnIndex(headers, possibleNames) {
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());

        for (const name of possibleNames) {
            const index = lowerHeaders.indexOf(name.toLowerCase());
            if (index >= 0) return index;
        }

        for (const name of possibleNames) {
            const index = lowerHeaders.findIndex(h => h.includes(name.toLowerCase()));
            if (index >= 0) return index;
        }

        return -1;
    },

    /**
     * 解析永豐台股 CSV (專用方法)
     * 格式: 成交日,商品,買賣,數量,成交價,價金,手續費,交易稅,應付金額,應收金額,融資金額,保證金,...
     */
    parseSinopac(rows, headers) {
        const columnIndices = {
            date: this.findColumnIndex(headers, ['成交日']),
            product: this.findColumnIndex(headers, ['商品']),
            action: this.findColumnIndex(headers, ['買賣']),
            quantity: this.findColumnIndex(headers, ['數量']),
            price: this.findColumnIndex(headers, ['成交價']),
            fees: this.findColumnIndex(headers, ['手續費']),
            tax: this.findColumnIndex(headers, ['交易稅']),
            amountPay: this.findColumnIndex(headers, ['應付金額']),
            amountReceive: this.findColumnIndex(headers, ['應收金額']),
            margin: this.findColumnIndex(headers, ['融資金額']),
            deposit: this.findColumnIndex(headers, ['保證金'])
        };

        const transactions = [];

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];

            // 解析欄位
            const dateStr = row[columnIndices.date] || '';
            const productStr = row[columnIndices.product] || '';
            const actionStr = row[columnIndices.action] || '';
            const quantity = this.parseNumber(row[columnIndices.quantity]);
            const price = this.parseNumber(row[columnIndices.price]);
            const fees = this.parseNumber(row[columnIndices.fees]);
            const tax = this.parseNumber(row[columnIndices.tax]);
            const amountPay = this.parseNumber(row[columnIndices.amountPay]);
            const amountReceive = this.parseNumber(row[columnIndices.amountReceive]);
            const margin = this.parseNumber(row[columnIndices.margin]);
            const deposit = this.parseNumber(row[columnIndices.deposit]);

            // 忽略融資融券交易
            if (margin !== 0 || deposit !== 0) {
                console.log(`[CSV] 忽略融資融券交易: ${productStr}`);
                continue;
            }

            // 解析日期 (YYYY/MM/DD 格式)
            const date = this.parseDate(dateStr);
            if (!date) continue;

            // 處理現金匯入/匯出 (商品 = "現金")
            if (productStr.trim() === '現金') {
                let cashAction = 'UNKNOWN';
                let cashAmount = 0;

                if (actionStr.includes('匯入') || actionStr.includes('入金') || actionStr.includes('存入')) {
                    cashAction = 'DEPOSIT';
                    cashAmount = Math.abs(amountReceive) || Math.abs(amountPay);
                } else if (actionStr.includes('匯出') || actionStr.includes('出金') || actionStr.includes('提領')) {
                    cashAction = 'WITHDRAW';
                    cashAmount = Math.abs(amountPay) || Math.abs(amountReceive);
                }

                if (cashAction !== 'UNKNOWN' && cashAmount > 0) {
                    transactions.push({
                        date,
                        symbol: 'CASH',
                        action: cashAction,
                        quantity: 0,
                        price: 0,
                        amount: cashAmount,
                        fees: 0,
                        currency: 'TWD',
                        broker: 'tw-sinopac',
                        originalAction: actionStr,
                        description: productStr
                    });
                    console.log(`[CSV] 現金${cashAction === 'DEPOSIT' ? '匯入' : '匯出'}: $${cashAmount}`);
                }
                continue; // 處理完現金交易，跳過後續股票處理
            }

            // 從商品欄位提取代號 (格式: "00640L 富邦日本正2")
            // 取空格前的部分，並加上 .TW 後綴
            const symbolParts = productStr.trim().split(/\s+/);
            const rawSymbol = symbolParts[0] || '';
            if (!rawSymbol) continue;
            const symbol = rawSymbol.toUpperCase() + '.TW';

            // 解析買賣動作
            let action = 'UNKNOWN';
            if (actionStr.includes('買')) {
                action = 'BUY';
            } else if (actionStr.includes('賣')) {
                action = 'SELL';
            }
            if (action === 'UNKNOWN') continue;

            // 計算總費用 (手續費 + 交易稅)
            const totalFees = Math.abs(fees) + Math.abs(tax);

            // 計算總金額
            // 買入用應付金額，賣出用應收金額
            let amount = 0;
            if (action === 'BUY') {
                amount = Math.abs(amountPay) || (quantity * price + totalFees);
            } else {
                amount = Math.abs(amountReceive) || (quantity * price - totalFees);
            }

            transactions.push({
                date,
                symbol,
                action,
                quantity: Math.abs(quantity),
                price: Math.abs(price),
                amount,
                fees: totalFees,
                currency: 'TWD',
                broker: 'tw-sinopac',
                originalAction: actionStr,
                description: productStr
            });
        }

        return transactions;
    },

    /**
     * 解析 Schwab CSV (專用方法)
     */
    parseSchwab(rows, headers) {
        const columnIndices = {
            date: this.findColumnIndex(headers, ['date']),
            action: this.findColumnIndex(headers, ['action']),
            symbol: this.findColumnIndex(headers, ['symbol']),
            description: this.findColumnIndex(headers, ['description']),
            quantity: this.findColumnIndex(headers, ['quantity']),
            price: this.findColumnIndex(headers, ['price']),
            fees: this.findColumnIndex(headers, ['fees & comm', 'fees']),
            amount: this.findColumnIndex(headers, ['amount'])
        };

        const transactions = [];
        const splitEvents = []; // 收集股票分割事件

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];

            const dateStr = row[columnIndices.date] || '';
            const actionStr = row[columnIndices.action] || '';
            const symbol = (row[columnIndices.symbol] || '').trim().toUpperCase();
            const description = row[columnIndices.description] || '';
            const quantity = this.parseNumber(row[columnIndices.quantity]);
            const price = this.parseNumber(row[columnIndices.price]);
            const fees = Math.abs(this.parseNumber(row[columnIndices.fees]));
            const amount = this.parseNumber(row[columnIndices.amount]);

            const date = this.parseDate(dateStr);
            if (!date) continue;

            const actionInfo = this.parseSchwabAction(actionStr);

            // 根據交易類型處理
            switch (actionInfo.action) {
                case 'BUY':
                    // 買入 (包含 Reinvest Shares)
                    if (symbol && quantity > 0 && price > 0) {
                        // 債券類代號（以數字開頭且不是台股，長度通常超過 5 碼）價格需除以 100
                        const isBond = /^\d/.test(symbol) && !symbol.toUpperCase().endsWith('.TW') && !symbol.toUpperCase().endsWith('.TWO') && symbol.length >= 6;
                        const adjustedPrice = isBond ? price / 100 : price;
                        const adjustedAmount = Math.abs(amount) || (Math.abs(quantity) * adjustedPrice);

                        transactions.push({
                            date,
                            symbol,
                            action: 'BUY',
                            quantity: Math.abs(quantity),
                            price: adjustedPrice,
                            amount: adjustedAmount,
                            fees,
                            currency: 'USD',
                            originalAction: actionStr,
                            description,
                            isBond
                        });
                    }
                    break;

                case 'SELL':
                    // 賣出
                    if (symbol && quantity !== 0 && price > 0) {
                        // 債券類代號（以數字開頭且不是台股，長度通常超過 5 碼）價格需除以 100
                        const isBond = /^\d/.test(symbol) && !symbol.toUpperCase().endsWith('.TW') && !symbol.toUpperCase().endsWith('.TWO') && symbol.length >= 6;
                        const adjustedPrice = isBond ? price / 100 : price;
                        const adjustedAmount = Math.abs(amount) || (Math.abs(quantity) * adjustedPrice);

                        transactions.push({
                            date,
                            symbol,
                            action: 'SELL',
                            quantity: Math.abs(quantity),
                            price: adjustedPrice,
                            amount: adjustedAmount,
                            fees,
                            currency: 'USD',
                            originalAction: actionStr,
                            description,
                            isBond
                        });
                    }
                    break;

                case 'DIVIDEND':
                    // 股利 (只記錄有正金額的)
                    if (amount > 0) {
                        transactions.push({
                            date,
                            symbol: symbol || 'CASH',
                            action: 'DIVIDEND',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'SPLIT':
                    // 股票分割
                    if (symbol && quantity !== 0) {
                        splitEvents.push({
                            date,
                            symbol,
                            quantity: quantity, // 分割獲得的股數
                            price: price || 0, // 分割後價格
                            originalAction: actionStr
                        });

                        // 將分割記錄為特殊交易類型
                        transactions.push({
                            date,
                            symbol,
                            action: 'SPLIT',
                            quantity: Math.abs(quantity),
                            price: price || 0,
                            amount: 0,
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description,
                            isSplit: true
                        });
                    }
                    break;

                case 'TAX':
                    // 稅務扣款 (負金額)
                    if (amount !== 0) {
                        transactions.push({
                            date,
                            symbol: symbol || 'TAX',
                            action: 'TAX',
                            quantity: 0,
                            price: 0,
                            amount: amount, // 保留負數
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'DEPOSIT':
                    // 現金匯入
                    if (amount > 0) {
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: 'DEPOSIT',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'WITHDRAW':
                    // 現金匯出
                    if (amount !== 0) {
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: 'WITHDRAW',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'INTEREST':
                    // 利息收入
                    if (amount > 0) {
                        transactions.push({
                            date,
                            symbol: 'INTEREST',
                            action: 'INTEREST',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'CASH_IN_LIEU':
                    // 碎股現金補償 (視為股利)
                    if (amount > 0) {
                        transactions.push({
                            date,
                            symbol: symbol || 'CASH',
                            action: 'DIVIDEND',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'SECURITY_TRANSFER':
                    // 股票轉移：負數為轉出，正數為轉入
                    // 使用獨立的 Action 類型以確保儲存後不會遺失類型資訊
                    if (symbol && quantity !== 0) {
                        // quantity 直接使用原始值（可能為負）
                        const rawQuantity = this.parseNumber(row[columnIndices.quantity]);

                        if (rawQuantity < 0) {
                            // 轉出 - 使用 TRANSFER_OUT 類型（不是 SELL）
                            transactions.push({
                                date,
                                symbol,
                                action: 'TRANSFER_OUT',
                                quantity: Math.abs(rawQuantity),
                                price: 0,
                                amount: 0,
                                fees: 0,
                                currency: 'USD',
                                originalAction: actionStr,
                                description
                            });
                            console.log(`[CSV] Security Transfer OUT: ${symbol} x ${Math.abs(rawQuantity)}`);
                        } else {
                            // 轉入 - 使用 TRANSFER_IN 類型（不是 BUY）
                            transactions.push({
                                date,
                                symbol,
                                action: 'TRANSFER_IN',
                                quantity: rawQuantity,
                                price: Math.abs(this.parseNumber(row[columnIndices.price])), // 保留價格作為成本
                                amount: 0,
                                fees: 0,
                                currency: 'USD',
                                originalAction: actionStr,
                                description
                            });
                            console.log(`[CSV] Security Transfer IN: ${symbol} x ${rawQuantity}`);
                        }
                    } else if (amount !== 0) {
                        // 現金轉移 (Security Transfer 帶 amount 但無 symbol)
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: 'CASH_TRANSFER',
                            quantity: 0,
                            price: 0,
                            amount: amount, // 負數為轉出
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                        console.log(`[CSV] Cash Transfer: $${amount}`);
                    }
                    break;

                case 'PROMOTIONAL':
                    // 開戶獎金
                    if (amount > 0) {
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: 'PROMOTIONAL',
                            quantity: 0,
                            price: 0,
                            amount: amount,
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'INTEREST':
                    // 現金利息
                    if (amount !== 0) {
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: 'INTEREST',
                            quantity: 0,
                            price: 0,
                            amount: amount,
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'FEE':
                    // 服務費用 (視為負的現金流)
                    if (amount !== 0) {
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: 'WITHDRAW',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                case 'MISC_CASH':
                    // 雜項現金 (如 WAIVE WIRE FEE)
                    if (amount !== 0) {
                        transactions.push({
                            date,
                            symbol: 'CASH',
                            action: amount > 0 ? 'DEPOSIT' : 'WITHDRAW',
                            quantity: 0,
                            price: 0,
                            amount: Math.abs(amount),
                            fees: 0,
                            currency: 'USD',
                            originalAction: actionStr,
                            description
                        });
                    }
                    break;

                // TRANSFER, OTHER 類型暫時忽略
                default:
                    break;
            }
        }

        // 附加分割事件資訊到交易列表
        transactions.splitEvents = splitEvents;

        return transactions;
    },

    /**
     * 主解析方法
     */
    parse(csvText, brokerType = 'auto') {
        const rows = this.parseCSV(csvText);
        if (rows.length < 2) {
            throw new Error('CSV 檔案內容不足');
        }

        const headers = rows[0];
        const broker = brokerType === 'auto' ? this.detectBroker(headers) : brokerType;

        let transactions = [];

        // Schwab 使用專用解析器
        if (broker === 'schwab') {
            transactions = this.parseSchwab(rows, headers);
        } else if (broker === 'tw-sinopac') {
            // 永豐台股使用專用解析器
            transactions = this.parseSinopac(rows, headers);
        } else {
            // 其他券商使用通用解析器
            const mapping = this.brokerMappings[broker];
            if (!mapping) {
                throw new Error(`不支援的券商格式: ${broker}`);
            }

            const columnIndices = {};
            for (const [field, possibleNames] of Object.entries(mapping)) {
                columnIndices[field] = this.findColumnIndex(headers, possibleNames);
            }

            if (columnIndices.date < 0) {
                throw new Error('找不到日期欄位');
            }

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];

                const date = this.parseDate(row[columnIndices.date]);
                let symbol = (row[columnIndices.symbol] || '').trim().toUpperCase();
                let action = this.parseAction(row[columnIndices.action]);
                const rawQuantity = this.parseNumber(row[columnIndices.quantity]);
                const quantity = Math.abs(rawQuantity);
                const price = Math.abs(this.parseNumber(row[columnIndices.price]));
                const amount = this.parseNumber(row[columnIndices.amount]);
                const fees = Math.abs(this.parseNumber(row[columnIndices.fees]));

                // 處理 Transfer 方向



                if (!date) continue;
                if (action === 'UNKNOWN') continue;

                // 處理 Transfer 方向
                if (action === 'TRANSFER') {
                    if (rawQuantity > 0) action = 'TRANSFER_IN';
                    else if (rawQuantity < 0) action = 'TRANSFER_OUT';
                    else action = 'TRANSFER_IN'; // 預設
                }

                if (!date) continue;
                if (action === 'UNKNOWN') continue;

                // 買賣需要有數量和價格
                if ((action === 'BUY' || action === 'SELL') && (quantity === 0 || price === 0)) {
                    continue;
                }

                // 對於 SPLIT，保留原始數值的正負號 (反分割可能是負數)
                // Transfer 也需要保留正負號嗎? 通常 App 用 quantity > 0 表示數量 (絕對值)，並靠 Action 區分方向。
                // 這裡我們已將 Action 分為 IN/OUT，quantity 應為絕對值。
                const finalQuantity = action === 'SPLIT' ? rawQuantity : quantity; // quantity is Math.abs(raw)

                transactions.push({
                    date,
                    symbol,
                    action,
                    quantity: action === 'DIVIDEND' ? 0 : finalQuantity,
                    price: action === 'DIVIDEND' ? 0 : price,
                    amount: Math.abs(amount) || (Math.abs(finalQuantity) * price),
                    fees,
                    currency: broker.startsWith('tw-') ? 'TWD' : 'USD',
                    broker
                });
            }
        }

        return transactions;
    },


    /**
     * 驗證交易記錄
     */
    validate(transaction) {
        const errors = [];

        if (!transaction.date) {
            errors.push('日期為必填');
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) {
            errors.push('日期格式無效');
        }

        const validActions = ['BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'TAX', 'DEPOSIT', 'WITHDRAW', 'INTEREST', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'];
        if (!validActions.includes(transaction.action)) {
            errors.push('交易類型無效');
        }

        if ((transaction.action === 'BUY' || transaction.action === 'SELL')) {
            if (!transaction.symbol) {
                errors.push('股票代號為必填');
            }
            if (transaction.quantity <= 0) {
                errors.push('股數必須大於 0');
            }
            if (transaction.price <= 0) {
                errors.push('價格必須大於 0');
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    },

    /**
     * 產生預覽表格
     */
    generatePreview(transactions, limit = 10) {
        const actionLabels = {
            'BUY': '買入',
            'SELL': '賣出',
            'DIVIDEND': '股利',
            'SPLIT': '分割',
            'TAX': '稅務',
            'DEPOSIT': '匯入',
            'WITHDRAW': '匯出',
            'INTEREST': '利息'
        };

        const headers = ['日期', '類型', '代號', '股數', '價格', '金額'];
        const rows = transactions.slice(0, limit).map(tx => [
            tx.date,
            actionLabels[tx.action] || tx.action,
            tx.symbol,
            tx.quantity > 0 ? tx.quantity.toFixed(4) : '--',
            tx.price > 0 ? tx.price.toFixed(2) : '--',
            tx.amount !== 0 ? tx.amount.toFixed(2) : '--'
        ]);

        return { headers, rows };
    },

    /**
     * 統計解析結果
     */
    summarize(transactions) {
        const summary = {
            total: transactions.length,
            byAction: {},
            bySymbol: {},
            splitEvents: transactions.splitEvents || []
        };

        for (const tx of transactions) {
            summary.byAction[tx.action] = (summary.byAction[tx.action] || 0) + 1;
            if (tx.symbol && tx.symbol !== 'CASH' && tx.symbol !== 'TAX' && tx.symbol !== 'INTEREST') {
                summary.bySymbol[tx.symbol] = (summary.bySymbol[tx.symbol] || 0) + 1;
            }
        }

        return summary;
    }
};

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CSVParser;
}

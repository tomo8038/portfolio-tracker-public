/**
 * Portfolio Tracker - 圖表組件
 * 使用 Chart.js 繪製資產走勢、配置圓餅圖、月度熱力圖
 */

const Charts = {
    instances: {},

    /**
     * 初始化資產走勢圖
     * @param {string} canvasId - Canvas 元素 ID
     */
    // 儲存完整數據以供過濾
    portfolioData: null,

    /**
     * 初始化資產走勢圖
     * @param {string} canvasId - Canvas 元素 ID
     */
    initPortfolioChart(canvasId) {
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        // 銷毀現有實例
        if (this.instances[canvasId]) {
            this.instances[canvasId].destroy();
        }

        this.instances[canvasId] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: '我的投資組合',
                        data: [],
                        borderColor: CONFIG.CHART_COLORS.portfolio,
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        borderWidth: 2
                    },
                    {
                        label: 'S&P 500',
                        data: [],
                        borderColor: CONFIG.CHART_COLORS.benchmark,
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        borderWidth: 1.5,
                        borderDash: [5, 5]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(30, 41, 59, 0.95)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: '#334155',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: function (context) {
                                const value = context.parsed.y;
                                const index = context.dataIndex;
                                const dataset = context.dataset;
                                const label = dataset.label;

                                let changeText = '';
                                if (index > 0) {
                                    const prevValue = dataset.data[index - 1];
                                    if (prevValue && prevValue > 0) {
                                        const change = value - prevValue;
                                        const pct = (change / prevValue) * 100;
                                        const sign = change >= 0 ? '+' : '';
                                        changeText = ` (${sign}${pct.toFixed(2)}%)`;
                                    }
                                }

                                // 顯示絕對金額 + 變化
                                return `${label}: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${changeText}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(51, 65, 85, 0.5)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#64748b',
                            maxTicksLimit: 12, // 約每季一格
                            autoSkip: true,
                            maxRotation: 0,
                            callback: function (val, index) {
                                // 取得完整標籤 (YYYY-MM-DD)
                                const label = this.getLabelForValue(val);
                                if (!label) return '';
                                // 簡化顯示為 MM-DD
                                const parts = label.split('-');
                                if (parts.length === 3) {
                                    return `${parts[1]}-${parts[2]}`;
                                }
                                return label;
                            }
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(51, 65, 85, 0.5)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#64748b',
                            callback: function (value) {
                                // 顯示為 K 或 M 格式
                                if (value >= 1000000) {
                                    return '$' + (value / 1000000).toFixed(1) + 'M';
                                } else if (value >= 1000) {
                                    return '$' + (value / 1000).toFixed(0) + 'K';
                                }
                                return '$' + value.toFixed(0);
                            }
                        }
                    }
                }
            }
        });
    },

    /**
     * 更新資產走勢圖
     * @param {string} canvasId - Canvas 元素 ID
     * @param {Object} data - { labels: [], portfolio: [], benchmark: [] }
     */
    updatePortfolioChart(canvasId, data) {
        const chart = this.instances[canvasId];
        if (!chart) return;

        // 儲存完整數據
        this.portfolioData = data;

        chart.data.labels = data.labels;
        chart.data.datasets[0].data = data.portfolio;
        chart.data.datasets[1].data = data.benchmark;
        chart.update('none');
    },

    /**
     * 根據時間範圍更新圖表
     * @param {string} canvasId - Canvas ID
     * @param {string} range - 時間範圍 (1M, 3M, 6M, YTD, 1Y, ALL)
     */
    updateChartRange(canvasId, range) {
        const chart = this.instances[canvasId];
        if (!chart || !this.portfolioData) return;

        const { labels, portfolio, benchmark } = this.portfolioData;
        const count = labels.length;
        if (count === 0) return;

        let startIndex = 0;
        const lastDate = new Date(labels[count - 1]);

        if (range !== 'ALL') {
            const cutoffDate = new Date(lastDate);

            switch (range) {
                case '1M':
                    cutoffDate.setMonth(cutoffDate.getMonth() - 1);
                    break;
                case '3M':
                    cutoffDate.setMonth(cutoffDate.getMonth() - 3);
                    break;
                case '6M':
                    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
                    break;
                case 'YTD':
                    cutoffDate.setMonth(0, 1); // 當年 1/1
                    break;
                case '1Y':
                    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
                    break;
            }

            // 尋找切分點（過濾掉早於 cutoffDate 的數據）
            startIndex = labels.findIndex(dateStr => new Date(dateStr) >= cutoffDate);
            if (startIndex === -1) startIndex = 0; // 如果都找不到，顯示全部
        }

        // 根據數據量調整 X 軸刻度密度
        const dataCount = count - startIndex;
        const maxTicks = dataCount <= 30 ? dataCount : 12;

        chart.options.scales.x.ticks.maxTicksLimit = maxTicks;
        chart.data.labels = labels.slice(startIndex);
        chart.data.datasets[0].data = portfolio.slice(startIndex);
        chart.data.datasets[1].data = benchmark.slice(startIndex);

        chart.update();
    },

    /**
     * 初始化資產配置圓餅圖
     * @param {string} canvasId - Canvas 元素 ID
     */
    initAllocationChart(canvasId) {
        const ctx = document.getElementById(canvasId)?.getContext('2d');
        if (!ctx) return;

        if (this.instances[canvasId]) {
            this.instances[canvasId].destroy();
        }

        this.instances[canvasId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: CONFIG.CHART_COLORS.palette,
                    borderColor: '#1e293b',
                    borderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#94a3b8',
                            padding: 12,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            font: {
                                size: 11
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(30, 41, 59, 0.95)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#94a3b8',
                        borderColor: '#334155',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function (context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = ((context.raw / total) * 100).toFixed(1);
                                return `${context.label}: ${Finance.formatCurrency(context.raw)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    },

    /**
     * 更新資產配置圓餅圖
     * @param {string} canvasId - Canvas 元素 ID
     * @param {Object} data - { labels: [], values: [] }
     */
    updateAllocationChart(canvasId, data) {
        const chart = this.instances[canvasId];
        if (!chart) return;

        chart.data.labels = data.labels;
        chart.data.datasets[0].data = data.values;
        chart.update('none');
    },

    /**
     * 生成月度熱力圖
     * @param {string} containerId - 容器元素 ID
     * @param {Array<{year: number, month: number, value: number}>} data - 月度報酬資料
     */
    renderMonthlyHeatmap(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        // 月份標籤
        const months = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
        const monthLabels = document.createElement('div');
        monthLabels.className = 'heatmap-row';
        monthLabels.style.display = 'grid';
        monthLabels.style.gridTemplateColumns = '40px repeat(12, 1fr)';
        monthLabels.style.gap = '3px';
        monthLabels.style.marginBottom = '4px';

        monthLabels.innerHTML = '<span class="heatmap-label"></span>' +
            months.map(m => `<span class="heatmap-label">${m}月</span>`).join('');
        container.appendChild(monthLabels);

        // 按年份分組
        const years = [...new Set(data.map(d => d.year))].sort((a, b) => b - a);

        // 取得顏色方案
        const settings = CacheService.settings.get();
        const isUSStyle = settings.colorScheme !== 'tw';

        years.forEach(year => {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '40px repeat(12, 1fr)';
            row.style.gap = '3px';
            row.style.marginBottom = '3px';

            // 年份標籤
            const yearLabel = document.createElement('span');
            yearLabel.className = 'heatmap-label';
            yearLabel.textContent = year;
            yearLabel.style.fontSize = '0.7rem';
            yearLabel.style.color = '#64748b';
            yearLabel.style.display = 'flex';
            yearLabel.style.alignItems = 'center';
            row.appendChild(yearLabel);

            // 12 個月份格子
            for (let month = 1; month <= 12; month++) {
                const monthData = data.find(d => d.year === year && d.month === month);
                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';

                if (monthData) {
                    const value = monthData.value;
                    const color = this.getHeatmapColor(value, isUSStyle);
                    cell.style.backgroundColor = color;
                    cell.textContent = (value * 100).toFixed(1);
                    cell.title = `${year}/${month}: ${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
                } else {
                    cell.style.backgroundColor = '#334155';
                    cell.style.opacity = '0.3';
                }

                row.appendChild(cell);
            }

            container.appendChild(row);
        });
    },

    /**
     * 計算熱力圖顏色
     * @param {number} value - 報酬率 (-1 到 1)
     * @param {boolean} isUSStyle - 是否使用美股色系
     * @returns {string} 顏色值
     */
    getHeatmapColor(value, isUSStyle = true) {
        const profitColor = isUSStyle ? [16, 185, 129] : [239, 68, 68]; // 綠 or 紅
        const lossColor = isUSStyle ? [239, 68, 68] : [16, 185, 129];   // 紅 or 綠

        // 限制範圍
        const normalizedValue = Math.max(-0.2, Math.min(0.2, value));
        const intensity = Math.abs(normalizedValue) / 0.2; // 0-1

        const baseColor = normalizedValue >= 0 ? profitColor : lossColor;

        // 混合背景色 (#1e293b)
        const bgColor = [30, 41, 59];
        const r = Math.round(bgColor[0] + (baseColor[0] - bgColor[0]) * intensity);
        const g = Math.round(bgColor[1] + (baseColor[1] - bgColor[1]) * intensity);
        const b = Math.round(bgColor[2] + (baseColor[2] - bgColor[2]) * intensity);

        return `rgb(${r}, ${g}, ${b})`;
    },

    /**
     * 清理所有圖表實例
     */
    destroyAll() {
        Object.values(this.instances).forEach(chart => {
            if (chart && typeof chart.destroy === 'function') {
                chart.destroy();
            }
        });
        this.instances = {};
    }
};

// 匯出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Charts;
}

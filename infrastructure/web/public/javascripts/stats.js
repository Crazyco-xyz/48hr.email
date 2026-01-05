/**
 * Statistics page functionality
 * Handles Chart.js initialization with historical, real-time, and predicted data
 */

// Store chart instance globally for updates
let statsChart = null;
let chartContext = null;
let lastReloadTime = 0;
const RELOAD_COOLDOWN_MS = 2000; // 2 second cooldown between reloads

// Initialize stats chart if on stats page
document.addEventListener('DOMContentLoaded', function() {
    const chartCanvas = document.getElementById('statsChart');
    if (!chartCanvas) return; // Not on stats page

    // Get data from global variables (set by template)
    if (typeof window.initialStatsData === 'undefined') {
        return;
    }

    const realtimeData = window.initialStatsData || [];
    const historicalData = window.historicalData || [];
    const predictionData = window.predictionData || [];

    // Set up Socket.IO connection for real-time updates with rate limiting
    if (typeof io !== 'undefined') {
        const socket = io();

        socket.on('stats-update', () => {
            const now = Date.now();
            if (now - lastReloadTime >= RELOAD_COOLDOWN_MS) {
                lastReloadTime = now;
                reloadStatsData();
            }
        });
    }

    // Combine all data and create labels
    const now = Date.now();

    // Use a reasonable historical window (show data within the purge time range)
    // This will adapt based on whether purge time is 48 hours, 7 days, etc.
    const allTimePoints = [
        ...historicalData.map(d => ({...d, type: 'historical' })),
        ...realtimeData.map(d => ({...d, type: 'realtime' })),
        ...predictionData.map(d => ({...d, type: 'prediction' }))
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Create labels
    const labels = allTimePoints.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    });

    // Prepare datasets
    const historicalPoints = allTimePoints.map(d => d.type === 'historical' ? d.receives : null);
    const realtimePoints = allTimePoints.map(d => d.type === 'realtime' ? d.receives : null);
    const predictionPoints = allTimePoints.map(d => d.type === 'prediction' ? d.receives : null);

    // Create gradient for fading effect on historical data
    const ctx = chartCanvas.getContext('2d');
    chartContext = ctx;
    const historicalGradient = ctx.createLinearGradient(0, 0, chartCanvas.width * 0.3, 0);
    historicalGradient.addColorStop(0, 'rgba(100, 100, 255, 0.05)');
    historicalGradient.addColorStop(1, 'rgba(100, 100, 255, 0.15)');

    // Track visibility state for each dataset
    const datasetVisibility = [true, true, true];

    statsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                    label: 'Historical',
                    data: historicalPoints,
                    borderColor: 'rgba(100, 149, 237, 0.8)',
                    backgroundColor: historicalGradient,
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: 'rgba(100, 149, 237, 0.8)',
                    spanGaps: true,
                    fill: true,
                    hidden: false
                },
                {
                    label: 'Current Activity',
                    data: realtimePoints,
                    borderColor: '#2ecc71',
                    backgroundColor: 'rgba(46, 204, 113, 0.15)',
                    borderWidth: 4,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#2ecc71',
                    spanGaps: true,
                    fill: true,
                    hidden: false
                },
                {
                    label: 'Predicted',
                    data: predictionPoints,
                    borderColor: '#ff9f43',
                    backgroundColor: 'rgba(255, 159, 67, 0.08)',
                    borderWidth: 3,
                    borderDash: [8, 4],
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#ff9f43',
                    spanGaps: true,
                    fill: true,
                    hidden: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: false // Disable default legend, we'll create custom
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(context) {
                            if (!context || !context[0] || context[0].dataIndex === undefined) return '';
                            const dataIndex = context[0].dataIndex;
                            if (!allTimePoints[dataIndex]) return '';
                            const point = allTimePoints[dataIndex];
                            const date = new Date(point.timestamp);
                            return date.toLocaleString('en-US', {
                                dateStyle: 'medium',
                                timeStyle: 'short'
                            });
                        },
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y + ' emails';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-dim'),
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value);
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    },
                    title: {
                        display: true,
                        text: 'Emails Received',
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-light')
                    }
                },
                x: {
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-dim'),
                        maxRotation: 45,
                        minRotation: 45,
                        maxTicksLimit: 20
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            }
        }
    });

    // Create custom legend buttons
    const chartContainer = chartCanvas.parentElement;
    const legendContainer = document.createElement('div');
    legendContainer.className = 'chart-legend-custom';
    legendContainer.innerHTML = `
        <button class="legend-btn active" data-index="0">
            <span class="legend-indicator" style="background: rgba(100, 149, 237, 0.8);"></span>
            <span class="legend-label">Historical</span>
        </button>
        <button class="legend-btn active" data-index="1">
            <span class="legend-indicator" style="background: #2ecc71;"></span>
            <span class="legend-label">Current Activity</span>
        </button>
        <button class="legend-btn active" data-index="2">
            <span class="legend-indicator" style="background: #ff9f43; border: 2px dashed rgba(255, 159, 67, 0.5);"></span>
            <span class="legend-label">Predicted</span>
        </button>
    `;

    chartContainer.insertBefore(legendContainer, chartCanvas);

    // Handle legend button clicks
    legendContainer.querySelectorAll('.legend-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const index = parseInt(this.getAttribute('data-index'));
            const isActive = this.classList.contains('active');

            // Toggle button state
            this.classList.toggle('active');

            // Toggle dataset visibility with fade effect
            const meta = statsChart.getDatasetMeta(index);
            const dataset = statsChart.data.datasets[index];

            if (isActive) {
                // Fade out
                meta.hidden = true;
                datasetVisibility[index] = false;
            } else {
                // Fade in
                meta.hidden = false;
                datasetVisibility[index] = true;
            }

            statsChart.update('active');
        });
    });

    // Lazy load full stats data if placeholder detected
    lazyLoadStats();
});

/**
 * Rebuild chart with new data
 */
function rebuildStatsChart() {
    if (!statsChart || !chartContext) {
        return;
    }

    const realtimeData = window.initialStatsData || [];
    const historicalData = window.historicalData || [];
    const predictionData = window.predictionData || [];

    const allTimePoints = [
        ...historicalData.map(d => ({...d, type: 'historical' })),
        ...realtimeData.map(d => ({...d, type: 'realtime' })),
        ...predictionData.map(d => ({...d, type: 'prediction' }))
    ].sort((a, b) => a.timestamp - b.timestamp);

    if (allTimePoints.length === 0) {
        return;
    }

    // Create labels
    const labels = allTimePoints.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    });

    // Prepare datasets
    const historicalPoints = allTimePoints.map(d => d.type === 'historical' ? d.receives : null);
    const realtimePoints = allTimePoints.map(d => d.type === 'realtime' ? d.receives : null);
    const predictionPoints = allTimePoints.map(d => d.type === 'prediction' ? d.receives : null);

    // Update chart data
    statsChart.data.labels = labels;
    statsChart.data.datasets[0].data = historicalPoints;
    statsChart.data.datasets[1].data = realtimePoints;
    statsChart.data.datasets[2].data = predictionPoints;

    // Update the chart
    statsChart.update();
}

/**
 * Lazy load full statistics data and update DOM
 */
function lazyLoadStats() {
    // Check if this is a lazy-loaded page (has placeholder data)
    const currentCountEl = document.getElementById('currentCount');
    if (!currentCountEl) {
        return;
    }

    const currentText = currentCountEl.textContent.trim();

    if (currentText !== '...') {
        return; // Already loaded with real data
    }

    reloadStatsData();
}

/**
 * Reload statistics data from API and update DOM
 */
function reloadStatsData() {
    fetch('/stats/api')
        .then(response => response.json())
        .then(data => {
            updateStatsDOM(data);
        })
        .catch(error => {
            console.error('Error reloading stats:', error);
        });
}

/**
 * Update DOM with stats data
 */
function updateStatsDOM(data) {
    // Update main stat cards
    document.getElementById('currentCount').textContent = data.currentCount || '0';
    document.getElementById('historicalTotal').textContent = data.allTimeTotal || '0';
    document.getElementById('receives24h').textContent = (data.last24Hours && data.last24Hours.receives) || '0';
    document.getElementById('deletes24h').textContent = (data.last24Hours && data.last24Hours.deletes) || '0';
    document.getElementById('forwards24h').textContent = (data.last24Hours && data.last24Hours.forwards) || '0';

    // Update enhanced stats if available
    if (data.enhanced) {
        const topSenderDomains = document.querySelector('[data-stats="top-sender-domains"]');
        const topRecipientDomains = document.querySelector('[data-stats="top-recipient-domains"]');
        const busiestHours = document.querySelector('[data-stats="busiest-hours"]');
        if (topSenderDomains && data.enhanced.topSenderDomains && data.enhanced.topSenderDomains.length > 0) {
            let html = '';
            data.enhanced.topSenderDomains.slice(0, 5).forEach(item => {
                html += `<li class="stat-list-item"><span class="stat-list-label">${item.domain}</span><span class="stat-list-value">${item.count}</span></li>`;
            });
            topSenderDomains.innerHTML = html;
        }

        if (topRecipientDomains && data.enhanced.topRecipientDomains && data.enhanced.topRecipientDomains.length > 0) {
            let html = '';
            data.enhanced.topRecipientDomains.slice(0, 5).forEach(item => {
                html += `<li class="stat-list-item"><span class="stat-list-label">${item.domain}</span><span class="stat-list-value">${item.count}</span></li>`;
            });
            topRecipientDomains.innerHTML = html;
        }

        if (busiestHours && data.enhanced.busiestHours && data.enhanced.busiestHours.length > 0) {
            let html = '';
            data.enhanced.busiestHours.forEach(item => {
                html += `<li class="stat-list-item"><span class="stat-list-label">${item.hour}:00 - ${item.hour + 1}:00</span><span class="stat-list-value">${item.count}</span></li>`;
            });
            busiestHours.innerHTML = html;
        }

        // Update unique domains count
        const uniqueSenderDomains = document.querySelector('[data-stats="unique-sender-domains"]');
        if (uniqueSenderDomains && data.enhanced.uniqueSenderDomains !== undefined) {
            uniqueSenderDomains.textContent = data.enhanced.uniqueSenderDomains;
        }

        const uniqueRecipientDomains = document.querySelector('[data-stats="unique-recipient-domains"]');
        if (uniqueRecipientDomains && data.enhanced.uniqueRecipientDomains !== undefined) {
            uniqueRecipientDomains.textContent = data.enhanced.uniqueRecipientDomains;
        }

        // Update Quick Insights values
        const avgSubjectLength = document.querySelector('[data-stats="average-subject-length"]');
        if (avgSubjectLength && data.enhanced.averageSubjectLength !== undefined) {
            avgSubjectLength.textContent = data.enhanced.averageSubjectLength;
        }

        const uniqueSenderDomainsValue = document.querySelector('[data-stats="unique-sender-domains-value"]');
        if (uniqueSenderDomainsValue && data.enhanced.uniqueSenderDomains !== undefined) {
            uniqueSenderDomainsValue.textContent = data.enhanced.uniqueSenderDomains;
        }

        const uniqueRecipientDomainsValue = document.querySelector('[data-stats="unique-recipient-domains-value"]');
        if (uniqueRecipientDomainsValue && data.enhanced.uniqueRecipientDomains !== undefined) {
            uniqueRecipientDomainsValue.textContent = data.enhanced.uniqueRecipientDomains;
        }

        const peakHourPercentage = document.querySelector('[data-stats="peak-hour-percentage"]');
        if (peakHourPercentage && data.enhanced.peakHourPercentage !== undefined) {
            peakHourPercentage.textContent = data.enhanced.peakHourPercentage + '%';
        }

        const emailsPerHour = document.querySelector('[data-stats="emails-per-hour"]');
        if (emailsPerHour && data.enhanced.emailsPerHour !== undefined) {
            emailsPerHour.textContent = data.enhanced.emailsPerHour;
        }

        const dayPercentage = document.querySelector('[data-stats="day-percentage"]');
        if (dayPercentage && data.enhanced.dayPercentage !== undefined) {
            dayPercentage.textContent = data.enhanced.dayPercentage + '%';
        }
    }

    // Update window data for charts
    window.initialStatsData = (data.last24Hours && data.last24Hours.timeline) || [];
    window.historicalData = data.historical || [];
    window.predictionData = data.prediction || [];

    // Rebuild chart with new data
    rebuildStatsChart();
}

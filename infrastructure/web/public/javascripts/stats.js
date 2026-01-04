/**
 * Statistics page functionality
 * Handles Chart.js initialization with historical, real-time, and predicted data
 */

// Initialize stats chart if on stats page
document.addEventListener('DOMContentLoaded', function() {
    const chartCanvas = document.getElementById('statsChart');
    if (!chartCanvas) return; // Not on stats page

    // Get data from global variables (set by template)
    if (typeof window.initialStatsData === 'undefined') {
        console.error('Initial stats data not found');
        return;
    }

    const realtimeData = window.initialStatsData || [];
    const historicalData = window.historicalData || [];
    const predictionData = window.predictionData || [];

    console.log(`Loaded data: ${historicalData.length} historical, ${realtimeData.length} realtime, ${predictionData.length} predictions`);

    // Set up Socket.IO connection for real-time updates
    if (typeof io !== 'undefined') {
        const socket = io();

        socket.on('stats-update', () => {
            console.log('Stats update received (page will not auto-reload)');
            // Don't auto-reload - user can manually refresh if needed
        });

        socket.on('reconnect', () => {
            console.log('Reconnected to server');
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
    const historicalGradient = ctx.createLinearGradient(0, 0, chartCanvas.width * 0.3, 0);
    historicalGradient.addColorStop(0, 'rgba(100, 100, 255, 0.05)');
    historicalGradient.addColorStop(1, 'rgba(100, 100, 255, 0.15)');

    // Track visibility state for each dataset
    const datasetVisibility = [true, true, true];

    const chart = new Chart(ctx, {
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
                            const dataIndex = context[0].dataIndex;
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
            const meta = chart.getDatasetMeta(index);
            const dataset = chart.data.datasets[index];

            if (isActive) {
                // Fade out
                meta.hidden = true;
                datasetVisibility[index] = false;
            } else {
                // Fade in
                meta.hidden = false;
                datasetVisibility[index] = true;
            }

            chart.update('active');
        });
    });
});

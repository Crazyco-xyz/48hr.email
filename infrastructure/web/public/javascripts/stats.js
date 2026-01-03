/**
 * Statistics page functionality
 * Handles Chart.js initialization and auto-refresh of statistics data
 */

// Initialize stats chart if on stats page
document.addEventListener('DOMContentLoaded', function() {
    const chartCanvas = document.getElementById('statsChart');
    if (!chartCanvas) return; // Not on stats page
    
    // Get initial data from global variable (set by template)
    if (typeof window.initialStatsData === 'undefined') {
        console.error('Initial stats data not found');
        return;
    }
    
    const initialData = window.initialStatsData;
    
    // Prepare chart data
    const labels = initialData.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    });
    
    const ctx = chartCanvas.getContext('2d');
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Received',
                    data: initialData.map(d => d.receives),
                    borderColor: '#9b4dca',
                    backgroundColor: 'rgba(155, 77, 202, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Deleted',
                    data: initialData.map(d => d.deletes),
                    borderColor: '#e74c3c',
                    backgroundColor: 'rgba(231, 76, 60, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Forwarded',
                    data: initialData.map(d => d.forwards),
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-light'),
                        font: { size: 14 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-dim'),
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                    }
                },
                x: {
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text-dim'),
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            }
        }
    });

    // Auto-refresh stats every 30 seconds
    setInterval(async () => {
        try {
            const response = await fetch('/stats/api');
            const data = await response.json();
            
            // Update stat cards
            document.getElementById('currentCount').textContent = data.currentCount;
            document.getElementById('historicalTotal').textContent = data.historicalTotal;
            document.getElementById('receives24h').textContent = data.last24Hours.receives;
            document.getElementById('deletes24h').textContent = data.last24Hours.deletes;
            document.getElementById('forwards24h').textContent = data.last24Hours.forwards;
            
            // Update chart
            const timeline = data.last24Hours.timeline;
            chart.data.labels = timeline.map(d => {
                const date = new Date(d.timestamp);
                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            });
            chart.data.datasets[0].data = timeline.map(d => d.receives);
            chart.data.datasets[1].data = timeline.map(d => d.deletes);
            chart.data.datasets[2].data = timeline.map(d => d.forwards);
            chart.update('none'); // Update without animation
        } catch (error) {
            console.error('Failed to refresh stats:', error);
        }
    }, 30000);
});

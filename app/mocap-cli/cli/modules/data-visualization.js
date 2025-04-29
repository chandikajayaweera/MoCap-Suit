import blessed from 'blessed';
import contrib from 'blessed-contrib';
import figures from 'figures';

/**
 * Visualization module for real-time sensor data display in terminal UI
 */
class DataVisualization {
	constructor(screen, grid) {
		if (DataVisualization.instance) {
			return DataVisualization.instance;
		}

		DataVisualization.instance = this;

		// Store references
		this.screen = screen;
		this.grid = grid;

		// UI elements
		this.elements = {};

		// Visualization state
		this.dataHistory = {
			timestamps: [],
			rates: [],
			sensorData: {}
		};

		// Constants
		this.MAX_HISTORY = 60; // 1 minute of history at 1Hz updates
		this.sensorColors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'grey'];
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(screen, grid) {
		if (!DataVisualization.instance && screen && grid) {
			DataVisualization.instance = new DataVisualization(screen, grid);
		}
		return DataVisualization.instance;
	}

	/**
	 * Initialize visualization components
	 * @param {Object} options - Configuration options
	 */
	initialize(options = {}) {
		// Data rate chart
		this.elements.rateChart = this.grid.set(
			options.rateChart?.row || 1,
			options.rateChart?.col || 8,
			options.rateChart?.rowSpan || 3,
			options.rateChart?.colSpan || 4,
			contrib.line,
			{
				label: ' Data Rate (packets/sec) ',
				showLegend: false,
				xLabelPadding: 3,
				xPadding: 5,
				minY: 0,
				maxY: 100,
				style: {
					text: 'white',
					baseline: 'cyan',
					fg: 'white',
					border: { fg: 'cyan' }
				}
			}
		);

		// Initialize rate chart with empty data
		this.updateRateChart(0);

		// Sensor data chart (quaternion visualization)
		this.elements.sensorChart = this.grid.set(
			options.sensorChart?.row || 4,
			options.sensorChart?.col || 0,
			options.sensorChart?.rowSpan || 4,
			options.sensorChart?.colSpan || 8,
			contrib.line,
			{
				label: ' Sensor Data (w values) ',
				showLegend: true,
				legend: { width: 20 },
				xLabelPadding: 3,
				xPadding: 5,
				minY: -1,
				maxY: 1,
				style: {
					text: 'white',
					baseline: 'white',
					fg: 'white',
					border: { fg: 'cyan' }
				}
			}
		);

		// Initialize sensor chart with empty data
		this.updateSensorChart({});

		// Gauge showing active sensors
		this.elements.sensorGauge = this.grid.set(
			options.sensorGauge?.row || 4,
			options.sensorGauge?.col || 8,
			options.sensorGauge?.rowSpan || 2,
			options.sensorGauge?.colSpan || 4,
			contrib.gauge,
			{
				label: ' Active Sensors ',
				percent: [0],
				stroke: 'cyan',
				fill: 'black'
			}
		);

		// Sensor status table
		this.elements.sensorTable = this.grid.set(
			options.sensorTable?.row || 6,
			options.sensorTable?.col || 8,
			options.sensorTable?.rowSpan || 2,
			options.sensorTable?.colSpan || 4,
			contrib.table,
			{
				label: ' Sensor Status ',
				keys: true,
				columnSpacing: 1,
				columnWidth: [12, 12, 12],
				fg: 'white',
				selectedFg: 'black',
				selectedBg: 'cyan',
				interactive: false,
				border: { fg: 'cyan' }
			}
		);

		// Initialize table with empty data
		this.updateSensorTable({});

		// Render screen
		this.screen.render();

		return this;
	}

	/**
	 * Update rate chart with new data point
	 * @param {number} rate - Current data rate
	 */
	updateRateChart(rate) {
		// Add timestamp to history
		const now = new Date();
		const timeLabel = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;

		this.dataHistory.timestamps.push(timeLabel);
		this.dataHistory.rates.push(rate);

		// Keep history within limits
		if (this.dataHistory.timestamps.length > this.MAX_HISTORY) {
			this.dataHistory.timestamps.shift();
			this.dataHistory.rates.shift();
		}

		// Create x and y series data
		const x = [...this.dataHistory.timestamps];
		const y = [...this.dataHistory.rates];

		// Only show last 20 data points for readability
		const displayCount = Math.min(20, x.length);
		const xDisplay = x.slice(-displayCount);
		const yDisplay = y.slice(-displayCount);

		// Calculate max Y based on data
		const maxRate = Math.max(...yDisplay, 10);
		this.elements.rateChart.options.maxY = Math.ceil(maxRate * 1.2);

		// Update chart data
		this.elements.rateChart.setData([
			{
				title: 'packets/sec',
				x: xDisplay,
				y: yDisplay,
				style: { line: 'cyan' }
			}
		]);

		// Render screen
		this.screen.render();
	}

	/**
	 * Update sensor data chart
	 * @param {Object} sensorData - Current sensor data
	 */
	updateSensorChart(sensorData) {
		// Track sensor quaternion w values over time (for orientation visualization)
		const now = new Date();
		const timeLabel = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;

		// Add current timestamp if not already added by rate chart
		if (
			this.dataHistory.timestamps.length === 0 ||
			this.dataHistory.timestamps[this.dataHistory.timestamps.length - 1] !== timeLabel
		) {
			this.dataHistory.timestamps.push(timeLabel);

			// Keep history within limits
			if (this.dataHistory.timestamps.length > this.MAX_HISTORY) {
				this.dataHistory.timestamps.shift();
			}
		}

		// Process each sensor's quaternion data
		for (const key in sensorData) {
			if (key.startsWith('S') && Array.isArray(sensorData[key]) && sensorData[key].length === 4) {
				// Extract w value from quaternion
				const wValue = sensorData[key][0];

				// Initialize sensor history if not exists
				if (!this.dataHistory.sensorData[key]) {
					this.dataHistory.sensorData[key] = Array(this.dataHistory.timestamps.length - 1).fill(
						null
					);
					this.dataHistory.sensorData[key].push(wValue);
				} else {
					this.dataHistory.sensorData[key].push(wValue);

					// Keep history within limits
					if (this.dataHistory.sensorData[key].length > this.MAX_HISTORY) {
						this.dataHistory.sensorData[key].shift();
					}
				}
			}
		}

		// Ensure all sensors have data for each timestamp (fill with null when no data)
		for (const key in this.dataHistory.sensorData) {
			if (this.dataHistory.sensorData[key].length < this.dataHistory.timestamps.length) {
				// Add null for missing data point
				this.dataHistory.sensorData[key].push(null);
			}
		}

		// Create chart series data
		const series = [];
		let i = 0;

		for (const key in this.dataHistory.sensorData) {
			// Only add active sensors with recent data
			const hasRecentData = this.dataHistory.sensorData[key].slice(-5).some((v) => v !== null);

			if (hasRecentData) {
				series.push({
					title: key,
					x: [...this.dataHistory.timestamps],
					y: [...this.dataHistory.sensorData[key]],
					style: { line: this.sensorColors[i % this.sensorColors.length] }
				});
				i++;
			}
		}

		// Only show last 20 data points for readability
		const displayCount = Math.min(20, this.dataHistory.timestamps.length);
		series.forEach((s) => {
			s.x = s.x.slice(-displayCount);
			s.y = s.y.slice(-displayCount);
		});

		// Update chart with series data
		this.elements.sensorChart.setData(series);

		// Render screen
		this.screen.render();
	}

	/**
	 * Update sensor gauge
	 * @param {number} activeSensors - Number of active sensors
	 * @param {number} totalSensors - Total number of sensors
	 */
	updateSensorGauge(activeSensors, totalSensors) {
		const percent = Math.min(100, Math.round((activeSensors / totalSensors) * 100));
		this.elements.sensorGauge.setPercent(percent);

		// Update label with count
		this.elements.sensorGauge.setLabel(` Active Sensors (${activeSensors}/${totalSensors}) `);

		// Render screen
		this.screen.render();
	}

	/**
	 * Update sensor status table
	 * @param {Object} sensorData - Current sensor data
	 */
	updateSensorTable(sensorData) {
		// Create table data
		const tableData = [['Sensor', 'Status', 'Quality']];

		// Map for sensor names
		const sensorNames = {
			S0: 'R Lower Leg',
			S1: 'R Upper Leg',
			S2: 'L Lower Leg',
			S3: 'L Upper Leg',
			S4: 'L Lower Arm',
			S5: 'L Upper Arm',
			S6: 'R Lower Arm',
			S7: 'R Upper Arm'
		};

		// Add rows for each possible sensor
		for (let i = 0; i < 8; i++) {
			const key = `S${i}`;
			const name = sensorNames[key] || key;

			// Check if sensor is active
			const isActive =
				sensorData[key] && Array.isArray(sensorData[key]) && sensorData[key].length === 4;

			// Add row with status
			tableData.push([
				name,
				isActive ? '{green-fg}Connected{/}' : '{red-fg}Disconnected{/}',
				isActive ? this.getSignalQuality(sensorData[key]) : '{gray-fg}N/A{/}'
			]);
		}

		// Update table
		this.elements.sensorTable.setData({
			headers: tableData[0],
			data: tableData.slice(1)
		});

		// Render screen
		this.screen.render();
	}

	/**
	 * Get signal quality indicator based on quaternion stability
	 * @param {Array} quaternion - Quaternion data array
	 * @returns {string} Signal quality indicator
	 */
	getSignalQuality(quaternion) {
		if (!quaternion || !Array.isArray(quaternion)) return '{gray-fg}N/A{/}';

		// Check if quaternion is normalized (w^2 + x^2 + y^2 + z^2 ≈ 1)
		const [w, x, y, z] = quaternion;
		const magnitude = Math.sqrt(w * w + x * x + y * y + z * z);

		// Determine quality based on how close to normalized it is
		if (Math.abs(magnitude - 1) < 0.01) {
			return '{green-fg}' + figures.tick + ' Excellent{/}';
		} else if (Math.abs(magnitude - 1) < 0.05) {
			return '{yellow-fg}' + figures.warning + ' Fair{/}';
		} else {
			return '{red-fg}' + figures.cross + ' Poor{/}';
		}
	}

	/**
	 * Update all visualizations with current data
	 * @param {Object} data - Current data including sensor readings and statistics
	 */
	updateAll(data) {
		if (!data) return;

		// Update rate chart
		if (typeof data.dataRate === 'number') {
			this.updateRateChart(data.dataRate);
		}

		// Update sensor data chart and table
		if (data.sensorData) {
			this.updateSensorChart(data.sensorData);
			this.updateSensorTable(data.sensorData);
		}

		// Update sensor gauge
		if (typeof data.activeSensors === 'number' && typeof data.totalSensors === 'number') {
			this.updateSensorGauge(data.activeSensors, data.totalSensors);
		}

		// Render screen
		this.screen.render();
	}

	/**
	 * Reset all visualizations
	 */
	reset() {
		// Clear data history
		this.dataHistory = {
			timestamps: [],
			rates: [],
			sensorData: {}
		};

		// Reset charts
		this.updateRateChart(0);
		this.updateSensorChart({});
		this.updateSensorGauge(0, 8);
		this.updateSensorTable({});

		// Render screen
		this.screen.render();
	}
}

export default DataVisualization;

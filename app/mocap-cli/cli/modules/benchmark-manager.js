import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import figures from 'figures';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

/**
 * BenchmarkManager - Enhanced version for terminal UI
 * Handles benchmark tests with real-time visualization
 */
class BenchmarkManager {
	constructor(connectionManager, logger, uiManager = null) {
		if (BenchmarkManager.instance) {
			return BenchmarkManager.instance;
		}

		BenchmarkManager.instance = this;

		// Save dependencies
		this.connection = connectionManager;
		this.logger = logger;
		this.ui = uiManager;

		// Get directory path in ESM
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);

		// Create logs directory
		this.logsDir = path.join(__dirname, '..', '..', 'logs');
		if (!fs.existsSync(this.logsDir)) {
			fs.mkdirSync(this.logsDir, { recursive: true });
		}

		// Benchmark state
		this.resetState();
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(connectionManager, logger, uiManager = null) {
		if (!BenchmarkManager.instance) {
			BenchmarkManager.instance = new BenchmarkManager(connectionManager, logger, uiManager);
		} else if (uiManager && !BenchmarkManager.instance.ui) {
			// Update UI manager if it wasn't available during initial creation
			BenchmarkManager.instance.ui = uiManager;
		}
		return BenchmarkManager.instance;
	}

	/**
	 * Reset benchmark state
	 */
	resetState() {
		this.packetCount = 0;
		this.startTime = 0;
		this.lastSeq = null;
		this.missedPackets = 0;
		this.outOfOrderPackets = 0;
		this.timestamps = [];
		this.sensorData = {};
		this.rates = [];
		this.benchmarkActive = false;
	}

	/**
	 * Create a benchmark log file
	 * @returns {Object} Log file info
	 */
	createLogFile() {
		// Configure log file
		const timestamp = new Date()
			.toISOString()
			.replace(/:/g, '')
			.replace(/T/, '_')
			.replace(/\..+/, '');

		const portName = path.basename(this.connection.getPortName());
		const logFilename = path.join(this.logsDir, `bench_${portName}_${timestamp}.log`);
		const logFile = fs.createWriteStream(logFilename);

		// Write header
		logFile.write(`=== MOTION CAPTURE BENCHMARK ===\n`);
		logFile.write(`Date: ${new Date().toLocaleString()}\n`);
		logFile.write(`Device: ${this.connection.getPortName()}\n`);

		return { file: logFile, filename: logFilename };
	}

	/**
	 * Create benchmark visualization UI elements
	 * @param {Object} screen - Blessed screen instance
	 * @returns {Object} UI elements
	 */
	createBenchmarkUI(screen) {
		// Create main box
		const benchmarkBox = blessed.box({
			top: 'center',
			left: 'center',
			width: '80%',
			height: '80%',
			tags: true,
			border: {
				type: 'line',
				fg: 'cyan'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'cyan'
				}
			}
		});

		// Add title
		benchmarkBox.append(
			blessed.text({
				top: 0,
				left: 'center',
				content: '{bold}{cyan-fg}BENCHMARK IN PROGRESS{/}{/bold}',
				tags: true
			})
		);

		// Create grid layout for visualizations
		const grid = new contrib.grid({
			rows: 12,
			cols: 12,
			screen: screen
		});

		// Progress bar
		const progressBar = blessed.progressbar({
			top: 2,
			left: 'center',
			width: '90%',
			height: 1,
			orientation: 'horizontal',
			pch: '█',
			style: {
				bar: {
					bg: 'cyan'
				},
				bg: 'black'
			}
		});

		// Progress text
		const progressText = blessed.text({
			top: 3,
			left: 'center',
			content: 'Initializing...',
			tags: true
		});

		// Benchmark stats box
		const statsBox = blessed.box({
			top: 5,
			left: 'center',
			width: '90%',
			height: 3,
			tags: true,
			border: {
				type: 'line',
				fg: 'blue'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'blue'
				}
			}
		});

		// Data rate line chart
		const rateChart = contrib.line({
			top: 9,
			left: 0,
			width: '50%',
			height: '40%',
			label: ' Data Rate (packets/sec) ',
			showLegend: false,
			xLabelPadding: 3,
			xPadding: 5,
			minY: 0,
			style: {
				text: 'white',
				baseline: 'cyan',
				fg: 'white',
				border: { fg: 'cyan' }
			}
		});

		// Sensor count gauge
		const sensorGauge = contrib.gauge({
			top: 9,
			left: '50%',
			width: '50%',
			height: '40%',
			label: ' Active Sensors ',
			percent: [0],
			stroke: 'cyan'
		});

		// Add elements to container
		benchmarkBox.append(progressBar);
		benchmarkBox.append(progressText);
		benchmarkBox.append(statsBox);
		benchmarkBox.append(rateChart);
		benchmarkBox.append(sensorGauge);

		return {
			container: benchmarkBox,
			progressBar,
			progressText,
			statsBox,
			rateChart,
			sensorGauge
		};
	}

	/**
	 * Run benchmark test with advanced UI
	 * @param {number} duration - Test duration in seconds
	 * @param {Object} dataProcessor - Data processor instance
	 * @returns {Promise<Object>} - Test results
	 */
	async run(duration = 30, dataProcessor) {
		if (!this.connection.isConnected()) {
			this.logger.log('Cannot run benchmark: Not connected', 'error');
			if (this.ui) {
				this.ui.showNotification('Cannot run benchmark: Not connected', 'error');
			}
			return null;
		}

		// Use modern UI if available
		if (this.ui && this.ui.screen) {
			return this.runWithModernUI(duration, dataProcessor);
		} else {
			return this.runLegacy(duration, dataProcessor);
		}
	}

	/**
	 * Run benchmark with modern terminal UI
	 * @param {number} duration - Test duration in seconds
	 * @param {Object} dataProcessor - Data processor instance
	 * @returns {Promise<Object>} - Test results
	 */
	async runWithModernUI(duration, dataProcessor) {
		// Create benchmark UI
		const elements = this.createBenchmarkUI(this.ui.screen);
		this.ui.screen.append(elements.container);
		this.ui.screen.render();

		try {
			// Create log file
			const { file: logFile, filename: logFilename } = this.createLogFile();
			logFile.write(`Duration: ${duration} seconds\n\n`);
			logFile.write(`DIAGNOSTIC LOG:\n`);

			// Reset state
			this.resetState();
			this.benchmarkActive = true;
			dataProcessor.reset();

			// Initialize data structures for visualization
			const rateData = {
				x: [],
				y: []
			};

			// Stop any active streaming
			if (dataProcessor.isStreaming()) {
				await this.connection.sendCommand('X');
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			// Start streaming
			elements.statsBox.setContent('{yellow-fg}Starting sensor streaming...{/}');
			this.ui.screen.render();

			await this.connection.sendCommand('S');

			// Wait for streaming to start
			const streamingStarted = await new Promise((resolve) => {
				const checkInterval = setInterval(() => {
					if (dataProcessor.isStreaming()) {
						clearInterval(checkInterval);
						resolve(true);
					}
				}, 100);

				// Timeout after 5 seconds
				setTimeout(() => {
					clearInterval(checkInterval);
					resolve(false);
				}, 5000);
			});

			if (!streamingStarted) {
				throw new Error('Streaming failed to start for benchmark');
			}

			// Start benchmark
			this.startTime = Date.now();
			elements.statsBox.setContent(`{green-fg}Benchmark running...{/}`);
			this.ui.screen.render();

			// Set up monitor data processor
			const dataHandler = (data) => {
				this.packetCount = data.packetCount;
				this.missedPackets = data.missedPackets;
				this.outOfOrderPackets = data.outOfOrderPackets;
				this.sensorData = data.sensorData;
				this.timestamps.push(data.timestamp);
			};

			dataProcessor.onData(dataHandler);

			// Set up update interval
			const updateInterval = setInterval(() => {
				// Skip updates if not active
				if (!this.benchmarkActive) {
					clearInterval(updateInterval);
					return;
				}

				// Calculate elapsed time
				const now = Date.now();
				const elapsed = Math.floor((now - this.startTime) / 1000);
				const progressPct = Math.min(100, Math.floor((elapsed / duration) * 100));

				// Update progress display
				elements.progressBar.setProgress(progressPct);
				elements.progressText.setContent(
					`Progress: ${elapsed}/${duration} seconds (${progressPct}%)`
				);

				// Calculate current rate from the most recent data
				const recentTimestamps = this.timestamps.filter((t) => now - t < 1000);
				const currentRate = recentTimestamps.length;
				this.rates.push(currentRate);

				// Update rate chart data
				rateData.x.push(elapsed.toString());
				rateData.y.push(currentRate);

				// Keep last 20 data points for display
				if (rateData.x.length > 20) {
					rateData.x.shift();
					rateData.y.shift();
				}

				// Calculate maxY based on data
				const maxRate = Math.max(...rateData.y, 10);
				elements.rateChart.options.maxY = Math.max(100, Math.ceil(maxRate * 1.2));

				// Update chart
				elements.rateChart.setData([
					{
						title: 'packets/sec',
						x: rateData.x,
						y: rateData.y,
						style: { line: 'cyan' }
					}
				]);

				// Get active sensors count
				const activeSensorCount = Object.keys(this.sensorData || {}).filter(
					(key) => key.startsWith('S') && Array.isArray(this.sensorData[key])
				).length;

				// Update sensor gauge
				const sensorPercent = Math.min(100, Math.round((activeSensorCount / 8) * 100));
				elements.sensorGauge.setPercent(sensorPercent);
				elements.sensorGauge.setLabel(` Active Sensors (${activeSensorCount}/8) `);

				// Update stats display
				elements.statsBox.setContent(
					`{bold}Packets:{/bold} ${this.packetCount.toLocaleString()}   ` +
						`{bold}Rate:{/bold} ${currentRate.toFixed(1)} packets/sec\n` +
						`{bold}Missing:{/bold} ${this.missedPackets}   ` +
						`{bold}Active Sensors:{/bold} ${activeSensorCount}   ` +
						`{bold}Out-of-order:{/bold} ${this.outOfOrderPackets}`
				);

				// Log to file
				logFile.write(
					`[${elapsed}s] Packets: ${this.packetCount}, Rate: ${currentRate.toFixed(1)} pps, ` +
						`Missing: ${this.missedPackets}, Sensors: ${activeSensorCount}\n`
				);

				// Render updates
				this.ui.screen.render();

				// Stop if duration reached
				if (elapsed >= duration) {
					clearInterval(updateInterval);
					this.finalizeBenchmark(dataProcessor, elements, logFile, logFilename, duration);
				}
			}, 1000);

			// Wait for benchmark to complete
			return new Promise((resolve) => {
				// Set timeout to stop benchmark
				setTimeout(
					() => {
						if (this.benchmarkActive) {
							this.finalizeBenchmark(dataProcessor, elements, logFile, logFilename, duration).then(
								(results) => resolve(results)
							);
						}
					},
					(duration + 1) * 1000
				);
			});
		} catch (error) {
			// Clean up on error
			this.logger.log(`Benchmark error: ${error.message}`, 'error');

			if (this.ui) {
				this.ui.showNotification(`Benchmark error: ${error.message}`, 'error');
			}

			// Try to stop streaming
			try {
				await this.connection.sendCommand('X');
			} catch (e) {
				// Ignore cleanup errors
			}

			// Reset state
			this.resetState();
			dataProcessor.onData(null);

			// Remove UI elements
			elements.container.detach();
			this.ui.screen.render();

			return null;
		}
	}

	/**
	 * Finalize benchmark and calculate results
	 * @param {Object} dataProcessor - Data processor
	 * @param {Object} elements - UI elements
	 * @param {Object} logFile - Log file stream
	 * @param {string} logFilename - Log file path
	 * @param {number} duration - Test duration
	 * @returns {Promise<Object>} - Test results
	 */
	async finalizeBenchmark(dataProcessor, elements, logFile, logFilename, duration) {
		// Stop streaming
		elements.statsBox.setContent('{yellow-fg}Finalizing benchmark...{/}');
		this.ui.screen.render();

		try {
			await this.connection.sendCommand('X');
		} catch (e) {
			this.logger.log(`Error stopping streaming: ${e.message}`, 'warning');
		}

		// Calculate final statistics
		const endTime = Date.now();
		const totalDuration = (endTime - this.startTime) / 1000;
		const overallRate = this.packetCount / totalDuration;

		// Calculate min/max/avg rates
		const minRate = Math.min(...this.rates) || 0;
		const maxRate = Math.max(...this.rates) || 0;
		const avgRate =
			this.rates.length > 0 ? this.rates.reduce((a, b) => a + b, 0) / this.rates.length : 0;

		// Calculate packet loss rate
		const lossRate =
			this.packetCount + this.missedPackets > 0
				? (this.missedPackets / (this.packetCount + this.missedPackets)) * 100
				: 0;

		// Write results to log file
		logFile.write('\n\n=== PER-SECOND DATA RATES ===\n');
		logFile.write('Second,Packets,Cumulative Average\n');

		let cumulativeTotal = 0;
		this.rates.forEach((rate, index) => {
			cumulativeTotal += rate;
			const cumAvg = (cumulativeTotal / (index + 1)).toFixed(2);
			logFile.write(`${index + 1},${rate},${cumAvg}\n`);
		});

		logFile.write('\n\n=== BENCHMARK SUMMARY ===\n');
		logFile.write(`Test Duration: ${totalDuration.toFixed(2)} seconds\n`);
		logFile.write(`Total Packets: ${this.packetCount}\n`);
		logFile.write(`Overall Rate: ${overallRate.toFixed(2)} packets/second\n\n`);

		logFile.write('Performance Metrics:\n');
		logFile.write(`  Minimum Rate: ${minRate} packets/second\n`);
		logFile.write(`  Average Rate: ${avgRate.toFixed(1)} packets/second\n`);
		logFile.write(`  Maximum Rate: ${maxRate} packets/second\n\n`);

		logFile.write('Reliability Metrics:\n');
		logFile.write(`  Missing Packets: ${this.missedPackets.toLocaleString()}\n`);
		logFile.write(`  Out-of-order: ${this.outOfOrderPackets.toLocaleString()}\n`);
		logFile.write(`  Packet Loss Rate: ${lossRate.toFixed(2)}%\n\n`);

		logFile.write(`Benchmark completed at: ${new Date().toLocaleString()}\n`);
		logFile.end();

		// Remove UI elements
		elements.container.detach();
		this.ui.screen.render();

		// Reset benchmark state
		this.benchmarkActive = false;
		dataProcessor.onData(null);

		// Format results
		const results = {
			duration: totalDuration,
			totalPackets: this.packetCount,
			overallRate: overallRate,
			minRate: minRate,
			maxRate: maxRate,
			avgRate: avgRate,
			missedPackets: this.missedPackets,
			outOfOrder: this.outOfOrderPackets,
			lossRate: lossRate,
			logFile: path.basename(logFilename)
		};

		// Reset state for next benchmark
		this.resetState();

		// Return results
		return results;
	}
}

// Import here to avoid circular dependency
import DataProcessor from './data-processor.js';

export default BenchmarkManager;

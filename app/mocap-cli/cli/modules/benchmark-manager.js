import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import boxen from 'boxen';
import { createSpinner } from 'nanospinner';
import logUpdate from 'log-update';
import cliCursor from 'cli-cursor';

/**
 * BenchmarkManager - Handles benchmark tests
 */
class BenchmarkManager {
	constructor(connectionManager, logger) {
		if (BenchmarkManager.instance) {
			return BenchmarkManager.instance;
		}

		BenchmarkManager.instance = this;

		// Save dependencies
		this.connection = connectionManager;
		this.logger = logger;

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
	static getInstance(connectionManager, logger) {
		if (!BenchmarkManager.instance) {
			BenchmarkManager.instance = new BenchmarkManager(connectionManager, logger);
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
	}

	/**
	 * Run benchmark test
	 */
	async run(duration = 30) {
		if (!this.connection.isConnected()) {
			this.logger.log('Cannot run benchmark: Not connected', 'error');
			return false;
		}

		try {
			// Reset state
			this.resetState();

			// Stop any active streaming
			const spinner = createSpinner('Preparing benchmark...').start();
			if (DataProcessor.getInstance().isStreaming()) {
				await this.connection.sendCommand('X');
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
			spinner.success();

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
			logFile.write(`Duration: ${duration} seconds\n\n`);
			logFile.write(`DIAGNOSTIC LOG:\n`);

			// Clear the console and show benchmark header
			console.clear();
			console.log(
				boxen(
					chalk.bold.cyan('BENCHMARK IN PROGRESS') +
						'\n\n' +
						`${chalk.bold('Device:')} ${chalk.cyan(this.connection.getPortName())}\n` +
						`${chalk.bold('Duration:')} ${chalk.cyan(duration)} seconds\n` +
						`${chalk.bold('Start Time:')} ${chalk.cyan(new Date().toLocaleString())}`,
					{
						padding: 1,
						margin: 1,
						borderStyle: 'round',
						borderColor: 'cyan',
						textAlignment: 'center'
					}
				)
			);

			// Hide cursor during benchmark
			cliCursor.hide();

			// Set up data processing
			const dataProcessor = DataProcessor.getInstance();
			this.dataHandler = (data) => {
				this.packetCount = data.packetCount;
				this.sensorData = data.sensorData;
				this.missedPackets = data.missedPackets;
				this.outOfOrderPackets = data.outOfOrderPackets;
				this.timestamps.push(data.timestamp);
			};

			dataProcessor.onData(this.dataHandler);

			// Start streaming
			this.startTime = Date.now();
			await this.connection.sendCommand('S');

			// Set up interval to track per-second stats
			let statInterval;
			await new Promise((resolve) => {
				statInterval = setInterval(() => {
					const now = Date.now();
					const elapsed = Math.floor((now - this.startTime) / 1000);

					// Calculate packets in this second
					const windowStart = this.startTime + elapsed * 1000;
					const packetsThisSecond = this.timestamps.filter(
						(t) => t >= windowStart && t < windowStart + 1000
					).length;

					this.rates.push(packetsThisSecond);

					// Progress bar calculation
					const progressPercentage = Math.min(elapsed / duration, 1);
					const progressBarWidth = 40;
					const completedWidth = Math.floor(progressPercentage * progressBarWidth);
					const remainingWidth = progressBarWidth - completedWidth;

					const progressBar =
						chalk.cyan('█'.repeat(completedWidth)) + chalk.gray('░'.repeat(remainingWidth));

					// Calculate estimated time remaining
					const eta = elapsed > 0 ? Math.ceil((duration - elapsed) * (elapsed / duration)) : '?';

					// Update on console with improved display
					const overallRate = this.packetCount / Math.max((now - this.startTime) / 1000, 0.001);

					logUpdate(
						`\n  ${chalk.bold('Progress:')} ${progressBar} ${chalk.yellow(Math.floor(progressPercentage * 100))}%\n\n` +
							`  ${chalk.bold('Elapsed:')} ${chalk.cyan(elapsed)}s / ${duration}s ${chalk.gray(`(ETA: ${eta}s)`)}\n` +
							`  ${chalk.bold('Packets:')} ${chalk.cyan(this.packetCount.toLocaleString())}\n` +
							`  ${chalk.bold('Rate:')} ${chalk.cyan(overallRate.toFixed(1))} packets/sec\n` +
							`  ${chalk.bold('Missing:')} ${this.missedPackets > 0 ? chalk.red(this.missedPackets) : chalk.green(0)}\n\n`
					);

					// Write to log file
					logFile.write(
						`[${elapsed}s] Packets: ${this.packetCount}, Rate: ${overallRate.toFixed(1)} pps, Missing: ${this.missedPackets}\n`
					);

					// End test if duration is reached
					if (elapsed >= duration) {
						clearInterval(statInterval);
						// Resolve the promise to continue execution
						resolve();
					}
				}, 1000);
			});

			// Remove data handler
			dataProcessor.onData(null);

			// Stop streaming
			await this.connection.sendCommand('X');

			// Show cursor again
			cliCursor.show();

			// Calculate statistics
			const totalDuration = (Date.now() - this.startTime) / 1000;
			const overallRate = this.packetCount / totalDuration;

			// Clear update display
			logUpdate.clear();
			console.log('\n'); // Add spacing

			// Format summary
			const summary = boxen(
				chalk.bold.cyan('BENCHMARK RESULTS') +
					'\n\n' +
					`${chalk.bold('Test Duration:')}        ${chalk.yellow(totalDuration.toFixed(2))} seconds\n` +
					`${chalk.bold('Total Packets:')}        ${chalk.yellow(this.packetCount.toLocaleString())}\n` +
					`${chalk.bold('Overall Rate:')}         ${chalk.yellow(overallRate.toFixed(2))} packets/second\n\n` +
					chalk.bold.blue('Performance Metrics:') +
					'\n' +
					`  ${chalk.bold('Minimum Rate:')}       ${chalk.green(Math.min(...this.rates) || 0)} packets/second\n` +
					`  ${chalk.bold('Average Rate:')}       ${chalk.green((this.rates.reduce((a, b) => a + b, 0) / (this.rates.length || 1)).toFixed(1))} packets/second\n` +
					`  ${chalk.bold('Maximum Rate:')}       ${chalk.green(Math.max(...this.rates) || 0)} packets/second\n\n` +
					chalk.bold.blue('Reliability Metrics:') +
					'\n' +
					`  ${chalk.bold('Missing Packets:')}    ${this.missedPackets > 0 ? chalk.red(this.missedPackets.toLocaleString()) : chalk.green('0')}\n` +
					`  ${chalk.bold('Out-of-order:')}       ${this.outOfOrderPackets > 0 ? chalk.yellow(this.outOfOrderPackets.toLocaleString()) : chalk.green('0')}\n` +
					`  ${chalk.bold('Packet Loss Rate:')}   ${
						this.missedPackets > 0
							? chalk.red(
									(
										(this.missedPackets / (this.packetCount + this.missedPackets || 1)) *
										100
									).toFixed(2) + '%'
								)
							: chalk.green('0.00%')
					}`,
				{
					padding: 1,
					margin: 1,
					borderStyle: 'round',
					borderColor: 'cyan',
					textAlignment: 'center'
				}
			);

			console.log(summary);

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
			logFile.write(`  Minimum Rate: ${Math.min(...this.rates) || 0} packets/second\n`);
			logFile.write(
				`  Average Rate: ${(this.rates.reduce((a, b) => a + b, 0) / (this.rates.length || 1)).toFixed(1)} packets/second\n`
			);
			logFile.write(`  Maximum Rate: ${Math.max(...this.rates) || 0} packets/second\n\n`);

			logFile.write('Reliability Metrics:\n');
			logFile.write(`  Missing Packets: ${this.missedPackets.toLocaleString()}\n`);
			logFile.write(`  Out-of-order: ${this.outOfOrderPackets.toLocaleString()}\n`);
			logFile.write(
				`  Packet Loss Rate: ${((this.missedPackets / (this.packetCount + this.missedPackets || 1)) * 100).toFixed(2)}%\n\n`
			);

			logFile.write(`Benchmark completed at: ${new Date().toLocaleString()}\n`);
			logFile.end();

			console.log(
				`\n ${chalk.green(figures.tick)} ${chalk.cyan(`Detailed report saved to: ${chalk.bold(path.basename(logFile.path))}`)}`
			);

			return true;
		} catch (error) {
			cliCursor.show();
			this.logger.log(`Benchmark error: ${error.message}`, 'error');
			return false;
		}
	}
}

// Import here to avoid circular dependency
import DataProcessor from './data-processor.js';
import figures from 'figures';

export default BenchmarkManager;

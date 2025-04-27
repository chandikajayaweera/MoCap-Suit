#!/usr/bin/env node
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import boxen from 'boxen';
import inquirer from 'inquirer';
import ora from 'ora';
import { fileURLToPath } from 'url';

/**
 * Motion Capture System Benchmark Tool
 * Interactive CLI for testing sensor data reception rates
 */

// Get directory path in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const BAUD_RATE = 115200; // Fixed baud rate
const DEFAULT_DURATION = 30; // Default test duration in seconds
const isWindows = process.platform === 'win32';

// Configure interactive CLI
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

// Statistics tracking
let buffer = Buffer.alloc(0);
let packetCount = 0;
let startTime = 0;
let lastSeq = null;
let missedPackets = 0;
let outOfOrderPackets = 0;
const timestamps = [];
const rates = [];
const seqNumbers = [];
const jitterValues = [];
let lastPacketTime = 0;

// Spinner for loading states
let spinner;

// Create logs directory relative to the project root
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Fall back to simple CLI if inquirer doesn't work
 */
async function simplifiedPrompt(message, choices) {
	console.log(`${message}`);

	// Print options with numbers
	choices.forEach((choice, i) => {
		console.log(`${i + 1}. ${choice.name}`);
	});

	const answer = await new Promise((resolve) => {
		rl.question('Enter option number: ', (answer) => {
			const num = parseInt(answer);
			if (!isNaN(num) && num >= 1 && num <= choices.length) {
				resolve(choices[num - 1].value);
			} else {
				// Default to first option if invalid
				console.log(`Invalid selection. Using default: ${choices[0].name}`);
				resolve(choices[0].value);
			}
		});
	});

	return answer;
}

/**
 * Patch inquirer for better Windows compatibility
 */
function patchInquirer() {
	// Use native Windows line endings on Windows
	if (isWindows) {
		// Use raw mode if available, but don't fail if not
		try {
			process.stdin.setRawMode(true);
		} catch (e) {
			// Ignore errors for cases where raw mode is not available
		}
	}

	// Add specific inquirer options for better Windows compatibility
	const defaultInquirerPrompt = inquirer.prompt;
	inquirer.prompt = (questions, ...rest) => {
		// Add better Windows options
		const patchedQuestions = questions.map((q) => {
			// For list type questions, ensure they work better on Windows
			if (q.type === 'list') {
				return {
					...q,
					loop: false, // Disable looping which can cause issues
					pageSize: Math.min(q.choices?.length || 10, 10) // Limit page size
				};
			}
			return q;
		});

		return defaultInquirerPrompt(patchedQuestions, ...rest);
	};
}

/**
 * Main function to run the benchmark
 */
async function main() {
	console.log(
		boxen(
			chalk.bold.cyan('Motion Capture System Benchmark Tool') +
				'\n\n' +
				chalk.white('Test your sensor data reception rates and reliability'),
			{
				padding: 1,
				margin: 1,
				borderStyle: 'round',
				borderColor: 'cyan',
				title: chalk.bold.white('MoCap Bench'),
				titleAlignment: 'center'
			}
		)
	);

	try {
		// Patch inquirer for better compatibility
		patchInquirer();

		// Get available ports
		spinner = ora('Scanning for serial ports...').start();
		const ports = await SerialPort.list();
		spinner.succeed(chalk.green('Found ' + ports.length + ' serial ports'));

		if (ports.length === 0) {
			console.error(chalk.red('No serial ports found. Please check your device connections.'));
			process.exit(1);
		}

		// Format port options for selection
		const portChoices = ports.map((port) => {
			const label = port.path + (port.manufacturer ? chalk.gray(` (${port.manufacturer})`) : '');
			return {
				name: label,
				value: port.path
			};
		});

		// Interactive config prompt with fallback
		let answers;
		try {
			// Try using inquirer first
			answers = await inquirer.prompt([
				{
					type: 'list',
					name: 'port',
					message: 'Select serial port:',
					choices: portChoices,
					pageSize: portChoices.length // Show all options on one page
				},
				{
					type: 'input',
					name: 'duration',
					message: 'Test duration (seconds):',
					default: DEFAULT_DURATION,
					validate: (value) => {
						const num = parseInt(value);
						return !isNaN(num) && num > 0 ? true : 'Please enter a positive number';
					},
					filter: (value) => parseInt(value)
				},
				{
					type: 'confirm',
					name: 'createLog',
					message: 'Save results to log file?',
					default: true
				}
			]);
		} catch (err) {
			// Fall back to simplified prompt if inquirer fails
			console.log(
				chalk.yellow('\nFalling back to simplified interface due to compatibility issues.')
			);

			const selectedPort = await simplifiedPrompt('Select serial port:', portChoices);

			let duration = DEFAULT_DURATION;
			const durationStr = await new Promise((resolve) => {
				rl.question(`Test duration (seconds) [${DEFAULT_DURATION}]: `, (answer) => {
					resolve(answer || DEFAULT_DURATION.toString());
				});
			});

			try {
				duration = parseInt(durationStr);
				if (isNaN(duration) || duration <= 0) {
					duration = DEFAULT_DURATION;
					console.log(`Invalid duration. Using default: ${DEFAULT_DURATION}`);
				}
			} catch (e) {
				duration = DEFAULT_DURATION;
			}

			const createLogStr = await new Promise((resolve) => {
				rl.question('Save results to log file? (y/n) [y]: ', (answer) => {
					resolve(answer || 'y');
				});
			});

			const createLog = createLogStr.toLowerCase().startsWith('y');

			answers = {
				port: selectedPort,
				duration,
				createLog
			};
		}

		// Setup log file if requested
		let logFile;
		let logFilename;

		if (answers.createLog) {
			// Generate shorter filename with less verbosity
			const timestamp = new Date()
				.toISOString()
				.replace(/:/g, '')
				.replace(/T/, '_')
				.replace(/\..+/, '');

			const portName = path.basename(answers.port);
			logFilename = path.join(logsDir, `bench_${portName}_${timestamp.substring(0, 15)}.log`);
			logFile = fs.createWriteStream(logFilename);

			// Write header
			logFile.write(`=== MOTION CAPTURE BENCHMARK ===\n`);
			logFile.write(`Date: ${new Date().toLocaleString()}\n`);
			logFile.write(`Device: ${answers.port}\n`);
			logFile.write(`Baud Rate: ${BAUD_RATE}\n`);
			logFile.write(`Duration: ${answers.duration} seconds\n\n`);
			logFile.write(`DIAGNOSTIC LOG:\n`);
		}

		// Log function
		function log(msg, type = 'info') {
			const timestamp = new Date().toISOString();
			const logMessage = `[${timestamp}] ${msg}`;

			// Write to file if enabled
			if (logFile) {
				logFile.write(logMessage + '\n');
			}

			// Console output with color
			switch (type) {
				case 'error':
					console.error(chalk.red(msg));
					break;
				case 'warn':
					console.warn(chalk.yellow(msg));
					break;
				case 'success':
					console.log(chalk.green(msg));
					break;
				case 'info':
				default:
					console.log(msg);
			}
		}

		// Status display function
		function updateStatus(message) {
			process.stdout.write(`\r${chalk.cyan('→')} ${message.padEnd(80)}`);
		}

		log(`Starting benchmark on port ${answers.port}`, 'info');

		// Open port
		spinner = ora(`Opening serial port ${answers.port}...`).start();
		const port = new SerialPort({
			path: answers.port,
			baudRate: BAUD_RATE,
			autoOpen: false,
			dataBits: 8,
			parity: 'none',
			stopBits: 1,
			rtscts: false,
			xon: false,
			xoff: false,
			hupcl: false,
			highWaterMark: 4096 // Increased buffer for better performance
		});

		// Open port with error handling
		await new Promise((resolve, reject) => {
			port.open((err) => {
				if (err) {
					spinner.fail(`Error opening port: ${err.message}`);
					reject(err);
					return;
				}
				spinner.succeed(`Port opened successfully`);
				resolve();
			});
		});

		// Configure port signals
		await new Promise((resolve) => {
			port.set({ dtr: false, rts: false }, (err) => {
				if (err) {
					log(`Warning: Could not set port signals: ${err.message}`, 'warn');
				}
				log(`Port configured, waiting for device initialization...`, 'info');
				// Short pause for device init
				setTimeout(resolve, 3000);
			});
		});

		// Handle data reception
		const processData = (chunk) => {
			try {
				if (!startTime) {
					// Still in initialization phase, store data but don't process
					buffer = Buffer.concat([buffer, chunk]);
					return;
				}

				const receivedTime = Date.now();

				// Calculate jitter if we've received packets before
				if (lastPacketTime > 0) {
					const interval = receivedTime - lastPacketTime;
					jitterValues.push(interval);
				}
				lastPacketTime = receivedTime;

				// Append to buffer
				buffer = Buffer.concat([buffer, chunk]);

				// Process all complete packets
				let processedUpTo = 0;
				let dataStart;

				while ((dataStart = buffer.indexOf('DATA:', processedUpTo)) !== -1) {
					const nextDataStart = buffer.indexOf('DATA:', dataStart + 5);

					if (nextDataStart === -1) break; // Incomplete packet

					// Extract packet and check sequence
					const packet = buffer.slice(dataStart + 5, nextDataStart);
					const packetStr = packet.toString();

					// Extract sequence number if available
					const seq = extractSequence(packetStr);
					if (seq !== null) {
						seqNumbers.push(seq);

						// Check for packet loss or out-of-order delivery
						if (lastSeq !== null) {
							const expectedSeq = (lastSeq + 1) % 65536; // 16-bit rollover

							if (seq !== expectedSeq) {
								if (seq > expectedSeq) {
									// Missing packets
									const missing = (seq - expectedSeq) % 65536;
									if (missing < 1000) {
										// Sanity check
										missedPackets += missing;
									}
								} else {
									// Out of order packet
									outOfOrderPackets++;
								}
							}
						}
						lastSeq = seq;
					}

					// Count this packet
					packetCount++;
					timestamps.push(receivedTime);

					// Periodic status updates (limit to reduce CPU impact)
					if (packetCount % 20 === 0) {
						const elapsed = (receivedTime - startTime) / 1000;
						const rate = packetCount / elapsed;
						updateStatus(
							`Received: ${packetCount} packets | Rate: ${rate.toFixed(2)} pps | Missing: ${missedPackets} | Time: ${elapsed.toFixed(1)}s`
						);
					}

					// Move pointer
					processedUpTo = nextDataStart;
				}

				// Keep only unprocessed data
				if (processedUpTo > 0) {
					buffer = buffer.slice(processedUpTo);
				}

				// Safety check for buffer growth
				if (buffer.length > 8192) {
					log(`Warning: Buffer size (${buffer.length}) exceeds threshold, truncating`, 'warn');
					buffer = buffer.slice(buffer.length - 1024);
				}
			} catch (error) {
				log(`Error processing data: ${error.message}`, 'error');
			}
		};

		// Set up port data handler
		port.on('data', processData);

		// Error handler
		port.on('error', (err) => {
			log(`Serial port error: ${err.message}`, 'error');
		});

		// Initialize and wait for abort or completion
		spinner = ora(`Initializing device...`).start();

		// Send start command and begin benchmark
		await new Promise((resolve, reject) => {
			// First stop any existing streaming
			port.write('X\n', (err) => {
				if (err) log(`Warning: Could not send stop command: ${err.message}`, 'warn');

				setTimeout(() => {
					// Start streaming
					port.write('S\n', (err) => {
						if (err) {
							spinner.fail(`Failed to start streaming: ${err.message}`);
							reject(err);
							return;
						}

						startTime = Date.now();
						spinner.succeed(`Benchmark started!`);

						log(`Benchmark started at ${new Date(startTime).toLocaleString()}`, 'success');

						// Track performance per second
						const statInterval = setInterval(() => {
							if (!startTime) return;

							const now = Date.now();
							const elapsed = Math.floor((now - startTime) / 1000);

							// Calculate packets in this second
							const windowStart = startTime + elapsed * 1000;
							const packetsThisSecond = timestamps.filter(
								(t) => t >= windowStart && t < windowStart + 1000
							).length;

							rates.push(packetsThisSecond);

							// End test if duration is reached
							if (elapsed >= answers.duration) {
								clearInterval(statInterval);
								cleanup(0);
							}
						}, 1000);

						resolve();
					});
				}, 500);
			});
		});

		// Helper function to extract sequence number from packet
		function extractSequence(data) {
			try {
				// Find SEQ: marker in the data
				const seqIndex = data.indexOf('SEQ:');
				if (seqIndex === -1) return null;

				// Extract sequence value
				const seqStart = seqIndex + 4;
				const seqEnd = data.indexOf(',', seqStart);
				if (seqEnd === -1) return null;

				return parseInt(data.substring(seqStart, seqEnd), 10);
			} catch (e) {
				return null;
			}
		}

		// Function to clean up and exit
		async function cleanup(exitCode = 0) {
			// Prevent duplicate cleanup
			if (cleanup.called) return;
			cleanup.called = true;

			spinner = ora(`Completing benchmark...`).start();

			try {
				// Calculate final statistics
				const duration = (Date.now() - startTime) / 1000;
				const overallRate = packetCount / duration;

				// Calculate jitter
				let avgJitter = 0;
				if (jitterValues.length > 1) {
					const jitterSum = jitterValues.reduce((a, b) => a + b, 0);
					const avgInterval = jitterSum / jitterValues.length;
					avgJitter =
						jitterValues.reduce((sum, interval) => sum + Math.abs(interval - avgInterval), 0) /
						jitterValues.length;
				}

				// Send stop command
				await new Promise((resolve) => {
					port.write('X\n', () => {
						port.drain(resolve);
					});
				});

				spinner.succeed(`Benchmark completed successfully`);

				// Format summary
				const summary = boxen(
					chalk.bold.cyan('BENCHMARK RESULTS') +
						'\n\n' +
						`${chalk.bold('Test Duration:')}        ${chalk.yellow(duration.toFixed(2))} seconds\n` +
						`${chalk.bold('Total Packets:')}        ${chalk.yellow(packetCount.toLocaleString())}\n` +
						`${chalk.bold('Overall Rate:')}         ${chalk.yellow(overallRate.toFixed(2))} packets/second\n\n` +
						chalk.bold.white('Performance Metrics:') +
						'\n' +
						`  ${chalk.bold('Minimum Rate:')}       ${chalk.green(Math.min(...rates) || 0)} packets/second\n` +
						`  ${chalk.bold('Average Rate:')}       ${chalk.green((rates.reduce((a, b) => a + b, 0) / (rates.length || 1)).toFixed(1))} packets/second\n` +
						`  ${chalk.bold('Maximum Rate:')}       ${chalk.green(Math.max(...rates) || 0)} packets/second\n\n` +
						chalk.bold.white('Reliability Metrics:') +
						'\n' +
						`  ${chalk.bold('Missing Packets:')}    ${missedPackets > 0 ? chalk.red(missedPackets.toLocaleString()) : chalk.green('0')}\n` +
						`  ${chalk.bold('Out-of-order:')}       ${outOfOrderPackets > 0 ? chalk.yellow(outOfOrderPackets.toLocaleString()) : chalk.green('0')}\n` +
						`  ${chalk.bold('Packet Loss Rate:')}   ${
							missedPackets > 0
								? chalk.red(
										((missedPackets / (packetCount + missedPackets || 1)) * 100).toFixed(2) + '%'
									)
								: chalk.green('0.00%')
						}\n` +
						`  ${chalk.bold('Average Jitter:')}     ${chalk.yellow(avgJitter.toFixed(2))} ms`,
					{
						padding: 1,
						margin: 1,
						borderStyle: 'round',
						borderColor: 'cyan'
					}
				);

				console.log(summary);

				// Write results to log file if enabled
				if (answers.createLog && logFile) {
					logFile.write('\n\n=== PER-SECOND DATA RATES ===\n');
					logFile.write('Second,Packets,Cumulative Average\n');

					let cumulativeTotal = 0;
					rates.forEach((rate, index) => {
						cumulativeTotal += rate;
						const cumAvg = (cumulativeTotal / (index + 1)).toFixed(2);
						logFile.write(`${index + 1},${rate},${cumAvg}\n`);
					});

					logFile.write('\n\n=== BENCHMARK SUMMARY ===\n');
					logFile.write(`Test Duration: ${duration.toFixed(2)} seconds\n`);
					logFile.write(`Total Packets: ${packetCount}\n`);
					logFile.write(`Overall Rate: ${overallRate.toFixed(2)} packets/second\n\n`);

					logFile.write('Performance Metrics:\n');
					logFile.write(`  Minimum Rate: ${Math.min(...rates) || 0} packets/second\n`);
					logFile.write(
						`  Average Rate: ${(rates.reduce((a, b) => a + b, 0) / (rates.length || 1)).toFixed(1)} packets/second\n`
					);
					logFile.write(`  Maximum Rate: ${Math.max(...rates) || 0} packets/second\n\n`);

					logFile.write('Reliability Metrics:\n');
					logFile.write(`  Missing Packets: ${missedPackets.toLocaleString()}\n`);
					logFile.write(`  Out-of-order: ${outOfOrderPackets.toLocaleString()}\n`);
					logFile.write(
						`  Packet Loss Rate: ${((missedPackets / (packetCount + missedPackets || 1)) * 100).toFixed(2)}%\n`
					);
					logFile.write(`  Average Jitter: ${avgJitter.toFixed(2)} ms\n\n`);

					logFile.write(`Benchmark completed at: ${new Date().toLocaleString()}\n`);

					console.log(
						chalk.cyan(
							`\nDetailed report saved to: ${chalk.bold(`logs/${path.basename(logFilename)}`)}`
						)
					);
				}

				// Close port and log file
				await new Promise((resolve) => {
					if (port.isOpen) {
						port.close(resolve);
					} else {
						resolve();
					}
				});

				if (logFile) {
					logFile.end();
				}

				// Close the readline interface
				rl.close();

				process.exit(exitCode);
			} catch (err) {
				spinner.fail(`Error during cleanup: ${err.message}`);
				process.exit(1);
			}
		}

		// Handle Ctrl+C and other termination
		process.on('SIGINT', () => {
			console.log(chalk.yellow('\n\nUser interrupted test'));
			cleanup(0);
		});

		process.on('SIGTERM', () => {
			console.log(chalk.yellow('\n\nTest terminated'));
			cleanup(0);
		});
	} catch (error) {
		if (spinner) spinner.fail(`Error: ${error.message}`);
		else console.error(chalk.red(`Error: ${error.message}`));

		process.exit(1);
	}
}

// Run main function
main().catch((err) => {
	console.error(chalk.red(`Fatal error: ${err.message}`));
	process.exit(1);
});

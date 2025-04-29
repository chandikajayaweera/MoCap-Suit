import { SerialPort } from 'serialport';
import { createSpinner } from 'nanospinner';
import chalk from 'chalk';

/**
 * ConnectionManager - Singleton that handles device connection
 */
class ConnectionManager {
	constructor() {
		if (ConnectionManager.instance) {
			return ConnectionManager.instance;
		}

		ConnectionManager.instance = this;

		this.serialPort = null;
		this.dataHandler = null;
		this.BAUD_RATE = 115200;
	}

	/**
	 * Get singleton instance
	 */
	static getInstance() {
		if (!ConnectionManager.instance) {
			ConnectionManager.instance = new ConnectionManager();
		}
		return ConnectionManager.instance;
	}

	/**
	 * Connect to a serial port
	 */
	async connect(portPath) {
		// Clear any existing connection
		await this.disconnect();

		try {
			// Create port instance
			this.serialPort = new SerialPort({
				path: portPath,
				baudRate: this.BAUD_RATE,
				autoOpen: false,
				dataBits: 8,
				parity: 'none',
				stopBits: 1,
				rtscts: false,
				xon: false,
				xoff: false,
				hupcl: false,
				highWaterMark: 65536 // Increase buffer size for better performance
			});

			// Create promise to handle async connection
			await new Promise((resolve, reject) => {
				this.serialPort.open((err) => {
					if (err) {
						reject(err);
						return;
					}

					// Set up data handling
					if (this.dataHandler) {
						this.serialPort.on('data', this.dataHandler);
					}

					// Set up error handling
					this.serialPort.on('error', (error) => {
						console.error(`Serial port error: ${error.message}`);
					});

					// Configure port signals
					this.serialPort.set({ dtr: false, rts: false }, (err) => {
						if (err) {
							console.warn(`Warning: Could not set port signals: ${err.message}`);
						}
						resolve();
					});
				});
			});

			return true;
		} catch (error) {
			console.error(`Connection error: ${error.message}`);
			return false;
		}
	}

	/**
	 * Disconnect from current port
	 */
	async disconnect() {
		if (!this.serialPort) return true;

		try {
			const spinner = createSpinner('Disconnecting...').start();

			// Close the port
			await new Promise((resolve) => {
				if (this.serialPort.isOpen) {
					this.serialPort.close(() => {
						this.serialPort = null;
						resolve();
					});
				} else {
					this.serialPort = null;
					resolve();
				}
			});

			spinner.success({ text: 'Device disconnected' });
			return true;
		} catch (error) {
			console.error(`Disconnect error: ${error.message}`);
			return false;
		}
	}

	/**
	 * Send command to device
	 */
	async sendCommand(command) {
		if (!this.serialPort || !this.serialPort.isOpen) {
			console.error('Cannot send command: Not connected');
			return false;
		}

		// Command labels for display
		const commandLabels = {
			S: 'Start streaming',
			X: 'Stop streaming',
			C: 'Check sensors',
			I: 'Initialize sensors',
			P: 'Ping node',
			N: 'Restart node',
			R: 'Restart receiver',
			Q: 'Quit receiver'
		};

		const label =
			commandLabels[command] || (command.startsWith('D:') ? 'Set debug level' : command);

		try {
			const spinner = createSpinner(`Sending: ${label}`).start();

			// Send the command with newline
			await new Promise((resolve, reject) => {
				this.serialPort.write(`${command}\n`, (err) => {
					if (err) {
						reject(err);
						return;
					}

					this.serialPort.drain(resolve);
				});
			});

			spinner.success({ text: `Command sent: ${chalk.bold(label)}` });
			return true;
		} catch (error) {
			console.error(`Command error: ${error.message}`);
			return false;
		}
	}

	/**
	 * Check if connection is active
	 */
	isConnected() {
		return this.serialPort !== null && this.serialPort.isOpen;
	}

	/**
	 * Get current port name
	 */
	getPortName() {
		return this.serialPort ? this.serialPort.path : null;
	}

	/**
	 * Set data handler
	 */
	onData(handler) {
		this.dataHandler = handler;

		// If already connected, add the handler
		if (this.serialPort && this.serialPort.isOpen) {
			this.serialPort.on('data', handler);
		}
	}
}

export default ConnectionManager;

import { SerialPort } from 'serialport';
import figures from 'figures';

/**
 * Enhanced ConnectionManager - Singleton that handles device connection
 * with improved UI integration and error handling
 */
class ConnectionManager {
	constructor() {
		if (ConnectionManager.instance) {
			return ConnectionManager.instance;
		}

		ConnectionManager.instance = this;

		this.serialPort = null;
		this.dataHandler = null;
		this.connectionStatusListeners = [];
		this.BAUD_RATE = 115200;

		// Connection state
		this.connecting = false;
		this.connected = false;
		this.connectionInfo = {
			port: null,
			baudRate: this.BAUD_RATE,
			connectedAt: null,
			deviceInfo: null
		};

		// Watchdog timer
		this.connectionWatchdog = null;
		this.lastActivity = 0;
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
	 * Connect to a serial port with improved error handling
	 * @param {string} portPath - Path to the port
	 * @param {Object} options - Connection options
	 * @returns {Promise<boolean>} - Connection success
	 */
	async connect(portPath, options = {}) {
		// Prevent connection attempts while one is in progress
		if (this.connecting) {
			throw new Error('Connection already in progress');
		}

		// Clear any existing connection
		await this.disconnect();

		try {
			this.connecting = true;

			// Notify listeners
			this.notifyStatusChange('connecting', { port: portPath });

			// Create port instance with improved options
			this.serialPort = new SerialPort({
				path: portPath,
				baudRate: options.baudRate || this.BAUD_RATE,
				autoOpen: false,
				dataBits: 8,
				parity: 'none',
				stopBits: 1,
				rtscts: false,
				xon: false,
				xoff: false,
				hupcl: false,
				highWaterMark: 65536, // Increase buffer size for better performance
				lock: true // Exclusive access to port
			});

			// Create promise to handle async connection
			await new Promise((resolve, reject) => {
				// Set connection timeout
				const timeout = setTimeout(() => {
					reject(new Error('Connection timeout'));
				}, 10000);

				this.serialPort.open((err) => {
					clearTimeout(timeout);

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
						this.handlePortError(error);
					});

					// Set up disconnect handling
					this.serialPort.on('close', () => {
						this.handleDisconnect('Port closed unexpectedly');
					});

					// Configure port signals (lower DTR to prevent reset)
					this.serialPort.set({ dtr: false, rts: false }, (err) => {
						if (err) {
							console.warn(`Warning: Could not set port signals: ${err.message}`);
						}
						resolve();
					});
				});
			});

			// Update connection state
			this.connected = true;
			this.connectionInfo = {
				port: portPath,
				baudRate: options.baudRate || this.BAUD_RATE,
				connectedAt: new Date(),
				deviceInfo: await this.getDeviceInfo()
			};

			// Start connection watchdog
			this.startConnectionWatchdog();

			// Notify listeners of connection success
			this.notifyStatusChange('connected', this.connectionInfo);

			return true;
		} catch (error) {
			// Clean up on connection failure
			if (this.serialPort) {
				try {
					this.serialPort.close();
				} catch (e) {
					// Ignore close errors
				}
				this.serialPort = null;
			}

			// Notify listeners of connection failure
			this.notifyStatusChange('error', {
				error: error.message || 'Unknown connection error'
			});

			throw error;
		} finally {
			this.connecting = false;
		}
	}

	/**
	 * Disconnect from current port with improved cleanup
	 * @returns {Promise<boolean>} - Success status
	 */
	async disconnect() {
		if (!this.serialPort) return true;

		try {
			// Stop watchdog
			this.stopConnectionWatchdog();

			// Notify listeners
			this.notifyStatusChange('disconnecting');

			// Create a promise for the disconnect operation
			await new Promise((resolve) => {
				if (this.serialPort.isOpen) {
					// Remove all listeners first to prevent callback errors
					this.serialPort.removeAllListeners('data');
					this.serialPort.removeAllListeners('error');
					this.serialPort.removeAllListeners('close');

					this.serialPort.close((err) => {
						if (err) {
							console.warn(`Warning during port close: ${err.message}`);
						}

						this.serialPort = null;
						resolve();
					});
				} else {
					this.serialPort = null;
					resolve();
				}
			});

			// Update state
			this.connected = false;
			this.connectionInfo = {
				port: null,
				baudRate: this.BAUD_RATE,
				connectedAt: null,
				deviceInfo: null
			};

			// Notify listeners
			this.notifyStatusChange('disconnected');

			return true;
		} catch (error) {
			console.error(`Disconnect error: ${error.message}`);

			// Force cleanup
			if (this.serialPort) {
				try {
					this.serialPort.close();
				} catch (e) {
					// Ignore cleanup errors
				}
				this.serialPort = null;
			}

			// Update state
			this.connected = false;

			// Notify listeners
			this.notifyStatusChange('disconnected');

			return false;
		}
	}

	/**
	 * Send command to device with timeout and retry
	 * @param {string} command - Command to send
	 * @param {Object} options - Command options
	 * @returns {Promise<boolean>} - Success status
	 */
	async sendCommand(command, options = {}) {
		if (!this.serialPort || !this.serialPort.isOpen) {
			throw new Error('Cannot send command: Not connected');
		}

		// Command labels for status reporting
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
			// Record activity
			this.lastActivity = Date.now();

			// Notify listeners
			this.notifyStatusChange('command', { command, label });

			// Command timeout
			const timeout = options.timeout || 5000;

			// Create promise for command execution
			return await new Promise((resolve, reject) => {
				// Set timeout
				const timeoutId = setTimeout(() => {
					reject(new Error(`Command timeout: ${label}`));
				}, timeout);

				// Send command
				this.serialPort.write(`${command}\n`, (writeErr) => {
					if (writeErr) {
						clearTimeout(timeoutId);
						reject(writeErr);
						return;
					}

					// Wait for drain (buffer flush)
					this.serialPort.drain((drainErr) => {
						clearTimeout(timeoutId);

						if (drainErr) {
							reject(drainErr);
							return;
						}

						// Successfully sent command
						resolve(true);
					});
				});
			});
		} catch (error) {
			// Notify listeners of command error
			this.notifyStatusChange('commandError', {
				command,
				label,
				error: error.message
			});

			throw error;
		}
	}

	/**
	 * Check if connection is active
	 * @returns {boolean} - Connection status
	 */
	isConnected() {
		return this.serialPort !== null && this.serialPort.isOpen;
	}

	/**
	 * Get current port name
	 * @returns {string|null} - Port name or null
	 */
	getPortName() {
		return this.serialPort ? this.serialPort.path : null;
	}

	/**
	 * Get device info by querying the connected device
	 * @returns {Promise<Object>} - Device information
	 */
	async getDeviceInfo() {
		// This would normally query the device for information
		// For now, return basic port info
		if (!this.serialPort) return null;

		return {
			type: 'Motion Capture Device',
			path: this.serialPort.path,
			baudRate: this.serialPort.baudRate
		};
	}

	/**
	 * Set data handler for receiving data from port
	 * @param {Function} handler - Data handler function
	 */
	onData(handler) {
		this.dataHandler = handler;

		// If already connected, add the handler
		if (this.serialPort && this.serialPort.isOpen) {
			this.serialPort.on('data', handler);
		}
	}

	/**
	 * Add connection status listener
	 * @param {Function} listener - Status change listener
	 */
	addStatusListener(listener) {
		if (typeof listener === 'function' && !this.connectionStatusListeners.includes(listener)) {
			this.connectionStatusListeners.push(listener);
		}
	}

	/**
	 * Remove connection status listener
	 * @param {Function} listener - Status change listener to remove
	 */
	removeStatusListener(listener) {
		const index = this.connectionStatusListeners.indexOf(listener);
		if (index !== -1) {
			this.connectionStatusListeners.splice(index, 1);
		}
	}

	/**
	 * Notify all status listeners of a connection state change
	 * @param {string} status - New connection status
	 * @param {Object} data - Additional status data
	 */
	notifyStatusChange(status, data = {}) {
		this.connectionStatusListeners.forEach((listener) => {
			try {
				listener(status, data);
			} catch (err) {
				console.error(`Error in connection status listener: ${err.message}`);
			}
		});
	}

	/**
	 * Handle port errors with improved recovery
	 * @param {Error} error - Port error
	 */
	handlePortError(error) {
		console.error(`Serial port error: ${error.message}`);

		// Check if disconnection is needed
		if (this.shouldDisconnectOnError(error)) {
			this.handleDisconnect(`Port error: ${error.message}`);
		} else {
			// Just notify of the error but stay connected
			this.notifyStatusChange('portError', { error: error.message });
		}
	}

	/**
	 * Handle unexpected disconnection
	 * @param {string} reason - Disconnection reason
	 */
	handleDisconnect(reason) {
		if (!this.serialPort) return;

		console.warn(`Handling disconnection: ${reason}`);

		// Stop watchdog
		this.stopConnectionWatchdog();

		// Update state
		this.connected = false;

		// Notify listeners
		this.notifyStatusChange('disconnected', { reason });

		// Clean up port
		try {
			this.serialPort.removeAllListeners();
			if (this.serialPort.isOpen) {
				this.serialPort.close();
			}
		} catch (e) {
			// Ignore cleanup errors
		}

		this.serialPort = null;
	}

	/**
	 * Start connection watchdog to detect inactive connections
	 */
	startConnectionWatchdog() {
		// Stop any existing watchdog
		this.stopConnectionWatchdog();

		// Initialize activity timestamp
		this.lastActivity = Date.now();

		// Start new watchdog timer
		this.connectionWatchdog = setInterval(() => {
			if (!this.serialPort || !this.serialPort.isOpen) {
				this.stopConnectionWatchdog();
				return;
			}

			// Check for inactivity
			const now = Date.now();
			const inactiveTime = now - this.lastActivity;

			// If inactive for more than 1 minute, ping the device
			if (inactiveTime > 60000) {
				// Send a ping command to check connection
				this.sendCommand('P').catch((err) => {
					console.warn(`Watchdog ping failed: ${err.message}`);
					this.handleDisconnect('Connection timeout - no response to ping');
				});
			}
		}, 30000); // Check every 30 seconds
	}

	/**
	 * Stop connection watchdog
	 */
	stopConnectionWatchdog() {
		if (this.connectionWatchdog) {
			clearInterval(this.connectionWatchdog);
			this.connectionWatchdog = null;
		}
	}

	/**
	 * Determine if an error should cause disconnection
	 * @param {Error} error - Port error
	 * @returns {boolean} - Whether to disconnect
	 */
	shouldDisconnectOnError(error) {
		const errorMsg = error.message.toLowerCase();

		// Errors that should cause disconnection
		const fatalErrors = [
			'disconnected',
			'access denied',
			'permission denied',
			'device not configured',
			'unknown error',
			'not found',
			'cannot open',
			'i/o error'
		];

		return fatalErrors.some((fatalError) => errorMsg.includes(fatalError));
	}
}

export default ConnectionManager;

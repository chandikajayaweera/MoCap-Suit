/**
 * DataProcessor - Singleton for processing device data
 */
class DataProcessor {
	constructor() {
		if (DataProcessor.instance) {
			return DataProcessor.instance;
		}

		DataProcessor.instance = this;

		// State
		this.streaming = false;
		this.dataBuffer = Buffer.alloc(0);
		this.packetCount = 0;
		this.startTime = 0;
		this.lastSeq = null;
		this.missedPackets = 0;
		this.outOfOrderPackets = 0;
		this.timestamps = [];
		this.sensorData = {};

		// Callbacks
		this.logCallback = null;
		this.streamingCallback = null;
		this.dataCallback = null;
	}

	/**
	 * Get singleton instance
	 */
	static getInstance() {
		if (!DataProcessor.instance) {
			DataProcessor.instance = new DataProcessor();
		}
		return DataProcessor.instance;
	}

	/**
	 * Process data chunk from serial port
	 */
	processData(chunk) {
		try {
			// Append new data to buffer
			this.dataBuffer = Buffer.concat([this.dataBuffer, chunk]);

			// Begin parsing the buffer
			let processedUpTo = 0;

			// Process LOG messages
			let logStart;
			while ((logStart = this.dataBuffer.indexOf('LOG:', processedUpTo)) !== -1) {
				// Find the end of the log message (newline)
				let logEnd = this.dataBuffer.indexOf('\n', logStart);
				if (logEnd === -1) {
					// Incomplete message, wait for more data
					break;
				}

				// Extract and handle the log message
				const logMessage = this.dataBuffer
					.slice(logStart + 4, logEnd)
					.toString()
					.trim();
				this.handleLogMessage(logMessage);

				// Move the position marker
				processedUpTo = logEnd + 1;
			}

			// Process DATA messages
			let dataStart;
			while ((dataStart = this.dataBuffer.indexOf('DATA:', processedUpTo)) !== -1) {
				// Find the next DATA: marker
				const nextDataStart = this.dataBuffer.indexOf('DATA:', dataStart + 5);
				if (nextDataStart === -1) {
					// Incomplete packet, wait for more data
					break;
				}

				// Extract the packet
				const packet = this.dataBuffer.slice(dataStart + 5, nextDataStart);
				this.handleDataPacket(packet);

				// Move the position marker
				processedUpTo = nextDataStart;
			}

			// Keep only unprocessed data
			if (processedUpTo > 0) {
				this.dataBuffer = this.dataBuffer.slice(processedUpTo);
			}

			// Safety check for buffer growth
			if (this.dataBuffer.length > 8192) {
				if (this.logCallback) {
					this.logCallback('Buffer size exceeds limit, truncating', 'warn');
				}
				this.dataBuffer = this.dataBuffer.slice(this.dataBuffer.length - 1024);
			}
		} catch (error) {
			if (this.logCallback) {
				this.logCallback(`Error processing data: ${error.message}`, 'error');
			}
		}
	}

	/**
	 * Handle log messages
	 */
	handleLogMessage(message) {
		// Check if this is a streaming status message
		if (
			message.includes('Sensor reading started') ||
			message.includes('UDP server started') ||
			message.includes('Starting sensor reading')
		) {
			this.setStreaming(true);
		} else if (
			message.includes('Sensor reading stopped') ||
			message.includes('UDP server stopped') ||
			message.includes('Stopping sensor')
		) {
			this.setStreaming(false);
		}

		// Forward log message to callback
		if (this.logCallback) {
			if (message.includes('[ERROR]')) {
				this.logCallback(message, 'error');
			} else if (message.includes('[WARNING]')) {
				this.logCallback(message, 'warn');
			} else if (message.includes('[DEBUG]')) {
				this.logCallback(message, 'debug');
			} else {
				this.logCallback(message);
			}
		}
	}

	/**
	 * Handle data packets
	 */
	handleDataPacket(packet) {
		try {
			const data = packet.toString();
			const receivedTime = Date.now();

			// Update streaming state
			if (!this.streaming) {
				this.setStreaming(true);
				this.startTime = this.startTime || receivedTime;
			}

			// Count packets
			this.packetCount++;
			this.timestamps.push(receivedTime);

			// Try to extract quaternion data
			if (data.includes('SEQ:')) {
				const seq = this.extractSequence(data);
				if (seq !== null) {
					// Check for lost packets
					if (this.lastSeq !== null) {
						const expectedSeq = (this.lastSeq + 1) % 65536;
						if (seq !== expectedSeq) {
							if (seq > expectedSeq) {
								const missing = (seq - expectedSeq) % 65536;
								if (missing < 1000) {
									// Sanity check
									this.missedPackets += missing;
								}
							} else {
								this.outOfOrderPackets++;
							}
						}
					}
					this.lastSeq = seq;
				}

				// Extract sensor data
				this.extractSensorData(data);
			}

			// Call data callback if exists
			if (this.dataCallback) {
				this.dataCallback({
					packetCount: this.packetCount,
					sensorData: this.sensorData,
					timestamp: receivedTime,
					missedPackets: this.missedPackets,
					outOfOrderPackets: this.outOfOrderPackets
				});
			}
		} catch (error) {
			if (this.logCallback) {
				this.logCallback(`Error handling data packet: ${error.message}`, 'error');
			}
		}
	}

	/**
	 * Extract sequence number from packet
	 */
	extractSequence(data) {
		try {
			const seqIndex = data.indexOf('SEQ:');
			if (seqIndex === -1) return null;

			const seqStart = seqIndex + 4;
			const seqEnd = data.indexOf(',', seqStart);
			if (seqEnd === -1) return null;

			return parseInt(data.substring(seqStart, seqEnd), 10);
		} catch (error) {
			return null;
		}
	}

	/**
	 * Extract sensor data from packet
	 */
	extractSensorData(data) {
		try {
			// Clear old data
			this.sensorData = {};

			// Extract sequence number
			const seqIndex = data.indexOf('SEQ:');
			if (seqIndex !== -1) {
				const seqStart = seqIndex + 4;
				const seqEnd = data.indexOf(',', seqStart);
				if (seqEnd !== -1) {
					this.sensorData.sequence = parseInt(data.substring(seqStart, seqEnd), 10);
				}
			}

			// Extract sensor readings with optimized parsing
			let pos = 0;
			while ((pos = data.indexOf('S', pos)) !== -1) {
				// Skip if not a sensor identifier
				if (pos + 1 >= data.length || !/\d/.test(data[pos + 1])) {
					pos++;
					continue;
				}

				// Extract sensor ID
				const idEnd = data.indexOf(':', pos);
				if (idEnd === -1) break;

				const sensorId = data.substring(pos + 1, idEnd);

				// Extract quaternion values
				const valuesStart = data.indexOf('[', idEnd);
				if (valuesStart === -1) break;

				const valuesEnd = data.indexOf(']', valuesStart);
				if (valuesEnd === -1) break;

				// Parse values with optimized split
				const valuesStr = data.substring(valuesStart + 1, valuesEnd);
				const values = this.fastSplit(valuesStr).map((v) => parseFloat(v));

				if (values.length === 4) {
					this.sensorData[`S${sensorId}`] = values;
				}

				pos = valuesEnd + 1;
			}
		} catch (error) {
			if (this.logCallback) {
				this.logCallback(`Error extracting sensor data: ${error.message}`, 'debug');
			}
		}
	}

	/**
	 * Fast string split for comma-separated values
	 */
	fastSplit(str) {
		const result = [];
		let start = 0;
		let pos = 0;

		while (pos < str.length) {
			if (str[pos] === ',') {
				result.push(str.substring(start, pos));
				start = pos + 1;
			}
			pos++;
		}

		if (start < str.length) {
			result.push(str.substring(start));
		}

		return result;
	}

	/**
	 * Reset statistics
	 */
	reset() {
		this.dataBuffer = Buffer.alloc(0);
		this.packetCount = 0;
		this.startTime = 0;
		this.lastSeq = null;
		this.missedPackets = 0;
		this.outOfOrderPackets = 0;
		this.timestamps = [];
		this.sensorData = {};
	}

	/**
	 * Get current statistics
	 */
	getStats() {
		const now = Date.now();
		const elapsed = (now - (this.startTime || now)) / 1000;
		const rate = this.packetCount / Math.max(elapsed, 0.001);

		return {
			packetCount: this.packetCount,
			elapsed,
			rate,
			missedPackets: this.missedPackets,
			outOfOrderPackets: this.outOfOrderPackets,
			sensorData: this.sensorData,
			activeSensors: Object.keys(this.sensorData).filter((key) => key.startsWith('S')).length
		};
	}

	/**
	 * Set streaming state
	 */
	setStreaming(status) {
		const changed = this.streaming !== status;
		this.streaming = status;

		if (changed && this.streamingCallback) {
			this.streamingCallback(status);
		}

		if (status) {
			this.startTime = this.startTime || Date.now();
		}
	}

	/**
	 * Check if streaming is active
	 */
	isStreaming() {
		return this.streaming;
	}

	/**
	 * Set log callback
	 */
	onLog(callback) {
		this.logCallback = callback;
	}

	/**
	 * Set streaming status change callback
	 */
	onStreaming(callback) {
		this.streamingCallback = callback;
	}

	/**
	 * Set data callback
	 */
	onData(callback) {
		this.dataCallback = callback;
	}
}

export default DataProcessor;

#!/usr/bin/env node
const { SerialPort } = require("serialport");
const fs = require("fs");
const path = require("path");

// Process command-line arguments
const [, , portPath, baudArg, durationArg] = process.argv;
if (!portPath) {
  console.error("Usage: node benchmark.js <port> [baudRate] [duration]");
  process.exit(1);
}

const baudRate = parseInt(baudArg, 10) || 115200;
const testDuration = parseInt(durationArg, 10) || 30; // Default to 30 seconds

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

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "benchmark_logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Generate a filename with timestamp and port info
const timestamp = new Date()
  .toISOString()
  .replace(/:/g, "-")
  .replace(/\..+/, "");
const logFilename = path.join(
  logsDir,
  `benchmark_${path.basename(portPath)}_${baudRate}_${timestamp}.log`
);
const logFile = fs.createWriteStream(logFilename);

// Log header with test information
logFile.write(
  `===============================================================================\n`
);
logFile.write(`                      MOTION CAPTURE BENCHMARK REPORT\n`);
logFile.write(
  `===============================================================================\n`
);
logFile.write(
  `Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n`
);
logFile.write(`Device: ${portPath}\n`);
logFile.write(`Baud Rate: ${baudRate}\n`);
logFile.write(`Duration: ${testDuration} seconds\n`);
logFile.write(
  `===============================================================================\n\n`
);
logFile.write(`DIAGNOSTIC LOG:\n`);

function log(msg) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${msg}`;
  logFile.write(logMessage + "\n");
  console.log(msg);
}

// Status display with better visibility
function updateStatus(message, final = false) {
  if (final) {
    console.log("\n" + message);
  } else {
    process.stdout.write(`\r${message.padEnd(80)}`);
  }
}

// Create an information block with instructions for data analysis
const logFileDisplay = path.basename(logFilename); // Just show the filename, not the full path
console.log(`
┌─────────────────────────────────────────────────────────────┐
│            MOTION CAPTURE SYSTEM BENCHMARK                  │
├─────────────────────────────────────────────────────────────┤
│ Device: ${portPath}                                         │
│ Baud Rate: ${baudRate}                                      │
│ Duration: ${testDuration} seconds                           │
│                                                             │
│ Press Ctrl+C to stop the benchmark early.                   │
│ Report will be saved to: benchmark_logs/${logFileDisplay}   │
└─────────────────────────────────────────────────────────────┘
`);

// Parse sensor data to extract sequence number
function extractSequence(data) {
  try {
    // Find SEQ: marker in the data
    const seqIndex = data.indexOf("SEQ:");
    if (seqIndex === -1) return null;

    // Extract sequence value
    const seqStart = seqIndex + 4;
    const seqEnd = data.indexOf(",", seqStart);
    if (seqEnd === -1) return null;

    return parseInt(data.substring(seqStart, seqEnd), 10);
  } catch (e) {
    return null;
  }
}

// Configure port with optimal settings
const port = new SerialPort({
  path: portPath,
  baudRate,
  autoOpen: false,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  rtscts: false,
  xon: false,
  xoff: false,
  hupcl: false,
  highWaterMark: 4096, // Increase buffer size for better performance
});

// Open serial port with careful initialization
log(`Opening serial port ${portPath} at ${baudRate} baud...`);
port.open((err) => {
  if (err) {
    log(`Error opening port: ${err.message}`);
    logFile.end();
    process.exit(1);
  }

  log(`Port opened successfully`);

  // Explicit port configuration
  port.set({ dtr: false, rts: false }, (err) => {
    if (err) {
      log(`Warning: Could not set port signals: ${err.message}`);
    }

    log(`Port signals configured, waiting for device initialization...`);

    // Progressive initialization with retries
    let initAttempt = 0;
    const tryInit = () => {
      // Try to stop any existing streaming first
      port.write("X\n", (err) => {
        if (err) log(`Warning: Could not send stop command: ${err.message}`);

        setTimeout(() => {
          log(
            `Initialization attempt ${
              initAttempt + 1
            }: Sending start command...`
          );
          port.write("S\n", (err) => {
            if (err) {
              log(`Error sending start command: ${err.message}`);
              if (initAttempt < 2) {
                initAttempt++;
                log(`Retrying in 1 second...`);
                setTimeout(tryInit, 1000);
              } else {
                log(`Failed to initialize after ${initAttempt + 1} attempts`);
                cleanup(1);
              }
              return;
            }

            // Mark start time and begin monitoring
            startTime = Date.now();
            log(`Benchmark started at ${new Date(startTime).toISOString()}`);

            // Set test duration timer
            setTimeout(() => {
              log(`Test duration (${testDuration}s) complete`);
              cleanup(0);
            }, testDuration * 1000);
          });
        }, 500); // Short pause after stop command
      });
    };

    // Wait for device to stabilize, then start test
    setTimeout(tryInit, 3000);
  });
});

// Optimized data handling
port.on("data", (chunk) => {
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

    while ((dataStart = buffer.indexOf("DATA:", processedUpTo)) !== -1) {
      const nextDataStart = buffer.indexOf("DATA:", dataStart + 5);

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
          `Received: ${packetCount} packets | Rate: ${rate.toFixed(
            2
          )} pps | Missing: ${missedPackets} | Time: ${elapsed.toFixed(1)}s`
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
      log(
        `Warning: Buffer size (${buffer.length}) exceeds threshold, truncating`
      );
      buffer = buffer.slice(buffer.length - 1024);
    }
  } catch (error) {
    log(`Error processing data: ${error.message}`);
  }
});

// Error handling for port
port.on("error", (err) => {
  log(`Serial port error: ${err.message}`);
});

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

  // We'll accumulate per-second data in memory and write the complete dataset at the end
  // This avoids frequent small writes to the log file that could impact performance
}, 1000);

// Graceful shutdown
function cleanup(exitCode = 0) {
  clearInterval(statInterval);

  updateStatus(`Sending stop command...`, true);

  // Stop streaming
  port.write("X\n", () => {
    port.drain(() => {
      // Calculate final statistics
      const duration = (Date.now() - startTime) / 1000;
      const overallRate = packetCount / duration;

      // Calculate jitter
      let avgJitter = 0;
      if (jitterValues.length > 1) {
        const jitterSum = jitterValues.reduce((a, b) => a + b, 0);
        const avgInterval = jitterSum / jitterValues.length;
        avgJitter =
          jitterValues.reduce(
            (sum, interval) => sum + Math.abs(interval - avgInterval),
            0
          ) / jitterValues.length;
      }

      // Write per-second data in CSV format to the log file
      logFile.write("\n\n");
      logFile.write(
        "===============================================================================\n"
      );
      logFile.write("                         PER-SECOND DATA RATES\n");
      logFile.write(
        "===============================================================================\n"
      );
      logFile.write("Second,Packets,Cumulative Average\n");

      let cumulativeTotal = 0;
      rates.forEach((rate, index) => {
        cumulativeTotal += rate;
        const cumAvg = (cumulativeTotal / (index + 1)).toFixed(2);
        logFile.write(`${index + 1},${rate},${cumAvg}\n`);
      });

      // Generate summary statistics
      const summary = `
===============================================================================
                             BENCHMARK SUMMARY
===============================================================================
Test Duration:        ${duration.toFixed(2)} seconds
Total Packets:        ${packetCount.toLocaleString()}
Overall Rate:         ${overallRate.toFixed(2)} packets/second

Performance Metrics:
  Minimum Rate:       ${Math.min(...rates) || 0} packets/second
  Average Rate:       ${(
    rates.reduce((a, b) => a + b, 0) / (rates.length || 1)
  ).toFixed(1)} packets/second
  Maximum Rate:       ${Math.max(...rates) || 0} packets/second
  
Reliability Metrics:
  Missing Packets:    ${missedPackets.toLocaleString()}
  Out-of-order:       ${outOfOrderPackets.toLocaleString()}
  Packet Loss Rate:   ${(
    (missedPackets / (packetCount + missedPackets || 1)) *
    100
  ).toFixed(2)}%
  Average Jitter:     ${avgJitter.toFixed(2)} ms

Test Information:
  Serial Port:        ${portPath}
  Baud Rate:          ${baudRate}
  Log File:           ${logFilename}
  Device Identifier:  ${port.path}
===============================================================================
`;

      updateStatus(summary, true);
      logFile.write("\n\n");
      logFile.write(summary);
      logFile.write("\n");

      // Add signature and timestamp
      const endTimestamp = new Date().toLocaleString();
      logFile.write(`Benchmark completed at: ${endTimestamp}\n`);
      logFile.write(`Generated by Motion Capture Benchmark Tool v1.0.0\n`);

      console.log(
        `\nReport saved to: benchmark_logs/${path.basename(logFilename)}`
      );

      // Close port and log file
      port.close(() => {
        logFile.end();
        process.exit(exitCode);
      });
    });
  });
}

// Handle user interruption
process.on("SIGINT", () => {
  updateStatus(`\nUser interrupted test`, true);
  cleanup(0);
});

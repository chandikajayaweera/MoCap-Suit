#!/usr/bin/env python3
import serial
import time
import argparse
import sys
from collections import deque

class SensorBenchmark:
    def __init__(self, port, baud_rate=115200, window_size=5):
        self.port = port
        self.baud_rate = baud_rate
        self.serial_conn = None
        self.window_size = window_size  # Window size in seconds for moving average
        
        # Tracking variables
        self.start_time = None
        self.packet_count = 0
        self.last_seq = None
        self.missing_packets = 0
        self.timestamps = deque(maxlen=1000)  # Store recent timestamps for rate calculation
        self.rates = deque(maxlen=100)        # Store recent rates for statistics
        
        # Stats per sensor
        self.sensor_stats = {i: {"count": 0, "errors": 0} for i in range(8)}
        
        # For calculating jitter
        self.last_packet_time = None
        self.intervals = deque(maxlen=1000)

    def connect(self):
        """Connect to the serial port"""
        try:
            self.serial_conn = serial.Serial(self.port, self.baud_rate, timeout=1)
            print(f"Connected to {self.port} at {self.baud_rate} baud")
            return True
        except Exception as e:
            print(f"Error connecting to {self.port}: {e}")
            return False
    
    def disconnect(self):
        """Disconnect from the serial port"""
        if self.serial_conn:
            self.serial_conn.close()
            print(f"Disconnected from {self.port}")
    
    def start_streaming(self):
        """Send command to start streaming data from the node"""
        if not self.serial_conn:
            return False
            
        print("Sending command to start streaming...")
        self.serial_conn.write(b"S\n")
        self.serial_conn.flush()
        
        # Wait a moment for streaming to begin
        time.sleep(1)
        return True
    
    def stop_streaming(self):
        """Send command to stop streaming data"""
        if self.serial_conn:
            print("Stopping data streaming...")
            self.serial_conn.write(b"X\n")
            self.serial_conn.flush()
            time.sleep(0.5)
    
    def calculate_rate(self):
        """Calculate the current packet rate based on timestamps in the window"""
        if len(self.timestamps) < 2:
            return 0
        
        # Only use timestamps within the window_size
        current_time = time.time()
        window_start = current_time - self.window_size
        
        # Filter timestamps within window
        window_timestamps = [ts for ts in self.timestamps if ts >= window_start]
        
        if len(window_timestamps) < 2:
            return 0
            
        # Calculate packets per second within the window
        return len(window_timestamps) / self.window_size
    
    def calculate_jitter(self):
        """Calculate jitter (variation in packet arrival times)"""
        if len(self.intervals) < 2:
            return 0
            
        avg_interval = sum(self.intervals) / len(self.intervals)
        jitter = sum(abs(i - avg_interval) for i in self.intervals) / len(self.intervals)
        return jitter * 1000  # Convert to ms
    
    def parse_quaternion_data(self, data_str):
        """Parse quaternion data and update sensor statistics"""
        try:
            # Extract sequence number
            if not data_str.startswith("SEQ:"):
                return False
                
            parts = data_str.split(',')
            seq_str = parts[0]
            seq = int(seq_str.split(':')[1])
            
            # Check for packet loss
            if self.last_seq is not None:
                expected_seq = (self.last_seq + 1) % 65536
                if seq != expected_seq:
                    lost = (seq - expected_seq) % 65536
                    if lost > 0 and lost < 1000:  # Sanity check
                        self.missing_packets += lost
            self.last_seq = seq
            
            # Count sensors
            for i in range(8):
                sensor_key = f"S{i}:"
                for part in parts:
                    if part.startswith(sensor_key):
                        self.sensor_stats[i]["count"] += 1
                        
                        # Validate quaternion data
                        try:
                            quat_str = part.split(':')[1].strip('[]')
                            quat_values = [float(x) for x in quat_str.split(',')]
                            if len(quat_values) != 4:
                                self.sensor_stats[i]["errors"] += 1
                        except:
                            self.sensor_stats[i]["errors"] += 1
                        break
            
            return True
        except Exception as e:
            print(f"Error parsing data: {e}")
            return False
    
    def run(self, duration=60):
        """Run the benchmark for specified duration"""
        if not self.connect():
            return
            
        print(f"Starting benchmark for {duration} seconds...")
        
        # First start streaming
        if not self.start_streaming():
            print("Failed to start streaming")
            self.disconnect()
            return
            
        print("Data streaming started. Press Ctrl+C to stop early")
        
        self.start_time = time.time()
        end_time = self.start_time + duration
        
        # Buffer for partial data
        buffer = b""
        debug_printed = False
        
        try:
            while time.time() < end_time:
                # Read data with timeout
                data = self.serial_conn.read(1024)
                if not data:
                    continue
                
                buffer += data
                
                # Debug: If no packets after 5 seconds, print some diagnostic info
                if time.time() - self.start_time > 5 and self.packet_count == 0 and not debug_printed:
                    print("\nWarning: No data packets detected after 5 seconds.")
                    print("Debug: Reading raw data to inspect format...")
                    raw_data = self.serial_conn.read(1024)
                    print(f"Raw data ({len(raw_data)} bytes): {raw_data[:100]}")
                    
                    # Look for common prefixes
                    for prefix in [b"DATA:", b"LOG:", b"QUAT_DATA:"]:
                        if prefix in buffer:
                            print(f"Found prefix: {prefix}")
                    debug_printed = True
                
                # Process all complete messages in buffer
                while b"DATA:" in buffer:
                    # Find start of data
                    start_pos = buffer.find(b"DATA:")
                    
                    # Remove data before start position
                    buffer = buffer[start_pos:]
                    
                    # Skip the "DATA:" prefix
                    data_start = 5  # Length of "DATA:"
                    
                    # Try to find the end of this packet (the start of the next one)
                    next_packet = buffer.find(b"DATA:", data_start)
                    
                    if next_packet == -1:
                        # Incomplete packet, wait for more data
                        break
                    
                    # Extract the complete packet
                    packet = buffer[data_start:next_packet]
                    
                    # Update buffer
                    buffer = buffer[next_packet:]
                    
                    # Process the packet
                    now = time.time()
                    self.timestamps.append(now)
                    self.packet_count += 1
                    
                    # Calculate interval for jitter
                    if self.last_packet_time:
                        interval = now - self.last_packet_time
                        self.intervals.append(interval)
                    self.last_packet_time = now
                    
                    # Parse quaternion data if it's in the expected format
                    try:
                        data_str = packet.decode('utf-8')
                        if data_str.startswith("QUAT_DATA:"):
                            quat_data = data_str[10:]  # Skip "QUAT_DATA: "
                            self.parse_quaternion_data(quat_data)
                    except UnicodeDecodeError:
                        # Binary packet - would need specific parsing
                        pass
                
                # Calculate and display stats every second
                current_rate = self.calculate_rate()
                self.rates.append(current_rate)
                
                elapsed = time.time() - self.start_time
                if int(elapsed) % 1 == 0:  # Update every second
                    self.display_stats()
        
        except KeyboardInterrupt:
            print("\nBenchmark interrupted by user")
        finally:
            # Stop streaming before disconnecting
            try:
                self.stop_streaming()
            except:
                pass
                
            # Show final statistics
            self.summary_stats()
            self.disconnect()
    
    def display_stats(self):
        """Display current statistics"""
        elapsed = time.time() - self.start_time
        current_rate = self.calculate_rate()
        avg_rate = sum(self.rates) / len(self.rates) if self.rates else 0
        
        # Calculate jitter
        jitter = self.calculate_jitter()
        
        # Clear line and update
        sys.stdout.write("\r\033[K")  # Clear line
        sys.stdout.write(f"Time: {elapsed:.1f}s | Rate: {current_rate:.1f} pkt/s | " 
                         f"Avg: {avg_rate:.1f} pkt/s | Total: {self.packet_count} | "
                         f"Missing: {self.missing_packets} | Jitter: {jitter:.2f}ms")
        sys.stdout.flush()
    
    def summary_stats(self):
        """Display summary statistics at the end of the benchmark"""
        elapsed = time.time() - self.start_time
        overall_rate = self.packet_count / elapsed if elapsed > 0 else 0
        
        # Calculate min/max/avg rates
        min_rate = min(self.rates) if self.rates else 0
        max_rate = max(self.rates) if self.rates else 0
        avg_rate = sum(self.rates) / len(self.rates) if self.rates else 0
        
        # Calculate packet loss percentage
        total_expected = self.packet_count + self.missing_packets
        loss_pct = (self.missing_packets / total_expected * 100) if total_expected > 0 else 0
        
        print("\n\n=== BENCHMARK SUMMARY ===")
        print(f"Duration: {elapsed:.2f} seconds")
        print(f"Total packets: {self.packet_count}")
        print(f"Overall rate: {overall_rate:.2f} packets/second")
        print(f"Rate stats (min/avg/max): {min_rate:.2f}/{avg_rate:.2f}/{max_rate:.2f} packets/second")
        print(f"Missing packets: {self.missing_packets} ({loss_pct:.2f}%)")
        print(f"Jitter: {self.calculate_jitter():.2f}ms")
        
        print("\n=== SENSOR STATISTICS ===")
        for i, stats in self.sensor_stats.items():
            if stats["count"] > 0:
                error_pct = (stats["errors"] / stats["count"] * 100) if stats["count"] > 0 else 0
                print(f"Sensor {i}: {stats['count']} readings, {stats['errors']} errors ({error_pct:.2f}%)")

def main():
    parser = argparse.ArgumentParser(description='Benchmark sensor data rate from motion capture system')
    parser.add_argument('port', help='Serial port (e.g., COM3 or /dev/ttyUSB0)')
    parser.add_argument('-b', '--baud', type=int, default=115200, help='Baud rate (default: 115200)')
    parser.add_argument('-d', '--duration', type=int, default=60, help='Benchmark duration in seconds (default: 60)')
    parser.add_argument('-w', '--window', type=int, default=5, help='Window size for rate calculation in seconds (default: 5)')
    
    args = parser.parse_args()
    
    benchmark = SensorBenchmark(args.port, args.baud, args.window)
    benchmark.run(args.duration)

if __name__ == "__main__":
    main()
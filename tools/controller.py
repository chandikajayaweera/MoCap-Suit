# controller.py - Optimized version
import argparse
import serial
import struct
import threading
import time
import queue
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
import os
import sys

class MoCapFrontend:
    def __init__(self, port, baud_rate=115200, debug=False):
        self.port = port
        self.baud_rate = baud_rate
        self.serial_conn = None
        self.running = False
        self.debug = debug
        
        # Data queue for visualization thread
        self.data_queue = queue.Queue(maxsize=200)
        
        # Sensor data storage
        self.sensor_data = [np.zeros((100, 4)) for _ in range(8)]
        self.timestamps = np.zeros(100)
        self.plot_index = 0
        
        # Add a connection status flag for better UI feedback
        self.connected = False
        
        # Track reconnection attempts
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5
        
        # Sensor mapping for clarity
        self.sensor_names = [
            "Right Lower Leg",
            "Right Upper Leg",
            "Left Lower Leg", 
            "Left Upper Leg",
            "Left Lower Arm",
            "Left Upper Arm",
            "Right Lower Arm",
            "Right Upper Arm"
        ]
    
    def connect(self):
        """Connect to the receiver via serial port with better error handling"""
        try:
            # First disconnect if we're already connected
            if self.serial_conn and self.serial_conn.is_open:
                self.disconnect()
                
            self.serial_conn = serial.Serial(self.port, self.baud_rate, timeout=1)
            self.connected = True
            self.reconnect_attempts = 0
            print(f"Connected to {self.port} at {self.baud_rate} baud")
            return True
        except Exception as e:
            print(f"Error connecting to {self.port}: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Disconnect from the receiver"""
        if self.serial_conn and self.serial_conn.is_open:
            try:
                self.serial_conn.close()
                print(f"Disconnected from {self.port}")
            except Exception as e:
                print(f"Error disconnecting from {self.port}: {e}")
            finally:
                self.connected = False
    
    def reconnect(self):
        """Attempt to reconnect to the receiver if we've lost connection"""
        if self.reconnect_attempts >= self.max_reconnect_attempts:
            print(f"Failed to reconnect after {self.reconnect_attempts} attempts. Please check your connection.")
            return False
            
        self.reconnect_attempts += 1
        print(f"Attempting to reconnect (attempt {self.reconnect_attempts}/{self.max_reconnect_attempts})...")
        
        try:
            # Close the current connection if it exists
            self.disconnect()
            
            # Wait a moment before reconnecting
            time.sleep(1)
            
            # Try to connect again
            return self.connect()
        except Exception as e:
            print(f"Error during reconnection: {e}")
            return False
    
    def send_command(self, command):
        """Send a command to the receiver with better error handling"""
        if not self.connected:
            print("Error: Not connected to receiver")
            return False

        try:
            # Clear any pending data in buffer first
            self.serial_conn.reset_input_buffer()
            
            # Send command with proper termination
            self.serial_conn.write(f"{command}\n".encode())
            self.serial_conn.flush()
            print(f"Sent command: {command}")
            
            # Wait briefly to ensure command is processed
            time.sleep(0.1)
            return True
        except serial.SerialException as e:
            print(f"Serial connection error: {e}")
            self.connected = False
            return False
        except Exception as e:
            print(f"Error sending command: {e}")
            return False
    
    def process_data_packet(self, data):
        """Process a binary data packet from the receiver with improved debugging"""
        try:
            # The packet format is: <sequence_number:uint16><quaternion_data:32_float>
            if len(data) < 2 + 32*4:  # At least 2 bytes for seq + 128 bytes for floats
                print(f"Invalid data packet length: {len(data)} bytes")
                return
            
            # Extract sequence number
            seq_num = struct.unpack("<H", data[0:2])[0]
            
            # Extract quaternion data (32 floats = 8 sensors x 4 values per quaternion)
            values = struct.unpack("<32f", data[2:])
            
            # Print debug info occasionally
            if self.debug and seq_num % 100 == 0:
                print(f"Received packet #{seq_num} with {len(values)} values")
            
            # Put data in queue for visualization thread
            if not self.data_queue.full():
                self.data_queue.put((time.time(), values))
                
        except Exception as e:
            print(f"Error processing data packet: {e}")
            # Optionally print hex dump of the packet in debug mode
            if self.debug:
                print("Packet dump (first 32 bytes):")
                print(" ".join(f"{b:02x}" for b in data[:32]))
    
    def read_thread(self):
        """Thread for reading data from the receiver with improved error handling and debug mode filtering"""
        buffer = b""
        prefix_found = False
        prefix_len = 5  # Length of "DATA:" or "LOG:"
        
        consecutive_errors = 0
        max_consecutive_errors = 10
        
        while self.running:
            try:
                if not self.connected:
                    # Try to reconnect if we've lost connection
                    if self.reconnect():
                        consecutive_errors = 0
                    else:
                        time.sleep(1)
                        continue
                
                # Read data with timeout
                try:
                    data = self.serial_conn.read(1024)
                    if data:
                        consecutive_errors = 0
                    else:
                        # Empty read - not necessarily an error but could indicate issues
                        time.sleep(0.01)
                        continue
                except serial.SerialException as e:
                    print(f"Serial read error: {e}")
                    self.connected = False
                    consecutive_errors += 1
                    if consecutive_errors > max_consecutive_errors:
                        print(f"Too many consecutive errors ({consecutive_errors}). Stopping read thread.")
                        break
                    continue
                
                buffer += data
                
                # Process all complete messages in buffer
                while buffer:
                    if not prefix_found:
                        # Look for "DATA:" or "LOG:" prefix
                        log_pos = buffer.find(b"LOG:")
                        data_pos = buffer.find(b"DATA:")
                        
                        if log_pos == -1 and data_pos == -1:
                            # No prefix found, keep last 10 bytes in case it's split
                            if len(buffer) > 10:
                                buffer = buffer[-10:]
                            break
                        
                        # Handle the prefix that comes first
                        if log_pos != -1 and (data_pos == -1 or log_pos < data_pos):
                            # LOG prefix found
                            position = log_pos
                            is_log = True
                        else:
                            # DATA prefix found
                            position = data_pos
                            is_log = False
                        
                        # Remove data before prefix
                        buffer = buffer[position:]
                        
                        if len(buffer) < prefix_len:
                            # Incomplete prefix
                            break
                        
                        # Remove prefix
                        buffer = buffer[prefix_len:]
                        prefix_found = True
                        
                        if is_log:
                            # For LOG messages, read until newline
                            newline_pos = buffer.find(b"\n")
                            if newline_pos == -1:
                                # Incomplete log message
                                break
                            
                            # Extract log message
                            log_msg = buffer[:newline_pos].decode('utf-8', errors='replace')
                            
                            # Skip heartbeat messages if debug mode is disabled
                            if not self.debug and ("HEARTBEAT" in log_msg or "timed out" in log_msg.lower()):
                                pass  # Skip heartbeat and timeout logs in non-debug mode
                            else:
                                print(f"{log_msg}")
                            
                            # Remove processed log message
                            buffer = buffer[newline_pos+1:]
                            prefix_found = False
                        else:
                            # For DATA messages, we need at least 130 bytes (2 for seq + 128 for quaternions)
                            if len(buffer) < 130:
                                # Incomplete data packet
                                break
                            
                            # Extract data packet (fixed length)
                            data_packet = buffer[:130]
                            self.process_data_packet(data_packet)
                            
                            # Remove processed data packet
                            buffer = buffer[130:]
                            prefix_found = False
                    else:
                        # This shouldn't happen based on the logic above
                        prefix_found = False
                
            except Exception as e:
                print(f"Error in read thread: {e}")
                consecutive_errors += 1
                if consecutive_errors > max_consecutive_errors:
                    print(f"Too many consecutive errors ({consecutive_errors}). Stopping read thread.")
                    break
                time.sleep(0.1)
    
    def visualization_thread(self):
        """Thread for processing data for visualization"""
        while self.running:
            try:
                if not self.data_queue.empty():
                    timestamp, values = self.data_queue.get(timeout=0.1)
                    
                    # Store data in circular buffer
                    self.timestamps[self.plot_index] = timestamp
                    
                    # Group quaternions by sensor
                    for i in range(8):
                        quat = values[i*4:(i+1)*4]
                        self.sensor_data[i][self.plot_index] = quat
                    
                    self.plot_index = (self.plot_index + 1) % 100
                else:
                    time.sleep(0.01)
            except queue.Empty:
                time.sleep(0.01)
            except Exception as e:
                print(f"Error processing visualization data: {e}")
                time.sleep(0.1)
    
    def run_visualization(self):
        """Run visualization with standard FuncAnimation but improved error handling"""
        try:
            # Create figure and axes
            fig, axes = plt.subplots(2, 4, figsize=(15, 8))
            fig.suptitle("Sensor Quaternion Visualization")
            lines = []
            
            # Set the style for better visualizations
            plt.style.use('dark_background')
            
            # Flatten axes for easier iteration
            axes_flat = axes.flatten()
            
            # Create a line for each quaternion component (w, x, y, z) for each sensor
            for i in range(8):
                ax = axes_flat[i]
                ax.set_title(f"Sensor {i}: {self.sensor_names[i]}")
                ax.set_ylim(-1.1, 1.1)
                ax.set_xlabel("Time")
                ax.set_ylabel("Quaternion Values")
                ax.grid(True, alpha=0.3)
                
                # Four lines for w, x, y, z components
                sensor_lines = []
                for color, label in zip(['#88CCEE', '#CC6677', '#DDCC77', '#117733'], ['w', 'x', 'y', 'z']):
                    line, = ax.plot([], [], color=color, label=label, linewidth=1.5)
                    sensor_lines.append(line)
                
                ax.legend(loc='upper right')
                lines.append(sensor_lines)
            
            # Status text with normal text objects
            connection_text = fig.text(0.02, 0.02, "Connection: Unknown", fontsize=10)
            rate_text = fig.text(0.98, 0.02, "Update Rate: 0 Hz", fontsize=10, ha='right')
            packet_text = fig.text(0.5, 0.02, "Packets: 0", fontsize=10, ha='center')
            
            # Make room for status text
            plt.subplots_adjust(bottom=0.1)
            
            # Track frame times for rate calculation
            last_update_time = time.time()
            frame_count = 0
            update_rate = 0
            packet_count = 0
            
            # Safe update function that handles errors gracefully
            def update(frame):
                nonlocal last_update_time, frame_count, update_rate, packet_count
                
                try:
                    # Update connection status
                    status = 'Connected' if self.connected else 'Disconnected'
                    status_color = 'lime' if self.connected else 'red'
                    connection_text.set_text(f"Connection: {status}")
                    connection_text.set_color(status_color)
                    
                    # Process data queue
                    while not self.data_queue.empty():
                        try:
                            self.data_queue.get(block=False)
                            packet_count += 1
                        except queue.Empty:
                            break
                    
                    # Copy timestamps to avoid modification during iteration
                    timestamp_data = np.copy(self.timestamps)
                    
                    # Generate indices for all points
                    indices = np.arange(len(timestamp_data))
                    
                    # Update each sensor's plot
                    for i in range(8):
                        if i < len(self.sensor_data) and i < len(lines):
                            # Safely get data
                            sensor_data = np.copy(self.sensor_data[i])
                            
                            # If we have valid data
                            if np.any(sensor_data):
                                x_values = np.arange(len(sensor_data))
                                
                                # Update each component (w, x, y, z)
                                for j in range(min(4, sensor_data.shape[1])):
                                    if j < len(lines[i]):
                                        lines[i][j].set_data(x_values, sensor_data[:, j])
                                
                                # Update axis limits if needed
                                if i < len(axes_flat):
                                    axes_flat[i].set_xlim(0, len(sensor_data))
                except Exception as e:
                    print(f"Plot update error: {e}")
                    
                # Update frame rate counter
                frame_count += 1
                current_time = time.time()
                elapsed = current_time - last_update_time
                
                # Update rate every second
                if elapsed >= 1.0:
                    update_rate = frame_count / elapsed
                    frame_count = 0
                    last_update_time = current_time
                    
                # Update status text
                rate_text.set_text(f"Update Rate: {update_rate:.1f} Hz")
                packet_text.set_text(f"Packets: {packet_count}")
                
                # Return all artists
                return [line for sensor_lines in lines for line in sensor_lines] + [connection_text, rate_text, packet_text]
            
            # Use animation with explicit save_count
            ani = FuncAnimation(
                fig, 
                update, 
                frames=None, 
                interval=40,  # 25 FPS (40ms interval)
                blit=False,   # Disable blitting to avoid NoneType errors
                save_count=100
            )
            
            plt.show()
        
        except KeyboardInterrupt:
            print("Visualization interrupted.")
        except Exception as e:
            print(f"Error in visualization setup: {e}")
        finally:
            # Clean up figure to prevent memory leaks
            try:
                plt.close('all')
            except:
                pass
    
    def run_command_loop(self):
        """Run an interactive command loop with better user experience"""
        print("\nMotion Capture Controller - Interactive Command Mode")
        print("="*60)
        print("Available Commands:")
        print("  S - Start streaming sensor data")
        print("  X - Stop streaming sensor data")
        print("  N - Restart node")
        print("  R - Restart receiver")
        print("  C - Check sensor status")
        print("  I - Reinitialize sensors")
        print("  V - Visualize data")
        print("  D - Toggle debug mode (show/hide heartbeats)")
        print("  Q - Quit frontend")
        print("="*60)
        
        while self.running:
            try:
                cmd = input("> ").strip().upper()
                
                if cmd == "Q":
                    self.running = False
                    print("Shutting down...")
                    break
                    
                elif cmd == "V":
                    print("Starting visualization (close window to return to command mode)")
                    # Launch visualization in the main thread
                    self.run_visualization()
                
                elif cmd == "D":
                    # Toggle debug mode
                    self.debug = not self.debug
                    print(f"Debug mode {'enabled' if self.debug else 'disabled'}")
                
                else:
                    # For network commands, check connection first
                    if not self.connected:
                        print("Not connected to receiver. Attempting to reconnect...")
                        if not self.reconnect():
                            continue
                    
                    # Process standard commands
                    if cmd in ["S", "X", "N", "R", "C", "I"]:
                        # Ensure we're sending just a single character command
                        result = self.send_command(cmd)
                        if not result:
                            print(f"Failed to send command {cmd}. Check connection.")
                    else:
                        print(f"Unknown command: {cmd}")
                        
            except KeyboardInterrupt:
                print("\nCommand interrupted. Type 'Q' to quit.")
            except Exception as e:
                print(f"Error in command loop: {e}")
    
    def start(self):
        """Start the frontend with improved error handling"""
        print(f"Motion Capture Controller v1.1")
        print(f"Connecting to {self.port}...")
        
        if not self.connect():
            print("Failed to connect. Would you like to retry? (Y/N)")
            retry = input().strip().upper()
            if retry != "Y":
                return False
            
            if not self.reconnect():
                print("Connection failed. Exiting.")
                return False
        
        self.running = True
        
        # Start the read thread
        read_thread = threading.Thread(target=self.read_thread)
        read_thread.daemon = True
        read_thread.start()
        
        # Start the visualization data processing thread
        viz_data_thread = threading.Thread(target=self.visualization_thread)
        viz_data_thread.daemon = True
        viz_data_thread.start()
        
        # Run the command loop in the main thread
        try:
            self.run_command_loop()
        except KeyboardInterrupt:
            print("\nExiting...")
        finally:
            self.running = False
            self.disconnect()
        
        return True

def find_serial_ports():
    """Find available serial ports on the system"""
    available_ports = []
    
    if os.name == 'nt':  # Windows
        from serial.tools import list_ports
        available_ports = [port.device for port in list_ports.comports()]
    else:  # Linux/Mac
        import glob
        if os.path.exists('/dev'):
            patterns = ['/dev/ttyUSB*', '/dev/ttyACM*', '/dev/tty.*', '/dev/cu.*']
            for pattern in patterns:
                available_ports.extend(glob.glob(pattern))
    
    return available_ports

def main():
    try:
        # Find available ports
        available_ports = find_serial_ports()
        
        parser = argparse.ArgumentParser(description="Motion Capture Controller")
        
        if available_ports:
            parser.add_argument("port", nargs='?', default=available_ports[0], 
                                help=f"Serial port to connect to (default: {available_ports[0]})")
            print(f"Found ports: {', '.join(available_ports)}")
        else:
            parser.add_argument("port", help="Serial port to connect to (e.g., COM3 or /dev/ttyUSB0)")
            print("No serial ports detected automatically. Please specify a port.")
            
        parser.add_argument("-b", "--baud", type=int, default=115200, help="Baud rate (default: 115200)")
        parser.add_argument("-d", "--debug", action="store_true", help="Enable debug mode (show heartbeats)")
        
        args = parser.parse_args()
        
        frontend = MoCapFrontend(args.port, args.baud, args.debug)
        frontend.start()
        
    except KeyboardInterrupt:
        print("\nProgram interrupted. Exiting.")
    except Exception as e:
        print(f"Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1
        
    return 0

if __name__ == "__main__":
    sys.exit(main())
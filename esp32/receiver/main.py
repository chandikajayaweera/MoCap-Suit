# main.py (receiver) - Improved version with bug fixes
import network
import socket
import sys
import select
import time
import _thread
import struct
import gc
import config_receiver as cfg
import machine

# Constants for better readability
HEARTBEAT_TIMEOUT = 60  # seconds
CMD_RESTART_NODE = 'N'
CMD_RESTART_RECEIVER = 'R'
CMD_START_STREAMING = 'S'
CMD_STOP_STREAMING = 'X'
CMD_CHECK_SENSORS = 'C'
CMD_REINIT_SENSORS = 'I'
CMD_QUIT = 'Q'
CMD_DEBUG = 'D'
CMD_PING = 'P'

# Global emergency stop flag for consistent thread termination
emergency_stop = False
emergency_lock = _thread.allocate_lock()

# Hardware watchdog timer to recover from crashes
watchdog = None
try:
    watchdog = machine.WDT(timeout=30000)  # 30 second timeout
except Exception as e:
    print(f"Warning: Could not initialize watchdog: {e}")

# Log levels for better filtering
LOG_DEBUG = 0
LOG_INFO = 1
LOG_WARNING = 2
LOG_ERROR = 3

# Current log level with thread-safe access
current_log_level = LOG_INFO
log_level_lock = _thread.allocate_lock()  # Lock for thread safety

def check_emergency_stop():
    """Check if emergency stop is activated"""
    global emergency_stop
    
    with emergency_lock:
        return emergency_stop

def set_emergency_stop():
    """Set emergency stop flag"""
    global emergency_stop
    
    with emergency_lock:
        emergency_stop = True


def feed_watchdog():
    """Feed the watchdog timer if it's enabled"""
    global watchdog
    if watchdog:
        try:
            watchdog.feed()
        except Exception:
            pass

# Logger with log levels
def log(message, level=LOG_INFO, source="RECEIVER"):
    """
    Send logs to controller with improved formatting and filtering
    Args:
        message: The message to log
        level: Log level (LOG_DEBUG, LOG_INFO, LOG_WARNING, LOG_ERROR)
        source: Source of the log message
    """
    global current_log_level
    
    # Skip messages below current log level with thread safety
    with log_level_lock:
        if level < current_log_level:
            return
    
    # Get log level prefix
    level_prefix = ""
    if level == LOG_DEBUG:
        level_prefix = "[DEBUG] "
    elif level == LOG_WARNING:
        level_prefix = "[WARNING] "
    elif level == LOG_ERROR:
        level_prefix = "[ERROR] "
    
    try:
        t = time.localtime()
        timestamp = "[{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}] ".format(t[0], t[1], t[2], t[3], t[4], t[5])
    except Exception:
        timestamp = ""
        
    formatted = "[" + source + "] " + timestamp + level_prefix + message
    
    # Then send to the computer with the LOG: prefix
    try:
        sys.stdout.write("LOG:" + formatted + "\n")
        if hasattr(sys.stdout, "flush"):
            sys.stdout.flush()
    except Exception as e:
        print(f"Error sending log to controller: {e}")

def validate_config():
    """Validate that configuration values are reasonable"""
    if not cfg.SSID or len(cfg.SSID) > 32:
        log("Invalid SSID in config", LOG_ERROR)
        return False
    if not cfg.PASSWORD or len(cfg.PASSWORD) < 8:
        log("Invalid password in config (too short)", LOG_ERROR)
        return False
    return True

class NetworkManager:
    def __init__(self):
        self.ap = network.WLAN(network.AP_IF)
        self.tcp_socket = None
        self.udp_socket = None
        self.clients = []  # Track connected clients

    def start_ap(self):
        """Start WiFi access point with improved reliability and retry logic"""
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                self.ap.active(False)  # First deactivate
                time.sleep_ms(500)     # Shorter wait
                self.ap.active(True)   # Then activate
                
                # Configure the access point with maximum compatibility
                self.ap.config(
                    essid=cfg.SSID,
                    password=cfg.PASSWORD,
                    authmode=network.AUTH_WPA_WPA2_PSK,
                    channel=6,  # Use a commonly available channel
                    hidden=False  # Make it visible for easier troubleshooting
                )
                
                # Set IP configuration
                self.ap.ifconfig((cfg.AP_IP, cfg.SUBNET_MASK, cfg.AP_IP, cfg.AP_IP))
                
                # Wait for the AP to start with timeout and watchdog feeding
                start_time = time.ticks_ms()
                while time.ticks_diff(time.ticks_ms(), start_time) < 10000:  # 10-second timeout
                    feed_watchdog()
                    if self.ap.active():
                        try:
                            mac = self.ap.config('mac')
                            mac_str = ":".join(["{:02x}".format(b) for b in mac])
                            log("Access Point started successfully! SSID: " + cfg.SSID)
                            log("AP IP: " + cfg.AP_IP + ", MAC: " + mac_str)
                        except Exception:
                            log("Access Point started successfully! SSID: " + cfg.SSID)
                            log("AP IP: " + cfg.AP_IP)
                        return True
                    time.sleep_ms(500)
                
                # AP didn't start within timeout, try again if not the last attempt
                if attempt < max_attempts - 1:
                    wait_time = 2 ** attempt  # Exponential backoff
                    log(f"AP start failed (attempt {attempt+1}), retrying in {wait_time}s...", LOG_WARNING)
                    time.sleep(wait_time)
                else:
                    log("Failed to start Access Point after all attempts.", LOG_ERROR)
            except OSError as e:
                if attempt < max_attempts - 1:
                    wait_time = 2 ** attempt  # Exponential backoff
                    log(f"Error starting AP (attempt {attempt+1}): {e}, retrying in {wait_time}s...", LOG_WARNING)
                    time.sleep(wait_time)
                else:
                    log(f"Final error starting Access Point: {e}", LOG_ERROR)
        
        return False

    def create_tcp_socket(self):
        """Create TCP socket with better error handling and socket options"""
        try:
            # Close existing socket if it exists
            if self.tcp_socket:
                try:
                    self.tcp_socket.close()
                except Exception:
                    pass
                self.tcp_socket = None
                time.sleep_ms(500)  # Wait for socket to fully close
                
            self.tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.tcp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            
            # Set additional socket options if available
            try:
                # Keep-alive can help detect stale connections
                self.tcp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            except Exception:
                # Not all MicroPython implementations support these options
                pass
                
            self.tcp_socket.bind((cfg.AP_IP, cfg.TCP_PORT))
            self.tcp_socket.listen(1)
            # Set timeout to make accept interruptible
            self.tcp_socket.settimeout(3.0)
            log(f"TCP server running on {cfg.AP_IP}:{cfg.TCP_PORT}")
            return True
        except OSError as e:
            log(f"Error starting TCP socket: {e}", LOG_ERROR)
            return False

    def create_udp_socket(self):
        """Create UDP socket with better error handling and buffer size optimization"""
        try:
            # Close existing UDP socket if it exists.
            if self.udp_socket:
                try:
                    self.udp_socket.close()
                except Exception:
                    pass
                self.udp_socket = None
                time.sleep_ms(500)  # Wait for socket to fully close
                
            self.udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            
            # Set larger receive buffer if supported
            try:
                self.udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8192)
            except Exception:
                # Not all MicroPython implementations support this option
                pass
                
            self.udp_socket.bind((cfg.AP_IP, cfg.UDP_PORT))
            self.udp_socket.setblocking(False)
            log(f"UDP server running on {cfg.AP_IP}:{cfg.UDP_PORT}")
            return True
        except OSError as e:
            log(f"Error starting UDP socket: {e}", LOG_ERROR)
            return False

    def cleanup(self):
        """Close all sockets and clean up resources"""
        # Close any client sockets
        for client in self.clients:
            try:
                client.close()
            except Exception:
                pass
        self.clients = []
        
        # Close UDP socket
        if self.udp_socket:
            try:
                self.udp_socket.close()
            except Exception:
                pass
            self.udp_socket = None
            
        # Close TCP socket
        if self.tcp_socket:
            try:
                self.tcp_socket.close()
            except Exception:
                pass
            self.tcp_socket = None
            
        log("Network resources cleaned up")

class TCPServer:
    """
    Handles the TCP connection to the node.
    It receives logs/error messages from the node and also
    can forward short command codes to the node.
    """
    def __init__(self, tcp_socket):
        self.tcp_socket = tcp_socket
        self.node_conn = None
        self.running = True
        self._last_heartbeat = 0
        # Thread-safe lock for node_conn and heartbeat access
        self.conn_lock = _thread.allocate_lock()
        self.heartbeat_lock = _thread.allocate_lock()
        
        # Pre-allocate receive buffer
        self.recv_buffer = bytearray(4096)
        
    @property
    def last_heartbeat(self):
        with self.heartbeat_lock:
            return self._last_heartbeat
              
    @last_heartbeat.setter
    def last_heartbeat(self, value):
        with self.heartbeat_lock:
            self._last_heartbeat = value
        
    def run(self):
        """Main accept loop that handles incoming connections with watchdog feeding"""
        while self.running and not check_emergency_stop():
            try:
                # Feed watchdog in accept loop
                feed_watchdog()
                
                # Accept with timeout to allow for interruption
                self.tcp_socket.settimeout(3.0)
                client_sock, client_addr = self.tcp_socket.accept()
                log(f"TCP connection established from {client_addr}")
                
                # Handle the client in a new thread to avoid blocking new connections
                _thread.start_new_thread(self.handle_client, (client_sock, client_addr))
                
            except OSError as e:
                error_str = str(e).lower()
                if "timed out" in error_str or "etimedout" in error_str:
                    # This is normal with timeout - do not log
                    continue
                elif self.running:  # Only log if we're still supposed to be running
                    log(f"Error accepting TCP connection: {e}", LOG_WARNING)
                    time.sleep_ms(1000)
            except Exception as e:
                log(f"Unexpected error in TCP server: {e}", LOG_ERROR)
                time.sleep_ms(1000)

    def stop(self):
        """
        Stop the TCP server and close connections safely with timeout handling.
        This method is thread-safe for multiple callers.
        """
        log("Stopping TCP server...")
        # Set running flag to false to stop accept loop
        self.running = False
        
        # Close node connection if it exists
        with self.conn_lock:
            if self.node_conn is not None:
                try:
                    self.node_conn.close()
                except Exception as e:
                    log(f"Error closing node connection: {e}", LOG_DEBUG)
                self.node_conn = None
        
        # Close TCP socket if it exists
        if hasattr(self, 'tcp_socket') and self.tcp_socket is not None:
            try:
                self.tcp_socket.close()
            except Exception as e:
                log(f"Error closing TCP socket: {e}", LOG_DEBUG)
            self.tcp_socket = None
        
        log("TCP server stopped")

    def handle_client(self, client_sock, addr):
        """Handle client connection with improved timeout handling and error recovery"""
        with self.conn_lock:
            # Close existing connection if any
            if self.node_conn is not None:
                try:
                    self.node_conn.close()
                except Exception as e:
                    log(f"Error closing previous node connection: {e}", LOG_DEBUG)
                self.node_conn = None
            self.node_conn = client_sock
            
        try:
            # Use non-blocking with select instead of settimeout which isn't available
            client_sock.setblocking(False)
            last_activity = time.ticks_ms()
            
            while self.running and not check_emergency_stop():
                # Feed watchdog
                feed_watchdog()
                
                try:
                    # Check if data is available with select (with 1 second timeout)
                    r, _, _ = select.select([client_sock], [], [], 1)
                    
                    # If not running anymore, break the loop
                    if not self.running or check_emergency_stop():
                        log("TCP server shutdown requested - closing client")
                        break
                    
                    # Process data if available
                    if r:
                        try:
                            data = client_sock.recv(1024)
                            if not data:
                                log("Node connection closed")
                                break
                            
                            # Process the data
                            message = data.decode().strip()
                            last_activity = time.ticks_ms()
                            
                            # Process different message types
                            if message.startswith("HEARTBEAT"):
                                # Handle enhanced heartbeat with stats (HEARTBEAT:sensors/total:memory)
                                heartbeat_parts = message.split(":", 2)
                                if len(heartbeat_parts) >= 2:
                                    sensor_status = heartbeat_parts[1] if len(heartbeat_parts) > 1 else "N/A"
                                    mem_status = heartbeat_parts[2] if len(heartbeat_parts) > 2 else "N/A"
                                    log(f"Node heartbeat - Sensors: {sensor_status}, Mem: {mem_status}", LOG_DEBUG)
                                
                                # Update last heartbeat time
                                self.last_heartbeat = time.ticks_ms()
                            elif message.startswith("LOG:"):
                                # Strip the LOG: prefix and forward
                                log_message = message[4:]
                                sys.stdout.write(f"LOG:{log_message}\n")
                                if hasattr(sys.stdout, "flush"):
                                    sys.stdout.flush()
                            elif message.startswith("NODE_CONNECTED"):
                                log("Node connected and ready")
                                
                                # Check for protocol version
                                if ":" in message:
                                    version = message.split(":", 1)[1]
                                    log(f"Node protocol version: {version}")
                            else:
                                # Regular response from node - could be command response
                                log_prefix = message[:50] + "..." if len(message) > 50 else message
                                log(f"Response from node: {log_prefix}")
                                if len(message) > 50:
                                    log(f"  (message length: {len(message)} chars)", LOG_DEBUG)
                                
                                # Forward the response to the frontend
                                sys.stdout.write(f"LOG:[NODE] Command response: {message}\n")
                                if hasattr(sys.stdout, "flush"):
                                    sys.stdout.flush()
                        except Exception as e:
                            error_str = str(e).lower()
                            if "eagain" in error_str or "would block" in error_str or "nonblocking" in error_str:
                                # This is normal for non-blocking sockets (BlockingIOError equivalent)
                                pass
                            else:
                                raise
                    
                    # Check for inactivity timeout (heartbeat-based)
                    current_time = time.ticks_ms()
                    time_since_last_activity = time.ticks_diff(current_time, last_activity)
                    if time_since_last_activity > HEARTBEAT_TIMEOUT * 1000:
                        log(f"Connection timeout - no activity for {HEARTBEAT_TIMEOUT} seconds", LOG_WARNING)
                        break
                except KeyboardInterrupt:
                    log("Keyboard interrupt in client handler")
                    self.running = False
                    set_emergency_stop()  # Set the emergency stop flag
                    break
                except Exception as e:
                    log(f"Unexpected error in client handling: {e}", LOG_ERROR)
                    time.sleep_ms(1000)
        except Exception as e:
            log(f"Error handling TCP client: {str(e)}", LOG_ERROR)
        finally:
            with self.conn_lock:
                if self.node_conn is client_sock:
                    self.node_conn = None
                    
            try:
                client_sock.close()
            except Exception:
                pass
                
            log("TCP connection closed.")
            
    def send_to_node(self, command_code, wait_for_response=True, timeout_sec=5):
        """
        Send a command to the node via its command server with improved reliability
        
        Args:
            command_code: The command to send
            wait_for_response: Whether to wait for a response
            timeout_sec: Timeout in seconds for response
            
        Returns:
            (success, response) tuple
        """
        # Use longer timeout for initialization and sensor check commands
        if command_code == 'I':  # Sensor initialization
            timeout_sec = 20  # Increase to 20 seconds
        elif command_code == 'C':  # Sensor check
            timeout_sec = 10  # Increase to 10 seconds
            
        cmd_sock = None
        try:
            # Create a new socket for the command connection
            cmd_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            # Use settimeout() method of the socket instance
            cmd_sock.settimeout(timeout_sec)  # configurable timeout
            
            # Connect to the node's command server
            log(f"Connecting to node command server at {cfg.NODE_IP}:{cfg.TCP_PORT}...")
            cmd_sock.connect((cfg.NODE_IP, cfg.TCP_PORT))
            
            # Send the command
            log(f"Sending command '{command_code}' to node...")
            cmd_sock.send(command_code.encode())
            
            # Wait for response if requested
            if wait_for_response:
                try:
                    response = cmd_sock.recv(4096).decode()
                    if response:
                        # Parse structured response (format: "STATUS:message")
                        status = "UNKNOWN"
                        message = response
                        
                        if ":" in response:
                            parts = response.split(":", 1)
                            status = parts[0]
                            message = parts[1] if len(parts) > 1 else ""
                        
                        # Handle based on status
                        if status == "OK":
                            log_prefix = message[:50] + "..." if len(message) > 50 else message
                            log(f"Success response from node: {log_prefix}")
                            # Forward the response to the frontend
                            sys.stdout.write(f"LOG:[NODE] Command successful: {message}\n")
                            if hasattr(sys.stdout, "flush"):
                                sys.stdout.flush()
                            return True, message
                        else:
                            log(f"Error response from node: {message}", LOG_WARNING)
                            # Forward the error to the frontend
                            sys.stdout.write(f"LOG:[NODE] Command failed: {message}\n")
                            if hasattr(sys.stdout, "flush"):
                                sys.stdout.flush()
                            return False, message
                    else:
                        log(f"Empty response from node after command: {command_code}", LOG_WARNING)
                        return False, "Empty response"
                except Exception as e:
                    # Use general exception handling for better compatibility
                    log("Response error from node after command: {} - {}".format(command_code, e), LOG_WARNING)
                    return False, "Error: {}".format(e)
            else:
                return True, "Command sent (no response requested)"
                    
        except Exception as e:
            log(f"Error sending command to node: {str(e)}", LOG_ERROR)
            return False, f"Error: {e}"
        finally:
            # Always clean up the socket in a finally block
            if cmd_sock:
                try:
                    cmd_sock.close()
                except Exception:
                    pass

class UDPServer:
    """
    Receives sensor data (quaternion data) from the node via UDP
    and writes the binary packets directly to the controller via CDC USB.
    """
    def __init__(self, udp_socket):
        self.udp_socket = udp_socket
        self.running = True
        self.packet_count = 0
        self.last_seq = None
        self.start_time = time.ticks_ms()
        self.error_count = 0
        self.max_errors = 10
        # Pre-allocate buffer for receiving data
        self.recv_buffer = bytearray(4200)  # Slightly larger than expected packet size
        # Periodic stats reporting
        self.last_stats_time = time.ticks_ms()
        self.stats_interval = 10000  # 10 seconds

    def run(self):
        """Receive and process UDP data with improved reliability and packet validation"""
        log("UDP data streaming started")
        
        while self.running and not check_emergency_stop():
            try:
                # Feed watchdog
                feed_watchdog()
                
                # Use recvfrom_into to avoid memory allocation
                try:
                    nbytes, addr = self.udp_socket.recvfrom_into(self.recv_buffer)
                    if nbytes > 0:
                        # Use the first nbytes of the buffer
                        data = memoryview(self.recv_buffer)[:nbytes]
                    else:
                        continue
                except Exception:
                    # Fallback to regular recvfrom if recvfrom_into not available
                    data, addr = self.udp_socket.recvfrom(4096)
                
                if data:
                    # Reset error counter on successful receive
                    self.error_count = 0
                    
                    # Update statistics
                    self.packet_count += 1
                    
                    # Parse new readable format - starts with SEQ:number
                    try:
                        # Convert data to string for parsing
                        data_str = data.decode('utf-8')
                        
                        # Validate packet structure
                        if not data_str.startswith("SEQ:"):
                            raise ValueError("Invalid packet format - missing SEQ: prefix")
                            
                        parts = data_str.split(',')
                        if len(parts) < 2:
                            raise ValueError("Incomplete packet - insufficient data")
                        
                        # Extract sequence number
                        seq_part = parts[0]
                        try:
                            seq = int(seq_part.split(':')[1])
                        except (IndexError, ValueError):
                            raise ValueError("Invalid sequence number format")
                            
                        # Check for packet loss if we have a previous sequence
                        if self.last_seq is not None:
                            expected_seq = (self.last_seq + 1) % 65536
                            if seq != expected_seq:
                                lost = (seq - expected_seq) % 65536
                                if lost > 0 and lost < 1000:  # Sanity check for reasonable loss
                                    log("Packet loss detected: {} packets missing".format(lost), LOG_WARNING)
                        self.last_seq = seq
                        
                        # Format data for better readability when displayed to user
                        formatted_data = "QUAT_DATA: " + data_str
                        data = formatted_data.encode('utf-8')
                        
                    except Exception as e:
                        log("Error parsing sensor data: {}".format(e), LOG_DEBUG)
                        # Continue processing - don't discard potentially valuable data
                    
                    # Log statistics periodically
                    current_time = time.ticks_ms()
                    if time.ticks_diff(current_time, self.last_stats_time) >= self.stats_interval:
                        elapsed = time.ticks_diff(current_time, self.start_time) / 1000
                        rate = self.packet_count / elapsed if elapsed > 0 else 0
                        log(f"UDP stats: {self.packet_count} packets received, {rate:.1f} packets/sec")
                        self.last_stats_time = current_time
                        
                        # Run GC during stats to minimize impact on streaming
                        gc.collect()
                    
                    # Writing binary sensor data directly to the computer with DATA: prefix
                    try:
                        sys.stdout.buffer.write(b"DATA:")
                        sys.stdout.buffer.write(data)
                        if hasattr(sys.stdout.buffer, "flush"):
                            sys.stdout.buffer.flush()
                    except Exception as e:
                        log(f"Error writing UDP data to stdout: {e}", LOG_ERROR)
            except Exception as e:
                error_str = str(e).lower()
                if "eagain" in error_str or "would block" in error_str or "nonblocking" in error_str:
                    # No data available; avoid busy loop (BlockingIOError equivalent in MicroPython)
                    time.sleep_ms(10)
                elif "timeout" in error_str:
                    # Handle timeout more gracefully - this can happen and isn't always fatal
                    log("UDP socket timeout - will continue trying", LOG_DEBUG)
                    time.sleep_ms(50)
                else:
                    # Count other errors
                    self.error_count += 1
                    if self.error_count > self.max_errors:
                        log("Too many UDP errors ({}), stopping: {}".format(self.error_count, e), LOG_ERROR)
                        break
                    else:
                        # Log other errors but continue
                        log("UDP error ({}/{}): {}".format(self.error_count, self.max_errors, e), LOG_WARNING)
                        time.sleep_ms(100)
        
        log(f"UDP server stopped after receiving {self.packet_count} packets")

    def stop(self):
        """Stop the UDP server safely"""
        self.running = False
        # Give time for the thread to finish naturally
        time.sleep_ms(200)

class CommandHandler:
    """
    Reads commands from CDC USB (STDIN) on a separate thread.
    Commands are expected as short codes or longer structured commands.
    """
    def __init__(self, tcp_server, network_manager):
        self.tcp_server = tcp_server
        self.network_manager = network_manager
        self.udp_server = None
        self.running = True
        # Flag to signal a clean exit
        self.exit_requested = False
        
        # Command dictionary for better modularity
        self.commands = {
            'S': self.start_streaming,
            'X': self.stop_streaming,
            'N': self.restart_node,
            'R': self.restart_receiver,
            'C': self.check_sensors,
            'I': self.reinitialize_sensors,
            'Q': self.quit_receiver,
            'D': self.set_debug_mode,
            'P': self.ping_node
        }

    def start_streaming(self, params=None):
        """Start sensor data streaming"""
        # Start sensor data: create and start UDP server.
        if self.udp_server is None:
            if self.network_manager.create_udp_socket():
                # First send the command to the node to start sending data
                success, response = self.tcp_server.send_to_node(CMD_START_STREAMING)
                if success:
                    # Then start our UDP server to receive it
                    self.udp_server = UDPServer(self.network_manager.udp_socket)
                    _thread.start_new_thread(self.udp_server.run, ())
                    log("UDP server started for sensor data.")
                    return True
                else:
                    log(f"Failed to send start command to node: {response}", LOG_ERROR)
                    # Clean up the socket we just created
                    if self.network_manager.udp_socket:
                        self.network_manager.udp_socket.close()
                        self.network_manager.udp_socket = None
                    return False
            else:
                log("Failed to create UDP server.", LOG_ERROR)
                return False
        else:
            log("UDP server is already running.")
            return True

    def stop_streaming(self, params=None):
        """Stop sensor data streaming"""
        # First tell the node to stop sending
        self.tcp_server.send_to_node(CMD_STOP_STREAMING)
        
        # Then stop our UDP server
        if self.udp_server:
            self.udp_server.stop()
            self.udp_server = None
            
        # Close the socket
        if self.network_manager.udp_socket:
            try:
                self.network_manager.udp_socket.close()
            except Exception:
                pass
            self.network_manager.udp_socket = None
            log("UDP server stopped.")
            return True
        else:
            log("UDP server was not running.")
            return True

    def restart_node(self, params=None):
        """Restart node command"""
        log("Sending restart command to node...")
        success, response = self.tcp_server.send_to_node(CMD_RESTART_NODE, wait_for_response=False)
        if success:
            log("Restart command sent to node.")
            
            # If we were streaming, stop the UDP server
            if self.udp_server:
                self.udp_server.stop()
                self.udp_server = None
                if self.network_manager.udp_socket:
                    try:
                        self.network_manager.udp_socket.close()
                    except Exception:
                        pass
                    self.network_manager.udp_socket = None
            return True
        else:
            log(f"Failed to send restart command to node: {response}", LOG_ERROR)
            return False

    def restart_receiver(self, params=None):
        """Restart receiver command"""
        log("Restarting receiver...")
        # Clean up first
        self.stop_streaming()
        
        # Set TCP server running flag to false
        if hasattr(self.tcp_server, 'running'):
            self.tcp_server.running = False
            
        # Clean up network resources
        self.network_manager.cleanup()
        
        # Wait for things to clean up
        time.sleep_ms(1000)
        
        # Reset the device
        try:
            machine.reset()
        except Exception:
            log("Failed to reset machine", LOG_ERROR)
            # If machine reset fails, set exit flag to restart normally
            self.exit_requested = True
            self.running = False
            return False
            
        return True

    def check_sensors(self, params=None):
        """Check sensor status command with multiple retry attempts"""
        log("Sending sensor status check command to node...")
        
        # Add retry logic with watchdog feeding
        for attempt in range(3):  # 3 attempts
            feed_watchdog()  # Feed watchdog during long operation
            success, response = self.tcp_server.send_to_node(CMD_CHECK_SENSORS)
            if success:
                log("Sensor status check command sent to node.")
                return True
            elif attempt < 2:  # Don't wait after last attempt
                log(f"Attempt {attempt+1} failed, retrying...", LOG_WARNING)
                time.sleep_ms(1000)  # Wait before retry
        
        log(f"Failed to send sensor status check command after all attempts", LOG_ERROR)
        return False

    def reinitialize_sensors(self, params=None):
        """Reinitialize sensors command with retries and watchdog feeding"""
        log("Sending sensor reinitialization command to node...")
        
        # Add retry logic with watchdog feeding
        for attempt in range(3):  # 3 attempts with watchdog feeding
            feed_watchdog()  # Feed watchdog during long operation
            success, response = self.tcp_server.send_to_node(CMD_REINIT_SENSORS)
            if success:
                log("Sensor reinitialization command sent to node.")
                return True
            elif attempt < 2:  # Don't wait after last attempt
                log(f"Attempt {attempt+1} failed, retrying...", LOG_WARNING)
                time.sleep_ms(2000)  # Longer wait for initialization
        
        log(f"Failed to send sensor reinitialization command after all attempts", LOG_ERROR)
        return False

    def quit_receiver(self, params=None):
        """Clean exit command"""
        log("Shutting down receiver (clean exit)...")
        
        # Stop UDP server if running
        self.stop_streaming()
        
        # Stop TCP server
        self.tcp_server.stop()
        
        # Clean up network resources
        self.network_manager.cleanup()
        
        # Set flags for orderly shutdown
        self.exit_requested = True
        self.running = False
        
        # Set emergency stop flag
        set_emergency_stop()
            
        return True

    def set_debug_mode(self, params=None):
        """Set debug mode command with node synchronization"""
        global current_log_level

        try:
            if params:
                # Strip any whitespace and check if valid integer
                param_clean = params.strip()
                if not param_clean.isdigit():
                    log(f"Invalid log level '{params}': must be integer 0-3", LOG_ERROR)
                    return False
                level = int(param_clean)
                if 0 <= level <= 3:
                    # Set receiver's log level
                    with log_level_lock:
                        current_log_level = level
                    modes = ["DEBUG", "INFO", "WARNING", "ERROR"]
                    log_msg = f"Receiver log level set to {modes[level]}"

                    # Send command to node and wait for response
                    success, node_response = self.tcp_server.send_to_node(f"D:{level}", wait_for_response=True)
                    
                    if success:
                        log_msg += f" | Node: {node_response}"
                    else:
                        log_msg += f" | Node failed: {node_response}"
                    
                    log(log_msg)
                    return True
                else:
                    log(f"Invalid log level: {level}. Must be 0-3.", LOG_ERROR)
                    return False
            else:
                # Return current log level
                with log_level_lock:
                    level = current_log_level
                log(f"Current receiver log level: {['DEBUG', 'INFO', 'WARNING', 'ERROR'][level]}")
                return True
        except Exception as e:
            log(f"Error setting debug mode: {e}", LOG_ERROR)
            return False

    def ping_node(self, params=None):
        """Ping node command"""
        log("Pinging node...")
        success, response = self.tcp_server.send_to_node(CMD_PING)
        if success:
            log(f"Node is responsive: {response}")
            return True
        else:
            log(f"Node ping failed: {response}", LOG_WARNING)
            return False

    def process_command(self, cmd):
        """
        Process commands with command pattern implementation and validation
        Args:
            cmd: Command string (can be structured with params using colon separator)
        """
        # Validate command length
        if not cmd or len(cmd) > 100:  # Reasonable command length limit
            log(f"Invalid command length: {len(cmd) if cmd else 0}", LOG_WARNING)
            return
            
        log(f"Processing command: {cmd}")
        
        try:
            # Parse command and parameters
            cmd_parts = cmd.split(':', 1)
            cmd_code = cmd_parts[0].upper()
            params = cmd_parts[1] if len(cmd_parts) > 1 else None
            
            # Look up command handler
            handler = self.commands.get(cmd_code)
            
            if handler:
                # Feed watchdog before potentially long command
                feed_watchdog()
                
                # Execute the command handler
                success = handler(params)
                if success:
                    log(f"Command {cmd_code} executed successfully")
                else:
                    log(f"Command {cmd_code} failed", LOG_WARNING)
            else:
                log(f"Unknown command received: {cmd}", LOG_WARNING)
                
        except Exception as e:
            log(f"Error processing command {cmd}: {e}", LOG_ERROR)
            # Don't reraise - keep running even after errors

    def run(self):
        """Read commands from CDC USB (STDIN) more reliably with watchdog feeding and buffer size limits"""
        # Flush any existing input to prevent residual data
        self.flush_input()
        buffer = ""
        MAX_BUFFER_SIZE = 256  # Prevent buffer overflow attacks
        
        while self.running and not check_emergency_stop():
            try:
                # Feed watchdog
                feed_watchdog()
                
                # Direct character-by-character reading approach
                if sys.stdin in select.select([sys.stdin], [], [], 0.1)[0]:
                    char = sys.stdin.read(1)
                    if char:
                        if char == '\n' or char == '\r':
                            if buffer:
                                cmd = buffer.strip().upper()
                                log(f"Received command from controller: {cmd}")
                                buffer = ""
                                self.process_command(cmd)
                        else:
                            # Prevent buffer overflow
                            if len(buffer) < MAX_BUFFER_SIZE:
                                buffer += char
                            else:
                                log("Command buffer overflow - resetting", LOG_WARNING)
                                buffer = ""
            except Exception as e:
                log(f"Error in command handler: {e}", LOG_ERROR)
            
            # Short sleep to prevent CPU hogging
            time.sleep_ms(10)
    
    def flush_input(self):
        """Flush any pending input from stdin"""
        try:
            while True:
                # Check if there's data to read without blocking
                r, _, _ = select.select([sys.stdin], [], [], 0)
                if sys.stdin in r:
                    # Read and discard the data
                    sys.stdin.read(1)
                else:
                    break
        except Exception as e:
            log(f"Error flushing input: {e}", LOG_DEBUG)

def start_tcp_server(network_manager):
    """Start TCP server in a thread"""
    tcp_server = TCPServer(network_manager.tcp_socket)
    _thread.start_new_thread(tcp_server.run, ())
    return tcp_server

def start_command_handler(tcp_server, network_manager):
    """Start command handler in a thread"""
    cmd_handler = CommandHandler(tcp_server, network_manager)
    _thread.start_new_thread(cmd_handler.run, ())
    return cmd_handler

def system_status_thread(tcp_server, network_manager, cmd_handler):
    """Periodically check and report system status using a timer approach with memory monitoring"""
    start_time = time.ticks_ms()
    
    try:
        def report_status(timer):
            if cmd_handler.exit_requested or check_emergency_stop():
                if hasattr(timer, 'deinit'):
                    timer.deinit()  # Stop the timer if exit requested
                return
                
            try:
                # Feed watchdog
                feed_watchdog()
                
                # Check memory and force GC if needed
                free_mem = gc.mem_free()
                if free_mem < 20000:  # 20KB threshold
                    log(f"Low memory: {free_mem} bytes free, running garbage collection", LOG_WARNING)
                    gc.collect()
                    free_mem = gc.mem_free()  # Get updated value
                
                # Calculate uptime
                uptime_ms = time.ticks_diff(time.ticks_ms(), start_time)
                uptime_sec = uptime_ms // 1000
                uptime_min = uptime_sec // 60
                uptime_hr = uptime_min // 60
                
                # Check WiFi AP status
                wifi_status = "Active" if network_manager.ap.active() else "Inactive"
                
                # Check node connection status
                node_status = "Connected" if tcp_server.node_conn else "Disconnected"
                
                # Check UDP streaming status
                udp_status = "Active" if cmd_handler.udp_server else "Inactive"
                
                # Calculate time since last heartbeat
                heartbeat_age = "Never"
                if tcp_server.last_heartbeat > 0:
                    age_sec = time.ticks_diff(time.ticks_ms(), tcp_server.last_heartbeat) // 1000
                    heartbeat_age = f"{age_sec}s ago"
                
                # Log the status
                log(f"STATUS: Uptime: {int(uptime_hr)}h {int(uptime_min%60)}m {int(uptime_sec%60)}s | "
                    f"WiFi AP: {wifi_status} | Node: {node_status} | "
                    f"UDP: {udp_status} | Last HB: {heartbeat_age} | Free Mem: {free_mem}")
                    
                # Run garbage collection
                gc.collect()
                
            except Exception as e:
                log(f"Error in status thread: {e}", LOG_ERROR)
                
        # Use a timer for more precise timing if available
        try:
            # Create a timer that triggers every 60 seconds
            status_timer = machine.Timer(-1)
            status_timer.init(period=60000, mode=machine.Timer.PERIODIC, callback=report_status)
            
            # Initial status report
            report_status(None)
            
            # Keep this thread alive but with minimal resource usage
            while not cmd_handler.exit_requested and not check_emergency_stop():
                time.sleep_ms(1000)
                feed_watchdog()
                
            # Clean up timer
            if hasattr(status_timer, 'deinit'):
                status_timer.deinit()
                
        except Exception:
            # Fallback to basic sleep loop if Timer is not available
            while not cmd_handler.exit_requested and not check_emergency_stop():
                report_status(None)  # Use the same function with None as timer
                
                # Sleep in smaller chunks to respond to exit request faster
                for _ in range(60):
                    if cmd_handler.exit_requested or check_emergency_stop():
                        break
                    time.sleep_ms(1000)
                    feed_watchdog()
    
    except KeyboardInterrupt:
        log("Keyboard interrupt in status thread", LOG_WARNING)
        set_emergency_stop()  # Set the emergency stop flag
    except Exception as e:
        log(f"Error in status thread: {e}", LOG_ERROR)

def cleanup_resources(tcp_server, network_manager, cmd_handler):
    """
    Stop all threads and clean up resources with more thorough error handling
    """
    log("Cleaning up resources...")
    
    # First disable watchdog to prevent resets during cleanup
    global watchdog
    if watchdog:
        try:
            # Some ESP32 implementations allow disabling the watchdog
            if hasattr(watchdog, 'deinit'):
                watchdog.deinit()
        except Exception:
            pass
    
    # Stop sensor reading if active
    if cmd_handler and hasattr(cmd_handler, 'udp_server') and cmd_handler.udp_server:
        try:
            cmd_handler.udp_server.stop()
            log("UDP server stopped")
        except Exception as e:
            log(f"Error stopping UDP server: {e}", LOG_DEBUG)
        cmd_handler.udp_server = None
    
    # Close UDP socket
    if network_manager and hasattr(network_manager, 'udp_socket') and network_manager.udp_socket:
        try:
            network_manager.udp_socket.close()
            log("UDP socket closed")
        except Exception as e:
            log(f"Error closing UDP socket: {e}", LOG_DEBUG)
        network_manager.udp_socket = None
    
    # Stop the TCP server
    if tcp_server:
        try:
            if hasattr(tcp_server, 'stop'):
                tcp_server.stop()
            else:
                if hasattr(tcp_server, 'running'):
                    tcp_server.running = False
                
                if hasattr(tcp_server, 'node_conn') and tcp_server.node_conn:
                    try:
                        tcp_server.node_conn.close()
                    except Exception:
                        pass
                    tcp_server.node_conn = None
            log("TCP server stopped")
        except Exception as e:
            log(f"Error stopping TCP server: {e}", LOG_DEBUG)
    
    # Close TCP socket
    if network_manager and hasattr(network_manager, 'tcp_socket') and network_manager.tcp_socket:
        try:
            network_manager.tcp_socket.close()
            log("TCP socket closed")
        except Exception as e:
            log(f"Error closing TCP socket: {e}", LOG_DEBUG)
        network_manager.tcp_socket = None
    
    # Stop AP if active
    if network_manager and hasattr(network_manager, 'ap'):
        try:
            network_manager.ap.active(False)
            log("WiFi AP deactivated")
        except Exception as e:
            log(f"Error deactivating AP: {e}", LOG_DEBUG)
    
    # Run garbage collection
    gc.collect()
    
    # Give more time for threads to finish - increase from 500ms to 2000ms
    log("Waiting for threads to terminate...")
    time.sleep_ms(2000)
    
    # Try to reset UART/USB state
    try:
        import machine
        uart = machine.UART(0, 115200)  # Assuming UART0 is used for USB
        uart.deinit()
        log("UART reset")
    except Exception:
        pass
    
    log("Resources cleaned up")
    return True

def safe_mode():
    """
    Enter safe mode with minimal functionality for diagnostics with state preservation
    """
    global current_log_level, emergency_stop
    
    # Preserve emergency stop state
    with emergency_lock:
        was_emergency = emergency_stop
    
    # Save current log level
    with log_level_lock:
        old_log_level = current_log_level
        # Set to most verbose for diagnostics
        current_log_level = LOG_DEBUG
    
    log("ENTERING SAFE MODE - Limited functionality available", LOG_ERROR)
    
    try:
        # Basic hardware check
        try:
            ap = network.WLAN(network.AP_IF)
            ap.active(True)
            log(f"AP active: {ap.active()}", LOG_INFO)
        except Exception as e:
            log(f"AP activation failed: {e}", LOG_ERROR)
        
        # Memory status
        try:
            log(f"Memory - Free: {gc.mem_free()}, Allocated: {gc.mem_alloc()}", LOG_INFO)
        except Exception as e:
            log(f"Memory check failed: {e}", LOG_ERROR)
        
        # Keep the system alive but in a minimal state
        log("Safe mode active. Press Ctrl+C for REPL or reset device.", LOG_INFO)
        
        try:
            while True:
                feed_watchdog()
                time.sleep_ms(1000)
        except KeyboardInterrupt:
            log("Keyboard interrupt detected, entering REPL", LOG_INFO)
        except Exception as e:
            log(f"Safe mode error: {e}", LOG_ERROR)
            machine.reset()  # Last resort
    finally:
        # Restore state if returning from safe mode
        with emergency_lock:
            emergency_stop = was_emergency
        with log_level_lock:
            current_log_level = old_log_level

def main():
    """Main function with improved error handling and recovery"""
    print("\n" * 2)
    print("============================================")
    print("MOTION CAPTURE RECEIVER - STARTING")
    print("Press BOOT button at startup to enter emergency REPL mode")
    print("Send 'Q' command to exit cleanly")
    print("Press Ctrl+C to enter REPL mode anytime")
    print(f"Free memory: {gc.mem_free()} bytes")
    print("============================================")
    
    # Reset emergency stop flag
    global emergency_stop
    with emergency_lock:
        emergency_stop = False
    
    # Validate config
    if not validate_config():
        log("Invalid configuration. Please check settings.", LOG_ERROR)
        return
    
    # Main initialization and recovery loop
    exit_requested = False
    tcp_server = None
    net_mgr = None
    cmd_handler = None
    
    # Track failures for safe mode entry
    failures = 0
    max_failures = 3
    
    try:
        while not exit_requested and not check_emergency_stop():
            try:
                # Feed watchdog
                feed_watchdog()
                
                net_mgr = NetworkManager()
                
                if not net_mgr.start_ap():
                    log("Failed to start Access Point, retrying...", LOG_WARNING)
                    failures += 1
                    if failures >= max_failures:
                        log("Too many consecutive failures, entering safe mode", LOG_ERROR)
                        safe_mode()
                        return
                    time.sleep_ms(5000)
                    continue
                    
                # Reset failure counter after successful AP start
                failures = 0
                    
                if not net_mgr.create_tcp_socket():
                    log("Failed to create TCP socket, retrying...", LOG_WARNING)
                    failures += 1
                    if failures >= max_failures:
                        log("Too many consecutive failures, entering safe mode", LOG_ERROR)
                        safe_mode()
                        return
                    time.sleep_ms(5000)
                    continue
                    
                # Reset failure counter after successful socket creation
                failures = 0
                
                # Start the TCP server thread
                tcp_server = start_tcp_server(net_mgr)
                
                # Start the command handler thread
                cmd_handler = start_command_handler(tcp_server, net_mgr)
                
                # Start the status thread
                _thread.start_new_thread(system_status_thread, (tcp_server, net_mgr, cmd_handler))
                
                log("Receiver is running. Awaiting commands from the Controller...")
                log("Press Ctrl+C to enter REPL mode")
                log("Use 'Q' command for clean exit")
                
                # Main thread's health monitoring loop
                while not exit_requested and not check_emergency_stop():
                    # Feed watchdog
                    feed_watchdog()
                    
                    # Check if exit was requested through command
                    if cmd_handler.exit_requested:
                        log("Exit requested via command...")
                        exit_requested = True
                        break
                    
                    # Check AP status periodically
                    if not net_mgr.ap.active():
                        if not exit_requested and not check_emergency_stop():
                            log("WiFi AP has stopped. Restarting...", LOG_WARNING)
                            break
                    
                    # Memory monitoring in main thread
                    free_mem = gc.mem_free()
                    if free_mem < 10000:  # Critical memory threshold in main thread
                        log(f"CRITICAL LOW MEMORY: {free_mem} bytes - forcing GC", LOG_ERROR)
                        gc.collect()
                    
                    # Run garbage collection occasionally
                    if time.ticks_ms() % 60000 < 1000:  # roughly once per minute
                        gc.collect()
                        
                    time.sleep_ms(1000)  # Check health every second
                    
            except KeyboardInterrupt:
                # Clean shutdown on CTRL+C
                print("\n" * 3)
                print("============================================")
                print("KEYBOARD INTERRUPT DETECTED - FORCING EXIT")
                print("============================================")
                
                # Set emergency stop flag
                set_emergency_stop()
                
                # Clean up resources
                cleanup_resources(tcp_server, net_mgr, cmd_handler)
                break
                
            except Exception as e:
                if not exit_requested and not check_emergency_stop():
                    log(f"Unexpected error in main loop: {e}", LOG_ERROR)
                    failures += 1
                    if failures >= max_failures:
                        log("Too many consecutive failures, entering safe mode", LOG_ERROR)
                        safe_mode()
                        return
                    time.sleep_ms(5000)  # Wait before retrying
                else:
                    break
    
    except KeyboardInterrupt:
        # Final KeyboardInterrupt handler
        print("\n" * 3)
        print("============================================")
        print("KEYBOARD INTERRUPT DETECTED - FORCING EXIT")
        print("============================================")
        
        # Set emergency stop flag
        set_emergency_stop()
        
        # Clean up resources
        cleanup_resources(tcp_server, net_mgr, cmd_handler)
    
    # Final cleanup
    cleanup_resources(tcp_server, net_mgr, cmd_handler)
    
    print("============================================")
    print("MOTION CAPTURE RECEIVER STOPPED")
    print("Type 'import machine' and then 'machine.soft_reset()' to restart")
    print("============================================")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n" * 3)
        print("============================================")
        print("SCRIPT STARTUP INTERRUPTED - REPL READY")
        print("============================================")
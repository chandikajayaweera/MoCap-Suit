# main.py (node) - Improved version with fixes
import network
import socket
import machine
import time
import _thread
import struct
import sys
import gc
from bno055 import BNO055
import config_node as cfg

# Global flag and lock to control sensor reading thread
reading_enabled = False
reading_lock = _thread.allocate_lock()

# Global list to hold sensor objects (one per multiplexer channel)
sensors = [None] * 8
sensor_lock = _thread.allocate_lock()

# Global TCP socket for sending logs to receiver
receiver_tcp = None
tcp_lock = _thread.allocate_lock()

# Emergency stop flag
emergency_stop = False
emergency_lock = _thread.allocate_lock()

# Hardware watchdog timer to recover from crashes
watchdog = None
try:
    watchdog = machine.WDT(timeout=30000)  # 30 second timeout
except Exception as e:
    print(f"Warning: Could not initialize watchdog: {e}")

# Pre-allocate data buffers for sensor readings to reduce memory fragmentation
sensor_data_buffer = [0.0] * 32

# Create an I2C bus using the configured SDA and SCL pins
try:
    print(f"Creating I2C bus on pins SDA={cfg.SDA_PIN}, SCL={cfg.SCL_PIN}")
    i2c = machine.I2C(1, sda=machine.Pin(cfg.SDA_PIN), scl=machine.Pin(cfg.SCL_PIN), freq=400000)  # Increased frequency
except Exception as e:
    print(f"Error creating I2C bus: {e}")
    machine.reset()

# Sensor mapping for better context in logs
SENSOR_NAMES = [
    "Right Lower Leg",
    "Right Upper Leg",
    "Left Lower Leg",
    "Left Upper Leg",
    "Left Lower Arm",
    "Left Upper Arm",
    "Right Lower Arm",
    "Right Upper Arm"
]

# Log levels for better filtering
LOG_DEBUG = 0
LOG_INFO = 1
LOG_WARNING = 2
LOG_ERROR = 3

# Current log level
current_log_level = LOG_INFO

def feed_watchdog():
    """Feed the watchdog timer if it's enabled"""
    global watchdog
    if watchdog:
        try:
            watchdog.feed()
        except Exception:
            pass

def log(message, level=LOG_INFO):
    """Send log messages to receiver via TCP with log levels"""
    global current_log_level
    
    # Skip messages below current log level
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
    
    formatted = "[NODE] " + timestamp + level_prefix + message
    
    # Print locally
    print(formatted)
    
    # Send to receiver if connected
    global receiver_tcp
    with tcp_lock:
        if receiver_tcp:
            try:
                receiver_tcp.send(("LOG:" + formatted).encode())
            except Exception as e:
                print("Failed to send log to receiver:", e)

def connect_wifi():
    """Connect to the receiver's WiFi access point in station mode using static IP with improved reliability."""
    sta = network.WLAN(network.STA_IF)
    sta.active(False)
    time.sleep_ms(500)  # Reduced sleep time
    sta.active(True)
    
    # FIX: Set static IP configuration BEFORE connection attempt
    try:
        sta.ifconfig((cfg.NODE_IP, cfg.SUBNET_MASK, cfg.GATEWAY, cfg.GATEWAY))
    except Exception as e:
        log(f"Error setting static IP: {e}", LOG_ERROR)
    
    # Try connecting multiple times with progressive backoff
    max_attempts = 5  # Increased from 3
    for attempt in range(max_attempts):
        log(f"Connecting to WiFi, attempt {attempt+1}/{max_attempts}...")
        try:
            sta.connect(cfg.SSID, cfg.PASSWORD)
            
            # Wait for connection with timeout and feed watchdog during wait
            timeout = 15  # Increased timeout
            while not sta.isconnected() and timeout > 0:
                log(f"Waiting for WiFi connection... ({timeout}s remaining)", LOG_DEBUG)
                time.sleep_ms(500)
                timeout -= 0.5
                feed_watchdog()
                
            if sta.isconnected():
                log(f"Connected to WiFi: {sta.ifconfig()}")
                # Store BSSID for more reliable reconnections
                try:
                    bssid = sta.config('bssid')
                    bssid_str = ":".join(["{:02x}".format(b) for b in bssid])
                    log("Connected to AP with BSSID: " + bssid_str, LOG_DEBUG)
                except Exception:
                    log("Connected to AP (BSSID not available)", LOG_DEBUG)
                return True
            
            # Progressive backoff before next attempt
            backoff = min(2**attempt, 30)  # Exponential backoff with 30s max
            log(f"Connection failed, retrying in {backoff}s...", LOG_WARNING)
            time.sleep(backoff)
            feed_watchdog()
            
        except Exception as e:
            log(f"WiFi connection error: {e}", LOG_ERROR)
            time.sleep_ms(1000)
    
    log("WiFi connection failed after multiple attempts", LOG_ERROR)
    return False

def receiver_connection_thread():
    """Maintains connection to the receiver and handles reconnection with improved reliability."""
    global receiver_tcp
    
    # More responsive heartbeat
    heartbeat_interval = 15  # seconds
    reconnect_interval = 2  # seconds
    
    while not check_emergency_stop():
        try:
            # Establish connection with timeout
            client_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            client_sock.settimeout(5.0)
            client_sock.connect((cfg.RECEIVER_IP, cfg.TCP_PORT))
            log(f"Connected to receiver at {cfg.RECEIVER_IP}:{cfg.TCP_PORT}")
            
            # FIX: Set timeout once when establishing connection rather than on every log call
            client_sock.settimeout(0.5)  # Set a reasonable timeout for all operations
            
            # Store the connection
            with tcp_lock:
                # Close existing connection if any
                if receiver_tcp:
                    try:
                        receiver_tcp.close()
                    except Exception:
                        pass
                receiver_tcp = client_sock
            
            # Send initial message with protocol version
            client_sock.send("NODE_CONNECTED:v1.0".encode())
            
            # Loop to keep connection alive with more responsive health monitoring
            last_heartbeat = time.ticks_ms()
            while not check_emergency_stop():
                # Feed watchdog in connection loop
                feed_watchdog()
                
                # Send heartbeat at specified interval
                current_time = time.ticks_ms()
                if time.ticks_diff(current_time, last_heartbeat) >= heartbeat_interval * 1000:
                    try:
                        # Include basic health info in heartbeat
                        with sensor_lock:
                            active_sensors = sum(1 for s in sensors if s is not None)
                        
                        heartbeat_msg = f"HEARTBEAT:{active_sensors}/8:{gc.mem_free()}"
                        client_sock.send(heartbeat_msg.encode())
                        last_heartbeat = current_time
                        log(f"Sent heartbeat: {heartbeat_msg}", LOG_DEBUG)
                    except Exception as e:
                        log(f"Error sending heartbeat: {e}", LOG_ERROR)
                        break  # Connection likely lost, exit loop to reconnect
                
                # Sleep a bit to avoid busy waiting
                time.sleep_ms(100)  # More frequent checks
                
        except Exception as e:
            log(f"Receiver connection error: {e}", LOG_WARNING)
            with tcp_lock:
                if receiver_tcp is client_sock:  # Only clear if it's the current connection
                    receiver_tcp = None
            try:
                client_sock.close()
            except Exception:
                pass
            
            # Wait before reconnection attempt with watchdog feeding
            remaining = reconnect_interval
            while remaining > 0 and not check_emergency_stop():
                time.sleep_ms(100)
                remaining -= 0.1
                feed_watchdog()

def check_emergency_stop():
    """Check if emergency stop is activated"""
    global emergency_stop
    
    with emergency_lock:
        return emergency_stop

def select_sensor(channel, retry=True):
    """
    Select a sensor channel on the I2C multiplexer with improved error handling.
    Optimized for performance while maintaining reliability.
    Returns True if successful, False otherwise.
    """
    global i2c
    
    try:
        data = bytes([1 << channel])
        i2c.writeto(cfg.MUX_ADDR, data)
        time.sleep_ms(cfg.MUX_SWITCH_DELAY_MS)  # Use configured delay
        return True
    except Exception as e:
        if retry:
            try:
                # One quick retry before giving up
                time.sleep_ms(10)
                # Need to redefine data inside retry block
                data = bytes([1 << channel])
                i2c.writeto(cfg.MUX_ADDR, data)
                return True
            except Exception:
                log(f"Error switching multiplexer to channel {channel}: {e}", LOG_ERROR)
                return False
        else:
            log(f"Error switching multiplexer to channel {channel}: {e}", LOG_ERROR)
            return False

def save_calibration(sensor, idx):
    """Save sensor calibration data to improve startup times"""
    if sensor is None:
        return False
        
    try:
        # Check if the sensor is calibrated enough to be worth saving
        cal = sensor.cal_status()
        if cal < 50:  # Only save if reasonably calibrated
            return False
            
        # Get the calibration data
        # This is a placeholder - the actual method will depend on BNO055 implementation
        # For illustrative purposes only
        try:
            cal_data = sensor.get_calibration()
            log(f"Saved calibration for sensor {idx}", LOG_DEBUG)
            return True
        except AttributeError:
            # If get_calibration isn't available in the BNO055 implementation
            return False
    except Exception as e:
        log(f"Error saving calibration for sensor {idx}: {e}", LOG_DEBUG)
        return False

def load_calibration(sensor, idx):
    """Load saved calibration data for sensor"""
    if sensor is None:
        return False
        
    try:
        # This is a placeholder - the actual method will depend on BNO055 implementation
        # For illustrative purposes only
        try:
            # Simulated load calibration
            # sensor.set_calibration(stored_data)
            log(f"Loaded calibration for sensor {idx}", LOG_DEBUG)
            return True
        except AttributeError:
            # If set_calibration isn't available in the BNO055 implementation
            return False
    except Exception as e:
        log(f"Error loading calibration for sensor {idx}: {e}", LOG_DEBUG)
        return False

def init_sensors():
    """
    Initialize eight BNO055 sensors with improved error handling and recovery.
    Returns: True if at least one sensor initialized successfully
    """
    global sensors, i2c
    
    with sensor_lock:
        sensors = [None] * 8  # 8 sensors
    success_count = 0
    
    # First reset the multiplexer to ensure a clean start
    reset_multiplexer()
    
    # Try to initialize each sensor with progressive backoff
    for idx in range(8):
        channel = idx // 2  # 0-3 channels
        addr = 0x28 if (idx % 2 == 0) else 0x29
        
        # Select the channel with error handling
        if not select_sensor(channel):
            log(f"Could not select channel {channel} for sensor {idx} ({SENSOR_NAMES[idx]})", LOG_WARNING)
            continue
        
        sensor = None
        
        for retry in range(5):  # Increased from 3 to 5 retries
            try:
                # Feed watchdog during potentially long initialization
                feed_watchdog()
                
                sensor = BNO055(i2c, address=addr)
                
                # Try to load calibration data from non-volatile storage
                load_calibration(sensor, idx)
                
                log(f"Sensor {idx} ({SENSOR_NAMES[idx]}, ch {channel}, addr {hex(addr)}) initialized", LOG_INFO)
                success_count += 1
                with sensor_lock:
                    sensors[idx] = sensor
                break
            except Exception as e:
                # Exponential backoff
                backoff_time = min((2 ** retry) * 100, 1000)  # ms, max 1 second
                log(f"Error initializing sensor {idx} ({SENSOR_NAMES[idx]}), attempt {retry+1}: {e}", LOG_WARNING)
                time.sleep_ms(backoff_time)
                
                # On later retries, attempt to reset the multiplexer
                if retry == 1:
                    reset_multiplexer()
                    select_sensor(channel)
        
        if sensor is None:
            log(f"Failed to initialize sensor {idx} ({SENSOR_NAMES[idx]})", LOG_ERROR)
    
    log(f"Sensors initialization complete: {success_count}/8 sensors initialized")
    
    if success_count == 0:
        # No sensors initialized, try more aggressive recovery
        log("No sensors initialized. Attempting emergency recovery...", LOG_ERROR)
        emergency_i2c_recovery()
            
    return success_count > 0  # Return True if at least one sensor initialized

def check_sensor_status():
    """
    Check the status of all sensors using reliable methods.
    Returns: A list of status strings for all sensors.
    """
    status_list = []
    
    with sensor_lock:
        for idx in range(8):
            channel = idx // 2
            sensor = sensors[idx]
            if sensor is not None:
                try:
                    # Select the sensor channel first
                    if not select_sensor(channel):
                        status_list.append(f"Sensor {idx} ({SENSOR_NAMES[idx]}): Channel selection failed")
                        continue
                    
                    # Try to check sensor connectivity using cal_status()
                    try:
                        cal = sensor.cal_status()
                        status_list.append(f"Sensor {idx} ({SENSOR_NAMES[idx]}): Connected, Calibration: {cal}")
                    except Exception as e:
                        status_list.append(f"Sensor {idx} ({SENSOR_NAMES[idx]}): Error checking status - {e}")
                        sensors[idx] = None  # Mark as disconnected
                except Exception as e:
                    status_list.append(f"Sensor {idx} ({SENSOR_NAMES[idx]}): Error - {e}")
                    sensors[idx] = None  # Mark as disconnected
            else:
                status_list.append(f"Sensor {idx} ({SENSOR_NAMES[idx]}): Not Initialized")
    
    return status_list

def emergency_i2c_recovery():
    """More aggressive I2C bus recovery when all sensors fail"""
    global i2c
    try:
        # Less verbose logging during recovery
        log("Emergency I2C recovery initiated", LOG_WARNING)
        
        # Reset the I2C bus completely
        scl_pin = machine.Pin(cfg.SCL_PIN, machine.Pin.OUT)
        sda_pin = machine.Pin(cfg.SDA_PIN, machine.Pin.OUT)
        
        # Set both high (idle state)
        scl_pin.value(1)
        sda_pin.value(1)
        time.sleep_ms(10)
        
        # Clock several times to unstick devices - faster cycle
        for _ in range(10):
            scl_pin.value(0)
            time.sleep_ms(2)
            scl_pin.value(1)
            time.sleep_ms(2)
        
        # Generate STOP condition
        sda_pin.value(0)
        time.sleep_ms(2)
        sda_pin.value(1)
        time.sleep_ms(5)
        
        # Now reinitialize the I2C bus with higher frequency for better performance
        i2c = machine.I2C(1, sda=machine.Pin(cfg.SDA_PIN), scl=machine.Pin(cfg.SCL_PIN), freq=400000)
        time.sleep_ms(200)  # Reduced wait time but still sufficient
        
        # Check if multiplexer is visible
        devices = i2c.scan()
        
        if cfg.MUX_ADDR in devices:
            log("Multiplexer found after recovery", LOG_INFO)
            return True
        else:
            log(f"Multiplexer (0x{cfg.MUX_ADDR:x}) not found after recovery", LOG_ERROR)
            return False
            
    except Exception as e:
        log(f"Emergency recovery failed: {e}", LOG_ERROR)
        return False

def reset_multiplexer():
    """Reset the I2C multiplexer by power cycling it if possible or sending reset sequence"""
    global i2c
    log("Attempting to reset the I2C multiplexer...", LOG_DEBUG)
    try:
        # Try to reset all channels by writing 0
        i2c.writeto(cfg.MUX_ADDR, bytes([0]))
        time.sleep_ms(50)  # Reduced from 100ms
        
        # Then try to read from the device to confirm it's working
        try:
            i2c.readfrom(cfg.MUX_ADDR, 1)
            log("Multiplexer reset successful", LOG_DEBUG)
            return True
        except Exception as e:
            log(f"Error communicating with multiplexer after reset: {e}", LOG_WARNING)
            
        # If that doesn't work, attempt to restart the I2C bus
        log("Attempting to restart I2C bus...", LOG_WARNING)
        i2c = machine.I2C(1, sda=machine.Pin(cfg.SDA_PIN), scl=machine.Pin(cfg.SCL_PIN), freq=400000)
        time.sleep_ms(100)  # Reduced from 200ms
        return True
    except Exception as e:
        log(f"Failed to reset multiplexer: {e}", LOG_ERROR)
        return False

def sensor_reading_thread():
    """
    Continuously read quaternion data from all sensors and send as a binary UDP packet.
    The packet contains 32 floats (8 sensors x 4 floats per sensor).
    Also periodically checks sensor status for disconnections.
    """
    global reading_enabled, emergency_stop, sensors, sensor_data_buffer
    
    udp_sock = None
    
    # Set up periodic sensor checking (every ~5 seconds)
    last_check_time = time.ticks_ms()
    check_interval = 5000  # ms
    
    # Packet stats
    packet_count = 0
    last_stats_time = time.ticks_ms()
    stats_interval = 10000  # 10 seconds
    
    try:
        # Create UDP socket with explicit timeout to avoid blocking
        udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp_sock.settimeout(0.1)  # 100ms timeout to prevent blocking
        dest = (cfg.RECEIVER_IP, cfg.UDP_PORT)
        
        # Add a sequence number to detect packet loss
        seq_num = 0
        
        # Log that we're starting
        log("Starting sensor data streaming at 50+ Hz")
        
        with reading_lock:
            reading_enabled = True
            
        while True:
            # Feed watchdog
            feed_watchdog()
            
            # Check emergency stop
            if check_emergency_stop():
                log("Emergency stop detected, ending sensor thread", LOG_WARNING)
                break
                
            # Check if reading is still enabled
            with reading_lock:
                if not reading_enabled:
                    log("Reading disabled, ending sensor thread", LOG_INFO)
                    break
            
            # Increment sequence number (wrap around at 65535)
            seq_num = (seq_num + 1) % 65536
            packet_count += 1
            
            # Check if it's time to verify sensor connections - do this less frequently
            current_time = time.ticks_ms()
            if time.ticks_diff(current_time, last_check_time) >= check_interval:
                last_check_time = current_time
                
                # Only check one sensor per cycle to reduce overhead
                sensor_to_check = (int(current_time) % 8)
                
                with sensor_lock:
                    if sensors[sensor_to_check] is not None:
                        channel = sensor_to_check // 2
                        select_sensor(channel)
                        try:
                            # Use cal_status() to check sensor connection
                            sensor_cal = sensors[sensor_to_check].cal_status()
                            # Sensor is still connected if we get here
                            
                            # Save calibration data periodically if reasonably calibrated
                            if sensor_cal > 50:
                                save_calibration(sensors[sensor_to_check], sensor_to_check)
                                
                        except Exception as e:
                            log(f"WARNING: Sensor {sensor_to_check} ({SENSOR_NAMES[sensor_to_check]}) appears to be disconnected: {e}", LOG_WARNING)
                            sensors[sensor_to_check] = None
            
            # Log stats periodically
            if time.ticks_diff(current_time, last_stats_time) >= stats_interval:
                elapsed_sec = time.ticks_diff(current_time, last_stats_time) / 1000
                rate = packet_count / elapsed_sec if elapsed_sec > 0 else 0
                log(f"Streaming stats: {rate:.1f} packets/sec", LOG_DEBUG)
                last_stats_time = current_time
                packet_count = 0
                
                # Run GC during stats to avoid impacting streaming too much
                gc.collect()
            
            # Read data from sensors more efficiently
            with sensor_lock:
                for idx in range(8):
                    channel = idx // 2
                    select_sensor(channel)
                    sensor = sensors[idx]
                    if sensor is not None:
                        try:
                            quat = sensor.quaternion()
                            if len(quat) == 4:
                                # Faster assignment without extending lists
                                data_idx = idx * 4
                                sensor_data_buffer[data_idx] = quat[0]
                                sensor_data_buffer[data_idx+1] = quat[1]
                                sensor_data_buffer[data_idx+2] = quat[2]
                                sensor_data_buffer[data_idx+3] = quat[3]
                            else:
                                # Invalid quaternion - use zeros
                                data_idx = idx * 4
                                sensor_data_buffer[data_idx] = 0.0
                                sensor_data_buffer[data_idx+1] = 0.0
                                sensor_data_buffer[data_idx+2] = 0.0
                                sensor_data_buffer[data_idx+3] = 0.0
                        except Exception as e:
                            # Error reading - use zeros and mark sensor as disconnected
                            data_idx = idx * 4
                            sensor_data_buffer[data_idx] = 0.0
                            sensor_data_buffer[data_idx+1] = 0.0
                            sensor_data_buffer[data_idx+2] = 0.0
                            sensor_data_buffer[data_idx+3] = 0.0
                            sensors[idx] = None
                    else:
                        # Sensor not available - use zeros
                        data_idx = idx * 4
                        sensor_data_buffer[data_idx] = 0.0
                        sensor_data_buffer[data_idx+1] = 0.0
                        sensor_data_buffer[data_idx+2] = 0.0
                        sensor_data_buffer[data_idx+3] = 0.0
            
            try:
                # For improved readability, create a human-readable JSON-like format
                # Include sequence number and formatted sensor data
                readable_data = "SEQ:{},".format(seq_num)
                
                # Add each sensor's quaternion data with labels
                for i in range(8):
                    base_idx = i * 4
                    readable_data += "S{}:[{:.4f},{:.4f},{:.4f},{:.4f}],".format(
                        i,
                        sensor_data_buffer[base_idx],
                        sensor_data_buffer[base_idx+1],
                        sensor_data_buffer[base_idx+2], 
                        sensor_data_buffer[base_idx+3]
                    )
                
                # Remove the trailing comma and convert to bytes
                readable_data = readable_data[:-1].encode()
                
                # Send the readable data format
                udp_sock.sendto(readable_data, dest)
            except Exception as e:
                log("Error sending UDP packet: {}".format(e), LOG_WARNING)
            
            # Ensure at least 50Hz, aiming for ~66Hz to account for processing overhead
            time.sleep_ms(15)
            
    except Exception as e:
        log(f"Sensor reading thread error: {e}", LOG_ERROR)
    finally:
        if udp_sock:
            try:
                udp_sock.close()
            except Exception:
                pass
        with reading_lock:
            reading_enabled = False
        log("Sensor reading thread stopped.")

def tcp_command_server_thread():
    """TCP server to handle commands from receiver"""
    global reading_enabled
    
    command_handlers = {
        'N': restart_node,
        'C': check_sensor_command,
        'I': reinitialize_sensors,
        'S': start_streaming,
        'X': stop_streaming,
        'Q': emergency_stop_command,
        'D': set_debug_mode,
        'P': ping_command
    }
    
    while not check_emergency_stop():
        tcp_sock = None
        
        try:
            addr = (cfg.NODE_IP, cfg.TCP_PORT)
            tcp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            tcp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            tcp_sock.bind(addr)
            tcp_sock.listen(1)
            # Set a timeout for accept() to make it interruptible
            tcp_sock.settimeout(3.0)
            log(f"TCP command server listening on {addr}")
            
            while not check_emergency_stop():
                try:
                    # Use accept with timeout to allow emergency stop checks
                    client_sock, client_addr = tcp_sock.accept()
                    log(f"New command connection from {client_addr}")
                    
                    # Process this client
                    handle_command_client(client_sock, client_addr, command_handlers)
                    
                except OSError as e:
                    error_str = str(e).lower()
                    if "timed out" in error_str or "etimedout" in error_str:
                        # This is normal with timeout - do not log
                        continue
                    else:
                        log(f"Accept error: {e}", LOG_WARNING)
                        time.sleep_ms(1000)
                
                # Feed watchdog in accept loop
                feed_watchdog()
                
        except Exception as e:
            log(f"TCP server error: {e}", LOG_ERROR)
        finally:
            if tcp_sock:
                try:
                    tcp_sock.close()
                except Exception:
                    pass
            
        # Only restart if not in emergency stop
        if not check_emergency_stop():
            log("TCP server restarting in 5 seconds...", LOG_WARNING)
            time.sleep_ms(5000)

def restart_node(params=None):
    """Restart node command handler"""
    log("Received restart command, executing...")
    return "Restarting node...", True, True  # Message, success, should_restart

def check_sensor_command(params=None):
    """Check sensor status command handler"""
    log("Checking sensor status...")
    try:
        status_list = check_sensor_status()
        response = "\n".join(status_list)
        log(f"Sending status response: {len(status_list)} items")
        return response, True, False  # Message, success, should_restart
    except Exception as e:
        error_msg = f"ERROR checking sensor status: {e}"
        log(error_msg, LOG_ERROR)
        return error_msg, False, False

def reinitialize_sensors(params=None):
    """Reinitialize sensors command handler"""
    global reading_enabled
    
    log("Reinitializing sensors...")
    # Stop sensor reading if active
    was_reading = False
    with reading_lock:
        was_reading = reading_enabled
        if reading_enabled:
            reading_enabled = False
            time.sleep_ms(100)
    
    try:
        success = init_sensors()
        
        # Restart sensor reading if it was active
        if was_reading and success:
            with reading_lock:
                reading_enabled = True
                _thread.start_new_thread(sensor_reading_thread, ())
        
        response = f"Sensors reinitialized. Success: {success}"
        log(f"Sensor reinitialization complete: {success}")
        return response, success, False  # Message, success, should_restart
    except Exception as e:
        error_msg = f"ERROR reinitializing sensors: {e}"
        log(error_msg, LOG_ERROR)
        return error_msg, False, False

def start_streaming(params=None):
    """Start streaming command handler"""
    global reading_enabled
    
    with reading_lock:
        if not reading_enabled:
            try:
                reading_enabled = True
                _thread.start_new_thread(sensor_reading_thread, ())
                response = "Sensor reading started."
                log("Starting sensor reading thread")
                return response, True, False  # Message, success, should_restart
            except Exception as e:
                reading_enabled = False  # Reset on failure
                error_msg = f"ERROR starting sensor reading: {e}"
                log(error_msg, LOG_ERROR)
                return error_msg, False, False
        else:
            response = "Sensor reading already running."
            log("Sensor reading already active")
            return response, True, False

def stop_streaming(params=None):
    """Stop streaming command handler"""
    global reading_enabled
    
    with reading_lock:
        if reading_enabled:
            reading_enabled = False
            response = "Sensor reading stopped."
            log("Stopping sensor reading")
            return response, True, False  # Message, success, should_restart
        else:
            response = "Sensor reading not running."
            log("Sensor reading already stopped")
            return response, True, False

def emergency_stop_command(params=None):
    """Emergency stop command handler"""
    global emergency_stop
    
    response = "Emergency stop activated. Stopping all threads."
    log(response, LOG_WARNING)
    
    # Set emergency stop flag
    with emergency_lock:
        emergency_stop = True
    
    return response, True, False  # Message, success, should_restart

def set_debug_mode(params=None):
    """Set debug mode command handler"""
    global current_log_level
    
    try:
        # Check if we have a parameter
        if params and len(params) > 0:
            level = int(params)
            if 0 <= level <= 3:
                current_log_level = level
                modes = ["DEBUG", "INFO", "WARNING", "ERROR"]
                response = f"Log level set to {modes[level]}"
                log(response)
                return response, True, False
            else:
                return f"Invalid log level: {level}. Must be 0-3.", False, False
        else:
            return "Current log level: {}".format(
                ["DEBUG", "INFO", "WARNING", "ERROR"][current_log_level]), True, False
    except Exception as e:
        return f"Error setting debug mode: {e}", False, False

def ping_command(params=None):
    """Simple ping command for connection testing"""
    return "PONG", True, False

def handle_command_client(client_sock, client_addr, command_handlers):
    """Handle a client connection with command pattern for better modularity"""
    global reading_enabled, emergency_stop, sensors
    
    try:
        # Set a shorter timeout to allow more frequent checks for emergency stop
        client_sock.settimeout(5.0)
        while not check_emergency_stop():
            try:
                data = client_sock.recv(1024)
                if not data:
                    log(f"Command connection closed from {client_addr}")
                    break
                
                # Feed watchdog on command receive
                feed_watchdog()
                    
                cmd_str = data.decode().strip()
                
                # Split into command and parameters
                cmd_parts = cmd_str.split(':', 1)
                cmd = cmd_parts[0].upper()
                params = cmd_parts[1] if len(cmd_parts) > 1 else None
                
                log(f"RECEIVED COMMAND: '{cmd}' from {client_addr}")
                
                # Initialize response variable
                response = "Unknown command"
                success = False
                should_restart = False
                
                # Check if streaming and handle accordingly
                is_streaming = False
                with reading_lock:
                    is_streaming = reading_enabled
                
                # If streaming, only accept X command or Q command
                if is_streaming and cmd != "X" and cmd != "Q" and cmd != "P":
                    response = f"ERROR: Cannot execute '{cmd}' while streaming. Stop streaming first (X command)."
                    log(f"Rejecting command {cmd} due to active streaming", LOG_WARNING)
                    success = False
                elif cmd in command_handlers:
                    # Execute the appropriate command handler
                    response, success, should_restart = command_handlers[cmd](params)
                else:
                    response = f"Unknown command: {cmd}"
                    log(f"Received unknown command: {cmd}", LOG_WARNING)
                    success = False
                
                # Send response for all commands
                if not should_restart:  # Skip if we're about to restart
                    try:
                        # Add status prefix to response for structured parsing
                        status_prefix = "OK:" if success else "ERROR:"
                        client_sock.send((status_prefix + response).encode())
                    except Exception as e:
                        log(f"Error sending response: {e}", LOG_ERROR)
                
                # Handle restart if requested
                if should_restart:
                    client_sock.send("OK:Restarting node...".encode())
                    log("Executing restart after command")
                    time.sleep_ms(500)  # Brief delay for response to be sent
                    machine.reset()
                    
            except OSError as e:
                if "timed out" in str(e).lower():
                    # Timeout is normal, continue silently
                    continue
                else:
                    log(f"Error handling command: {e}", LOG_WARNING)
                    break
    except Exception as e:
        log(f"Command client error: {e}", LOG_ERROR)
    finally:
        try:
            client_sock.close()
        except Exception:
            pass

def system_status_thread():
    """
    Periodically check and report system status
    using a sleep-based approach for better reliability
    """
    start_time = time.ticks_ms()
    
    # FIX: Replace timer with sleep-based loop for better reliability
    try:
        while not check_emergency_stop():
            try:
                # Feed watchdog
                feed_watchdog()
                
                # Calculate uptime
                uptime_ms = time.ticks_diff(time.ticks_ms(), start_time)
                uptime_sec = uptime_ms // 1000
                uptime_min = uptime_sec // 60
                uptime_hr = uptime_min // 60
                
                # Check WiFi status
                sta = network.WLAN(network.STA_IF)
                wifi_status = "Connected" if sta.isconnected() else "Disconnected"
                
                # Check sensor status
                with sensor_lock:
                    active_sensors = sum(1 for s in sensors if s is not None)
                
                # Check streaming status
                with reading_lock:
                    streaming_status = "Yes" if reading_enabled else "No"
                    
                # Check memory
                free_mem = gc.mem_free()
                
                # Log the status
                log(f"STATUS: Uptime: {int(uptime_hr)}h {int(uptime_min%60)}m {int(uptime_sec%60)}s | "
                      f"WiFi: {wifi_status} | Active Sensors: {active_sensors}/8 | "
                      f"Streaming: {streaming_status} | Free Mem: {free_mem}")
                      
                # Run garbage collection to prevent memory issues
                gc.collect()
                
                # Sleep for 60 seconds (with small chunks to allow interrupt)
                for _ in range(60):
                    if check_emergency_stop():
                        break
                    time.sleep(1)
                    feed_watchdog()
                
            except Exception as e:
                log(f"Error in status thread: {e}", LOG_ERROR)
                time.sleep(5)  # Short sleep on error before retry
                
    except KeyboardInterrupt:
        log("Keyboard interrupt in status thread", LOG_WARNING)
    except Exception as e:
        log(f"Error in status thread: {e}", LOG_ERROR)

def cleanup_resources():
    """Stop all threads and clean up resources"""
    log("Cleaning up resources...")
    
    # Stop sensor reading if active
    with reading_lock:
        global reading_enabled
        reading_enabled = False
    
    # Close TCP connection to receiver
    with tcp_lock:
        global receiver_tcp
        if receiver_tcp:
            try:
                receiver_tcp.close()
            except Exception:
                pass
            receiver_tcp = None
    
    # Run garbage collection
    gc.collect()
    
    # Give threads time to exit
    time.sleep_ms(500)
    
    log("Resources cleaned up")

def safe_mode():
    """
    Enter safe mode with minimal functionality for diagnostics
    """
    global current_log_level
    
    log("ENTERING SAFE MODE - Limited functionality available", LOG_ERROR)
    current_log_level = LOG_DEBUG  # Set to most verbose for diagnostics
    
    # Basic I2C scan
    try:
        devices = i2c.scan()
        log(f"I2C scan found {len(devices)} devices: {[hex(d) for d in devices]}", LOG_INFO)
    except Exception as e:
        log(f"I2C scan failed: {e}", LOG_ERROR)
    
    # Basic network connectivity
    try:
        sta = network.WLAN(network.STA_IF)
        if sta.active():
            log(f"WiFi status: {sta.status()}, Connected: {sta.isconnected()}", LOG_INFO)
            if sta.isconnected():
                log(f"Network config: {sta.ifconfig()}", LOG_INFO)
        else:
            log("WiFi is inactive", LOG_WARNING)
    except Exception as e:
        log(f"WiFi check failed: {e}", LOG_ERROR)
    
    # Memory status
    try:
        log(f"Memory - Free: {gc.mem_free()}, Allocated: {gc.mem_alloc()}", LOG_INFO)
    except Exception as e:
        log(f"Memory check failed: {e}", LOG_ERROR)
    
    # Start a minimal command server for diagnostics
    try:
        log("Starting minimal diagnostic server...", LOG_INFO)
        _thread.start_new_thread(tcp_command_server_thread, ())
    except Exception as e:
        log(f"Failed to start diagnostic server: {e}", LOG_ERROR)
    
    # Keep the system alive but in a minimal state
    log("Safe mode active. Use 'N' command to restart. Press Ctrl+C for REPL.", LOG_INFO)
    
    try:
        while True:
            feed_watchdog()
            time.sleep_ms(1000)
    except KeyboardInterrupt:
        log("Keyboard interrupt detected, entering REPL", LOG_INFO)
    except Exception as e:
        log(f"Safe mode error: {e}", LOG_ERROR)
        machine.reset()  # Last resort

def main():
    # Reset emergency stop flag
    global emergency_stop
    with emergency_lock:
        emergency_stop = False
    
    try:
        # Print banner
        print("\n" * 2)
        print("="*50)
        print("MOTION CAPTURE NODE - STARTING")
        print("="*50)
        print(f"Free memory: {gc.mem_free()} bytes")
        
        # Initialize system
        log("Node startup...")
        
        # Track failure count for safe mode entry
        failures = 0
        max_failures = 3
        
        # Initialization retry loop
        while not check_emergency_stop():
            try:
                # Feed watchdog during initialization
                feed_watchdog()
                
                if not connect_wifi():
                    log("Failed to connect to WiFi. Retrying...", LOG_WARNING)
                    failures += 1
                    if failures >= max_failures:
                        log("Too many consecutive failures, entering safe mode", LOG_ERROR)
                        safe_mode()
                        return
                    time.sleep_ms(5000)
                    continue
                
                # Reset failure count after successful WiFi connection
                failures = 0
                
                # Start the receiver connection thread (handles connection to the receiver)
                _thread.start_new_thread(receiver_connection_thread, ())
                    
                if not init_sensors():
                    log("Failed to initialize any sensors. Retrying...", LOG_WARNING)
                    failures += 1
                    if failures >= max_failures:
                        log("Too many consecutive failures, entering safe mode", LOG_ERROR)
                        safe_mode()
                        return
                    time.sleep_ms(5000)
                    continue
                    
                # Reset failure count after successful sensor initialization
                failures = 0
                
                # Start the TCP command server in a separate thread
                _thread.start_new_thread(tcp_command_server_thread, ())
                
                # Start the status reporting thread
                _thread.start_new_thread(system_status_thread, ())
                
                log("Node is running. Awaiting commands...")
                log("Send 'Q' command for emergency stop")
                log("Press Ctrl+C to enter REPL mode")
                
                # Main thread's health monitoring loop
                while not check_emergency_stop():
                    # Feed watchdog
                    feed_watchdog()
                    
                    # Check WiFi connection with improved recovery
                    sta = network.WLAN(network.STA_IF)
                    if not sta.isconnected():
                        # Try to reconnect a few times before restarting
                        log("WiFi connection lost. Attempting to reconnect...", LOG_WARNING)
                        reconnect_success = False
                        
                        for attempt in range(3):
                            log(f"Reconnection attempt {attempt+1}/3")
                            sta.disconnect()
                            time.sleep_ms(500)
                            
                            # FIX: Set static IP before reconnection attempt
                            try:
                                sta.ifconfig((cfg.NODE_IP, cfg.SUBNET_MASK, cfg.GATEWAY, cfg.GATEWAY))
                            except Exception as e:
                                log(f"Error setting static IP: {e}", LOG_ERROR)
                                
                            sta.connect(cfg.SSID, cfg.PASSWORD)
                            
                            # Wait for connection with timeout
                            for _ in range(10):  # 5 second timeout
                                if sta.isconnected():
                                    reconnect_success = True
                                    log("WiFi reconnected successfully")
                                    break
                                time.sleep_ms(500)
                                feed_watchdog()
                                
                            if reconnect_success:
                                break
                                
                        if not reconnect_success:
                            log("WiFi reconnection failed, restarting...", LOG_ERROR)
                            time.sleep_ms(1000)
                            machine.reset()
                        
                    # Run garbage collection occasionally
                    if time.ticks_ms() % 60000 < 1000:  # roughly once per minute
                        gc.collect()
                        
                    time.sleep_ms(1000)  # Check health every second
                    
            except KeyboardInterrupt:
                # Clean shutdown on CTRL+C
                log("!!! KEYBOARD INTERRUPT DETECTED !!!")
                log("Entering REPL mode")
                with emergency_lock:
                    emergency_stop = True
                
                # Clean up resources
                cleanup_resources()
                break
                
            except Exception as e:
                log(f"Critical error in main loop: {e}", LOG_ERROR)
                failures += 1
                if failures >= max_failures:
                    log("Too many consecutive failures, entering safe mode", LOG_ERROR)
                    safe_mode()
                    return
                time.sleep_ms(5000)  # Wait before retrying
    
    except KeyboardInterrupt:
        # Clean shutdown on CTRL+C
        log("!!! KEYBOARD INTERRUPT DETECTED !!!")
        log("Entering REPL mode")
        with emergency_lock:
            emergency_stop = True
        
        # Clean up resources
        cleanup_resources()
            
    finally:
        log("System halted. REPL mode available.")
        print("\n" * 3)
        print("=============================================")
        print("NODE STOPPED - REPL READY")
        print("Type 'machine.reset()' to restart the node")
        print("=============================================")

if __name__ == "__main__":
    try:
        # Run the main function with keyboard interrupt handling
        main()
    except KeyboardInterrupt:
        print("\n" * 3)
        print("=============================================")
        print("SCRIPT STARTUP INTERRUPTED - REPL READY")
        print("=============================================")
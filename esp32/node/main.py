import machine
import time
import network
import socket
import struct
from bno055 import *
import config_node as cfg

# Constants
PACKET_HEADER = 0x00
CMD_RESPONSE = 0x01
STATUS_BROADCAST = 0x02

class SensorManager:
    def __init__(self, i2c):
        self.i2c = i2c
        self.sensors = []
        self.bitmask = 0

    def init_sensors(self):
        print("[SENSOR] Initializing sensors...")
        self.sensors = []
        self.bitmask = 0
        for idx in range(8):
            channel = idx // 2
            addr = 0x28 if (idx % 2 == 0) else 0x29
            sensor = {'present': False, 'obj': None}
            
            try:
                # Set mux channel
                self.i2c.writeto(cfg.MUX_ADDR, bytes([1 << channel]))
                time.sleep_ms(50)  # Increased mux settling time
                
                # Initialize sensor with retries
                for _ in range(3):
                    try:
                        sensor['obj'] = BNO055(self.i2c, address=addr)
                        sensor['present'] = True
                        self.bitmask |= 1 << idx
                        print(f"[SENSOR] Sensor {idx} initialized")
                        break
                    except OSError as e:
                        time.sleep_ms(20)
            except Exception as e:
                print(f"[SENSOR] Init error sensor {idx}: {str(e)}")
            
            self.sensors.append(sensor)
        print(f"[SENSOR] Active sensors: {bin(self.bitmask)}")

class NetworkManager:
    def __init__(self):
        self.sta = network.WLAN(network.STA_IF)
        self.sock = None
        self.seq_num = 0

    def connect(self):
        print("[NET] Connecting to AP...")
        self.sta.active(True)
        self.sta.connect(cfg.SSID, cfg.PASSWORD)
        for i in range(20):
            if self.sta.isconnected():
                print(f"[NET] Connected! IP: {self.sta.ifconfig()[0]}")
                return True
            print(f"[NET] Connection attempt {i+1}/20")
            time.sleep(0.5)
        return False

    def create_socket(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.bind(('0.0.0.0', cfg.NODE_CMD_PORT))
            self.sock.setblocking(False)
            print(f"[NET] Socket created on port {cfg.NODE_CMD_PORT}")
            return True
        except OSError as e:
            print(f"[NET] Socket error: {e}")
            return False

def main():
    print("\n=== NODE STARTING ===")
    
    # Hardware setup
    i2c = machine.SoftI2C(sda=machine.Pin(cfg.SDA_PIN), 
                         scl=machine.Pin(cfg.SCL_PIN))
    sensor_mgr = SensorManager(i2c)
    sensor_mgr.init_sensors()

    # Network setup
    net_mgr = NetworkManager()
    if not net_mgr.connect() or not net_mgr.create_socket():
        print("[FATAL] Network initialization failed!")
        machine.reset()

    # Main loop
    sending_enabled = False
    print("\n=== ENTERING MAIN LOOP ===")
    
    while True:
        # Command handling with enhanced logging
        try:
            data, addr = net_mgr.sock.recvfrom(256)
            print(f"[CMD] Received {len(data)} bytes: {data}")
            
            if data == b'START':
                print("[CMD] Starting data stream")
                sending_enabled = True
                resp = struct.pack('<B3s', CMD_RESPONSE, b'ACK')
                net_mgr.sock.sendto(resp, (cfg.RECEIVER_IP, cfg.DATA_PORT))
                print("[CMD] Sent START response")
                
            elif data == b'STOP':
                print("[CMD] Stopping data stream")
                sending_enabled = False
                resp = struct.pack('<B3s', CMD_RESPONSE, b'ACK')
                net_mgr.sock.sendto(resp, (cfg.RECEIVER_IP, cfg.DATA_PORT))
                print("[CMD] Sent STOP response")
                
            elif data == b'STATUS':
                print("[CMD] Sending status")
                resp = struct.pack('<BH', STATUS_BROADCAST, sensor_mgr.bitmask)
                net_mgr.sock.sendto(resp, (cfg.RECEIVER_IP, cfg.DATA_PORT))
                print(f"[CMD] Sent STATUS: {bin(sensor_mgr.bitmask)}")
                
            elif data == b'RESTART':
                print("[CMD] Restarting...")
                resp = struct.pack('<B3s', CMD_RESPONSE, b'ACK')
                net_mgr.sock.sendto(resp, (cfg.RECEIVER_IP, cfg.DATA_PORT))
                print("[CMD] Sent RESTART response")
                time.sleep(1)
                machine.reset()
                
        except OSError as e:
            if e.errno != 11:  # Ignore EAGAIN
                print(f"[CMD] Recv error: {e}")
        except Exception as e:
            print(f"[CMD] Critical error: {e}")
            machine.reset()

        # Data transmission logic
        if sending_enabled:
            try:
                data = bytearray()
                current_bitmask = 0
                
                for idx, sensor in enumerate(sensor_mgr.sensors):
                    if not sensor['present'] or sensor['obj'] is None:
                        continue  # Skip uninitialized sensors
                        
                    try:
                        # Switch mux channel
                        channel = idx // 2
                        sensor_mgr.i2c.writeto(cfg.MUX_ADDR, bytes([1 << channel]))
                        time.sleep_ms(15)  # Mux settling time
                        
                        # Read quaternion with validation
                        if hasattr(sensor['obj'], 'iget'):
                            w, x, y, z = sensor['obj'].iget(QUAT_DATA)
                            data += struct.pack('<hhhh', w, x, y, z)
                            current_bitmask |= 1 << idx
                        else:
                            print(f"[DATA] Sensor {idx} invalid object")
                            sensor['present'] = False
                            
                    except Exception as e:
                        print(f"[DATA] Sensor {idx} read error: {str(e)}")
                        sensor['present'] = False

                if current_bitmask:
                    header = struct.pack('<BHB', PACKET_HEADER, net_mgr.seq_num, current_bitmask)
                    net_mgr.sock.sendto(header + data, (cfg.RECEIVER_IP, cfg.DATA_PORT))
                    net_mgr.seq_num += 1
                    
            except Exception as e:
                print(f"[DATA] Critical error: {str(e)}")
                sending_enabled = False

        time.sleep_ms(10)

if __name__ == '__main__':
    main()

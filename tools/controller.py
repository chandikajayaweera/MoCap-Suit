import serial
import time
import struct
from enum import IntEnum

class PacketType(IntEnum):
    SENSOR_DATA = 0x00
    CMD_RESPONSE = 0x01
    STATUS_BROADCAST = 0x02

class MotionController:
    def __init__(self, port="COM12", baudrate=115200):
        self.port = port
        self.baudrate = baudrate
        self.debug = True
        self.ser = None
        self.connected = False
        self.connect()

    def check_connection(self):
        try:
            # Simplified connection check - just verify port is open
            return self.ser and self.ser.is_open
        except Exception:
            return False

    def connect(self):
        try:
            if self.ser and self.ser.is_open:
                self.ser.close()
                
            self.ser = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=1,
                write_timeout=1
            )
            time.sleep(2)  # Important for ESP32 reset
            self.connected = True
            print(f"Connected to {self.port}")
            return True
        except Exception as e:
            print(f"Connection error: {e}")
            self.connected = False
            return False

    def send_command(self, cmd, timeout=3):
        try:
            if not self.check_connection():
                print("Serial port not open! Reconnecting...")
                self.connect()
                if not self.check_connection():
                    return "Connection failed"

            self.ser.reset_input_buffer()
            self.ser.write(f"{cmd}\r\n".encode())
            
            start_time = time.time()
            response = bytearray()
            
            while time.time() - start_time < timeout:
                while self.ser.in_waiting > 0:
                    response.extend(self.ser.read_all())
                    if len(response) >= 3:  # Minimum valid response size
                        return self.parse_response(response)
                time.sleep(0.1)
                
            return "Timeout"
        except Exception as e:
            return f"Error: {str(e)}"

    def parse_response(self, raw):
        try:
            if not raw:
                return "No response"
            
            pkt_type = raw[0]
            if pkt_type == PacketType.CMD_RESPONSE:
                return raw[1:].decode(errors='replace').strip()
            elif pkt_type == PacketType.STATUS_BROADCAST:
                if len(raw) >= 3:
                    status = struct.unpack('<H', raw[1:3])[0]
                    return f"Sensors: {bin(status)}"
                return "Invalid status packet"
            return f"Unknown packet: {raw.hex()}"
        except Exception as e:
            return f"Parse error: {str(e)}"

    def check_status(self):
        return self.send_command("STATUS")

    def start_stream(self):
        return self.send_command("START")

    def stop_stream(self):
        return self.send_command("STOP")

    def restart_node(self):
        return self.send_command("RESTART")

    def menu(self):
        print("\nMotion Capture Control")
        print("1. Check Status")
        print("2. Start Stream")
        print("3. Stop Stream")
        print("4. Restart Node")
        print("5. Exit")

    def run(self):
        try:
            while True:
                self.menu()
                choice = input("Select option: ").strip()
                if choice == '1':
                    print("Status:", self.check_status())
                elif choice == '2':
                    print("Start:", self.start_stream())
                elif choice == '3':
                    print("Stop:", self.stop_stream())
                elif choice == '4':
                    print("Restart:", self.restart_node())
                elif choice == '5':
                    print("Exiting...")
                    break
                else:
                    print("Invalid option")
        except KeyboardInterrupt:
            print("\nExiting...")
        finally:
            if self.ser and self.ser.is_open:
                self.ser.close()

if __name__ == "__main__":
    controller = MotionController()
    controller.run()

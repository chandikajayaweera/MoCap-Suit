import serial
from datetime import datetime

PORT = 'COM12'  # Replace with receiver's port
BAUDRATE = 115200

def main():
    try:
        ser = serial.Serial(PORT, BAUDRATE, timeout=1)
        print(f"Monitoring receiver logs on {PORT}...")
        while True:
            line = ser.readline().decode(errors='ignore').strip()
            if line:
                timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                print(f"[{timestamp}] RECV: {line}")
    except KeyboardInterrupt:
        print("\nMonitoring stopped.")
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == '__main__':
    main()
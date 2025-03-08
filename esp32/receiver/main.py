import network
import socket
import sys
import struct
import time
import machine
import config_receiver as cfg
import select

# Constants
PACKET_HEADER = 0x00
CMD_RESPONSE = 0x01
STATUS_BROADCAST = 0x02

class Receiver:
    def __init__(self):
        self.ap = network.WLAN(network.AP_IF)
        self.sock = None

    def start_ap(self):
        try:
            self.ap.active(False)
            time.sleep(1)
            self.ap.config(essid=cfg.SSID, password=cfg.PASSWORD,
                           authmode=network.AUTH_WPA_WPA2_PSK)
            self.ap.ifconfig((cfg.AP_IP, cfg.SUBNET_MASK, cfg.AP_IP, cfg.AP_IP))
            self.ap.active(True)
            
            for _ in range(10):
                if self.ap.active():
                    return True
                time.sleep(0.5)
            return False
        except OSError as e:
            return False

    def start_udp(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.bind(('0.0.0.0', cfg.DATA_PORT))
            self.sock.setblocking(False)
            return True
        except OSError as e:
            return False

def main():
    receiver = Receiver()
    
    if not receiver.start_ap():
        return
    
    if not receiver.start_udp():
        return

    # Set up select polling for non-blocking stdin reading
    poll = select.poll()
    poll.register(sys.stdin, select.POLLIN)
    
    while True:
        # Handle USB input
        try:
            events = poll.poll(0)
            if events:
                cmd = sys.stdin.readline().strip().upper()
                if cmd:
                    try:
                        receiver.sock.sendto(cmd.encode(), (cfg.NODE_IP, cfg.NODE_CMD_PORT))
                    except OSError as e:
                        pass
        except Exception as e:
            pass

        # Handle UDP packets
        try:
            pkt, addr = receiver.sock.recvfrom(1024)
            if pkt:
                sys.stdout.buffer.write(pkt)
                sys.stdout.flush()
        except OSError:
            pass
        except Exception as e:
            pass

        time.sleep_ms(10)

if __name__ == '__main__':
    main()



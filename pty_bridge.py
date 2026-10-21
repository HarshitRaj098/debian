#!/usr/bin/env python3
import os
import sys
import pty
import select
import termios
import struct
import fcntl
import json

def set_winsize(fd, rows, cols):
    try:
        winsize = struct.pack("HHHH", int(rows), int(cols), 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        pass

def main():
    rows = int(sys.argv[1]) if len(sys.argv) > 1 else 24
    cols = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    cmd = sys.argv[3:] if len(sys.argv) > 3 else ['/bin/bash']

    pid, master_fd = pty.fork()
    if pid == 0:
        os.environ['TERM'] = 'xterm-256color'
        os.environ['COLORTERM'] = 'truecolor'
        os.execvp(cmd[0], cmd)
        sys.exit(0)

    set_winsize(master_fd, rows, cols)

    os.set_blocking(master_fd, False)
    os.set_blocking(sys.stdin.fileno(), False)

    stdin_buffer = bytearray()
    stdin_closed = False

    while True:
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                try:
                    remaining = os.read(master_fd, 8192)
                    if remaining:
                        sys.stdout.buffer.write(remaining)
                        sys.stdout.buffer.flush()
                except OSError:
                    pass
                break
        except ChildProcessError:
            break

        rlist = [master_fd]
        if not stdin_closed:
            rlist.append(sys.stdin.fileno())

        try:
            ready, _, _ = select.select(rlist, [], [], 0.05)
        except (KeyboardInterrupt, select.error):
            break

        if master_fd in ready:
            try:
                data = os.read(master_fd, 8192)
                if data:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
            except OSError:
                break

        if not stdin_closed and sys.stdin.fileno() in ready:
            try:
                chunk = os.read(sys.stdin.fileno(), 8192)
                if not chunk:
                    stdin_closed = True
                else:
                    stdin_buffer.extend(chunk)
            except OSError:
                stdin_closed = True

            while b'\n' in stdin_buffer:
                line, stdin_buffer = stdin_buffer.split(b'\n', 1)
                # Raw write if not JSON, or try JSON
                try:
                    msg = json.loads(line.decode('utf-8'))
                    msg_type = msg.get('type')
                    if msg_type == 'input':
                        raw_data = msg.get('data', '')
                        if raw_data:
                            os.write(master_fd, raw_data.encode('utf-8'))
                    elif msg_type == 'resize':
                        r = msg.get('rows', rows)
                        c = msg.get('cols', cols)
                        set_winsize(master_fd, r, c)
                except Exception:
                    # Not JSON, write line directly
                    os.write(master_fd, line + b'\n')

    try:
        os.close(master_fd)
    except Exception:
        pass

if __name__ == '__main__':
    main()

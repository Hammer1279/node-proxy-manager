#!/bin/bash
# Kill all processes running from /root/node-proxy-manager, except the current shell and its parent (VS Code terminal)

DIR="/root/node-proxy-manager"

# Get current shell PID and its parent (VS Code terminal)
MYPID=$$
PARENTPID=$(ps -o ppid= -p $$ | tr -d ' ')

# Kill any process whose cwd is $DIR, except this shell and its parent
for pid in $(ls -1 /proc | grep -E '^[0-9]+$' | while read pid; do
    if [ -d "/proc/$pid/cwd" ] && [ "$(readlink -f /proc/$pid/cwd 2>/dev/null)" = "$DIR" ]; then
        echo $pid
    fi
done); do
    if [ "$pid" != "$MYPID" ] && [ "$pid" != "$PARENTPID" ]; then
        echo "Killing PID $pid (cwd $DIR)"
        kill -9 "$pid"
    fi
done

# Kill any node process running a script from $DIR, except this shell and its parent
for pid in $(ps aux | grep node | grep "$DIR" | awk '{print $2}'); do
    if [ "$pid" != "$MYPID" ] && [ "$pid" != "$PARENTPID" ]; then
        echo "Killing Node PID $pid (from $DIR)"
        kill -9 "$pid"
    fi
done

echo "All processes from $DIR have been killed"
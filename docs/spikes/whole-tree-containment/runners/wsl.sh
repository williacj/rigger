#!/bin/bash
# ABOUTME: wsl.sh <script-file> : runs a bash script inside WSL via hostpc, logged
f="$1"; 
./t.sh wsl-via-hostpc "cat $f | ssh hostpc wsl.exe -e bash -s   # script $f: $(tr '\n' ';' < $f | sed 's/"/\\"/g')"

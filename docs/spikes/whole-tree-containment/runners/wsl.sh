#!/bin/bash
# ABOUTME: wsl.sh <script-file> : runs a bash script inside WSL via finnpc, logged
f="$1"; 
./t.sh wsl-via-finnpc "cat $f | ssh finnpc wsl.exe -e bash -s   # script $f: $(tr '\n' ';' < $f | sed 's/"/\\"/g')"

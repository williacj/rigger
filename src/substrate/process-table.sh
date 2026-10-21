#!/bin/bash
# ABOUTME: Reads Linux process groups, raw command names and zombie wait statuses for L0.

# proc_pid_comm(5) exposes the kernel name without ps replacing control bytes.
if [[ $# == 4 && $1 == -p && $2 =~ ^[1-9][0-9]*$ && $3 == -o && $4 == ucomm= ]]; then
  [[ -r /proc/$2/comm ]] || exit 1
  exec /bin/cat /proc/"$2"/comm
fi

args=("$@")
wait_status=0
for argument in "$@"; do
  if [[ $argument == pid=,stat=,xstat= ]]; then wait_status=1; fi
done
for ((index=0; index<${#args[@]}; index++)); do
  if [[ ${args[index]} == -g && index+1 -lt ${#args[@]} ]]; then
    group=${args[index+1]}
    unset 'args[index]' 'args[index+1]'
    /bin/ps -A -o pgid= "${args[@]}" |
      /usr/bin/awk -v group="$group" -v wait_status="$wait_status" '
        $1 == group {
          sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "")
          if (wait_status) {
            status = 0
            if ($2 ~ /^Z/) {
              path = "/proc/" $1 "/stat"
              read = (getline record < path)
              close(path)
              # proc_pid_stat(5): field 52 is the decimal POSIX wait status.
              # The comm field may contain spaces and closing parentheses.
              sub(/^.*\) /, "", record)
              count = split(record, fields, " ")
              if (read != 1 || count < 50 || fields[1] != "Z") next
              status = fields[50]
            }
            sub(/[^[:space:]]+[[:space:]]*$/, sprintf("%x", status))
          }
          print
          found=1
        }
        END { exit !found }
      '
    status=("${PIPESTATUS[@]}")
    if [[ ${status[0]} != 0 ]]; then exit "${status[0]}"; fi
    exit "${status[1]}"
  fi
done
exec /bin/ps "$@"

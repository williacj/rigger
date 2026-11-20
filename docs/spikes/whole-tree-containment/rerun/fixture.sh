#!/bin/bash
# ABOUTME: Card #1430 rerun fixture (macOS and Linux): starts M1-M6 sleeping 300 s; every process it starts writes its pid to $FX_SHLOG.
# Usage: bash fixture.sh <run>, cwd = the dispatch directory. Only bash builtins run here between starts, so no unrecorded process is made.
R="$1"; L="$FX_SHLOG"
echo "root $$" >> "$L"
bash -c "echo M1 \$\$ >> '$L'; (exec -a fx-$R-M2 sleep 300) & echo M2 \$! >> '$L'; exec -a fx-$R-M1 sleep 300" &
echo "M1-from-root $!" >> "$L"
perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; exec {"sleep"} "fx-'"$R"'-M3", "300"' &
echo "M3 $!" >> "$L"
bash -c "echo M4-parent \$\$ >> '$L'; (exec -a fx-$R-M4 sleep 300) & echo M4 \$! >> '$L'; exit 0" &
echo "M4-parent-from-root $!" >> "$L"
bash -c "trap '' TERM; echo M5 \$\$ >> '$L'; exec -a fx-$R-M5 sleep 300" &
echo "M5-from-root $!" >> "$L"
perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; chdir "/" or die; exec {"sleep"} "fx-'"$R"'-M6", "300"' &
echo "M6 $!" >> "$L"
wait
exec sleep 300

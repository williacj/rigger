#!/bin/bash
# ABOUTME: wsl-run.sh <mode> <run> [killmode]: inside WSL, starts the supervisor as a transient systemd user service
# (Delegate=yes, KillMode=process unless given), and for e2 kills it outright, lists +12 s, then a fresh writer kills the orphaned tree cgroup.
S=$HOME/1430-spike-engineer; N=$S/node-v24.19.0-linux-x64/bin/node
mode=$1; run=$2; km=${3:-process}; D=$S/d-$run; mkdir -p $D; L=$S/$run.log; : > $L
echo "runner pid $$ in cgroup $(cut -d: -f3 /proc/self/cgroup); id: $(id)"
systemd-run --user --unit=fx1430-$run -p Delegate=yes -p KillMode=$km --working-directory=$S \
  bash -c "id >> $L; echo supervisor-process pid \$\$ >> $L; exec $N $S/fixture/supervisor.cjs $mode $run $D $S/fixture >> $L 2>&1"
if [ $mode = e2 ]; then
  until grep -q 'waiting to be killed' $L; do sleep 0.2; done
  sup=$(systemctl --user show -p MainPID --value fx1430-$run); cg=$(systemctl --user show -p ControlGroup --value fx1430-$run)
  echo "supervisor MainPID $sup, unit cgroup $cg"
  kill -9 $sup; echo "$(date -u +%FT%T.%3NZ) kill -9 $sup"
  sleep 12; echo "$(date -u +%FT%T.%3NZ) listing +12 s after kill -9"; bash $S/fixture/list.sh $run
  systemctl --user show -p ActiveState -p SubState -p Result fx1430-$run
  T=/sys/fs/cgroup$cg/tree
  if [ -d $T ]; then
    echo "tree cgroup $T procs: $(tr '\n' ' ' < $T/cgroup.procs)"
    bash -c "echo \"fresh writer pid \$\$\"; t0=\$(date +%s%N); echo 1 > $T/cgroup.kill; until [ ! -e $T/cgroup.events ] || grep -q 'populated 0' $T/cgroup.events; do sleep 0.001; done; echo \"fresh writer: cgroup.kill written; tree cgroup empty or removed (exists: \$([ -e $T ] && echo yes || echo no)) after \$(( (\$(date +%s%N)-t0)/1000 )) us\""
    sleep 10; echo "$(date -u +%FT%T.%3NZ) listing +10 s after fresh cgroup.kill"; bash $S/fixture/list.sh $run
  else echo "no tree cgroup at $T (systemd removed the unit cgroup)"; fi
else
  until grep -q 'AFTER ENDING' $L && ! systemctl --user is-active -q fx1430-$run; do sleep 0.5; done
fi
echo ---- supervisor log; cat $L

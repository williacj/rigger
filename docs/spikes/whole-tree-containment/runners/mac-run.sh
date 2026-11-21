#!/bin/bash
# ABOUTME: mac-run.sh <mode> <run>: runs one macOS run; for e2, kills the supervisor outright and lists 12 s later.
S=$HOME/GitHub/rigger-worktrees/1430-spike-engineer/spikes/1430-spike-engineer
mode=$1; run=$2; D=$S/mac/d-$run; mkdir -p $D
node $S/fixture/supervisor.cjs $mode $run $D $S/fixture > $S/mac/$run.log 2>&1 &
sup=$!; echo "supervisor pid $sup (started by mac-run.sh pid $$)"
if [ $mode = e2 ]; then
  until grep -q 'waiting to be killed' $S/mac/$run.log; do sleep 0.2; done
  kill -9 $sup; echo "$(date -u +%FT%TZ) kill -9 $sup"; wait $sup 2>/dev/null
  sleep 12; echo "$(date -u +%FT%TZ) listing +12 s after kill -9"; bash $S/fixture/list.sh $run
else
  wait $sup; echo "supervisor exited $?"
fi
echo ---- supervisor log; cat $S/mac/$run.log

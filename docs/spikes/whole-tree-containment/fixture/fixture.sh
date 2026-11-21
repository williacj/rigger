#!/bin/bash
# ABOUTME: Card #1430 fixture (macOS and Linux): the supervised command; starts members M1-M6, each sleeping 300 s.
# Usage: bash fixture.sh <run-tag>   (cwd = the dispatch directory). Each member's argv[0] is fx-<run>-M<n>.
R="$1"
# M1: direct child of this command. M2: M1's child (a grandchild of this command).
bash -c "(exec -a fx-$R-M2 sleep 300) & exec -a fx-$R-M1 sleep 300" &
# M3: a descendant that starts a new session.
perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; exec {"sleep"} "fx-'"$R"'-M3", "300"' &
# M4: double-forked; its parent exits at once, so it is reparented.
bash -c "(exec -a fx-$R-M4 sleep 300) & exit 0" &
# M5: ignores SIGTERM (SIG_IGN survives exec).
bash -c "trap '' TERM; exec -a fx-$R-M5 sleep 300" &
# M6: a new session that changes its working directory to /.
perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; chdir "/" or die; exec {"sleep"} "fx-'"$R"'-M6", "300"' &
wait
sleep 300

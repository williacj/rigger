#!/bin/bash
# ABOUTME: Card #1459 fixture (#1430's members M1-M6, sleeping 300 s): every process it starts is recorded, as it starts, with its
# pid and /proc starttime, by the process that starts it, using bash builtins only. Usage: bash fixture.sh <run>, cwd = dispatch dir.
R="$1"; L="$FX_SHLOG"; export TZ=UTC
r(){ local raw; { raw=$(</proc/$2/stat); } 2>/dev/null || { echo "MISS $1 $2" >> "$L"; return; }; local rest=${raw##*) }; local -a f=($rest); local t=$EPOCHREALTIME; printf 'MEMBER %s %s %s %(%Y-%m-%dT%H:%M:%S)T.%sZ\n' "$1" "$2" "${f[19]}" "${t%.*}" "${t#*.}" >> "$L"; }
R_DEF="$(declare -f r)"
r root $$
bash -c "$R_DEF; L='$L'; r M1 \$\$; (exec -a fx-$R-M2 sleep 300) & r M2 \$!; exec -a fx-$R-M1 sleep 300" &
r M1-from-root $!
perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; exec {"sleep"} "fx-'"$R"'-M3", "300"' &
r M3 $!
bash -c "$R_DEF; L='$L'; r M4-parent \$\$; (exec -a fx-$R-M4 sleep 300) & r M4 \$!; exit 0" &
r M4-parent-from-root $!
bash -c "trap '' TERM; $R_DEF; L='$L'; r M5 \$\$; exec -a fx-$R-M5 sleep 300" &
r M5-from-root $!
perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; chdir "/" or die; exec {"sleep"} "fx-'"$R"'-M6", "300"' &
r M6 $!
wait
exec sleep 300

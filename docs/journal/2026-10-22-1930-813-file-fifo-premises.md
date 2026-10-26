ABOUTME: Records the bounded file/FIFO fixture proof and its distinction from unresolved historical timeouts.

# File/FIFO fixture premises

The replacement acceptance on #813 limits this work to its named stand-in
scenarios and their direct readiness and diagnostic helpers. The owner authorized
current correctness and prevention, including the replacement scope recorded on
#881. The historical cancellations remain unexplained; passing current cases
does not establish their cause.

The source at maker base `06b4bcf` already writes the file before announcing it.
The waiter opens its FIFO before its first existence read. Neither operation
requires a protocol correction on the evidence collected here.

The tests now observe the writer's file before releasing a waiter stopped after
its false first read. The before-first-read cases assert that the writer planned
to remain alive is still running when the waiter settles. The two pending-waiter
cases observe an explicit child acknowledgment that its synchronous gate read
returned before probing the still-open FIFO and sending SIGTERM. The previously
untraced declarations now record reached stages. These observations establish
the schedules directly; sorting cross-process trace timestamps is no causal proof.

The two skipped case bodies first executed through the ordinary host suite entry
point with a bounded in-memory module hook. The hook required each exact skip
anchor once and reported original and loaded source SHA256 values. The tracked
skip properties remained intact during that run. The retained Node report names
both intended tests and measures two passes, zero failures, zero cancellations,
and zero skips on WSL Linux with Node 26.12.0. Only then were those two skip
properties removed.

That diagnostic preserved EACCES with an absent written file, EMFILE with a
present written file, pending-FIFO observations, and FIFO removal on SIGTERM.
Complete original output, the hook, and both process trace directories are
retained together in the external #813 evidence directory. These are current
real-host boundary observations, not retrospective proof of an old incident.

The complete stand-in-agent host file then measured 19 passes, zero failures,
zero cancellations, and zero skips through the supported host runner on that
same Linux/Node environment. The two scoped writer-alive cases also inspect
the existing process-state authority and reject empty, zombie, or dead states.
The real FIFO/open/error/signal cases remain in place. This local result makes
no claim about a macOS run.

The final complete-file run used an explicit persistent evidence root outside the
checkout and temporary directory, with mode 0700. final-full-file.log measures
19 passes, zero failures, cancellations or skips, 1,993 ms; eighteen original
JSONL traces across six traced cases remain retained there. Earlier disposable
automatic trace roots provide no retained-original credit. The normal commit
hook supplies final ordinary-suite verification, recorded with the resulting
head in the pull request.

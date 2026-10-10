ABOUTME: Records how card 653 made a continuing workspace from the forge line and what its tests established.

# Continuing a card's workspace

The first test handed L1 a card and the head of its forge branch. It failed because the workspace
still started at main. L1 now uses the second argument to choose the continuing path while a card
alone keeps the existing start from main.

The continuing path checks the branch the forge holds before it removes an earlier worktree. L0
fetches that branch, checks its head again, and L1 resets the local card branch to the fetched
commit. This removes uncommitted files and local commits the forge does not hold. L1 also refuses
a worktree on another branch or a card branch checked out elsewhere before changing the path.

The tests use a local bare repository as the forge. They cover each state in the proposed
`R-WORK-25` table, including a force move, a changed or deleted forge branch, and a failed or
timed-out fetch. The failed baseline runs on this card preceded the change; C18 on the M5 record
classified their census guard failures with Test quality card #697. A later baseline run passed.

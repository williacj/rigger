<!-- ABOUTME: Records card 923's four status-issue writes and the boundary checks that admit them. -->

# Status issue writes

Card #923 adds four substrate operations: open an issue with its status label in one request, close
an issue, remove one label, and add an issue to the board. The opening checks the label in the
forge's own answer, since a successful response can still omit it. The board add accepts an issue
number, reads its node ID through the read runner, and uses the existing board read for the project
ID. The read side remains untouched.

The repository-write runner admits the three REST request forms by shape. The item-write runner
admits the GraphQL add only with one project ID and one content ID. The installed-`gh` proxy tests
check the methods, fields and encoded label path seen by the forge boundary.

This card claims none of `R-SCHED-20` through `R-SCHED-27`. Later workflow cards choose the notice,
drive these writes and prove the scheduling requirements.

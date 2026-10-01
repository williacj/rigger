# ABOUTME: The demo tape: `rigger once` claiming a card from a fake board, in a world
# test/demo-world.sh builds outside the checkout, making and provisioning the card's workspace,
# and exiting non-zero naming that workspace because no maker runs before M4. Run from the
# checkout root as `vhs docs/demo.tape`; CI does.

Output docs/demo.gif
# The screen as the recording ends, as text: what CI reads the claim, the message and the exit from.
Output docs/demo.txt

Set Shell bash
Set FontSize 16
Set Width 1100
Set Height 240
Set Padding 20

# The world is built and entered before any frame is captured, so the GIF opens on the prompt
# in the consumer's repository, with the installed rigger and the fake gh alone on PATH.
Hide
Type ". test/demo-world.sh"
Enter
# Packing and installing takes longer than the default wait of 15 seconds allows for.
Wait@2m
# The line typed above is still on the screen; the recording opens on a bare prompt.
Ctrl+L
Show

Type "rigger once"
Sleep 500ms
Enter
Wait@30s
Sleep 1s
Type "echo exit $?"
Sleep 500ms
Enter
Wait
Sleep 3s

# node-iridium
A modified version of Razvan Dragomirescu's original Iridium SDB node.js library. (http://www.veri.fi/iridiumsbd.tar.gz)

This version is the same basic code, just added a function to disable Flow Control on my RockBlock, which seems to fix an issue reading data using a 3-wire UART connection to my Raspberry Pi GPIO.

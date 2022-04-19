Node.js library for sending and receiving [Iridium SBD](https://www.iridium.com/services/details/iridium-sbd) (Short
Burst Data).

Created for using with [RockBlock](http://www.rock7.com) modems but should work with other Iridium 9602 modems.

## Installation

```console
$ npm install iridium-sbd
```

## Usage

```javascript
const iridium = require("iridium-sbd");

iridium.open({
    debug: 1, //turn debugging on
    port: "/dev/ttyUSB0",
    flowControl: true, //set to false to disable flowControl on the SBD for 3-wire UART setups
});

iridium.on("initialized", () => {
    console.log("Iridium initialized");

    iridium.sendCompressedMessage("Hello world!", (err, momsn) => {
        console.log("Message Sent!");
    });
});

iridium.on("ringalert", () => {
    console.log("New incoming message event!");
    iridium.mailboxCheck();
});

iridium.on("newmessage", (message, queued) => {
    console.log("Received new message ", message);
});

iridium.on("debug", log => {
    console.log(">>> " + log);
});
```

## Credits

-   Razvan Dragomirescu's original Iridium SDB node.js library.
    [http://www.veri.fi/iridiumsbd.tar.gz](http://www.veri.fi/iridiumsbd.tar.gz)
-   Rock Seven - RockBlock (Iridium 9602). [https://www.rock7.com/](https://www.rock7.com/)

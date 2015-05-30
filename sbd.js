#!/usr/bin/node
// Demo software for Iridium Node.JS library
// Version 1.5 (2012-12-28)
// (C) 2012 Razvan Dragomirescu <razvan.dragomirescu@veri.fi>

var iridium = require("./iridium.js");
var sys = require('sys');
var zlib = require('zlib');
var execSync = require('exec-sync');
var dateFormat = require('dateformat');


var pending = 0;
var lock = 0;

// always do your work AFTER the 'initialized' event is received!
iridium.on('initialized', function() {
    sys.log("[SBD] IRIDIUM INITIALIZED");
    
    // The lines below send the exact same message
    // use sendMessage or sendBinaryMessage for text
    // use only sendBinaryMessage for binary messages
    
    //sendBinaryMessage("hello");
    //sendBinaryMessage(new Buffer("68656c6c6f", "hex"));

    //check the mailbox for messages upon initialization?
    //mailboxCheck();

    iridium.getSystemTime(function(err, ctime) {
        sys.log("Current Iridium time is "+ctime);
        var fdate = dateFormat(ctime, "mmddHHMMyyyy.ss");
        execSync("date "+fdate);
        sys.log("Date set from Iridium time");
    })

		//to send a compressed text message use sendCompressedMessage - on the other end use ZLib Deflate to uncompress it
		//sendCompressedMessage("This is a test for the compressed messages!");
});

iridium.on('ringalert', function() {
    sys.log("[SBD] RING ALERT");
    mailboxCheck();
});

function mailboxCheck() {
    if (lock) {
        pending++;
    } else {
        sendMessage("");
    }
}

// when a message is received, try to execute it as a command
iridium.on('newmessage', function(message, queued) {
    sys.log("[SBD] Received new message "+message);
//    var user = execSync(message);
//    sys.log(user);
    sys.log("[SBD] There are "+queued+" messages still waiting");
    pending = queued;
});

function sendCompressedMessage(text) {
    zlib.deflateRaw(text, function(err, buffer) {
        if (!err) {
            sys.log("Text compressed, initial length "+text.length+", compressed length "+buffer.length);
            sendBinaryMessage(buffer);
        }
    });
}


function sendMessage(text) {
    lock=1;
    iridium.sendMessage(text, function(err, momsn) {
        if (err==null) {
            if (text) sys.log("[SBD] Message sent successfully, assigned MOMSN "+momsn);

            // check to see if there are other messages pending - if there are, send a new mailbox check to fetch them in 1 second
            if (pending>0) setTimeout(function() {
                sendMessage("");
            }, 1000);
            else {
                lock=0;
            }
        } else {
            sys.log("[SBD] Iridium returned error "+err+", will retry in 20s");
            setTimeout(function() {
                sendMessage(text);
            }, 20000);
        }
    });
}

function sendBinaryMessage(buffer) {
    lock=1;
    iridium.sendBinaryMessage(buffer, function(err, momsn) {
        if (err==null) {
            if (buffer) sys.log("[SBD] Binary message sent successfully, assigned MOMSN "+momsn);

            // check to see if there are other messages pending - if there are, send a new mailbox check to fetch them in 1 second
            if (pending>0) setTimeout(function() {
                sendMessage("");
            }, 1000);
            else {
                lock=0;
            }
        } else {
            sys.log("[SBD] Iridium returned error "+err+", will retry in 20s");
            setTimeout(function() {
                sendBinaryMessage(buffer);
            }, 20000);
        }
    });
}

iridium.open({
    debug: 1,
    port: "/dev/ttyUSB0",
    flowControl: true //set to false to disable flowControl on the SBD for 3-wire UART setups 
});







// Small Iridium SBD (short burst data) Node.JS Library
// Version 1.5 (2012-12-28)
// A continuous work in progress, check for the latest version at http://www.veri.fi/iridiumsbd.tar.gz (will move to GitHub at a certain point)
// See the sbd.js example to see how to use this. Feel free to send questions and feedback to the email below
// (C) 2012 Razvan Dragomirescu <razvan.dragomirescu@veri.fi>
// Additions (C) 2015 Brian Robinson <brian@ndmweb.com>

var sys = require('sys');
var clc = require('cli-color');
var async = require('async');
var serialport = require("serialport");
var SerialPort = serialport.SerialPort;
var EventEmitter = require('events').EventEmitter;

var iridiumEvents = new EventEmitter();
exports.on = function(ev, callback) {
    iridiumEvents.on(ev, callback);
}


var buffer = "";
var df;
var er;
var tf;
var bars=0;
var messagePending=0;
var debug = 0;
var port = "/dev/ttyUSB0";
var flowControl = true; //added by @dudewheresmycode to fix 3-wire UART data reading issue

var OK = /^OK\r/;
var ALL = /.*/;


var DEFAULT_TIMEOUT = 60000; // 60 seconds general timeout for all commands
var SIMPLE_COMMAND_TIMEOUT = 2000; // 2 seconds timeout for simple command such as "echo off" (ATE0)
var TIMEOUT_FOREVER = -1;


// this array contains all possible unsollicited response codes and their
// corresponding handling functions
var unsollicited = {
    "SBDRING": {
        pattern: /^SBDRING/, 
        execute: sbdring
    },
    "AREG": {
        pattern: /^\+AREG/, 
        execute: areg
    }
};

var errors = [
/ERROR/
];

// emit a 'ringalert' event if the SBDRING unsollicited response is received
function sbdring() {
    iridiumEvents.emit('ringalert');
}


// log if debug enabled
function log(message) {
    if (debug){
	    //sys.log(message);
      iridiumEvents.emit('debugLog', message);
	  }
}

// interpret the automatic registration result
function areg(line) {
    var m = line.match(/^\+AREG:(\d+),(\d+)/);
    var regevent = m[1];
    var regerr = m[2];
    log("Registration result: "+regevent+" with error "+regerr);
}


// send a binary message via SBD and call back when done
function sendBinaryMessage(message, callback, maxWait) {

    if (message.length==0) {
        sendMessage(message, callback, maxWait);
        return;
    }

    var buffer = (message instanceof Buffer)?message:new Buffer(message);	

    var command = "AT+SBDWB="+buffer.length;

    var ob = new Buffer(buffer.length+2);
    var sum = 0;
    for (var i=0;i<buffer.length;i++) {
        ob[i]=buffer[i];
        sum+=buffer[i];
    }
    ob[buffer.length+1]=sum&0xff;
    sum>>=8;
    ob[buffer.length]=sum&0xff;
    
   

    // first write the binary message to storage - issue AT+SBDWB and wait for the modem to say READY 
    AT(command, /READY/, ALL, function(err, text) {

        if (err) {
            messagePending = 0;
            clearMOBuffers(function() {
                callback(err);
            });
            return;
        }

        // send the binary message and wait for OK
        ATS(ob, OK, ALL, function(berr) {
            if (berr) {
                messagePending = 0;
                clearMOBuffers(function() {
                    callback(berr);
                });
                return;
            }


            messagePending = 1;
            waitForNetwork(function(xerr) {
       
                if (xerr) {
                    messagePending = 0;
                    clearMOBuffers(function() {
                        callback(xerr);
                    });
                    return;
                }



                messagePending=2;
                disableSignalMonitoring(function(xcallback) {
                    initiateSession(callback);
                });
            }, maxWait);

        });
    });
}

// export this function so that it can be called from any code requiring this
exports.sendBinaryMessage = sendBinaryMessage;



// send a message via SBD and call back when done
function sendMessage(message, callback, maxWait) {

    // if no message is given, this is a mailbox check, so clear the MO storage
    var command = message?"AT+SBDWT="+message:"AT+SBDD0"; 
   
    // write the MO message, wait for network (+CIEV event)
    // disable signal monitoring (+CIER=0) then send the message (+SBDIXA)
 
    AT(command, OK, ALL, function(err, text) {

        if (err) {
            messagePending = 0;
            clearMOBuffers(function() {
                callback(err);
            });
            return;
        }

        messagePending = 1;
        waitForNetwork(function(xerr) {
       
            if (xerr) {
                messagePending = 0;
                clearMOBuffers(function() {
                    callback(xerr);
                });
                return;
            }



            messagePending=2;
            disableSignalMonitoring(function(xcallback) {
                initiateSession(callback);
            });
        }, maxWait);
    });
}

// export this function so that it can be called from any code requiring this
exports.sendMessage = sendMessage;
	

var serialPort;
var data = "";
var binaryMode = false;
var binaryBuffer = new Buffer(512);
var binaryBufferCounter = 0;
var serialEmitter;

// in binary mode we do not stop at OK or any other regexp, it's all time-based (it reads all available data for bufferTimeout seconds)
function enableBinaryMode(bufferTimeout) {
    binaryMode = true;
    setTimeout(function() {
        var ob = new Buffer(binaryBufferCounter);
        binaryBuffer.copy(ob, 0, 0, ob.length);
        serialEmitter.emit('data', ob);
        binaryBufferCounter = 0;
        binaryMode = false;
    }, bufferTimeout);
}

// read line by line or a whole binary blob, depending on the mode
function readSBD(emitter, buffer) {
    serialEmitter = emitter;
    if (binaryMode) {
        buffer.copy(binaryBuffer, binaryBufferCounter);
        binaryBufferCounter+=buffer.length;
    }
    else {
        // Collect data
        data += buffer.toString('binary');
        // Split collected data by delimiter
        var parts = data.split("\n")
        data = parts.pop();
        parts.forEach(function (part, i, array) {
            emitter.emit('data', part);
        });
    }
};


// open the serial port
// config options are: "debug" (set to 1 to monitor the AT commands and response
// and "port" (the actual device to use - defaults to /dev/ttyUSB0)

function open(config) {
    if (config) {
        if (config.debug) debug=config.debug;
        if (config.port) port=config.port;
				flowControl=!!config.flowControl;
    }
    serialPort = new SerialPort(port, {
        baudrate: 19200,
        buffersize: 512,
        parser: readSBD
    });
    serialPort.on("data", function (data) {
        log(("< "+data));
        if (!er) {
            df(null, data);
            delete(df);
            delete(er);
            return;
        }
	
        for (x in unsollicited) {
            if (unsollicited[x].pattern.test(data)) {
                unsollicited[x].execute(data);
                return;
            }
        }

        for (x in errors) {
            if (errors[x].test(data)) {
                df(errors[x], buffer);
                buffer="";
                delete(df);
                delete(er);
                return;
            }
        }
 

        if (!kr || kr.test(data)) {
            buffer+=(data+"\n");
        }
        if (er && er.test(data)) {
            df(null, buffer);
            buffer="";
            delete(df);
            delete(er);

	

        }
    });
    serialPort.on("error", function (error) {
        log("ERROR: "+error);
    });

    serialPort.on("open", function() {
	    if(flowControl){
		    init();
		  }else{
		    disableFlowControl(init);
      }
    });

}

// export the "open" function so that it can be called externally
exports.open = open;


function batchProcess(tasks) {
    async.series(tasks, function(err, results) {
        //sys.log("Batch process complete");
        });
}

function initComplete(callback) {
    iridiumEvents.emit('initialized');
    log("[SBD] IRIDIUM INITIALIZED");
    callback(null);
}
// this is the modem initialization process - echo off, clear all buffers (MO & MT)
// query registration status (should return 2 = registered)
// enable ring alert (AT+SBDMTA=1)

function init() {
    batchProcess([
        echoOff,
        clearBuffers,
        enableRegistration,
        ringAlertEnable,
        initComplete
        ]
        );
}

// expose the init() function to the outside world
exports.init = init;

function waitForNetwork(callback, maxWait) {
    ATS("AT+CIER=1,1,0,0", /\+CIEV:0,[^0]/, ALL, callback, maxWait?maxWait:TIMEOUT_FOREVER);
}

function getSystemTime(callback) {
    AT("AT+CCLK?", OK, ALL, function(err, result) {
        if (err) callback(err);
        else {
            var m = result.match(/CCLK:(\d+)\/(\d+)\/(\d+),(\d+):(\d+):(\d+)/);
            if (!m) callback("UNKNOWN_TIME");
            else {
                var ctime = new Date(Date.UTC(2000+Number(m[1]), m[2]-1, m[3], m[4], m[5], m[6]));
                callback(null, ctime);
            }
	
        }
    });
}
exports.getSystemTime = getSystemTime;
		
function disableFlowControl(callback){
	log("[SDB] DISABLING FLOW CONTROL");
	ATS("AT&K0", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

function disableSignalMonitoring(callback) {
    ATS("AT+CIER=0,0,0,0", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}
function getSignalQuality(callback) {
    ATS("AT+CSQ", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}
exports.getSignalQuality = getSignalQuality;

function ringAlertEnable(callback) {
    ATS("AT+SBDMTA=1", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

function echoOff(callback) {
    ATS("ATE0", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

function enableRegistration(callback) {
    ATS("AT+SBDAREG=1", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

function clearMOBuffers(callback) {
    ATS("AT+SBDD0", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

function clearMTBuffers(callback) {
    ATS("AT+SBDD1", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

function clearBuffers(callback) {
    ATS("AT+SBDD2", OK, ALL, callback, SIMPLE_COMMAND_TIMEOUT);
}

// emit a 'newmessage' event containing the message
// and the number of queued messages still waiting at the server
function readBinaryMessage(mtqueued, callback) {
    enableBinaryMode(1000);
    AT("AT+SBDRB", false, false, function(err, buffer) {

        if (err) {
            clearMTBuffers(function() {
                callback(err);
            });
            return;
        }

        var ib = buffer;
        var messageLength = ib.readUInt16BE(0);
        var messageBuffer = new Buffer(messageLength);
        ib.copy(messageBuffer, 0, 2, messageLength+2);



        log("Received message is "+messageBuffer.toString('hex'));
        binaryMode = false;
        iridiumEvents.emit('newmessage', messageBuffer, mtqueued);
        clearMTBuffers(callback);
    }, SIMPLE_COMMAND_TIMEOUT);
}


// emit a 'newmessage' event containing the message
// and the number of queued messages still waiting at the server
function readMessage(mtqueued, callback) {
    AT("AT+SBDRT", OK, ALL, function(err, text) {
		
        if (err) {
            clearMTBuffers(function() {
                callback(err);
            });
            return;
        }


        var m = text.match(/SBDRT:[^]{2}(.*)/);
        var rmessage = m[1];
        log("Received message is "+rmessage);
        iridiumEvents.emit('newmessage', rmessage, mtqueued);
        clearMTBuffers(callback);
    }, SIMPLE_COMMAND_TIMEOUT);
}
			
// most important function, initiates a SBD session and sends/receives messages
function initiateSession(callback) {
    AT("AT+SBDIXA", OK, /\+SBDIX/, function(err, text) {


        if (err) {
            messagePending = 1;
            clearMOBuffers(function() {
                callback(err);
            });
            return;
        }
        var m = text.match(/\+SBDIX: (\d+), (\d+), (\d+), (\d+), (\d+), (\d+)/);
        var status = m[1];
        var momsn = m[2];
        var mtstatus = m[3];
        var mtmsn = m[4];
        var mtlen = m[5];
        var mtqueued = m[6];

        if (status<=4) {
            log("MO message transferred successfully");
            messagePending = 0;
        } else if (status==18) {
            log("MO message failed, radio failure");
            messagePending = 1;
            clearMOBuffers(function() {
                callback("radio failure");
            });
            return;
        } else if (status==32) {
            log("MO message failed, network failure");
            messagePending = 1;
            clearMOBuffers(function() {
                callback("network failure");
            });
            return;
        } else {
            log("MO message failed, error "+status);
            messagePending = 1;
            clearMOBuffers(function() {
                callback("unknown failure");
            });
            return;
        }
      

        if (mtqueued>0) {
            log("There are still "+mtqueued+" messages waiting!");
        }

        if (mtstatus==0) {
            log("No MT messages are pending");
        } else if (mtstatus==1) {
            log("A MT message has been transferred, use AT+SBDRT to read it");
						
						
						//disableFlowControl(function(){
	            
	            readBinaryMessage(mtqueued, function() {
	                clearMOBuffers(function(err) {
	                    callback(err, momsn);
	                });
				
	            });
				
						//});
            
            return;
        } else {
            log("Error determining MT status: "+mtstatus);
        }

        clearMOBuffers(function(err) {
            callback(err, momsn);
        });


    });
}

// simplified AT command function - when you don't care about the result
// the end callback is simply a null function (does nothing)
function ATS(command, endregexp, keepregexp, callback, timeout) {
    AT(command, endregexp, keepregexp, function(err, text) {
        return callback(err);
    }, timeout);
}


// send an AT command to the modem and call datafunction when complete
// endregexp is the regular expression that marks the end of the response (usually the string OK)
// keepregexp tells it to filter the response and keep only the lines that match it
// datafunction is the function to call when the response is fully received
function AT(command, endregexp, keepregexp, datafunction, timeout) {
    er = endregexp; // when to push the completed buffer to the datafunction
    kr = keepregexp; // what lines to keep
    if (tf) clearTimeout(tf); // any new AT command clears the previous command
    delete tf;
    df = function (err, text) {
        if (tf) clearTimeout(tf);
        delete(tf);
        datafunction(err, text); // what to call when ended
    };
    if (!timeout) timeout=DEFAULT_TIMEOUT; // general timeout 60 seconds
    if (timeout>0) tf = setTimeout(function() {
        log("Sending a timeout event for command "+command);
        datafunction("TIMEOUT");
    }, timeout);

    if (command instanceof Buffer) {
        log("[BINARY] > "+command.toString('hex'));
        serialPort.write(command);
    } else {
        log("> "+command);
        serialPort.write(command+"\r");
    }
}

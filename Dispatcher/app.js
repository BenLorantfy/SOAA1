// [ Dependencies ]
var net = require("net");
var dns = require("dns");
var exec = require('child_process').exec;
var request = require('request');
var services = require("./services.json");

// [ Custom log function ]
var log = function(msg,indent){
    if(!indent) var indent = 0;
    
    var indents = "";
    for(var i = 0; i < indent; i++){
        indents += "    ";
    }
    indents += ">>> ";
    
    console.log(indents + msg);
}
var clients = [];

// The following ASCII values are taken from the SOA Messaging Protocol Spec
var BOM = 11;
var EOS = 13;
var EOM = 28;

// These ASCII values are whitespace according to https://en.wikipedia.org/wiki/Whitespace_character
var whitespace = [9,10,11,12,13,32 /* <- space */, 133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288 /* following values are not WSpace=Y according to unicode but similar -> */, 6158,8203,8204,8205,8288,65279];


// [ Start all the services ]
(function startup(){
    log("Starting all the services...");
    for(var i = 0; i < services.services.length; i++){
        var service = services.services[i];
        if(service.start){
            log("Starting " + service.serviceName + " service...",1)
            exec(service.start, function(error, stdout, stderr){
              if (error) {
                console.error("exec error: " + error);
                return;
              }
              console.log("stdout: " + stdout);
              console.log("stderr: " + stderr);
            });        
        }
    }    
    log("Done starting services");
})();


// [ Consumes a message and performs required actions ]
function consumeMessage(message){
	var segments = message.split(String.fromCharCode(EOS));
	
	// [ Remove all the empty segments ]
	for(var i = segments.length - 1; i >= 0; i--){
		if(typeof segments[i] != "string"){
			segments.splice(i,1);
			continue;
		}
		
		if(segments[i].trim() == ""){
			segments.splice(i,1);
			continue;
		}
	}
	
	// [ Make sure we didn't recieve an empty message ]
	if(segments.length == 0){
		log("Recieved empty message");
		return;
	}
	
//	 console.log(segments);
	
	for(var i = 0; i < segments.length; i++){
		var parts = segments[i].split("|");
		if(parts[0] == "DRC" && parts[1] == "EXEC-SERVICE"){
			executeService(segments)
		}
	}
}

function executeService(segments){
	if(segments.length > 2){
		log("Not enough segments");
		return;	
	}
	
	// [ Make sure SRV segment exists ]
	var srv = segments[1].split("|");
	if(srv[0] != "SRV"){
		log("Second segment didn't begin with SRV");
		return;
	}
	
	// [ Get service name ]
	var serviceName = null;
	if(typeof srv[1] !== "string" ){
		log("Service name invalid");
		return;
	}
	if(srv[1].trim() == ""){
		log("Service name empty");
		return;
	}
	serviceName = srv[1].trim();
	
	// [ Look for service info ]
	var service = null;
	for(var i = 0; i < services.services.length; i++){
		if(services.services[i].serviceName == serviceName){
			service = services.services[i];
			break;
		}
	}
	
	// [ Make sure service was found ]
	if(service == null){
		log("Couldn't find service with provided service name");
		return;
	}
	
	// [ Execute service ]
    var url = 'http://localhost:' + service.port + service.path;
	log("Executing " + service.serviceName + "...");
    log("Making REST HTTP request to " + url + "...");
    
    request.get(url, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log(body) 
      }
    })
}

// [ Creates the server ]
function createServer(err, ip, fam) {
    log("Determined local IP address:" + ip,1)
	// [ Create the TCP server ]
	log("Creating Server...");
	var server = net.createServer(function (socket){
	   socket.setEncoding('utf8');
		
		var client = {
			 socket:socket
			,buffer:""	
			,messages:[]
		}
		
		// [ When a client connects, push them to a list of clients ]
		clients.push(client);
		
		// [ Listen for messages ]
		(function listenForMessages(client){
			client.socket.on("data",function(data){
                
				// Add any recieved data to buffer
				client.buffer += data;
                										
				// [ Checks buffer for any new messages ]
				while(client.buffer.indexOf(String.fromCharCode(EOM)) >= 0){
					// [ Adds charachters to message until EOM is reached]
					var message = "";
				
					// [ If buffer doesn't start with BOM then invalid data ]
					if(client.buffer.charCodeAt(0) != BOM && client.buffer.length > 0){
						// First try to remove any beginning whitespace before declaring invalid
						while(
							   whitespace.indexOf(client.buffer.charCodeAt(0)) >= 0 
							&& client.buffer.length > 0 
							&& client.buffer.charCodeAt(0) != BOM 
							&& client.buffer.charCodeAt(0) != EOM
							&& client.buffer.charCodeAt(0) != EOS
						){
							client.buffer = client.buffer.substr(1);
						}
						
						if(client.buffer.charCodeAt(0) != BOM && client.buffer.length > 0){
							client.buffer = "";
							log("Recieved invalid message, clearing buffer. Message must start with <BOM>");
							break;				
						}
					}

					// Assumed buffer will always begin with BOM because it passed the above check
					for(var i = 0; i < client.buffer.length; i++){
						message += client.buffer[i];
						
						if(client.buffer.charCodeAt(i) == EOM){
							// [ Remove message from buffer ]
							// .replace only replaces the first occurance which is good here
							client.buffer = client.buffer.replace(message,"");
							
							// Remove any following whitespace (including newlines) to keep buffer clean
							while(
								   whitespace.indexOf(client.buffer.charCodeAt(0)) >= 0 
								&& client.buffer.length > 0 
								&& client.buffer.charCodeAt(0) != BOM 
								&& client.buffer.charCodeAt(0) != EOM
								&& client.buffer.charCodeAt(0) != EOS
							){
								client.buffer = client.buffer.substr(1);
							}
							break;
						}
					}
					
					// Remove BOM and EOM from message because they are not needed anymore
					message = message.replace(String.fromCharCode(EOM),"");
					message = message.replace(String.fromCharCode(BOM),"");
					
					log("Recieved Message");
					client.messages.push(message);
					
				}
				
				for(var i = client.messages.length - 1; i >= 0; i--){
					consumeMessage(client.messages[i]);
					
					// [ Remove message so it's not consumed twice ]
					client.messages.splice(i, 1);
				}


			});			
		})(client);

		
		//socket.end('goodbye\n');
	}).on('error', function(err){
		// handle errors here
		throw err;
	});

    log("Created server");
	// [ Listen for Connections ]
	server.listen(2016, ip, function(){
		var info = server.address();
		log('Server listening on ' + info.address + ":" + info.port + "...");
	});
}

// [ Look up the local private IP and then start the server ]
log("Looking up IP address...");
dns.lookup(require('os').hostname(), createServer);



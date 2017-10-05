'use strict';

const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
const mic = require('mic');

module.exports = function (RED) {

  function Node (config) {
    RED.nodes.createNode(this, config);
    let node = this;

    let speech_to_text = new SpeechToTextV1({
      "username": this.credentials.username,
      "password": this.credentials.password
    });

    let sttStream = undefined;
    let micInputStream = undefined;
    let micInstance = undefined;
    let isRunning = false;

    let closeStreams = () => {
      try {
        if (micInstance) {
          micInstance.stop();
        }
        if (micInputStream) {
          micInputStream.end();
        }
        if (sttStream) {
          sttStream.end();
          sttStream = undefined;
        }
        return true;
      } 
      catch (err) {
        node.error('Cloud not close streams', err);
        return false;
      }
    }

    node.on('input', function (msg) {
      if (!msg.payload) {
        let message = 'Missing property: msg.payload';
        node.error(message, msg);
        return;
      }
      let { payload } = msg;
    
      switch (payload) {
        case 'start':
          isRunning = true;
          node.status({fill:"yellow", shape:"dot", text:"starting"});
          micInstance = mic({
              rate: '48000',
              bitwidth: '16',
              endian: 'little',
              encoding: 'signed-integer',
              channels: '1',
              debug: false,
              exitOnSilence: 0,
              device: config.device
          });

          micInstance.start();

          micInputStream = micInstance.getAudioStream();

          let counter = 0;
          let value = 0;
          let silenceSamples = 0;
          let trigger = config.silence * 16;
          let treshold = config.treshold*32768;
          let firstBuffer;
          micInputStream.on('data', function (data) {
            if (!isRunning) {
              return;
            }
            if (!firstBuffer) {
              firstBuffer = data;
            } 
            else {
              for (let i=0; i < data.length; i = i + 2) {
                let buffer = new ArrayBuffer(16);
                let int8View = new Int8Array(buffer);
                int8View[0] = data[i];
                int8View[1] = data[i+1];
                let timepoint = new Int16Array(buffer,0,1)[0];
                value = value + Math.abs(timepoint);
                counter++;
                
                if (counter === 4000) {
                  value = value / 4000;
                  if (value > treshold) {
                    silenceSamples = 0;
                  } else {
                    silenceSamples++;
                    if (silenceSamples === trigger) {
                      if (isRunning) {
                        node.send({payload:'silence'});
                        node.status({fill:"blue", shape:"dot", text:"silence"});
                      }
                      if (sttStream) {
                        sttStream.end();
                        sttStream = undefined;
                      }
                    }
                  }
                  counter = 0;
                  value = 0;
                }
              }

              if (silenceSamples < trigger) {
                if (!sttStream) {
                  let recognizeConfig = { 
                    content_type: 'audio/l16; rate=48000;', 
                    model:config.model, 
                    interim_results: true,
                    inactivity_timeout: parseInt(config.silence)
                  }
                  sttStream = speech_to_text.createRecognizeStream(recognizeConfig);
                  sttStream.write(firstBuffer);
                  sttStream.on('results', function(data) {
                    if (data.results[0] && data.results[0].alternatives[0] && data.results[0].alternatives[0].transcript) {
                      if (data.results[0].final === false) {
                        node.status({fill:"blue", shape:"dot", text:data.results[0].alternatives[0].transcript});
                      } 
                      else if (data.results[0].final === true) {
                        node.send({payload: data.results[0].alternatives[0].transcript.toString('utf8')});
                        node.status({fill:"green", shape:"dot", text:"done " + data.results[0].alternatives[0].transcript.toString('utf8')});
                      }
                    }
                  });

                  sttStream.on('close', (code, reason) => {
                    console.log(`Code: ${code} Reason: ${reason}`);
                  });
                  sttStream.on('error', (err) => {
                    console.log(`Error in Speech To Text: ${err}`);
                  });

                }
                sttStream.write(data);
              }
            }
          });

          micInputStream.on('error', function(err) {
            node.status({fill:"red", shape:"dot", text:"mic stream error"})
            cosole.log("Error in Input Stream: " + err);
          });

          micInputStream.on('startComplete', function() {
            node.status({fill:"green", shape:"dot", text:"waiting for input"});
          });
              
          micInputStream.on('processExitComplete', function() {
            node.status({fill:"red", shape:"dot", text:"process exited"});
          });

          break;
        case 'stop':
          isRunning = false;
          node.status({fill:"Red", shape:"dot", text:"stopped"});
          closeStreams();
          break;
        default:
          node.status({fill:"Red", shape:"dot", text:"invalid input"});
          break;
      }

    });

    node.on('close', function() {
      node.status({fill:"red", shape:"dot", text:"closed"});
      closeStreams();
    });

  }

  RED.nodes.registerType("micro-to-watson-speech-to-text-stream", Node, { 
    credentials: {
      username: {type:"text"},
      password: {type:"password"}
    }
  });

}

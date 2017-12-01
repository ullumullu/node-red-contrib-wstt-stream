'use strict';

const debug = require('debug')('wstt:node-red')
const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
const mic = require('mic');

module.exports = function (RED) {

  /**
   * Watson Speech to Text Stream Node
   * @param {*} config 
   */
  function Node (config) {
    debug('ENTER Creade WSTT Node %o', config);
    RED.nodes.createNode(this, config);
    let node = this;

    let speech_to_text = new SpeechToTextV1({
      username: this.credentials.username,
      password: this.credentials.password
    });

    let micInstance = undefined;
    let sttStream = undefined;
    let micInputStream = undefined;

    let isRunning = false;

    let closeStreams = () => {
      debug('ENTER closeStreams');
      try {
        if (micInstance) {
          debug('Stop micInstance');
          micInstance.stop();
        }
        
        if (micInputStream) {
          debug('Stop micInputStream');
          micInputStream.end();
        }
        if (sttStream) {
          debug('Stop sttStream');
          sttStream.end();
        }
        return true;
      } 
      catch (err) {
        node.error('Could not close streams', err);
        return false;
      }
      finally {
        debug('EXIT closeStreams');
      }
    }

    node.on('input', function (msg) {
      let { payload = '' } = msg;
    
      switch (payload) {
        case 'start':
          node.status({fill:"yellow", shape:"dot", text:"starting"});

          let trigger = config.silence * 16;
          let treshold = config.treshold * 32768;
          let counter = 0;
          let value = 0;
          let silenceSamples = 0;
          let firstBuffer;
          let lastResult = ''; 

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

          micInputStream = micInstance.getAudioStream();

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
                
                counter++;
                value = value + Math.abs(timepoint);
                if (counter === 3000) {
                  value = value / 3000;
                  
                  if (value > treshold) {
                    silenceSamples = 0;
                  } else {
                    silenceSamples++;
                    if (silenceSamples === trigger) {
                      debug('Silence triggered');
                      if (isRunning) {
                        node.send({payload:'silence'});
                        node.status({fill:"blue", shape:"dot", text:`Silence. Last Result: ${lastResult}`});
                      }
                      if (sttStream) {
                        debug('End sttStream');
                        sttStream.end();
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
                    inactivity_timeout: parseInt(config.silence)+1
                  }
                  sttStream = speech_to_text.createRecognizeStream(recognizeConfig);
                  sttStream.write(firstBuffer);
                  sttStream.on('results', function (data) {
                    let {results = []} = data;
                    let firstResult = results[0];

                    if (!(firstResult && firstResult.alternatives[0] && firstResult.alternatives[0].transcript)) {
                      debug('WARN: No results from STT Service. Data - %o', data);
                      return;
                    }

                    if (firstResult.final === false) {
                      node.status({
                        fill:"blue", 
                        shape: "dot", 
                        text: firstResult.alternatives[0].transcript
                      });
                    } 
                    else if (firstResult.final === true) {
                      lastResult = firstResult.alternatives[0].transcript.toString('utf8');
                      debug('Final Text: %s', lastResult);
                      node.send({
                        payload: lastResult
                      });
                      node.status({
                        fill:"green", 
                        shape:"dot", 
                        text: "Final: " + lastResult
                      });
                    }

                  });

                  sttStream.on('close', (code, reason) => {
                    debug(`Close Stream - Code: ${code} Reason: ${reason}`);
                    sttStream = undefined;
                  });

                  sttStream.on('error', (err) => {
                    debug(`Error in Speech To Text: ${err}`);
                  });

                }
                sttStream.write(data);
              }
            }
          });

          micInputStream.on('stopComplete', function() {
            debug('EVENT: stopComplete');
            isRunning = false;
            micInstance = undefined;
            micInputStream = undefined;
            debug('Mic Stream Closed');
          });

          micInputStream.on('startComplete', function() {
            debug('EVENT: startComplete');
            isRunning = true;
            node.status({fill:"green", shape:"dot", text:"waiting for input"});
            debug('Mic Stream Opened')
          });

          micInputStream.on('error', function(err) {
            debug('EVENT: error');
            node.status({fill:"red", shape:"dot", text:"mic stream error"})
            debug("Error in Input Stream: " + err);
          });

          micInputStream.on('processExitComplete', function() {
            debug('EVENT: processExitComplete');
            node.status({fill:"red", shape:"dot", text:"process exited"});
          });

          micInstance.start();

          break;
        case 'stop':
          node.status({fill:"Red", shape:"dot", text:"stopped"});
          closeStreams();
          break;
        default:
          node.status({fill:"Red", shape:"dot", text:`Invalid input to msg.payload: ${msg.payload}`});
          break;
      }

    });

    node.on('close', function() {
      debug('EVENT: close');
      node.status({fill:"red", shape:"dot", text:"closed"});
      closeStreams();
      debug('Node closed');
    });

  }

  RED.nodes.registerType("micro-to-watson-speech-to-text-stream", Node, { 
    credentials: {
      username: {type:"text"},
      password: {type:"password"}
    }
  });

}

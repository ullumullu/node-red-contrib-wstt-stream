/**
 * Copyright 2017 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* jslint node: true, esversion: 6 */

'use strict';

const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
const mic = require('mic');

module.exports = function(RED) {

  function Node(config) {
    RED.nodes.createNode(this, config);
    let node = this;

    let speech_to_text = new SpeechToTextV1({
      "username": this.credentials.username,
      "password": this.credentials.password
    });

    let sttStream;
    let micInputStream;
    let micInstance;

    node.on('input', function(msg) {
      if (!msg.payload) {
        let message = 'Missing property: msg.payload';
        node.error(message, msg);
        return;
      }
      let { payload } = msg;
    
      switch (payload) {
        case 'start':
          node.status({fill:"yellow", shape:"dot", text:"starting"});
          micInstance = mic({
              rate: '16000',
              bitwidth: '16',
              endian: 'little',
              encoding: 'signed-integer',
              channels: '1',
              debug: false,
              exitOnSilence: 0,
              device:"plughw:1,0"
          });

          micInstance.start();

          micInputStream = micInstance.getAudioStream();

          let counter = 0;
          let value = 0;
          let silenceSamples = 0;
          let trigger = config.silence * 4; // 3 seconds
          let treshold = config.treshold*32768;
          let firstBuffer;
          micInputStream.on('data', function(data) {
            // console.log('ondata');
            if(!firstBuffer) firstBuffer = data;

            for(let i=0; i < data.length; i = i + 2) {
              let buffer = new ArrayBuffer(16);
              let int8View = new Int8Array(buffer);
              int8View[0]=data[i];
              int8View[1]=data[i+1];
              value = (value + Math.abs(new Int16Array(buffer,0,1)[0]))/2;
              counter++;
              
              if(counter === 4000) {
                if(value > treshold) {
                  silenceSamples = 0;
                } else {
                  silenceSamples++;
                  if(silenceSamples === trigger) {
                    // console.log('silence');
                    if (sttStream) sttStream.end();
                    sttStream = undefined;
                    node.send({payload:'silence'});
                    node.status({fill:"blue", shape:"dot", text:"silence"});
                  }
                }
                counter = 0;
                value = 0;
              }
            }
            if (silenceSamples < trigger) {
              // console.log('ondata write');
              if(!sttStream) {
                sttStream = speech_to_text.createRecognizeStream({ content_type: 'audio/l16; rate=40000', model:'en-US_BroadbandModel', "interim_results": "false"});
                sttStream.write(firstBuffer);
                sttStream.on('results', function(data) {
                  if(
                    data.results[0] && 
                    data.results[0].final === false &&
                    data.results[0].alternatives[0] &&
                    data.results[0].alternatives[0].transcript
                    ) {
                    node.status({fill:"blue", shape:"dot", text:data.results[0].alternatives[0].transcript});
                  } else if(
                    data.results[0] && 
                    data.results[0].final === true &&
                    data.results[0].alternatives[0] &&
                    data.results[0].alternatives[0].transcript
                    ) {
                    node.send({payload: data.results[0].alternatives[0].transcript.toString('utf8')});
                    node.status({fill:"green", shape:"dot", text:"done " + data.results[0].alternatives[0].transcript.toString('utf8')});
                  }
                });
              }
              // console.log('sttStream !== undefined ', sttStream !== undefined);
              sttStream.write(data);
            } 
            // console.log('ondata end ');
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
          node.status({fill:"Red", shape:"dot", text:"stopped"});
          if (micInstance) micInstance.stop();
          if (micInputStream) micInputStream.end();
          if (sttStream) {sttStream.end(); sttStream = undefined;}
          break;
        default:
          node.status({fill:"Red", shape:"dot", text:"invalid input"});
          break;
      }

    });

    node.on('close', function() {
      node.status({fill:"red", shape:"dot", text:"closed"});
      if (micInstance) micInstance.stop();
      if (micInputStream) micInputStream.end();
      if (sttStream) sttStream.end();
    });

  }

  RED.nodes.registerType("micro-to-watson-speech-to-text-stream", Node, { 
    credentials: {
      username: {type:"text"},
      password: {type:"password"}
    }
  });

}
